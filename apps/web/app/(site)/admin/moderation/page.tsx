"use client";

// Route: /admin/moderation — Moderation queue (MVP simplified)
// Responsibilities
// - List reports; allow quarantine/unquarantine
// TODOs
// - Authz gate; audit log for actions

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";

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
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/moderation/reports?status=pending&limit=50");

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
      const res = await fetch(`/api/moderation/reports/${reportId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

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

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (data && ((data as any).error || (data as any).message)) || "Failed to resolve report";
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
                      <Link href={`/player/${report.targetId}`} className="underline">
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
