"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiRemixTreeResponseSchema } from "@vibecodr/shared";
import RemixTree from "@/components/RemixTree";
import { remixesApi, type RemixTreeResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { usePageMeta } from "@/lib/seo";

export default function RemixTreePage() {
  const { capsuleId } = useParams();
  const [tree, setTree] = useState<RemixTreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!capsuleId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTree(null);

    (async () => {
      try {
        const response = await remixesApi.tree(capsuleId);
        const raw = await response
          .json()
          .catch(() => ({ error: "Failed to parse remix response" }));

        if (!response.ok) {
          const message =
            raw && typeof raw.error === "string"
              ? raw.error
              : "Failed to load remix lineage";
          throw new Error(message);
        }

        const parsed = ApiRemixTreeResponseSchema.parse(raw);
        if (!cancelled) {
          setTree(parsed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load remix tree");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [capsuleId]);

  const focusTitle = useMemo(() => {
    if (!tree) return "Remix family tree";
    const node = tree.nodes.find((n) => n.capsuleId === tree.requestedCapsuleId);
    return node?.title ? `${node.title} remixes` : "Remix family tree";
  }, [tree]);

  usePageMeta({
    title: focusTitle,
    description: "Explore how this vibe has been remixed over time.",
    url:
      typeof window !== "undefined" && capsuleId
        ? `${window.location.origin}/vibe/${capsuleId}/remixes`
        : undefined,
    type: "article",
    canonicalUrl:
      typeof window !== "undefined" && capsuleId
        ? `${window.location.origin}/vibe/${capsuleId}/remixes`
        : undefined,
  });

  if (!capsuleId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Missing vibe ID.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Remix chain
            </p>
            <h1 className="text-2xl font-bold leading-tight">Family tree</h1>
            <p className="text-sm text-muted-foreground">
              Trace the lineage of this vibe and its remixes.
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading remix family...
        </Card>
      )}

      {error && !loading && (
        <Card className="flex items-center gap-3 p-6 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </Card>
      )}

      {!loading && !error && tree && <RemixTree tree={tree} />}
    </div>
  );
}
