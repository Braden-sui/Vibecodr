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
    <div className="flex items-center justify-center">
      <div className="mt-24 w-full max-w-2xl rounded-xl border p-8 text-center">
        <div className="mb-3 text-4xl">🐞</div>
        <h1 className="text-2xl font-semibold">You naughty little bugger!</h1>
        <p className="mt-2 text-muted-foreground">
          You’ve found a part of our site that isn’t quite live yet — stay tuned!
        </p>
      </div>
    </div>
  );
}
