Observability Dashboards (Workers API)
======================================

This documents the key metrics we now emit via `vibecodr_analytics_engine` and suggested dashboards to build (Cloudflare Analytics Engine or D1 queries).

Event schema (analytics_engine)
- import: blobs ["import", outcome, plan, code, ""], doubles [totalSizeBytes, fileCount, warningCount], indexes [userId]
- publish: blobs ["publish", outcome, plan, code, capsuleId], doubles [totalSizeBytes, fileCount, warningCount], indexes [userId]
- run_start/run_complete: blobs [event, status, plan, capsuleId, postId, error], doubles [durationMs], indexes [runId or capsuleId]
- artifact_compile (DO): blobs ["artifact_compile", outcome, runtimeType, errorCode, artifactId], doubles [bundleSizeBytes, elapsedMs, warningCount], indexes [artifactId]

Dashboards to build
1) Top capsules by runs
   - Source: analytics_engine events where event == "run_complete", status == "completed".
   - Group by capsuleId (blob[3]) or index[0], count.
   - Optional filters: plan (blob[2]) or postId (blob[4]).

2) Top users by resource usage
   - Storage/runs already tracked in D1 users table; complement with analytics_engine imports/publish.
   - Source: "import" and "publish" events. Group by userId (index[0]); sum totalSizeBytes (double[0]) and count events.
   - Include plan (blob[2]) to slice by tier.

3) P95 latencies
   - Artifact compile: event "artifact_compile", outcome "success"; p95 of elapsedMs (double[1]).
   - Runs: event "run_complete"; p95 of durationMs (double[0]) grouped by capsuleId or plan.

Quick AE query sketch (pseudocode)
- Filter: blobs[0] = "run_complete" AND blobs[1] = "completed"
- SELECT capsuleId=blobs[3], p95(durationMs)=quantile(0.95)(doubles[0])
- GROUP BY capsuleId

Notes
- Import/publish warn counts are in doubles[2].
- Failure codes are in blobs[3]/blobs[2] depending on event.
- If you prefer D1 for top runs, you can also query the runs table directly, but AE events give plan/post context without extra joins.
