// Auth middleware for Cloudflare Workers using Clerk
// Verifies JWT tokens from Clerk in Authorization header

import type { Env } from "./index";

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
}

export async function verifyAuth(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    // TODO: Verify Clerk JWT token
    // For now, we'll do a simple implementation
    // In production, use Clerk's JWT verification
    // https://clerk.com/docs/backend-requests/handling/manual-jwt

    // This is a placeholder - implement proper JWT verification
    const payload = JSON.parse(atob(token.split(".")[1]));

    if (!payload.sub) {
      return null;
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid || "",
    };
  } catch (error) {
    console.error("Auth verification failed:", error);
    return null;
  }
}

export function requireAuth(
  handler: (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>,
    user: AuthenticatedUser
  ) => Promise<Response>
) {
  return async (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>
  ): Promise<Response> => {
    const user = await verifyAuth(req, env);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(req, env, ctx, params, user);
  };
}
