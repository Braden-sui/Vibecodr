# Research: GitHub Import & Storage → Capsules Pipeline

## Overview
What it takes to import from GitHub reliably, respect limits, and cache artifacts for cheap, fast runs on Vibecodr.

## Relevant GitHub Constraints
- File limits: warning > 50 MiB; hard block > 100 MiB; prefer Git LFS for larger files.
- Repo size: keep under 1–5 GB for health (GitHub recommendation).
- Releases: per-asset limit 2 GiB; no bandwidth cap stated for release delivery.
- REST API rate limits: 60 req/hour unauth; 5,000 req/hour authenticated (higher for some org contexts). LFS has separate per-minute buckets.
- Archive endpoints: tarball/zipball export available for a repo ref; good for shallow imports.

## Import Options
- Shallow download then build
  - Use tarball/zipball for a ref; extract; run a static build (esbuild) if needed; emit a manifest + assets bundle.
- GitHub App vs OAuth
  - GitHub App: fine-grained repo access; higher installation limits; webhook friendly.
  - OAuth: simpler; personal scope; lower ceiling for automation.
- Source of truth
  - Cache immutable bundles in R2 keyed by content hash; store manifest separately in D1.

## UX Recommendations
- Import screen: accept GitHub URL or ZIP; show validation + progress (download → analyze → build → upload → ready).
- Clear guidance: flag SSR or server-only code; suggest static export; show detected entry and size before publish.
- License detection: surface SPDX from repo; warn if missing.
- Branch/commit picker: default to default branch HEAD; allow tags.

## Implementation Notes
- Rate limiting: batch GitHub API calls; prefer archive downloads over many content API calls.
- Build: esbuild-wasm in-browser first; fall back to Worker queue for heavy builds.
- Storage: R2 for assets; D1 for capsule record; include integrity hash for tamper checks.
- Security: never execute arbitrary build scripts client-side; whitelist simple static bundling only.

## Sources
- GitHub large files: https://docs.github.com/api/article/body?pathname=/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- REST API rate limits: https://docs.github.com/api/article/body?pathname=/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Git LFS overview: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage

