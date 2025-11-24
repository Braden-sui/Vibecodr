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

type RuntimeAnalyticsResponse = {
  snapshotTime: number;
  summary: RuntimeAnalyticsSummaryRow[];
  recent: RuntimeAnalyticsRecentEvent[];
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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Event summary</h2>
              <p className="text-xs text-muted-foreground">
                Snapshot at {new Date(summary.snapshotTime).toLocaleTimeString()}
              </p>
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
                    <span>capsule: {item.capsuleId ?? "—"}</span>
                    <span>artifact: {item.artifactId ?? "—"}</span>
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
