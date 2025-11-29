"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Camera, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Report composer - Coming Soon
 *
 * Planned features:
 * - Rich text editor with inline vibe snapshots
 * - "Insert vibe snapshot" freezes params/seed
 * - Save drafts; publish to posts table as type=report
 */

const highlights = [
  {
    title: "Rich text editor",
    description: "Write narrative reports with full formatting support.",
    icon: FileText,
  },
  {
    title: "Inline vibe snapshots",
    description: "Embed interactive snapshots of your vibes with frozen params.",
    icon: Camera,
  },
  {
    title: "Publish & share",
    description: "Share your creative process and learnings with the community.",
    icon: Sparkles,
  },
];

export default function NewReport() {
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12">
      <div className="space-y-6 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-3 w-3" />
          Reports
        </div>
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Reports are coming soon</h1>
          <p className="text-lg text-muted-foreground">
            Tell the story of your vibe with rich text and inline snapshots. This feature is under active development.
          </p>
        </div>
        <div className="flex justify-center">
          <Link to="/">
            <Button size="lg" variant="outline">
              Back to feed
            </Button>
          </Link>
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
    </section>
  );
}
