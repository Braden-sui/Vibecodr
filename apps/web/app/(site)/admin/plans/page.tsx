"use client";

import { useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Plan } from "@vibecodr/shared";
import { Plan as PlanEnum } from "@vibecodr/shared";

type AuthzState = "unknown" | "unauthenticated" | "forbidden" | "authorized";
type PublicMetadata = { role?: string } | null;

const PLAN_OPTIONS: Plan[] = [PlanEnum.FREE, PlanEnum.CREATOR, PlanEnum.PRO, PlanEnum.TEAM];

export default function AdminPlansPage() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const [authzState, setAuthzState] = useState<AuthzState>("unknown");
  const [plan, setPlan] = useState<Plan>(PlanEnum.PRO);
  const [userId, setUserId] = useState("");
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ handle?: string; userId?: string; planAfter?: Plan; planBefore?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildAuthInit = async (): Promise<RequestInit | null> => {
    if (typeof getToken !== "function") return null;
    const token = await getToken({ template: "workers" });
    if (!token) return null;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  const handleSubmit = async () => {
    setError(null);
    setResult(null);

    if (!isSignedIn) {
      setAuthzState("unauthenticated");
      return;
    }
    if (!isAdmin) {
      setAuthzState("forbidden");
      return;
    }
    const targetHandle = handle.trim();
    const targetUserId = userId.trim();
    if (!targetHandle && !targetUserId) {
      setError("Provide a handle or user id.");
      return;
    }

    setLoading(true);
    try {
      const init = await buildAuthInit();
      if (!init) {
        setAuthzState("unauthenticated");
        setError("Unable to fetch admin token.");
        return;
      }
      const response = await adminApi.updateUserPlan(
        { plan, handle: targetHandle || undefined, userId: targetUserId || undefined },
        init
      );

      if (response.status === 401) {
        setAuthzState("unauthenticated");
        setError("Sign in again to continue.");
        return;
      }
      if (response.status === 403) {
        setAuthzState("forbidden");
        setError("Admin access required.");
        return;
      }
      const payload = (await response.json()) as any;
      if (!response.ok || !payload?.ok) {
        setError(typeof payload?.error === "string" ? payload.error : "Failed to update plan");
        return;
      }
      setAuthzState("authorized");
      setResult({
        handle: payload.handle ?? targetHandle,
        userId: payload.userId ?? targetUserId,
        planAfter: payload.planAfter,
        planBefore: payload.planBefore,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  if (!isSignedIn) {
    return <div className="text-sm text-muted-foreground">Sign in to access admin tools.</div>;
  }

  if (!isAdmin) {
    return <div className="text-sm text-muted-foreground">Admin access required.</div>;
  }

  return (
    <section className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin: Gift Plan</h1>
        <p className="text-sm text-muted-foreground">
          Update a user&apos;s plan with Clerk-admin clearance. Changes apply immediately to quotas and new runs.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border p-4 shadow-sm">
        <div className="grid gap-2">
          <Label htmlFor="target-handle">Handle (preferred)</Label>
          <Input
            id="target-handle"
            placeholder="@handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="target-user-id">User ID (fallback)</Label>
          <Input
            id="target-user-id"
            placeholder="clerk_user_id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="grid gap-2">
          <Label>Plan</Label>
          <Select value={plan} onValueChange={(value) => setPlan(value as Plan)} disabled={loading}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose plan" />
            </SelectTrigger>
            <SelectContent>
              {PLAN_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Updating..." : "Update Plan"}
          </Button>
          {authzState === "forbidden" && <p className="text-sm text-destructive">Admin access required.</p>}
          {authzState === "unauthenticated" && <p className="text-sm text-destructive">Sign in again.</p>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p className="font-medium">Updated</p>
            <p>
              Handle: <span className="font-mono">{result.handle || "n/a"}</span>
            </p>
            <p>
              User ID: <span className="font-mono">{result.userId || "n/a"}</span>
            </p>
            <p>
              Plan: {result.planBefore ? `${result.planBefore} → ` : ""}{" "}
              <span className="font-semibold">{result.planAfter}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
