"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveWaitlistDialog } from "@/components/live/LiveWaitlistDialog";
import { Sparkles, Pointer, MessageCircle } from "lucide-react";

const highlights = [
  {
    title: "Pointer sync",
    description: "Share your canvas in real time while viewers follow every move.",
    icon: Pointer,
  },
  {
    title: "Built-in chat",
    description: "Keep Q&A in one place while you demo or pair program.",
    icon: MessageCircle,
  },
  {
    title: "Playable capsules",
    description: "Run the vibe as you present so viewers can remix it afterward.",
    icon: Sparkles,
  },
];

export default function LivePage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12">
      <div className="space-y-6 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Live sessions
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Live is in private beta</h1>
          <p className="text-lg text-muted-foreground">
            Join the early access list to present vibes with pointer sync and chat while we finish the rollout.
          </p>
        </div>
        <div className="flex justify-center">
          <Button size="lg" onClick={() => setWaitlistOpen(true)}>
            Join the waitlist
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {highlights.map((item) => (
          <Card key={item.title} className="h-full vc-surface border-0">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="rounded-full bg-muted p-2 text-muted-foreground">
                <item.icon className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{item.description}</CardContent>
          </Card>
        ))}
      </div>

      <LiveWaitlistDialog open={waitlistOpen} onOpenChange={setWaitlistOpen} />
    </section>
  );
}
