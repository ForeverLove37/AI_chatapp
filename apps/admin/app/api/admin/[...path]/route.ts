import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const backend = process.env.BACKEND_URL ?? "http://localhost:8787";
  const target = new URL(`/admin/${path.map(encodeURIComponent).join("/")}`, backend);
  target.search = request.nextUrl.search;
  const controller = new AbortController();
  let timedOut = false;
  const streaming = path.at(-1) === "stream";
  const timeout = streaming ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10_000);

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("x-admin-key", process.env.ADMIN_API_KEY ?? "dev-admin-key");

  try {
    const hasBody = !["GET", "HEAD"].includes(request.method);
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "connection", "x-accel-buffering"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json(
      {
        error: {
          message: timedOut
            ? "The admin API did not respond in time. Refresh the console and check the gateway service."
            : "The admin API is unavailable. Start the Adaptive Chat API service.",
        },
      },
      { status: timedOut ? 504 : 502 },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
