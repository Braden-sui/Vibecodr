"use client";

import { useEffect, useState } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
import { moderationApi } from "@/lib/api";

type AuditEntry = {
  id: string;
  moderatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  notes?: string | null;
  createdAt: number;
};

type PublicMetadata = {
  role?: string;
} | null;

export default function ModerationAuditPage() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditEntry[]>([]);

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
        const res = await moderationApi.getAuditLog({ limit: 100 }, init);
        if (res.status === 401) {
          toast({
            title: "Sign in required",
            description: "Please sign in as an admin to view the audit log.",
            variant: "warning",
          });
          return;
        }
        if (res.status === 403) {
          toast({
            title: "Forbidden",
            description: "Only admins can view the moderation audit log.",
            variant: "error",
          });
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to fetch audit log (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setEntries(data.entries ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          toast({
            title: "Failed to load audit log",
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

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Moderation audit</h1>
        <p className="text-sm text-muted-foreground">Only admins can access this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Moderation audit log</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No moderation actions recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {entry.action} {entry.targetType} {entry.targetId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    by {entry.moderatorId} {" - "} {new Date(entry.createdAt * 1000).toLocaleString()}
                  </div>
                </div>
                <Badge variant="outline" className="uppercase">
                  {entry.action}
                </Badge>
              </CardHeader>
              {entry.notes && (
                <CardContent>
                  <p className="text-sm text-muted-foreground">{entry.notes}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
