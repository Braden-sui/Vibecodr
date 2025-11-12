"use client";

import { useState } from "react";
import Link from "next/link";
import { LiveSessionCard, type LiveSession } from "@/components/live/LiveSessionCard";
import { LiveWaitlistDialog } from "@/components/live/LiveWaitlistDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trackEvent } from "@/lib/analytics";
import { Shield, Sparkles } from "lucide-react";

const sessions: LiveSession[] = [
  {
    id: "live-1",
    title: "Building a Weather Capsule with Worker-Edge",
    host: { handle: "sarah_dev", plan: "pro" },
    status: "scheduled",
    startTime: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(),
    runner: "worker-edge",
    capabilities: ["pointer-sync", "param-timeline", "chat"],
    waitlistOnly: true,
    tags: ["weather", "worker-edge", "api"],
    minutesBudget: 45,
  },
  {
    id: "live-2",
    title: "Remix Jam: Generative Textures",
    host: { handle: "marta", plan: "team" },
    status: "live",
    startTime: new Date().toISOString(),
    runner: "webcontainer",
    capabilities: ["pointer-sync", "chat"],
    waitlistOnly: false,
    tags: ["live", "remix", "canvas"],
    minutesBudget: 30,
  },
  {
    id: "live-3",
    title: "Capsule Safety Office Hours",
    host: { handle: "staff", plan: "team" },
    status: "scheduled",
    startTime: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    runner: "client-static",
    capabilities: ["chat", "recording"],
    waitlistOnly: true,
    tags: ["moderation", "safety"],
    minutesBudget: 25,
  },
];

export default function LivePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);

  const handleJoin = (session: LiveSession) => {
    setSelectedSession(session);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-gradient-to-br from-purple-600/10 to-indigo-600/10 p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="w-fit gap-2 bg-white/80 text-purple-700">
              <Sparkles className="h-4 w-4" />
              Phase 5 beta
            </Badge>
            <h1 className="text-3xl font-bold tracking-tight">Live Capsules</h1>
            <p className="text-muted-foreground max-w-2xl">
              Stream a capsule with pointer sync, chat, and param timelines. We gate the beta to keep infra predictable—
              request access and we’ll unlock minutes on Creator+ plans.
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setDialogOpen(true)}>Join waitlist</Button>
            <Button variant="ghost" className="gap-2" asChild>
              <Link
                href="https://github.com/vibecodr/vibecodr/blob/main/docs/checklist.mdx"
                target="_blank"
                rel="noreferrer"
              >
                View checklist
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {sessions.map((session) => (
          <LiveSessionCard key={session.id} session={session} onJoin={handleJoin} />
        ))}
      </section>

      <section className="rounded-xl border p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">How Live access works</h2>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              <li>Creator plans include 50 live minutes/month; Pro/Team unlock more.</li>
              <li>We alert you at 80% usage so you can upgrade or pause streams.</li>
              <li>Every session records lightweight analytics for incident response.</li>
            </ul>
          </div>
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-medium">
              <Shield className="h-4 w-4" />
              Safety guardrails
            </div>
            <p className="mt-2">
              Streams run inside the existing sandbox. Reports go straight to the moderation queue if a viewer flags
              them.
            </p>
          </div>
        </div>
      </section>

      <LiveWaitlistDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setSelectedSession(null);
          } else if (selectedSession) {
            trackEvent("live_waitlist_opened", { sessionId: selectedSession.id });
          }
        }}
        session={selectedSession}
      />
    </div>
  );
}
