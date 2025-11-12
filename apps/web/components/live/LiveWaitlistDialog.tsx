"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LiveSession } from "./LiveSessionCard";
import { trackEvent } from "@/lib/analytics";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: LiveSession | null;
}

export function LiveWaitlistDialog({ open, onOpenChange, session }: Props) {
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [plan, setPlan] = useState<"free" | "creator" | "pro" | "team">("free");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const resetForm = () => {
    setEmail("");
    setHandle("");
    setPlan("free");
    setMessage("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;

    setIsSubmitting(true);
    setMessage("");

    try {
      // TODO: POST /api/live/waitlist
      await new Promise((resolve) => setTimeout(resolve, 800));
      trackEvent("live_waitlist_submitted", {
        sessionId: session.id,
        plan,
      });
      setMessage("You're on the list. We'll email you as soon as slots open up.");
      resetForm();
    } catch (error) {
      console.error("Failed to join waitlist", error);
      setMessage("Something went wrong. Please try again shortly.");
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
              ? `Reserve a spot for “${session.title}”. Live minutes are limited while we scale Phase 5.`
              : "Reserve a spot to stream your capsule with pointer sync + chat."}
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
            <Select value={plan} onValueChange={(value) => setPlan(value as typeof plan)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="creator">Creator</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Live minutes are included on Creator plans and above. We’ll nudge you if you’re close to your quota.
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
