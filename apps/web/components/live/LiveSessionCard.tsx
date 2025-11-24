"use client";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Radio, Users, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

export type LiveSession = {
  id: string;
  title: string;
  host: {
    handle: string;
    avatarUrl?: string;
    plan: "creator" | "pro" | "team";
  };
  status: "live" | "scheduled" | "completed";
  startTime: string;
  runner: "client-static" | "webcontainer" | "worker-edge";
  capabilities: Array<"pointer-sync" | "param-timeline" | "chat" | "recording">;
  waitlistOnly?: boolean;
  tags: string[];
  minutesBudget: number;
};

interface Props {
  session: LiveSession;
  onJoin: (session: LiveSession) => void;
}

export function LiveSessionCard({ session, onJoin }: Props) {
  const statusBadge = {
    live: { label: "Live", className: "bg-red-500 text-white" },
    scheduled: { label: "Scheduled", className: "bg-blue-500/10 text-blue-600" },
    completed: { label: "Replay", className: "bg-muted text-muted-foreground" },
  }[session.status];

  const handleJoin = () => {
    trackEvent("live_session_cta", { sessionId: session.id, status: session.status });
    onJoin(session);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge className={statusBadge.className}>{statusBadge.label}</Badge>
          <Badge variant="outline" className="gap-1">
            <Radio className="h-3 w-3" />
            {session.runner}
          </Badge>
          {session.waitlistOnly && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Waitlist
            </Badge>
          )}
        </div>
        <div>
          <CardTitle className="text-xl">{session.title}</CardTitle>
          <CardDescription className="flex items-center gap-2 text-sm">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
            @{session.host.handle} - {session.host.plan.toUpperCase()} plan
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {new Date(session.startTime).toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {session.minutesBudget} min budget
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {session.capabilities.map((cap) => (
            <Badge key={cap} variant="outline">
              {cap}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
          {session.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <p className="text-sm text-muted-foreground">
          {session.waitlistOnly ? "Plan required - request an invite" : "Open to anyone with remix access"}
        </p>
        <Button onClick={handleJoin}>{session.status === "live" ? "Join live" : "Request invite"}</Button>
      </CardFooter>
    </Card>
  );
}
