"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, GitFork, MessageCircle, Sparkles } from "lucide-react";
import { Comments } from "@/components/Comments";

export interface PlayerDrawerProps {
  postId?: string;
  notes?: string;
  remixInfo?: {
    parentId?: string | null;
    parentTitle?: string | null;
    parentHandle?: string | null;
    parentPostId?: string | null;
    remixCount?: number;
    treeUrl?: string;
  };
  recipesContent?: ReactNode;
  comments?: Array<{
    id: string;
    user: string;
    text: string;
    timestamp: number;
  }>;
  initialTab?: "notes" | "remix" | "chat" | "recipes";
  onTabChange?: (tab: "notes" | "remix" | "chat" | "recipes") => void;
  onRemix?: () => void;
  remixInfoLoading?: boolean;
  remixInfoError?: string | null;
}

export function PlayerDrawer({
  postId,
  notes,
  remixInfo,
  recipesContent,
  comments = [],
  initialTab,
  onTabChange,
  onRemix,
  remixInfoLoading,
  remixInfoError,
}: PlayerDrawerProps) {
  const hasRecipes = Boolean(recipesContent);
  const [tab, setTab] = useState<"notes" | "remix" | "chat" | "recipes">(
    initialTab && (initialTab !== "recipes" || hasRecipes) ? initialTab : "notes"
  );

  useEffect(() => {
    if (initialTab === "recipes" && !hasRecipes) {
      setTab("notes");
      return;
    }
    setTab(initialTab ?? "notes");
  }, [initialTab, hasRecipes]);

  const handleTabChange = (value: string) => {
    const next =
      value === "remix" || value === "chat" || value === "recipes"
        ? (value as "remix" | "chat" | "recipes")
        : "notes";
    if (next === "recipes" && !hasRecipes) {
      setTab("notes");
      return;
    }
    setTab(next);
    onTabChange?.(next);
  };

  const staticComments = !postId ? comments : [];
  return (
    <div className="flex h-full flex-col border-l bg-card">
      <Tabs value={tab} onValueChange={handleTabChange} className="flex h-full flex-col">
        <TabsList className="w-full justify-start rounded-none border-b">
          <TabsTrigger value="notes" className="gap-2">
            <FileText className="h-4 w-4" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="remix" className="gap-2">
            <GitFork className="h-4 w-4" />
            Remix
          </TabsTrigger>
          {hasRecipes && (
            <TabsTrigger value="recipes" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Recipes
            </TabsTrigger>
          )}
          <TabsTrigger value="chat" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            Chat
            {postId == null && staticComments.length > 0 && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {staticComments.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Notes Tab */}
        <TabsContent value="notes" className="flex-1 overflow-auto p-4">
          {notes ? (
            <div className="prose prose-sm max-w-none">
              <p className="text-sm text-muted-foreground">{notes}</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">No notes available</p>
            </div>
          )}
        </TabsContent>

        {/* Remix Tab */}
        <TabsContent value="remix" className="flex-1 overflow-auto p-4">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Remix this vibe</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Fork this vibe in the composer and make your own changes.
              </p>
            </div>

            <Card className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {remixInfo?.parentId ? "Remixed from" : "Origin"}
                  </p>
                  {remixInfo?.parentId ? (
                    <p className="text-sm font-semibold leading-tight">
                      {remixInfo.parentTitle ?? "Original vibe"}{" "}
                      {remixInfo.parentHandle ? `by @${remixInfo.parentHandle}` : null}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This is the first published version of this vibe.
                    </p>
                  )}
                </div>
                {remixInfo?.parentPostId && (
                  <Link
                    to={`/player/${remixInfo.parentPostId}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    View parent
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </Card>

            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <GitFork className="h-4 w-4 text-primary" />
                {remixInfoLoading ? (
                  <span className="text-xs font-normal text-muted-foreground">Loading lineage...</span>
                ) : (
                  <span>
                    {remixInfo?.remixCount ?? 0} remix{(remixInfo?.remixCount ?? 0) === 1 ? "" : "es"}
                  </span>
                )}
              </div>
              {remixInfo?.treeUrl && (
                <Link
                  to={remixInfo.treeUrl}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  View family tree
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>

            {remixInfoError && (
              <p className="text-xs text-muted-foreground">
                Lineage unavailable: {remixInfoError}
              </p>
            )}

            <Button className="w-full gap-2" onClick={onRemix} disabled={!onRemix}>
              <GitFork className="h-4 w-4" />
              Remix in composer
            </Button>
          </div>
        </TabsContent>

        {hasRecipes && (
          <TabsContent value="recipes" className="flex-1 overflow-auto p-4">
            {recipesContent}
          </TabsContent>
        )}

        {/* Chat Tab */}
        <TabsContent value="chat" className="flex-1 overflow-auto p-4">
          {postId ? (
            <Comments postId={postId} className="h-full" />
          ) : staticComments.length > 0 ? (
            <div className="space-y-4">
              {staticComments.map((comment) => (
                <div key={comment.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                    <span className="text-sm font-medium">{comment.user}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="ml-8 text-sm text-muted-foreground">{comment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No comments yet</p>
              <Button variant="outline" size="sm" className="mt-2">
                Be the first to comment
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
