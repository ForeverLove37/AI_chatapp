import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

const files: Record<string, string> = {
  chatgpt: "gpt_icon.png",
  gemini: "gemini_icon.png",
  deepseek: "deepseek_icon.png",
};

function repositoryRoot() {
  const cwd = process.cwd();
  return cwd.endsWith("/apps/web") ? resolve(cwd, "../..") : cwd;
}

export async function GET(_request: Request, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  const file = files[channel];
  if (!file) return new Response("Not found", { status: 404 });
  const image = await readFile(resolve(repositoryRoot(), "icons/model_icons", file));
  return new Response(image, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
