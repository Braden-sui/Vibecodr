"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { adminApi } from "@/lib/api";
import type { Manifest } from "@vibecodr/shared/manifest";
import { PlayerIframe, type PlayerIframeHandle } from "@/components/Player/PlayerIframe";
import { Badge } from "@/components/ui/badge";

type InspectorCapsule = {
  id: string;
  ownerId: string;
  quarantined: boolean;
  quarantineReason: string | null;
  createdAt: number | null;
  manifest: Manifest | null;
  manifestSource: "r2" | "db" | null;
  manifestError?: string | null;
  hash?: string | null;
};

type InspectorArtifact = {
  id: string;
  ownerId: string;
  capsuleId: string;
  type: string;
  runtimeVersion: string | null;
  status: string | null;
  policyStatus: string | null;
  visibility: string | null;
  safetyTier: string | null;
  riskScore: number | null;
  createdAt: number | null;
};

type InspectorRuntimeManifest = {
  manifest: Record<string, unknown> | null;
  version: number | null;
  runtimeVersion: string | null;
  source: "kv" | "db" | null;
  error?: string | null;
};

type InspectorEvent = {
  id: string;
  eventName: string;
  capsuleId: string | null;
  artifactId: string | null;
  runtimeType: string | null;
  runtimeVersion: string | null;
  code: string | null;
  message: string | null;
  properties: Record<string, unknown> | null;
  createdAt: number | null;
};

type CompileState = {
  lastCompileRequest?: Record<string, unknown> | null;
  lastCompileResult?: Record<string, unknown> | null;
  error?: string;
  code?: string;
} | null;

type ArtifactInspectResponse = {
  artifact: InspectorArtifact;
  capsule: InspectorCapsule | null;
  runtimeManifest: InspectorRuntimeManifest | null;
  compile: CompileState;
  events: InspectorEvent[];
};

type CapsuleInspectResponse = {
  capsule: InspectorCapsule;
  latestArtifact: InspectorArtifact | null;
  runtimeManifest: InspectorRuntimeManifest | null;
  compile: CompileState;
  events: InspectorEvent[];
};

type AuthzState = "unknown" | "unauthenticated" | "forbidden" | "authorized";

type PublicMetadata = {
  role?: string;
} | null;

function formatDate(value: number | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function buildDefaultParams(manifest: Manifest | null | undefined): Record<string, unknown> {
  if (!manifest?.params) return {};
  const params: Record<string, unknown> = {};
  for (const param of manifest.params) {
    if (param.default !== undefined) {
      params[param.name] = param.default;
    } else if (param.type === "toggle") {
      params[param.name] = false;
    } else if (param.type === "slider" || param.type === "number") {
      params[param.name] = param.min ?? 0;
    } else {
      params[param.name] = "";
    }
  }
  return params;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/60 px-3 py-2 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventList({ events }: { events: InspectorEvent[] }) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
        No recent runtime violations or kills recorded for this target.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.id} className="rounded-lg border border-border/70 bg-background/50 p-3 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="uppercase tracking-wide">
              {event.eventName}
            </Badge>
            <span>capsule: {event.capsuleId ?? "n/a"}</span>
            <span>artifact: {event.artifactId ?? "n/a"}</span>
            {event.runtimeVersion && <span>runtime {event.runtimeVersion}</span>}
            <span>{formatDate(event.createdAt)}</span>
          </div>
          {(event.code || event.message) && (
            <p className="mt-2 text-xs text-destructive">
              {event.code ? `${event.code}: ` : ""}
              {event.message}
            </p>
          )}
          {event.properties && <JsonBlock value={event.properties} />}
        </div>
      ))}
    </div>
  );
}

function CompilePanel({ compile }: { compile: CompileState }) {
  if (!compile) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
        No compile telemetry recorded for this artifact yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {compile.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-destructive">
          {compile.error}
        </div>
      )}
      {compile.lastCompileRequest && (
        <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last request</p>
          <JsonBlock value={compile.lastCompileRequest} />
        </div>
      )}
      {compile.lastCompileResult && (
        <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last result</p>
          <JsonBlock value={compile.lastCompileResult} />
        </div>
      )}
    </div>
  );
}

