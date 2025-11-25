import { Compass, Home, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { featuredTags } from "@/lib/tags";

const suggestedTags = [...featuredTags];

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-5xl flex-col gap-8 px-6 py-12 md:px-10">
      <div className="relative overflow-hidden rounded-3xl border bg-white/70 p-8 shadow-vc-soft md:p-12">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-10 top-8 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-accent/15 blur-3xl" />
        </div>

        <div className="flex flex-col gap-4 text-center md:text-left">
          <div className="flex items-center justify-center gap-2 md:justify-start">
            <Badge
              variant="secondary"
              className="border-transparent bg-secondary/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary"
            >
              404
            </Badge>
            <span className="text-sm font-semibold text-muted-foreground">Vibe not found</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Page not found</h1>
          <p className="text-lg text-muted-foreground md:max-w-3xl">
            The page you were looking for has drifted away. Jump back to the feed, search for a vibe, or
            explore a tag to keep building.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <Button asChild size="lg" className="shadow-vc-soft">
              <a href="/">
                <Home className="h-4 w-4" />
                Go to feed
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="/discover">Browse discover</a>
            </Button>
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[3fr,2fr]">
          <Card className="border-0 bg-white/80 shadow-inner">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Search the feed</CardTitle>
                <CardDescription>Find creators, tags, or vibes without losing your place.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action="/" method="get" className="flex flex-col gap-3" role="search" aria-label="Search vibes">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    name="q"
                    aria-label="Search the feed"
                    placeholder="Search vibes, creators, or tags"
                    className="h-12 rounded-xl bg-white/90 pl-10"
                  />
                </div>
                <Button type="submit" className="self-start">
                  Search
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-0 bg-white/80 shadow-inner">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="rounded-full bg-accent/10 p-2 text-accent">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Try a popular path</CardTitle>
                <CardDescription>Jump into a tag to get back on track.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {suggestedTags.map((tag) => (
                <Button key={tag} asChild variant="secondary" size="sm" className="rounded-full">
                  <a href={`/?tags=${encodeURIComponent(tag)}`}>#{tag}</a>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
