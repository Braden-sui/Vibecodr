"use client";

import { useCallback, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LiveSession } from "./LiveSessionCard";
import { trackEvent } from "@/lib/analytics";
import { liveApi } from "@/lib/api";
import { redirectToSignIn, useBuildAuthInit } from "@/lib/client-auth";
import { Plan, normalizePlan } from "@vibecodr/shared";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: LiveSession | null;
}

export function LiveWaitlistDialog({ open, onOpenChange, session }: Props) {
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [plan, setPlan] = useState<Plan>(Plan.FREE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const buildAuthInit = useBuildAuthInit();

  const resetForm = () => {
    setEmail("");
    setHandle("");
    setPlan(Plan.FREE);
    setMessage("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setIsSubmitting(true);
    setMessage("");

    try {
      const sessionId = session?.id ?? "live-beta-general";
      const init = await buildAuthInit();
      const response = await liveApi.joinWaitlist(
        {
          sessionId,
          email,
          handle,
          plan,
        },
        init
      );

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = await response.json();
      if (!response.ok || data.error) {
        const errorMessage =
          typeof data.error === "string" ? data.error : "Failed to join waitlist. Please try again.";
        throw new Error(errorMessage);
      }

      trackEvent("live_waitlist_submitted", { sessionId, plan });
      resetForm();
      setMessage("You're on the list. We'll email you as soon as slots open up.");
    } catch (error) {
      console.error("Failed to join waitlist", error);
      const nextMessage =
        error instanceof Error ? error.message : "Something went wrong. Please try again shortly.";
      setMessage(nextMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetForm();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Join the live beta waitlist</DialogTitle>
          <DialogDescription>
            {session
              ? `Reserve a spot for "${session.title}". Live minutes are limited while we scale Phase 5.`
              : "Reserve a spot to showcase your projects live with pointer sync and chat. Demo your vibes, walk through features, or stream your coding process."}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="handle">Vibecodr handle</Label>
            <Input
              id="handle"
              required
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@yourname"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Contact email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Current plan</Label>
            <Select value={plan} onValueChange={(value) => setPlan(normalizePlan(value, plan))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={Plan.FREE}>Free</SelectItem>
                <SelectItem value={Plan.CREATOR}>Creator</SelectItem>
                <SelectItem value={Plan.PRO}>Pro</SelectItem>
                <SelectItem value={Plan.TEAM}>Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Live minutes are included on Creator plans and above. We'll nudge you if you're close to your quota.
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Join waitlist"}
          </Button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
