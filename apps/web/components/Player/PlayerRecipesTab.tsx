"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";

type RecipeValue = string | number | boolean;

export type PlayerRecipeView = {
  id: string;
  name: string;
  params: Record<string, RecipeValue>;
  author: {
    id: string;
    handle?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  };
  createdAt?: number | null;
  isDefault?: boolean;
};

interface PlayerRecipesTabProps {
  recipes: PlayerRecipeView[];
  isLoading: boolean;
  isSaving: boolean;
  canSave: boolean;
  busyRecipeId?: string | null;
  error?: string | null;
  onSave: (name: string) => Promise<void> | void;
  onApply: (recipe: PlayerRecipeView) => void;
  onUpdate: (recipe: PlayerRecipeView) => Promise<void> | void;
  onDelete: (recipe: PlayerRecipeView) => Promise<void> | void;
  onRefresh?: () => void;
}

function formatRelativeDate(timestamp: number | null | undefined): string {
  if (timestamp == null) return "Just now";
  const ms = typeof timestamp === "string" ? Number(timestamp) * 1000 : timestamp * 1000;
  if (!Number.isFinite(ms)) return "Just now";
  const delta = Date.now() - ms;
  if (delta < 60_000) return "Just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RecipeBadges({ params }: { params: Record<string, RecipeValue> }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      {entries.slice(0, 4).map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-mono text-[11px]">
          {key}: {String(value)}
        </Badge>
      ))}
      {entries.length > 4 && (
        <span className="text-[11px] text-muted-foreground">+{entries.length - 4} more</span>
      )}
    </div>
  );
}

export function PlayerRecipesTab({
  recipes,
  isLoading,
  isSaving,
  canSave,
  busyRecipeId,
  error,
  onSave,
  onApply,
  onUpdate,
  onDelete,
  onRefresh,
}: PlayerRecipesTabProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("New recipe");

  const visibleRecipes = useMemo(() => recipes, [recipes]);

  const handleSave = async () => {
    if (!recipeName.trim()) return;
    if (!canSave) return;
    await onSave(recipeName.trim());
    setIsDialogOpen(false);
    setRecipeName("New recipe");
  };

  const communityCount = visibleRecipes.filter((recipe) => !recipe.isDefault).length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Parameter Recipes</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Save and replay interesting parameter sets without touching code.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh recipes"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!canSave || isSaving}>
                <Wand2 className="mr-2 h-4 w-4" />
                Save current params
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Save a recipe</DialogTitle>
                <DialogDescription>
                  Capture the current controls so others can replay this vibe instantly.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="text-sm font-medium" htmlFor="recipe-name">
                  Recipe name
                </label>
                <Input
                  id="recipe-name"
                  value={recipeName}
                  onChange={(event) => setRecipeName(event.target.value)}
                  maxLength={80}
                  placeholder="Slow Motion, Chaos Mode, Zen..."
                />
                {!canSave && (
                  <p className="text-xs text-muted-foreground">
                    Sign in to publish your recipe to this app.
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving || !canSave || !recipeName.trim()}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save recipe
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            {onRefresh && (
              <Button variant="ghost" size="sm" onClick={onRefresh} className="text-destructive hover:text-destructive">
                Retry
              </Button>
            )}
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading recipes...
          </div>
        </div>
      ) : (
        <ScrollArea className="h-full">
          <div className="space-y-3 pb-4">
            {visibleRecipes.map((recipe) => (
              <Card key={recipe.id} className="space-y-2 border-muted p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{recipe.name}</p>
                      {recipe.isDefault && <Badge variant="secondary">Default</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {recipe.author.handle ? `@${recipe.author.handle}` : "Unknown"} •{" "}
                      {formatRelativeDate(recipe.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={recipe.isDefault ? "outline" : "secondary"}
                      onClick={() => onApply(recipe)}
                      disabled={busyRecipeId === recipe.id}
                    >
                      {busyRecipeId === recipe.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Apply
                    </Button>
                    {!recipe.isDefault && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onUpdate(recipe)}
                          disabled={busyRecipeId === recipe.id}
                        >
                          {busyRecipeId === recipe.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Update
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(recipe)}
                          disabled={busyRecipeId === recipe.id}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <RecipeBadges params={recipe.params} />
              </Card>
            ))}
            {!isLoading && communityCount === 0 && (
              <Card className="border-dashed p-4 text-sm text-muted-foreground">
                No community recipes yet. Be the first to capture an interesting state.
              </Card>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
