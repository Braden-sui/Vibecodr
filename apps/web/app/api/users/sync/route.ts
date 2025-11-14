import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { getWorkerApiBase } from "@/lib/worker-api";

export const runtime = "edge";
const API_BASE = getWorkerApiBase();

export async function POST() {
  const userId = await requireAuth();
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
      Authorization: `Bearer ${userId}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  return NextResponse.json(json, { status: res.status });
}
