"use client";

import { useState } from "react";
import Link from "next/link";
import { PlayerIframe } from "@/components/Player/PlayerIframe";
import { PlayerControls } from "@/components/Player/PlayerControls";
import { PlayerDrawer } from "@/components/Player/PlayerDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

export default function PlayerPage({ params }: { params: { postId: string } }) {
  const { postId } = params;
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ fps: 0, memory: 0, bootTime: 0 });
  const [params, setParams] = useState<Record<string, unknown>>({});

  // TODO: Fetch post data from API
  const mockPost = {
    id: postId,
    title: "Interactive Boids Simulation",
    author: {
      handle: "marta",
      name: "Marta Chen",
    },
    capsule: {
      id: "capsule1",
      runner: "client-static" as const,
      capabilities: {
        net: [],
        storage: false,
        workers: false,
      },
    },
    notes: `This is an interactive simulation of flocking behavior (boids algorithm).

Adjust the parameters to see how the birds' behavior changes:
- **Count**: Number of boids in the simulation
- **Speed**: How fast the boids move
- **Vision**: How far each boid can see

The algorithm implements three rules:
1. Separation: avoid crowding neighbors
2. Alignment: steer towards average heading of neighbors
3. Cohesion: steer towards average position of neighbors`,
    comments: [
      {
        id: "1",
        user: "alex_codes",
        text: "This is amazing! Love how you can tweak the parameters in real-time.",
        timestamp: Date.now() - 86400000,
      },
      {
        id: "2",
        user: "sarah_dev",
        text: "Great implementation! The performance is really smooth even with 100+ boids.",
        timestamp: Date.now() - 43200000,
      },
    ],
  };

  const handleRestart = () => {
    // TODO: Send restart message to iframe
    console.log("Restarting capsule...");
  };

  const handleKill = () => {
    setIsRunning(false);
    // TODO: Kill iframe execution
    console.log("Killing capsule...");
  };

  const handleShare = () => {
    // TODO: Open share dialog
    console.log("Sharing capsule...");
  };

  const handleReport = () => {
    // TODO: Open report dialog
    console.log("Reporting capsule...");
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header */}
      <div className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">{mockPost.title}</h1>
              <Link
                href={`/profile/${mockPost.author.handle}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                by @{mockPost.author.handle}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{mockPost.capsule.runner}</Badge>
            {mockPost.capsule.capabilities.net &&
              mockPost.capsule.capabilities.net.length > 0 && (
                <Badge variant="outline">Network</Badge>
              )}
          </div>
        </div>
      </div>

      {/* Main Player Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Player */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 p-4">
            <PlayerIframe
              capsuleId={mockPost.capsule.id}
              params={params}
              onReady={() => setIsRunning(true)}
              onLog={(log) => console.log("Capsule log:", log)}
              onStats={(s) => setStats(s)}
            />
          </div>

          {/* Controls */}
          <PlayerControls
            isRunning={isRunning}
            stats={stats}
            onRestart={handleRestart}
            onKill={handleKill}
            onShare={handleShare}
            onReport={handleReport}
          />
        </div>

        {/* Right: Drawer */}
        <div className="w-80">
          <PlayerDrawer
            notes={mockPost.notes}
            comments={mockPost.comments}
            remixInfo={{ changes: 0 }}
          />
        </div>
      </div>

      {/* TODO: Implement param controls based on manifest */}
      {/* TODO: Connect to real API */}
      {/* TODO: Implement actual postMessage bridge */}
    </div>
  );
}

