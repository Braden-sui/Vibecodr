"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  Globe,
  Lock,
  Eye,
  Rocket,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Publish Tab
 * Final validation and publishing of capsule
 * Based on mvp-plan.md Studio Publish section
 */
export function PublishTab() {
  const [title, setTitle] = useState("My Awesome Capsule");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>(["demo", "interactive"]);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [enableNetwork, setEnableNetwork] = useState(false);
  const [enableStorage, setEnableStorage] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<"idle" | "validating" | "uploading" | "success" | "error">("idle");

  // Validation checks
  type CheckStatus = "pass" | "warning" | "fail";
  const checks: { name: string; status: CheckStatus; message: string }[] = [
    {
      name: "Manifest Valid",
      status: "pass" as const,
      message: "Manifest schema is valid",
    },
    {
      name: "Entry File Exists",
      status: "pass" as const,
      message: "index.html found",
    },
    {
      name: "Bundle Size",
      status: "pass" as const,
      message: "2.3 MB / 25 MB (Free tier)",
    },
    {
      name: "License Detected",
      status: "warning" as const,
      message: "No license file found. Consider adding one.",
    },
    {
      name: "No Server Code",
      status: "pass" as const,
      message: "No server-side code detected",
    },
  ];

  const hasErrors = checks.some((c) => c.status === "fail");
  const hasWarnings = checks.some((c) => c.status === "warning");

  const addTag = () => {
    if (tagInput && !tags.includes(tagInput)) {
      setTags([...tags, tagInput]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setPublishStatus("validating");

    try {
      // Simulate validation
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setPublishStatus("uploading");

      // Simulate upload to R2
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setPublishStatus("success");
    } catch (err) {
      setPublishStatus("error");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Publish Capsule</h2>
        <p className="text-muted-foreground">
          Final checks and metadata before publishing to the feed
        </p>
      </div>

      {/* Validation Checks */}
      <Card>
        <CardHeader>
          <CardTitle>Pre-Flight Checks</CardTitle>
          <CardDescription>
            Ensuring your capsule meets all requirements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checks.map((check, i) => (
            <div key={i} className="flex items-start gap-3">
              {check.status === "pass" ? (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
              ) : check.status === "warning" ? (
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-yellow-600" />
              ) : (
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive" />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{check.name}</span>
                  {check.status === "warning" && (
                    <Badge variant="secondary" className="text-xs">
                      Warning
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{check.message}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Capsule Details</CardTitle>
          <CardDescription>
            This information will be visible in the feed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your capsule a catchy title"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {title.length}/200 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what your capsule does..."
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">
              {description.length}/1000 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Add tags..."
                maxLength={30}
              />
              <Button onClick={addTag} variant="secondary">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  #{tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-1 hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visibility & Capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>Visibility & Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select value={visibility} onValueChange={(v: any) => setVisibility(v)}>
              <SelectTrigger id="visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    <div>
                      <div className="font-medium">Public</div>
                      <div className="text-xs text-muted-foreground">
                        Visible in feed and search
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="unlisted">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    <div>
                      <div className="font-medium">Unlisted</div>
                      <div className="text-xs text-muted-foreground">
                        Only accessible via link
                      </div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="private">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    <div>
                      <div className="font-medium">Private</div>
                      <div className="text-xs text-muted-foreground">Only you can see it</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Capabilities</h4>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="network">Network Access</Label>
                <p className="text-xs text-muted-foreground">
                  Allow this capsule to make network requests
                </p>
              </div>
              <Switch
                id="network"
                checked={enableNetwork}
                onCheckedChange={setEnableNetwork}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="storage">Local Storage</Label>
                <p className="text-xs text-muted-foreground">
                  Allow this capsule to use IndexedDB
                </p>
              </div>
              <Switch
                id="storage"
                checked={enableStorage}
                onCheckedChange={setEnableStorage}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Publish Button */}
      <Card>
        <CardContent className="pt-6">
          {publishStatus === "success" ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-600" />
              <h3 className="mb-2 text-lg font-semibold">Capsule Published!</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Your capsule is now live on Vibecodr
              </p>
              <div className="flex justify-center gap-2">
                <Button variant="outline">View in Feed</Button>
                <Button>Share</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {hasErrors && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">Cannot publish yet</p>
                  <p>Please fix the errors above before publishing.</p>
                </div>
              )}

              {hasWarnings && !hasErrors && (
                <div className="rounded-md bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                  <p className="font-medium">Warnings detected</p>
                  <p>You can still publish, but consider addressing the warnings.</p>
                </div>
              )}

              <Button
                onClick={handlePublish}
                disabled={hasErrors || isPublishing}
                className="w-full gap-2"
                size="lg"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {publishStatus === "validating" && "Validating..."}
                    {publishStatus === "uploading" && "Uploading..."}
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Publish Capsule
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                By publishing, you agree to the{" "}
                <a href="/terms" className="underline">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="/acceptable-use" className="underline">
                  Acceptable Use Policy
                </a>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