function Harness({
  capsuleId,
  artifactId,
  manifest,
}: {
  capsuleId: string;
  artifactId: string;
  manifest: Manifest | null;
}) {
  const iframeRef = useRef<PlayerIframeHandle>(null);
  const [paramsText, setParamsText] = useState<string>(() =>
    JSON.stringify(buildDefaultParams(manifest), null, 2)
  );
  const [paramError, setParamError] = useState<string | null>(null);
  const [parsedParams, setParsedParams] = useState<Record<string, unknown>>(() =>
    buildDefaultParams(manifest)
  );
  const [reloadKey, setReloadKey] = useState(0);

  const applyParams = () => {
    try {
      const parsed = JSON.parse(paramsText);
      if (parsed && typeof parsed === "object") {
        setParsedParams(parsed as Record<string, unknown>);
        setParamError(null);
      } else {
        setParamError("Params must be a JSON object.");
      }
    } catch (err) {
      setParamError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-background/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Replay in test harness</h3>
          <p className="text-xs text-muted-foreground">
            Loads only this artifact inside the runtime iframe with the params below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm font-medium hover:bg-muted/60"
            onClick={() => setReloadKey((v) => v + 1)}
          >
            Restart
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-105"
            onClick={() => {
              applyParams();
              setReloadKey((v) => v + 1);
              iframeRef.current?.restart();
            }}
          >
            Apply params
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Runtime params (JSON)</p>
          <textarea
            className="h-40 w-full rounded-md border border-border bg-background/80 p-2 font-mono text-xs"
            value={paramsText}
            onChange={(e) => setParamsText(e.target.value)}
          />
          {paramError && <p className="text-xs text-destructive">{paramError}</p>}
        </div>

        <div className="h-64 overflow-hidden rounded-lg border border-border bg-black/80">
          <PlayerIframe
            key={`${artifactId}-${reloadKey}`}
            ref={iframeRef}
            capsuleId={capsuleId}
            artifactId={artifactId}
            params={parsedParams}
            onError={(msg) => setParamError(msg || "Runtime error")}
          />
        </div>
      </div>
    </div>
  );
}

function SummaryCards({
  capsule,
  artifact,
  runtimeManifest,
}: {
  capsule: InspectorCapsule | null;
  artifact: InspectorArtifact | null;
  runtimeManifest: InspectorRuntimeManifest | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-lg border border-border/60 bg-background/60 p-3 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Capsule</p>
        {capsule ? (
          <>
            <p className="mt-1 text-sm font-semibold">{capsule.id}</p>
            <p className="text-xs text-muted-foreground">
              Runner {capsule.manifest?.runner ?? "unknown"} · Entry {capsule.manifest?.entry ?? "n/a"}
            </p>
            <p className="text-xs text-muted-foreground">
              {capsule.quarantined ? "Quarantined" : "Active"} · Source {capsule.manifestSource ?? "n/a"}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No capsule linked.</p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-background/60 p-3 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Artifact</p>
        {artifact ? (
          <>
            <p className="mt-1 text-sm font-semibold">{artifact.id}</p>
            <p className="text-xs text-muted-foreground">
              {artifact.type} · runtime {artifact.runtimeVersion ?? "n/a"}
            </p>
            <p className="text-xs text-muted-foreground">
              {artifact.status ?? "unknown"} · policy {artifact.policyStatus ?? "n/a"}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No artifact compiled yet.</p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 bg-background/60 p-3 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Runtime manifest</p>
        {runtimeManifest?.manifest ? (
          <>
            <p className="mt-1 text-sm font-semibold">
              v{runtimeManifest.version ?? "1"} · runtime {runtimeManifest.runtimeVersion ?? "n/a"}
            </p>
            <p className="text-xs text-muted-foreground">Source {runtimeManifest.source ?? "unknown"}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not available</p>
        )}
      </div>
    </div>
  );
}

type InspectorMode = "artifact" | "capsule";

function InspectorPage({ mode }: { mode: InspectorMode }) {
  const params = useParams();
  const navigate = useNavigate();
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isAdmin = !!user && isSignedIn && role === "admin";

  const idParam = mode === "artifact" ? params.artifactId : params.capsuleId;
  const [authzState, setAuthzState] = useState<AuthzState>("unknown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsule, setCapsule] = useState<InspectorCapsule | null>(null);
  const [artifact, setArtifact] = useState<InspectorArtifact | null>(null);
  const [runtimeManifest, setRuntimeManifest] = useState<InspectorRuntimeManifest | null>(null);
  const [compile, setCompile] = useState<CompileState>(null);
  const [events, setEvents] = useState<InspectorEvent[]>([]);
  const [inputValue, setInputValue] = useState(idParam ?? "");

  useEffect(() => {
    setInputValue(idParam ?? "");
  }, [idParam]);

  const loadData = useMemo(
    () => async () => {
      if (!idParam) {
        setError("Missing id");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const token = await getToken({ template: "workers" });
        if (!token) {
          setAuthzState("unauthenticated");
          setLoading(false);
          return;
        }
        setAuthzState(isAdmin ? "authorized" : "forbidden");

        const init: RequestInit = {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        };

        const response =
          mode === "artifact"
            ? await adminApi.inspectArtifact(idParam, init)
            : await adminApi.inspectCapsule(idParam, init);

        if (!response.ok) {
          const message = `Inspector request failed (${response.status})`;
          setError(message);
          setLoading(false);
          return;
        }

        const data = (await response.json()) as ArtifactInspectResponse | CapsuleInspectResponse;

        if ("artifact" in data) {
          setArtifact(data.artifact);
          setCapsule(data.capsule ?? null);
        } else {
          setArtifact(data.latestArtifact ?? null);
          setCapsule(data.capsule);
        }

        setRuntimeManifest(data.runtimeManifest ?? null);
        setCompile(data.compile ?? null);
        setEvents(data.events ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load inspector data");
      } finally {
        setLoading(false);
      }
    },
    [getToken, idParam, isAdmin, mode]
  );

  useEffect(() => {
    if (!isSignedIn) {
      setAuthzState("unauthenticated");
      return;
    }
    if (!isAdmin) {
      setAuthzState("forbidden");
      return;
    }
    setAuthzState("authorized");
    void loadData();
  }, [isAdmin, isSignedIn, loadData]);

  const manifest = capsule?.manifest ?? null;
  const runtimeManifestBody = runtimeManifest?.manifest ?? null;

  const eventHint =
    "Shows permission violations, budget kills, iframe/runtime errors, and kill events posted by the runtime.";

  if (authzState === "unauthenticated") {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Inspector</h1>
        <p className="text-sm text-muted-foreground">Sign in as an administrator to view inspector data.</p>
      </section>
    );
  }

  if (authzState === "forbidden") {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Inspector</h1>
        <p className="text-sm text-muted-foreground">Only administrators can access this inspector.</p>
      </section>
    );
  }

  const capsuleId = capsule?.id ?? artifact?.capsuleId ?? "";
  const artifactId = artifact?.id ?? "";

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Inspector</h1>
          <Badge variant="outline" className="uppercase">
            {mode} mode
          </Badge>
          {artifact && (
            <Badge variant="secondary" className="font-mono">
              {artifact.id}
            </Badge>
          )}
          {!artifact && capsule && (
            <Badge variant="secondary" className="font-mono">
              {capsule.id}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Capsule manifest, runtime manifest, compile telemetry, and runtime violations in one place. Use this when uploads
          vanish or permissions get blocked.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded-md border border-border bg-background/80 px-3 py-2 text-sm"
            placeholder={mode === "artifact" ? "artifact id" : "capsule id"}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-105"
            onClick={() => {
              const trimmed = inputValue.trim();
              if (!trimmed) return;
              navigate(mode === "artifact" ? `/admin/artifacts/${trimmed}` : `/admin/capsules/${trimmed}`);
            }}
          >
            Inspect
          </button>
          {mode === "artifact" && capsuleId && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/60"
              onClick={() => navigate(`/admin/capsules/${capsuleId}`)}
            >
              View capsule
            </button>
          )}
          <Link to="/admin/analytics" className="text-xs text-primary underline">
            Runtime analytics
          </Link>
        </div>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading inspector data…</p>}
      {error && (
        <div className="rounded-lg border border-destructive/60 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <SummaryCards capsule={capsule} artifact={artifact} runtimeManifest={runtimeManifest} />

      <SectionCard
        title="Capsule manifest"
        description="Runner, entry point, params, and capabilities exactly as stored. Useful for verifying bundle/network policy."
      >
        {manifest ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Runner</p>
                <p className="font-medium">{manifest.runner}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Entry</p>
                <p className="font-medium">{manifest.entry}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Network</p>
                <p className="font-medium">
                  {manifest.capabilities?.net?.length
                    ? manifest.capabilities.net.join(", ")
                    : "null origin only"}
                </p>
              </div>
            </div>
            <div className="mt-2">
              <JsonBlock value={manifest} />
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            Capsule manifest unavailable{capsule?.manifestError ? `: ${capsule.manifestError}` : "."}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Runtime manifest"
        description="What the iframe actually receives: runtime assets, bundle key, runtime version, and CSP nonce."
      >
        {runtimeManifestBody ? (
          <JsonBlock value={runtimeManifestBody} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            Runtime manifest not found{runtimeManifest?.error ? `: ${runtimeManifest.error}` : "."}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Compile telemetry"
        description="Last compile request/result from the ArtifactCompiler durable object (warnings, errors, bundle keys)."
      >
        <CompilePanel compile={compile} />
      </SectionCard>

      <SectionCard title="Recent runtime events" description={eventHint}>
        <EventList events={events} />
      </SectionCard>

      {artifactId && capsuleId && <Harness capsuleId={capsuleId} artifactId={artifactId} manifest={manifest} />}
    </section>
  );
}

export function ArtifactInspectorPage() {
  return <InspectorPage mode="artifact" />;
}

export function CapsuleInspectorPage() {
  return <InspectorPage mode="capsule" />;
}

export default ArtifactInspectorPage;
