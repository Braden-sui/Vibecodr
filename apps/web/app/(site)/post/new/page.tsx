"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Code2, Image as ImageIcon, Link2 } from "lucide-react";

export default function ShareVibePage() {
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageName, setImageName] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    window.setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 400);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-4">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-amber-500" />
          Share a vibe
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Share a vibe</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Start with a runnable vibe from Studio, then add context with text, links, or an image. Everything you post
          here shows up as a vibe in the feed.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Code2 className="h-4 w-4" />
                Runnable vibe
              </CardTitle>
              <CardDescription>
                Attach one of your Studio outputs so people can run your vibe inline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="output">Studio output</Label>
                <Select value={selectedOutput} onValueChange={setSelectedOutput}>
                  <SelectTrigger id="output">
                    <SelectValue placeholder="Choose a built vibe from Studio" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sample-1">Example: Boids simulation</SelectItem>
                    <SelectItem value="sample-2">Example: Weather dashboard</SelectItem>
                    <SelectItem value="sample-3">Example: Markdown editor</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  In a later iteration this list will be populated from your published Studio builds.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/studio">Open Studio</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/studio/import">Import a new vibe</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vibe details</CardTitle>
              <CardDescription>
                Optional context that appears alongside your runnable vibe in the feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="caption">Vibe text</Label>
                <Textarea
                  id="caption"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="What should people know before they run this vibe?"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="link" className="flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  Optional link
                </Label>
                <Input
                  id="link"
                  type="url"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://example.com, repo URL, or reference article"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="image" className="flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  Optional image
                </Label>
                <Input id="image" type="file" accept="image/*" onChange={handleImageChange} />
                {imageName && (
                  <p className="text-xs text-muted-foreground">Selected: {imageName}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Helpful for non-code vibes or giving a quick visual of what your vibe does.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                This is a rough preview of how your vibe might appear in the feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Runnable vibe</div>
                <div className="h-32 rounded-md border border-dashed border-muted-foreground/40 bg-background" />
              </div>
              {caption && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Vibe text</div>
                  <p className="rounded-md border bg-background p-2 text-sm">{caption}</p>
                </div>
              )}
              {linkUrl && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Link</div>
                  <p className="truncate text-xs text-blue-600 underline underline-offset-2">{linkUrl}</p>
                </div>
              )}
              {imageName && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Image</div>
                  <p className="text-xs text-muted-foreground">{imageName}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sharing…" : "Share vibe"}
              </Button>
              {submitted && (
                <p className="text-xs text-muted-foreground">
                  This composer is an early shell. Your inputs are not yet saved, but the structure is ready for wiring
                  up persistence and feed integration.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
