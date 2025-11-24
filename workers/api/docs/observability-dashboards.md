Observability (Workers API)
===========================

Data sources:
- Analytics Engine dataset `vibecodr_analytics_engine`.
- D1 tables (`runs`, `runtime_events`, `proxy_rate_limits`, etc.) and the `/runtime-analytics/summary` API (admin-only) that already aggregates runtime health for the web dashboard.

Event schemas (Analytics Engine)
- `import`: blobs `["import", outcome, plan, code]`; doubles `[totalSizeBytes, fileCount, warningCount]`; indexes `[userId]`.
- `publish`: blobs `["publish", outcome, plan, code, capsuleId]`; doubles `[totalSizeBytes, fileCount, warningCount]`; indexes `[userId]`.
- `artifact_compile`: blobs `["artifact_compile", outcome, runtimeType, errorCode, artifactId]`; doubles `[bundleSizeBytes, elapsedMs, warningCount]`; indexes `[artifactId]`. Additional counters: `artifact_compile_queued|success|failed` (blob only) and bundle warning metrics (doubles `[warningCount]`, indexes `[source]`).
- `run_start` / `run_complete`: blobs `[event, status, plan, capsuleId, postId, error]`; doubles `[durationMs]`; indexes `[runId|capsuleId]`.
- `run_quota_observation`: blobs `["run_quota_observation", plan, userId]`; doubles `[runsThisMonth, percentUsed]`.
- `player_console_log`: blobs `["player_console_log", level, source, message, capsuleId, postId]`; doubles `[timestampMs, sampleRate]`; indexes `[runId]`.
- `runtime_event` (from `/runtime-events`): blobs `[event, capsuleId, artifactId, runtimeType, runtimeVersion, code, message]`; doubles `[timestampMs, isErrorFlag]`; indexes `[artifactId|capsuleId]`. Raw JSON properties also persisted to D1 `runtime_events`.
- `safety_verdict`: blobs `["safety_verdict", entryPath, riskLevel, allow|block, tagsCsv, reasons]`; indexes `[codeHash]`.
- `live_waitlist`: blobs `["live_waitlist", plan, sessionId]`.
- `do_status`: blobs `["do_status"]`; doubles `[1]`.

D1 runtime events
- Table `runtime_events` stores `{ event_name, capsule_id, artifact_id, runtime_type, runtime_version, code, message, properties (JSON), created_at }` for the admin analytics snapshot. Keep it in sync with schema when adding new runtime event fields.

Suggested dashboards
1) **Runtime health** – run success vs fail/kill rates (run_complete), top capsules by error rate (group by capsuleId), and player_console_log volume by level.
2) **Runtime latency** – p95 durationMs for run_complete by capsuleId and plan; p95 artifact compile elapsedMs by runtimeType.
3) **Import/Publish funnel** – counts and totalSizeBytes grouped by plan/userId; warningCount percentile to catch noisy uploads.
4) **Safety posture** – safety_verdict counts by riskLevel and block/allow decision; list blocked hashes.
5) **Runtime events** – event frequency and top error codes via runtime_event (both AE and D1); recent error samples from `/runtime-analytics/summary`.
6) **Live waitlist** – signups by plan/sessionId over time.

Operational tips
- Use `limit=1000` when exploring AE keys/values to capture all blob positions.
- For admin triage, call `GET /runtime-analytics/summary?limit=20&recentLimit=20` instead of ad-hoc queries; it already merges AE + D1 data used by `/admin/analytics`.
