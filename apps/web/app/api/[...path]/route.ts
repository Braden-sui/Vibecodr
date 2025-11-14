import { NextRequest } from "next/server";
import { getWorkerApiBase } from "@/lib/worker-api";

export const runtime = "edge";

const API_BASE = getWorkerApiBase();

async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\/?/, "");
  const target = `${API_BASE}/${path}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(req.method)) {
    const body = await req.arrayBuffer();
    init.body = body;
  }

  const res = await fetch(target, init);

  const respHeaders = new Headers(res.headers);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: respHeaders });
}

export async function GET(req: NextRequest) { return proxy(req); }
export async function POST(req: NextRequest) { return proxy(req); }
export async function PUT(req: NextRequest) { return proxy(req); }
export async function PATCH(req: NextRequest) { return proxy(req); }
export async function DELETE(req: NextRequest) { return proxy(req); }
export async function OPTIONS(req: NextRequest) { return proxy(req); }
