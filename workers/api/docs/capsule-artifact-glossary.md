Capsule/Artifact Glossary
=========================

Purpose: keep capsule, bundle, artifact, and manifest terminology consistent so integrity checks, telemetry, and cleanup logic use the right identifiers.

Definitions
- Capsule: D1 row (`capsules`) that owns a manifest and metadata. `capsuleId` (UUID) is the canonical handle for ownership and permissions. `capsules.hash` stores the bundle content hash.
- Capsule bundle (immutable): All uploaded files plus `manifest.json` stored in R2 under `capsules/{contentHash}/`. `contentHash` comes from `uploadCapsuleBundle` (`generateBundleHash`) and is the authoritative digest for integrity/dedup (`verifyCapsuleIntegrity`).
- Capsule entry file: `manifest.entry` inside the bundle. When runtime artifacts are off, the runtime manifest points directly at this file in R2. When runtime artifacts are on, it is compiled or inlined.
- Artifact (runtime-facing): D1 `artifacts` row keyed by `artifactId`. Used by `/artifacts/:id/manifest|bundle` and runtime telemetry. Created either as a compiled runtime artifact or as a capsule-backed record.
- Capsule-backed artifact: Fallback path in `persistCapsuleBundle` when `RUNTIME_ARTIFACTS_ENABLED` is false or the manifest runner is unsupported. Runtime manifest references the capsule entry key (`capsules/{contentHash}/{entry}`). `bundle_digest` uses the entry digest; it is not the whole bundle hash unless the entry is missing.
- Runtime artifact (compiled): Produced by `createRuntimeArtifactForCapsule` (also `compileDraftArtifact`). For `webcontainer` runners the bundle lives at `artifacts/{artifactId}/bundle.js`; for `client-static` the bundle may stay at the capsule entry key. `bundle_digest` is the digest of the runtime bundle/entry, not the full `contentHash`.
- Runtime manifest: Versioned document from `buildRuntimeManifest` stored in `artifact_manifests` and `artifacts/{artifactId}/v1/runtime-manifest.json` (with optional KV mirror). Carries runtime assets plus `bundle.r2Key` and `bundle.digest`. Canonical identity is `(artifactId, manifestVersion)`.
- Artifact manifest ID: UUID primary key for `artifact_manifests`. Runtime fetchers rely on `artifactId` + `version`; this ID is only for DB row management.
- Content hash vs bundle digest: `contentHash` covers the entire capsule bundle and drives R2 layout; `bundleDigest` is scoped to the runtime payload actually executed. Use `bundleDigest` for CSP/telemetry about runtime bytes; use `contentHash` for storage integrity/deduplication.

Authority map

| Object | Identifier to use | Integrity/digest | Stored at |
| --- | --- | --- | --- |
| Capsule | `capsules.id` | `capsules.hash` (`contentHash`) | D1 row; R2 `metadata.json` mirrors `contentHash` |
| Capsule bundle | `contentHash` | Bundle hash from `generateBundleHash` | R2 `capsules/{contentHash}/...` |
| Runtime artifact (compiled or capsule-backed) | `artifacts.id` | `artifacts.bundle_digest` and runtime manifest `bundle.digest` | D1 `artifacts`; R2 `artifacts/{artifactId}/...` or capsule entry key |
| Runtime manifest | `(artifactId, version)` | `bundle.digest` inside manifest | D1 `artifact_manifests`; R2 `artifacts/{artifactId}/v1/runtime-manifest.json` (KV optional) |

Telemetry and cleanup guardrails
- Log `capsuleId` for user-facing actions (publish/quota/ownership) and only log `contentHash` when diagnosing storage integrity.
- Log `artifactId` (plus `runtimeType`/`runtimeVersion`) for runtime events, player fetches, and run telemetry; `artifactId` is the runtime boundary key even for capsule-backed artifacts.
- Cleanup that removes a capsule should drop D1 rows by `capsuleId` and only delete `capsules/{contentHash}/` when no other capsule rows reference the same hash (see `persistCapsuleBundle` check).
- Cleanup that removes a runtime artifact should delete `artifacts/{artifactId}/...` and the `artifacts`/`artifact_manifests` rows; capsule-backed artifacts still rely on the capsule entry key for their bundle.
