"use client";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { workerUrl } from "@/lib/api";

type RuntimeAnalyticsSummaryRow = {
  eventName: string;
  total: number;
  lastHour: number;
  lastDay: number;
};

type RuntimeAnalyticsRecentEvent = {
  eventName: string;
  capsuleId: string | null;
  artifactId: string | null;
  runtimeType: string | null;
  runtimeVersion: string | null;
  code: string | null;
  message: string | null;
  properties: Record<string, unknown> | null;
  createdAt: number;
};

type ErrorEventCount = {
  eventName: string;
  count: number;
};

type CapsuleErrorRate = {
  capsuleId: string;
  total: number;
  errors: number;
  errorRate: number;
};

type CapsuleRunVolume = {
  capsuleId: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
};

type EndpointHealth = {
  total: number;
  fiveXx: number;
  rate: number;
};

type RuntimeHealth = {
  killed: number;
  completed: number;
  killRate: number;
};

type RuntimeAnalyticsResponse = {
  snapshotTime: number;
  summary: RuntimeAnalyticsSummaryRow[];
  recent: RuntimeAnalyticsRecentEvent[];
  errorsLastDay: ErrorEventCount[];
  capsuleErrorRates: CapsuleErrorRate[];
  capsuleRunVolumes: CapsuleRunVolume[];
  health: {
    endpoints: {
      artifacts: EndpointHealth;
      runs: EndpointHealth;
      import: EndpointHealth;
    };
    runtime: RuntimeHealth;
  };
};

type AuthzState = "unknown" | "unauthenticated" | "forbidden" | "authorized";

type PublicMetadata = {
  role?: string;
} | null;

export default function AdminAnalyticsPage() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const [authzState, setAuthzState] = useState<AuthzState>("unknown");
  const [summary, setSummary] = useState<RuntimeAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const endpoints = summary?.health?.endpoints;
  const runtimeHealth = summary?.health?.runtime;

  const buildAuthInit = async (): Promise<RequestInit | undefined> => {
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  useEffect(() => {
    let cancelled = false;

    if (!isSignedIn) {
      setAuthzState("unauthenticated");
      return;
    }

    if (!isAdmin) {
      setAuthzState("forbidden");
      return;
    }

    setAuthzState("authorized");
    setLoading(true);
    setError(null);

    const loadSummary = async () => {
      try {
        const init = await buildAuthInit();
        if (!init) {
          setAuthzState("unauthenticated");
          return;
        }
        const response = await fetch(workerUrl("/runtime-analytics/summary"), init);
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }
        const data = (await response.json()) as RuntimeAnalyticsResponse;
        if (cancelled) return;
        setSummary(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, isSignedIn, getToken]);

  useEffect(() => {
    if (summary && (!endpoints || !runtimeHealth)) {
      console.warn("E-VIBECODR-2401 runtime analytics summary missing health metrics");
    }
  }, [summary, endpoints, runtimeHealth]);

  if (authzState === "unauthenticated") {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Runtime analytics</h1>
        <p className="text-sm text-muted-foreground">Sign in as an administrator to view this dashboard.</p>
      </section>
    );
  }

  if (authzState === "forbidden") {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Runtime analytics</h1>
        <p className="text-sm text-muted-foreground">
          This area is restricted to administrators only.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Runtime analytics</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Observability data for the iframe runtime pipeline. Only administrators can see these metrics.
        </p>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading data...</p>}
      {error && (
        <div className="rounded-lg border border-destructive/60 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          <div className="rounded-xl vc-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Platform health</h2>
                <p className="text-xs text-muted-foreground">
                  Snapshot at {new Date(summary.snapshotTime).toLocaleTimeString()}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                5xx signals come from client_error telemetry; runtime outcomes from player events.
              </p>
            </div>
            <div className="mt-4">
              {endpoints && runtimeHealth ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    { key: "artifacts", label: "Artifacts 5xx", data: endpoints.artifacts },
                    { key: "runs", label: "Runs 5xx", data: endpoints.runs },
                    { key: "import", label: "Import 5xx", data: endpoints["import"] },
                  ].map((item) => (
                    <div key={item.key} className="rounded-lg border border-border/80 bg-background/40 p-3 shadow-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">{formatPercent(item.data.rate)}</span>
                        <span className="text-xs text-muted-foreground">({item.data.fiveXx}/{item.data.total || 1})</span>
                      </div>
                      <p className="text-xs text-muted-foreground">5xx events vs. total client_error signals</p>
                    </div>
                  ))}
                  <div className="rounded-lg border border-border/80 bg-background/40 p-3 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Runtime killed vs completed</p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold">{formatPercent(runtimeHealth.killRate)}</span>
                      <span className="text-xs text-muted-foreground">
                        ({runtimeHealth.killed}/{runtimeHealth.killed + runtimeHealth.completed || 1})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {runtimeHealth.killed} killed / {runtimeHealth.completed} completed
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-sm">
                  {/* INVARIANT: Only render health cards when the Worker response provides endpoint and runtime snapshots. */}
                  <p className="font-semibold text-foreground">Health data unavailable</p>
                  <p className="text-xs text-muted-foreground">
                    The runtime analytics payload is missing health metrics. Check ingestion and Worker logs for
                    E-VIBECODR-2401.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl vc-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Top error events (last 24h)</h2>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Event</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.errorsLastDay.map((row) => (
                      <tr key={row.eventName}>
                        <td className="px-2 py-1">{row.eventName}</td>
                        <td className="px-2 py-1 font-semibold">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl vc-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Top capsules by error rate (last 24h)</h2>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Capsule</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Error rate</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Errors</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.capsuleErrorRates.map((row) => (
                      <tr key={row.capsuleId}>
                        <td className="px-2 py-1">{row.capsuleId}</td>
                        <td className="px-2 py-1 font-semibold">{formatPercent(row.errorRate)}</td>
                        <td className="px-2 py-1">{row.errors}</td>
                        <td className="px-2 py-1">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl vc-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Top capsules by run volume (last 24h)</h2>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Capsule</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Runs</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Completed</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.capsuleRunVolumes.map((row) => (
                      <tr key={row.capsuleId}>
                        <td className="px-2 py-1">{row.capsuleId}</td>
                        <td className="px-2 py-1 font-semibold">{row.totalRuns}</td>
                        <td className="px-2 py-1">{row.completedRuns}</td>
                        <td className="px-2 py-1">{row.failedRuns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl vc-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Event summary</h2>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Event</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Total</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Last hour</th>
                      <th className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">Last day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.summary.map((row) => (
                      <tr key={row.eventName}>
                        <td className="px-2 py-1">{row.eventName}</td>
                        <td className="px-2 py-1 font-semibold">{row.total}</td>
                        <td className="px-2 py-1">{row.lastHour}</td>
                        <td className="px-2 py-1">{row.lastDay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-xl vc-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent events</h2>
              <Link to="/admin/moderation" className="text-xs text-primary underline">
                View moderation queue
              </Link>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {summary.recent.map((item, index) => (
                <div key={`${item.eventName}-${index}`} className="rounded-lg border border-dashed border-border/80 p-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-medium text-muted-foreground">{item.eventName}</span>
                    <span>capsule: {item.capsuleId ?? "n/a"}</span>
                    <span>artifact: {item.artifactId ?? "n/a"}</span>
                    <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                  </div>
                  {(item.message || item.code) && (
                    <div className="mt-1 text-xs text-destructive">
                      {item.code ? `${item.code}: ` : ""}
                      {item.message}
                    </div>
                  )}
                  {item.properties && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded border bg-muted px-2 py-1 text-xs">
                      {JSON.stringify(item.properties, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
