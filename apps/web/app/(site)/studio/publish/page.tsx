"use client";

import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { capsulesApi, postsApi } from "@/lib/api";
import { redirectToSignIn } from "@/lib/client-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type PublishStep = "idle" | "publishing" | "creating-post";

type QuotaError =
  | {
      type: "bundle";
      limit?: number;
      attempted?: number;
      reason?: string;
    }
  | {
      type: "storage";
      limit?: number;
      currentUsage?: number;
      additionalSize?: number;
      reason?: string;
    }
  | null;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const parseTags = (raw: string) =>
  raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

export default function StudioPublish() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [bundleFiles, setBundleFiles] = useState<File[]>([]);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [manifestAutoDetected, setManifestAutoDetected] = useState(false);
  const [step, setStep] = useState<PublishStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<QuotaError>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const directoryInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.setAttribute("webkitdirectory", "true");
      node.setAttribute("directory", "true");
    }
  }, []);

  const bundleSize = useMemo(
    () => bundleFiles.reduce((total, file) => total + file.size, 0),
    [bundleFiles]
  );

  const handleManifestSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setManifestFile(file);
      setManifestAutoDetected(false);
    }
    event.target.value = "";
  };

  const handleBundleSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    let manifestCandidate: File | null = null;

    const nonManifestFiles = files.filter((file) => {
      const isManifest = file.name.toLowerCase() === "manifest.json";
      if (isManifest && !manifestCandidate) {
        manifestCandidate = file;
        return false;
      }
      return true;
    });

    if (manifestCandidate) {
      setManifestFile(manifestCandidate);
      setManifestAutoDetected(true);
    }

    setBundleFiles(nonManifestFiles);
    event.target.value = "";
  };

  const handlePublish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setWarnings([]);
    setQuotaError(null);

    const trimmedTitle = title.trim();
    if (!manifestFile) {
      setError("Add manifest.json so we can validate your capsule.");
      return;
    }
    if (bundleFiles.length === 0) {
      setError("Add at least one file or directory from your build output.");
      return;
    }
    if (!trimmedTitle) {
      setError("Give your vibe a title before publishing.");
      return;
    }

    const formData = new FormData();
    formData.append("manifest", manifestFile, manifestFile.name || "manifest.json");
    bundleFiles.forEach((file) => {
      const key = file.webkitRelativePath || file.name;
      formData.append(key || file.name, file, file.name);
    });

    try {
      setStep("publishing");
      const publishResponse = await capsulesApi.publish(formData);

      if (publishResponse.status === 401) {
        redirectToSignIn("/studio/publish");
        return;
      }

      const publishJson = (await publishResponse.json()) as {
        success?: boolean;
        capsuleId?: string;
        warnings?: string[];
        error?: string;
        reason?: string;
        bundleSize?: number;
        limit?: number;
        currentUsage?: number;
        additionalSize?: number;
      };

      if (!publishResponse.ok || !publishJson.success || !publishJson.capsuleId) {
        setStep("idle");

        if (publishResponse.status === 400 && publishJson.error) {
          if (publishJson.error.includes("Bundle size")) {
            setQuotaError({
              type: "bundle",
              limit: publishJson.limit,
              attempted: publishJson.bundleSize,
              reason: publishJson.reason,
            });
          } else if (publishJson.error.includes("Storage quota")) {
            setQuotaError({
              type: "storage",
              limit: publishJson.limit,
              currentUsage: publishJson.currentUsage,
              additionalSize: publishJson.additionalSize,
              reason: publishJson.reason,
            });
          }
          setError(publishJson.error);
          return;
        }

        setError(publishJson.error || "Failed to publish capsule. Please try again.");
        return;
      }

      if (publishJson.warnings?.length) {
        setWarnings(publishJson.warnings);
      }

      setStep("creating-post");
      const postResponse = await postsApi.create({
        title: trimmedTitle,
        description: description.trim() || undefined,
        type: "app",
        capsuleId: publishJson.capsuleId,
        tags: parseTags(tagsInput),
      });

      if (postResponse.status === 401) {
        redirectToSignIn("/studio/publish");
        return;
      }

      if (!postResponse.ok) {
        setStep("idle");
        setError("Capsule uploaded but creating the feed post failed. Please try again.");
        return;
      }

      const postJson = (await postResponse.json()) as { id?: string };
      const postId = postJson.id;
      if (!postId) {
        setStep("idle");
        setError("Post created without an id. Refresh and try again.");
        return;
      }

      router.push(`/player/${postId}`);
    } catch (err) {
      console.error("Failed to publish capsule:", err);
      setError("Unexpected error while publishing. Please try again.");
      setStep("idle");
    }
  };

  const canPublish =
    title.trim().length > 0 && manifestFile && bundleFiles.length > 0 && step === "idle";

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 py-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <Upload className="h-3 w-3" />
          Publish
        </div>
        <h2 className="text-3xl font-semibold tracking-tight">Publish your vibe</h2>
        <p className="text-sm text-muted-foreground">
          Validate your manifest, upload bundle files, and push the finished capsule to the feed.
        </p>
      </header>

      {error && (
        <div className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">{error}</p>
            {quotaError && quotaError.type === "bundle" && (
              <p className="text-xs text-destructive/90">
                Attempted {formatBytes(quotaError.attempted ?? 0)} against a limit of{" "}
                {formatBytes(quotaError.limit ?? 0)}. {quotaError.reason}
              </p>
            )}
            {quotaError && quotaError.type === "storage" && (
              <p className="text-xs text-destructive/90">
                Current usage {formatBytes(quotaError.currentUsage ?? 0)} +{" "}
                {formatBytes(quotaError.additionalSize ?? 0)} would exceed{" "}
                {formatBytes(quotaError.limit ?? 0)}. {quotaError.reason}
              </p>
            )}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Published with warnings
          </div>
          <ul className="mt-2 space-y-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-xs">
                • {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" onSubmit={handlePublish}>
        <div className="space-y-6 rounded-lg border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="My tiny app"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">{title.length}/200 characters</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Explain what people should try once the vibe launches."
              maxLength={1000}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="viz, physics, canvas"
            />
            <p className="text-xs text-muted-foreground">Comma separated list</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <select
              id="visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as "public" | "unlisted")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Unlisted capsules don&apos;t appear in the feed yet, but you can share the link.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <div className="space-y-2">
              <Label>Manifest JSON *</Label>
              <Input type="file" accept="application/json" onChange={handleManifestSelect} />
              {manifestAutoDetected && (
                <p className="text-xs text-muted-foreground">
                  Using <code>{manifestFile?.name}</code> detected from your bundle.
                </p>
              )}
              {manifestFile && !manifestAutoDetected && (
                <p className="text-xs text-muted-foreground">
                  Selected <code>{manifestFile.name}</code>
                </p>
              )}
            </div>

            <div className="space-y-2 pt-4">
              <Label>Bundle files *</Label>
              <Input
                type="file"
                multiple
                ref={directoryInputRef}
                onChange={handleBundleSelect}
                className="cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">
                Choose the build output folder (we keep the relative paths).
              </p>
              {bundleFiles.length > 0 && (
                <div className="rounded-md border border-dashed p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <Badge variant="secondary" className="text-xs">
                      {bundleFiles.length} files
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {formatBytes(bundleSize)}
                    </Badge>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {bundleFiles.slice(0, 5).map((file) => (
                      <li key={`${file.name}-${file.lastModified}`}>
                        {file.webkitRelativePath || file.name} — {formatBytes(file.size)}
                      </li>
                    ))}
                    {bundleFiles.length > 5 && (
                      <li>+{bundleFiles.length - 5} more files</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <h3 className="text-sm font-semibold">Publish checklist</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                {manifestFile ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
                Valid manifest selected
              </li>
              <li className="flex items-start gap-2">
                {bundleFiles.length > 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
                Bundle files attached ({formatBytes(bundleSize)})
              </li>
              <li className="flex items-start gap-2">
                {title.trim() ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
                Title provided
              </li>
            </ul>

            <Button type="submit" disabled={!canPublish} className="w-full">
              {step === "publishing" && (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading bundle...
                </>
              )}
              {step === "creating-post" && (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating post...
                </>
              )}
              {step === "idle" && "Publish"}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
