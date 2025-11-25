import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitFork, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemixTreeResponse } from "@/lib/api";

type RemixTreeProps = {
  tree: RemixTreeResponse;
};

function truncate(text: string | null | undefined, max = 96): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

export function RemixTree({ tree }: RemixTreeProps) {
  const nodesById = useMemo(() => {
    const map = new Map<string, RemixTreeResponse["nodes"][number]>();
    for (const node of tree.nodes) {
      const sortedChildren = [...node.children].sort();
      map.set(node.capsuleId, { ...node, children: sortedChildren });
    }
    return map;
  }, [tree.nodes]);

  const renderNode = (nodeId: string) => {
    const node = nodesById.get(nodeId);
    if (!node) return null;
    const note = truncate(node.description);
    const children = node.children
      .map((childId) => nodesById.get(childId))
      .filter(Boolean)
      .sort((a, b) => (a?.createdAt ?? 0) - (b?.createdAt ?? 0));

    return (
      <div key={nodeId} className="relative pl-4">
        <div
          className={cn(
            "rounded-xl border bg-card/80 p-3 shadow-sm transition-shadow",
            node.isRequested && "border-primary/60 shadow-vc-soft"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <GitFork className="h-3 w-3" />
                {node.parentId ? "Remix" : "Original"}
              </div>
              <h4 className="text-base font-semibold leading-tight">
                {node.title ?? "Untitled vibe"}
              </h4>
              <p className="text-xs text-muted-foreground">
                {node.authorHandle ? `@${node.authorHandle}` : "Unknown author"}
                {note ? ` · ${note}` : null}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant="secondary" className="gap-1">
                <GitFork className="h-3 w-3" />
                {node.remixCount}
              </Badge>
              {node.postId && (
                <Link
                  to={`/player/${node.postId}`}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Open
                </Link>
              )}
            </div>
          </div>
        </div>
        {children.length > 0 && (
          <div className="mt-3 space-y-3 border-l border-border/60 pl-4">
            {children.map((child) => child && renderNode(child.capsuleId))}
          </div>
        )}
      </div>
    );
  };

  const focusNode = nodesById.get(tree.requestedCapsuleId);
  const totalRemixes = focusNode?.remixCount ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Remix chain
            </p>
            <h3 className="text-lg font-bold leading-tight">
              {focusNode?.title ?? "Vibe"} family tree
            </h3>
            <p className="text-sm text-muted-foreground">
              {focusNode?.authorHandle ? `@${focusNode.authorHandle}` : "Unknown author"} ·{" "}
              {totalRemixes} remix{totalRemixes === 1 ? "" : "es"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tree.directParentId && (
              <Link
                to={`/vibe/${tree.directParentId}/remixes`}
                className="text-sm font-semibold text-primary hover:underline"
              >
                View parent chain
              </Link>
            )}
            {focusNode?.postId && (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link to={`/player/${focusNode.postId}`}>
                  <Sparkles className="h-4 w-4" />
                  Open in player
                </Link>
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div>{renderNode(tree.rootCapsuleId)}</div>

      {tree.truncated && (
        <p className="text-xs text-muted-foreground">
          Lineage is truncated for size; focus on a branch to see more.
        </p>
      )}
    </div>
  );
}

export default RemixTree;
