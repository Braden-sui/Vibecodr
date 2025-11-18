"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Globe, Lock, Eye, Rocket } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { capsulesApi, postsApi } from "@/lib/api";
import { redirectToSignIn } from "@/lib/client-auth";
import type { CapsuleDraft, DraftArtifact } from "./StudioShell";

interface PublishTabProps {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
}

type CheckStatus = "pass" | "warning" | "fail";

/**
 * Publish Tab - wires bundle upload, capsule publish, and post creation.
 */
export function PublishTab({ draft, onDraftChange }: PublishTabProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [title, setTitle] = useState("My Awesome Vibe");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [enableStorage, setEnableStorage] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<
    "idle" | "validating" | "uploading" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string>("");
  const [capsuleWarnings, setCapsuleWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (draft?.manifest?.title) {
      setTitle(draft.manifest.title);
    }
    if (draft?.manifest?.description) {
      setDescription(draft.manifest.description);
    }
    if (draft?.manifest?.capabilities?.storage != null) {
      setEnableStorage(Boolean(draft.manifest.capabilities.storage));
    }
  }, [draft?.manifest]);

  const totalSize = useMemo(() => {
    if (!draft?.files || draft.files.length === 0) return 0;
    return draft.files.reduce((sum, file) => sum + file.size, 0);
  }, [draft?.files]);

  const entryPath = draft?.manifest?.entry;
  const entryExists = Boolean(
    entryPath && draft?.files?.some((file) => file.path === entryPath)
  );
  const hasBundle = Boolean(draft?.files && draft.files.length > 0);
  const canPublish =
    Boolean(draft?.manifest) && draft?.validationStatus === "valid" && hasBundle && entryExists;

  const bundleLimitBytes = 25 * 1024 * 1024;

  const checks: { name: string; status: CheckStatus; message: string }[] = [
    {
      name: "Manifest Valid",
      status:
        draft?.validationStatus === "valid"
          ? "pass"
          : draft?.validationStatus === "invalid"
            ? "fail"
            : "warning",
      message:
        draft?.validationStatus === "valid"
          ? "Schema matches @vibecodr/shared manifest definition"
          : draft?.validationStatus === "invalid"
            ? "Fix manifest errors before publishing"
            : "Import a ZIP bundle to validate the manifest",
    },
    {
      name: "Entry File",
      status: entryExists ? "pass" : hasBundle ? "fail" : "warning",
      message: entryExists
        ? `${entryPath} is present`
        : entryPath
          ? `Missing ${entryPath} in bundle`
          : "Set an entry field in manifest.json",
    },
    {
      name: "Bundle Size",
      status:
        totalSize === 0
          ? "warning"
          : totalSize > bundleLimitBytes
            ? "warning"
            : "pass",
      message: `${formatBytes(totalSize)} of 25 MB (Free tier limit)`,
    },
  ];

  const hasErrors = checks.some((check) => check.status === "fail");
  const hasWarnings = checks.some((check) => check.status === "warning") || capsuleWarnings.length > 0;

  const manifestWarnings = draft?.validationWarnings ?? [];

  const buildAuthInit = async (): Promise<RequestInit | undefined> => {
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    if (tags.includes(tagInput.trim())) return;
    setTags([...tags, tagInput.trim()]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handlePublish = async () => {
    if (!draft?.manifest || !draft.files || draft.files.length === 0) {
      setError("Import a ZIP file before publishing.");
      return;
    }
    if (draft.validationStatus !== "valid") {
      setError("Fix manifest validation errors before publishing.");
      return;
    }
    if (!entryExists) {
      setError(`Entry file ${entryPath ?? "(missing)"} not found in bundle.`);
      return;
    }

    setIsPublishing(true);
    setPublishStatus("validating");
    setError("");
    setCapsuleWarnings([]);

    const trimmedTitle = title.trim() || draft.manifest.title || "Untitled Vibe";
    const trimmedDescription = description.trim();
    const manifestCapabilities = draft.manifest.capabilities ?? { storage: false, workers: false };
    const manifestToPublish = {
      ...draft.manifest,
      title: trimmedTitle,
      description: trimmedDescription || draft.manifest.description,
      capabilities: {
        ...manifestCapabilities,
        storage: enableStorage,
        workers: manifestCapabilities.workers ?? false,
      },
    };

    onDraftChange((prev) =>
      prev
        ? {
            ...prev,
            manifest: manifestToPublish,
            buildStatus: "building",
            publishStatus: "publishing",
          }
        : prev
    );

    try {
      const init = await buildAuthInit();
      const manifestFile = new File(
        [JSON.stringify(manifestToPublish, null, 2)],
        "manifest.json",
        {
          type: "application/json",
        }
      );
      const formData = new FormData();
      formData.append("manifest", manifestFile);

      draft.files
        .filter((entry) => entry.path.toLowerCase() !== "manifest.json")
        .forEach((entry) => {
          formData.append(entry.path, entry.file, entry.path);
        });

      const publishResponse = await capsulesApi.publish(formData, init);
      if (publishResponse.status === 401) {
        redirectToSignIn();
        return;
      }
      const publishJson: {
        success?: boolean;
        error?: string;
        capsule?: { id: string; contentHash: string; totalSize: number; fileCount: number };
        artifact?: {
          id?: string;
          runtimeVersion?: string | null;
          bundleDigest?: string | null;
          bundleSizeBytes?: number | null;
          queued?: boolean;
        } | null;
        warnings?: string[];
      } = await publishResponse.json();

      if (!publishResponse.ok || !publishJson?.capsule?.id) {
        throw new Error(publishJson?.error || "Failed to publish capsule");
      }

      if (publishJson.warnings?.length) {
        setCapsuleWarnings(publishJson.warnings);
      }

      const capsuleId = publishJson.capsule.id;
      const artifactInfo: DraftArtifact | null = publishJson.artifact
        ? {
            id: publishJson.artifact.id ?? undefined,
            runtimeVersion: publishJson.artifact.runtimeVersion ?? null,
            bundleDigest: publishJson.artifact.bundleDigest ?? null,
            bundleSizeBytes: publishJson.artifact.bundleSizeBytes ?? null,
            status: publishJson.artifact.queued ? "queued" : "ready",
          }
        : null;

      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              manifest: manifestToPublish,
              capsuleId,
              buildStatus: "success",
              artifact: artifactInfo,
              publishStatus: "publishing",
            }
          : prev
      );

      setPublishStatus("uploading");

      const postResponse = await postsApi.create({
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        type: "app",
        capsuleId,
        tags: tags.length ? tags : undefined,
        coverKey: undefined,
      }, init);

      if (postResponse.status === 401) {
        redirectToSignIn();
        return;
      }

      const postJson = await postResponse.json();
      if (!postResponse.ok || !postJson?.id) {
        throw new Error(postJson?.error || "Failed to create post");
      }

      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              publishStatus: "success",
              postId: postJson.id,
            }
          : prev
      );
      setPublishStatus("success");
      router.push(`/post/${postJson.id}`);
    } catch (err) {
      console.error("Publish failed", err);
      setPublishStatus("error");
      setError(err instanceof Error ? err.message : "Failed to publish vibe");
      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              buildStatus: "failed",
              publishStatus: "error",
            }
          : prev
      );
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Publish Vibe</h2>
        <p className="text-muted-foreground">
          Validate your bundle and ship it to the feed as a runnable post.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bundle Summary</CardTitle>
          <CardDescription>
            Double-check entry files, manifest status, and bundle size before publishing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checks.map((check) => (
            <div key={check.name} className="flex items-start gap-3">
              {check.status === "pass" ? (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
              ) : check.status === "warning" ? (
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-yellow-600" />
              ) : (
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{check.name}</p>
                <p className="text-xs text-muted-foreground">{check.message}</p>
              </div>
            </div>
          ))}

          {manifestWarnings.length > 0 && (
            <div className="rounded-md bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
              <p className="font-medium">Manifest warnings</p>
              <ul className="mt-1 space-y-1">
                {manifestWarnings.slice(0, 4).map((warning, index) => (
                  <li key={`${warning.path}-${index}`}>
                    <span className="font-mono">{warning.path}</span>: {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {capsuleWarnings.length > 0 && (
            <div className="rounded-md bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
              <p className="font-medium">Publish warnings</p>
              <ul className="mt-1 space-y-1">
                {capsuleWarnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
          <CardDescription>Title, description, tags, and visibility</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Give your vibe a name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Tell people what this vibe does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                  {tag}
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove ${tag}`}
                  >
                    x
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button variant="outline" onClick={addTag}>
                Add
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger>
                <SelectValue placeholder="Select visibility" />
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
            <p className="text-xs text-muted-foreground">
              Outbound network access is disabled for now. Storage controls the IndexedDB flag in
              the manifest.
            </p>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="storage">Local Storage</Label>
                <p className="text-xs text-muted-foreground">Allow this vibe to use IndexedDB</p>
              </div>
              <Switch id="storage" checked={enableStorage} onCheckedChange={setEnableStorage} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Publish Button */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {publishStatus === "success" ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-600" />
              <h3 className="mb-2 text-lg font-semibold">Vibe Published!</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Redirecting you to the post...
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {hasErrors && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">Cannot publish yet</p>
                  <p>Resolve the issues above before publishing.</p>
                </div>
              )}

              {hasWarnings && !hasErrors && (
                <div className="rounded-md bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                  <p className="font-medium">Warnings detected</p>
                  <p>You can still publish, but please review the warnings above.</p>
                </div>
              )}

              <Button
                onClick={handlePublish}
                disabled={!canPublish || hasErrors || isPublishing}
                className="w-full gap-2"
                size="lg"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {publishStatus === "validating" && "Validating..."}
                    {publishStatus === "uploading" && "Publishing..."}
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Publish Vibe
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
