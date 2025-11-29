const JSON_HEADERS = { "content-type": "application/json" };
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_MS = 5000;
const FLUSH_BACKOFF_MS = 1000;

type RuntimeEvent = {
  id: string;
  capsuleId?: string | null;
  artifactId?: string | null;
  runnerType?: string | null;
  runtimeVersion?: string | null;
  event: string;
  code?: string | null;
  message?: string | null;
  properties?: string | null;
  timestampMs?: number;
};

type InMemoryBatch = {
  events: RuntimeEvent[];
  flushAt: number;
};

export class RuntimeEventShard {
  private batch: InMemoryBatch = { events: [], flushAt: Date.now() + DEFAULT_FLUSH_MS };

  constructor(private readonly state: DurableObjectState, private readonly env: any) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    let payload: RuntimeEvent | RuntimeEvent[];
    try {
      payload = (await req.json()) as RuntimeEvent | RuntimeEvent[];
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: JSON_HEADERS });
    }

    const now = Date.now();
    const events = Array.isArray(payload) ? payload : [payload];
    this.batch.events.push(
      ...events.map((e) => ({
        id: typeof e.id === "string" && e.id ? e.id : crypto.randomUUID(),
        capsuleId: e.capsuleId ?? null,
        artifactId: e.artifactId ?? null,
        runnerType: e.runnerType ?? null,
        runtimeVersion: e.runtimeVersion ?? null,
        event: e.event,
        code: e.code ?? null,
        message: e.message ?? null,
        properties: typeof e.properties === "string" ? e.properties : null,
        timestampMs: typeof e.timestampMs === "number" ? e.timestampMs : now,
      })),
    );

    if (this.batch.events.length >= DEFAULT_BATCH_SIZE || now >= this.batch.flushAt) {
      await this.flush();
    } else {
      this.state.storage.setAlarm(this.batch.flushAt).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, buffered: this.batch.events.length }), {
      status: 202,
      headers: JSON_HEADERS,
    });
  }

  async alarm(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.batch.events.length === 0) {
      this.batch.flushAt = Date.now() + DEFAULT_FLUSH_MS;
      this.state.storage.setAlarm(this.batch.flushAt).catch(() => {});
      return;
    }

    const events = this.batch.events.splice(0, this.batch.events.length);
    this.batch.flushAt = Date.now() + DEFAULT_FLUSH_MS;

    const db = (this.env as any)?.DB as D1Database | undefined;
    const ae = (this.env as any)?.vibecodr_analytics_engine as
      | { writeDataPoint: (p: { blobs?: string[]; doubles?: number[]; indexes?: string[] }) => void }
      | undefined;

    if (!db) {
      console.error("E-VIBECODR-2136 runtime event DO missing DB binding", {
        shard: safeShardId(this.state),
      });
      this.batch.events.unshift(...events);
      this.batch.flushAt = Date.now() + FLUSH_BACKOFF_MS;
      this.state.storage.setAlarm(this.batch.flushAt).catch(() => {});
      return;
    }

    const start = Date.now();
    try {
      const statements = events.map((e) =>
        db
          .prepare(
            `INSERT INTO runtime_events (
              id,
              event_name,
              capsule_id,
              artifact_id,
              runtime_type,
              runtime_version,
              code,
              message,
              properties,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`
          )
          .bind(
            e.id,
            e.event,
            e.capsuleId ?? null,
            e.artifactId ?? null,
            e.runnerType ?? null,
            e.runtimeVersion ?? null,
            e.code ?? null,
            e.message ?? null,
            e.properties ?? null,
            Math.floor((e.timestampMs ?? Date.now()) / 1000),
          ),
      );
      await db.batch(statements);

      if (ae && typeof ae.writeDataPoint === "function") {
        for (const e of events) {
          ae.writeDataPoint({
            blobs: [
              e.event,
              e.capsuleId ?? "",
              e.artifactId ?? "",
              e.runnerType ?? "",
              e.runtimeVersion ?? "",
              e.code ?? "",
              e.message ?? "",
            ],
            doubles: [e.timestampMs ?? Date.now(), isErrorEvent(e.event) ? 1 : 0],
            indexes: [e.artifactId ?? e.capsuleId ?? ""],
          });
        }
      }

      const durationMs = Date.now() - start;
      console.info("E-VIBECODR-2131 runtime event shard flushed", {
        shard: safeShardId(this.state),
        count: events.length,
        durationMs,
      });
      this.state.storage.setAlarm(this.batch.flushAt).catch(() => {});
    } catch (err) {
      console.error("E-VIBECODR-2130 runtime event DO flush failed", {
        shard: safeShardId(this.state),
        error: err instanceof Error ? err.message : String(err),
        buffered: events.length,
      });
      this.batch.events.unshift(...events);
      this.batch.flushAt = Date.now() + FLUSH_BACKOFF_MS;
      this.state.storage.setAlarm(this.batch.flushAt).catch(() => {});
    }
  }
}

function safeShardId(state: DurableObjectState): string {
  try {
    return String((state as any)?.id ?? "unknown");
  } catch {
    return "unknown";
  }
}

function isErrorEvent(name: string): boolean {
  const normalized = (name || "").toLowerCase();
  return normalized.includes("error") || normalized.includes("violation") || normalized.includes("fail");
}
