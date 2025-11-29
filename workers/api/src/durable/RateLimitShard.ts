const JSON_HEADERS = { "content-type": "application/json" };
const DEFAULT_WINDOW_SEC = 60;

type RateLimitRequest = {
  key: string;
  limit: number;
  windowSec?: number;
  cost?: number;
  nowMs?: number;
};

type CounterRecord = {
  resetMs: number;
  count: number;
};

type RateLimitResponse = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  windowSec: number;
  total: number;
  limit: number;
};

export class RateLimitShard {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    let body: RateLimitRequest;
    try {
      body = (await req.json()) as RateLimitRequest;
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const key = typeof body.key === "string" && body.key.length > 0 ? body.key : null;
    const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : null;
    const windowSec =
      typeof body.windowSec === "number" && body.windowSec > 0 ? body.windowSec : DEFAULT_WINDOW_SEC;
    const cost = typeof body.cost === "number" && body.cost > 0 ? body.cost : 1;
    const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();

    if (!key || !limit) {
      return new Response(JSON.stringify({ error: "key and limit are required" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    const current = ((await this.state.storage.get<CounterRecord>(key)) as CounterRecord | undefined) ?? null;

    const resetMs = current && current.resetMs > nowMs ? current.resetMs : nowMs + windowSec * 1000;
    const total = current && current.resetMs > nowMs ? current.count + cost : cost;
    const allowed = total <= limit;
    const remaining = Math.max(0, limit - total);

    const updated: CounterRecord = { resetMs, count: total };
    await this.state.storage.put(key, updated, { allowConcurrency: false });

    const response: RateLimitResponse = {
      allowed,
      remaining,
      resetMs,
      windowSec,
      total,
      limit,
    };

    return new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS });
  }
}
