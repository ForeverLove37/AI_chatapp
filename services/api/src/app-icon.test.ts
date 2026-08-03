import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { installBuildAppIcon } from "./app-icon.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("build launcher icon", () => {
  it("generates every Android density and restores source resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "adaptive-icon-test-"));
    temporaryRoots.push(root);
    const originals = new Map<string, Buffer>();
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      const directory = join(root, "app", "src", "main", "res", `mipmap-${density}`);
      await mkdir(directory, { recursive: true });
      for (const filename of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
        const path = join(directory, filename);
        const content = Buffer.from(`original-${density}-${filename}`);
        originals.set(path, content);
        await writeFile(path, content);
      }
    }
    const uploaded = await sharp({ create: { width: 32, height: 32, channels: 4, background: "#00aa88" } }).png().toBuffer();
    const restore = await installBuildAppIcon(root, `data:image/png;base64,${uploaded.toString("base64")}`);

    const generated = await sharp(join(root, "app", "src", "main", "res", "mipmap-xxxhdpi", "ic_launcher.png")).metadata();
    expect([generated.width, generated.height]).toEqual([192, 192]);
    await restore();
    for (const [path, content] of originals) expect(await readFile(path)).toEqual(content);
  });
});
