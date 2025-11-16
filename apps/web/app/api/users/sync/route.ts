import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCurrentUser } from "@/lib/auth";
import { getWorkerApiBase } from "@/lib/worker-api";

export const runtime = "edge";
const API_BASE = getWorkerApiBase();
const WORKER_TEMPLATE = "workers";

export async function POST() {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerToken = getToken ? await getToken({ template: WORKER_TEMPLATE }) : null;
  if (!workerToken) {
    return NextResponse.json({ error: "E-VIBECODR-0403 missing worker token" }, { status: 401 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = {
    id: user.id,
    handle: user.handle,
    name: user.name,
    avatarUrl: user.avatarUrl,
    bio: null,
    plan: undefined,
  };

  const res = await fetch(`${API_BASE}/users/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify(payload),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return NextResponse.json(json, { status: res.status });
}
