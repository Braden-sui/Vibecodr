"use client";

// Route: /admin/moderation — Moderation queue (MVP simplified)
// Responsibilities
// - List reports; allow quarantine/unquarantine
// TODOs
// - Authz gate; audit log for actions

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUser, useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
import { trackClientError } from "@/lib/analytics";
import { moderationApi } from "@/lib/api";

type ModerationReport = {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: string;
  details?: string | null;
  status: string;
  createdAt: number;
  reporter: {
    id: string;
    handle: string;
  };
};

type PublicMetadata = {
  role?: string;
} | null;

type ResolveAction = "dismiss" | "quarantine";

export default function ModerationQueue() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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
    if (!isAdmin) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const init = await buildAuthInit();
        const res = await moderationApi.listReports({ status: "pending", limit: 50 }, init);

        if (res.status === 401) {
          toast({
            title: "Sign in required",
            description: "Please sign in as an admin to view the moderation queue.",
            variant: "warning",
          });
          return;
        }

        if (res.status === 403) {
          toast({
            title: "Forbidden",
            description: "Only admins can view the moderation queue.",
            variant: "error",
          });
          return;
        }

        if (!res.ok) {
          throw new Error(`Failed to fetch moderation reports (${res.status})`);
        }

        const data = await res.json();
        if (!cancelled) {
          const nextReports = Array.isArray(data.reports) ? (data.reports as ModerationReport[]) : [];
          setReports(nextReports);
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Failed to load moderation queue",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function resolveReport(reportId: string, action: ResolveAction) {
    setSubmittingId(reportId);
    try {
      const init = await buildAuthInit();
      const res = await moderationApi.resolveReport(reportId, action, init);

      if (res.status === 401) {
        toast({
          title: "Sign in required",
          description: "Please sign in as an admin to perform moderation actions.",
          variant: "warning",
        });
        return;
      }

      if (res.status === 403) {
        toast({
          title: "Forbidden",
          description: "You do not have permission to perform this action.",
          variant: "error",
        });
        return;
      }

      let data: { error?: unknown; message?: unknown } | null = null;
      try {
        data = (await res.json()) as { error?: unknown; message?: unknown } | null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-0514 moderation resolve error JSON parse failed", {
            reportId,
            action,
            status: res.status,
            error: message,
          });
        }
        trackClientError("E-VIBECODR-0514", {
          area: "admin.moderationResolve",
          reportId,
          action,
          status: res.status,
          message,
        });
      }
      if (!res.ok) {
        const message =
          (data &&
            (typeof data.error === "string"
              ? data.error
              : typeof data.message === "string"
                ? data.message
                : null)) ||
          "Failed to resolve report";
        toast({
          title: "Action failed",
          description: message,
          variant: "error",
        });
        return;
      }

      setReports((prev) => prev.filter((r) => r.id !== reportId));

      const description =
        action === "quarantine"
          ? "Content has been quarantined and the action was logged."
          : "Report has been dismissed and the action was logged.";

      toast({
        title: "Moderation action recorded",
        description,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setSubmittingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Moderation queue</h1>
        <p className="text-sm text-muted-foreground">Only administrators and moderators can access this page.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Moderation queue</h1>
        <Badge variant="outline">{reports.length} pending</Badge>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pending reports right now.</p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="capitalize">{report.reason}</span>
                    <Badge variant="outline">{report.targetType}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Reported by @{report.reporter.handle} · {new Date(report.createdAt * 1000).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground break-all">
                    Target:{" "}
                    {report.targetType === "post" ? (
                      <Link to={`/player/${report.targetId}`} className="underline">
                        {report.targetId}
                      </Link>
                    ) : (
                      report.targetId
                    )}
                  </div>
                  {report.details && (
                    <div className="text-xs text-muted-foreground">{report.details}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={submittingId === report.id}
                    onClick={() => resolveReport(report.id, "quarantine")}
                  >
                    {submittingId === report.id ? "Working…" : "Quarantine"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submittingId === report.id}
                    onClick={() => resolveReport(report.id, "dismiss")}
                  >
                    {submittingId === report.id ? "Working…" : "Dismiss"}
                  </Button>
                </div>
              </CardHeader>
              {report.details && (
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{report.details}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
