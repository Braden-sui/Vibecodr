import { PlanSchema } from "@vibecodr/shared";
import type { Handler, Env } from "../types";
import { verifyAuth } from "../auth";
import { json } from "../lib/responses";

export const joinLiveWaitlist: Handler = async (req, env) => {
  try {
    const body = (await req.json()) as {
      sessionId?: string;
      email?: string;
      handle?: string;
      plan?: unknown;
    };

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const handle = typeof body.handle === "string" ? body.handle.trim() : "";
    const planParse = PlanSchema.safeParse(
      typeof body.plan === "string" ? body.plan.trim().toLowerCase() : null
    );
    if (!planParse.success) {
      return json({ error: "Invalid plan" }, 400);
    }
    const plan = planParse.data;

    if (!sessionId) {
      return json({ error: "sessionId is required" }, 400);
    }

    if (!email || !email.includes("@")) {
      return json({ error: "Valid email is required" }, 400);
    }

    if (!handle) {
      return json({ error: "Handle is required" }, 400);
    }

    let userId: string | null = null;
    try {
      const auth = await verifyAuth(req, env);
      userId = auth?.userId ?? null;
    } catch {
      userId = null;
    }

    const waitlistId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO live_waitlist (id, session_id, email, handle, plan, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(waitlistId, sessionId, email, handle, plan, userId)
      .run();

    try {
      await env.vibecodr_analytics_engine.writeDataPoint({
        blobs: ["live_waitlist", plan, sessionId],
      });
    } catch (err) {
      console.warn("E-VIBECODR-0601 live waitlist analytics write failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return json({ ok: true, id: waitlistId }, 201);
  } catch (error) {
    return json(
      {
        error: "Failed to join live waitlist",
        details: error instanceof Error ? error.message : "unknown",
      },
      500
    );
  }
};
