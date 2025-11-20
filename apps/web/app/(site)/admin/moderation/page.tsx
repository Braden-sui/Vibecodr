"use client";

// Route: /admin/moderation - Moderation queue (MVP simplified)
// Responsibilities
// - List reports; allow quarantine/unquarantine
// - Enforce moderator/admin authz with token-backed checks and audit notes for every resolve action

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUser, useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
import { trackClientError, trackEvent } from "@/lib/analytics";
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
  isModerator?: boolean;
} | null;

type ResolveAction = "dismiss" | "quarantine";

type AuthzState = "unknown" | "unauthenticated" | "forbidden" | "authorized";

function buildResolveAuditNote(params: {
  action: ResolveAction;
  report?: ModerationReport;
  actorId?: string | null;
}): string {
  const segments = ["source=admin_queue", `action=${params.action}`];

  if (params.report) {
    segments.push(`target=${params.report.targetType}:${params.report.targetId}`);
    segments.push(`reason=${params.report.reason}`);
  }

  if (params.actorId) {
    segments.push(`actor=${params.actorId}`);
  }

  return segments.join(" | ");
}

export default function ModerationQueue() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";
  const isModeratorFlag = role === "moderator" || metadata?.isModerator === true;
  const isModeratorOrAdmin = !!user && isSignedIn && (isAdmin || isModeratorFlag);
  const actorId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [authzState, setAuthzState] = useState<AuthzState>("unknown");

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

    async function load() {
      setLoading(true);

      if (!isSignedIn) {
        if (!cancelled) {
          setAuthzState("unauthenticated");
          setReports([]);
          setLoading(false);
        }
        return;
      }

      if (!isModeratorOrAdmin) {
        if (!cancelled) {
          setAuthzState("forbidden");
          setReports([]);
          setLoading(false);
        }
        return;
      }

      try {
        const init = await buildAuthInit();
        if (!init) {
          if (!cancelled) {
            setAuthzState("unauthenticated");
            setReports([]);
            toast({
              title: "Sign in required",
              description: "Authenticate as a moderator or admin to view the moderation queue.",
              variant: "warning",
            });
            setLoading(false);
          }
          return;
        }

        const res = await moderationApi.listReports({ status: "pending", limit: 50 }, init);

        if (res.status === 401) {
          if (!cancelled) {
            setAuthzState("unauthenticated");
            toast({
              title: "Sign in required",
              description: "Please sign in as a moderator or admin to view the moderation queue.",
              variant: "warning",
            });
          }
          return;
        }

        if (res.status === 403) {
          if (!cancelled) {
            setAuthzState("forbidden");
            toast({
              title: "Forbidden",
              description: "Only moderators and admins can view the moderation queue.",
              variant: "error",
            });
          }
          return;
        }

        if (!res.ok) {
          throw new Error(`Failed to fetch moderation reports (${res.status})`);
        }

        const data = await res.json();
        if (!cancelled) {
          const nextReports = Array.isArray(data.reports) ? (data.reports as ModerationReport[]) : [];
          setAuthzState("authorized");
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

    void load();

    return () => {
      cancelled = true;
    };
  }, [isModeratorOrAdmin, isSignedIn]);

  async function resolveReport(reportId: string, action: ResolveAction) {
    const report = reports.find((r) => r.id === reportId);
    if (authzState !== "authorized") {
      trackClientError("E-VIBECODR-0515", {
        area: "admin.moderationResolve",
        reportId,
        action,
        authzState,
      });
      toast({
        title: "Not authorized",
        description: "Moderator or admin access is required to resolve reports.",
        variant: "error",
      });
      return;
    }

    setSubmittingId(reportId);
    try {
      const init = await buildAuthInit();
      if (!init) {
        setAuthzState("unauthenticated");
        throw new Error("Authentication is required to perform moderation actions.");
      }

      const auditNotes = buildResolveAuditNote({ action, report, actorId });
      const res = await moderationApi.resolveReport({ reportId, action, notes: auditNotes }, init);

      if (res.status === 401) {
        setAuthzState("unauthenticated");
        toast({
          title: "Sign in required",
          description: "Please sign in as a moderator or admin to perform moderation actions.",
          variant: "warning",
        });
        return;
      }

      if (res.status === 403) {
        setAuthzState("forbidden");
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
      trackEvent("moderation.report_resolved", {
        action,
        reportId,
        targetType: report?.targetType,
        targetId: report?.targetId,
        actorId: actorId ?? undefined,
        source: "admin_queue",
      });

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

  if (authzState === "unauthenticated") {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Moderation queue</h1>
        <p className="text-sm text-muted-foreground">Sign in as a moderator or admin to access this page.</p>
      </section>
    );
  }

  if (authzState === "forbidden") {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">Moderation queue</h1>
        <p className="text-sm text-muted-foreground">Only moderators and administrators can access this page.</p>
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
        <p className="text-sm text-muted-foreground">Loading...</p>
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
                    Reported by @{report.reporter.handle} -{" "}
                    {new Date(report.createdAt * 1000).toLocaleString()}
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
                    {submittingId === report.id ? "Working..." : "Quarantine"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submittingId === report.id}
                    onClick={() => resolveReport(report.id, "dismiss")}
                  >
                    {submittingId === report.id ? "Working..." : "Dismiss"}
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
