import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

function repositoryRoot() {
  const cwd = process.cwd();
  return cwd.endsWith("/apps/web") ? resolve(cwd, "../..") : cwd;
}

export async function GET() {
  const image = await readFile(resolve(repositoryRoot(), "icons/logo.png"));
  return new Response(image, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
