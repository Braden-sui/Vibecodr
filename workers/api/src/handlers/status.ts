import { json } from "../lib/responses";
import type { Env } from "../types";

export async function doStatus(_req: Request, env: Env): Promise<Response> {
  try {
    const id = env.BUILD_COORDINATOR_DURABLE.idFromName("global");
    const stub = env.BUILD_COORDINATOR_DURABLE.get(id);
    const res = await stub.fetch("https://internal/status");
    try {
      env.vibecodr_analytics_engine.writeDataPoint({
        blobs: ["do_status"],
        doubles: [1],
      });
    } catch (error) {
      console.error("E-VIBECODR-0206 doStatus analytics write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e: any) {
    return json({ error: "do status failed", details: e?.message || "unknown" }, 500);
  }
}
