import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getWorkerApiBase } from "@/lib/worker-api";

export const runtime = "edge";

async function injectClerkAuthHeader(headers: Headers) {
  if (headers.has("authorization")) {
    return;
  }

  try {
    const authResult = await auth();
    const { getToken } = authResult;
    if (!getToken) {
      return;
    }
    const token = await getToken({ template: "workers" });
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  } catch (error) {
    console.error("E-VIBECODR-0003 clerk token injection failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\/?/, "");
  const target = `${getWorkerApiBase()}/${path}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  await injectClerkAuthHeader(headers);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
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
