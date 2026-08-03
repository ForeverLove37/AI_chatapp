import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const densities = [
  { name: "mdpi", launcher: 48, foreground: 108 },
  { name: "hdpi", launcher: 72, foreground: 162 },
  { name: "xhdpi", launcher: 96, foreground: 216 },
  { name: "xxhdpi", launcher: 144, foreground: 324 },
  { name: "xxxhdpi", launcher: 192, foreground: 432 },
] as const;

function imageBuffer(dataUrl: string) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("The configured app icon is not a supported PNG, JPEG, or WebP data URL.");
  const input = Buffer.from(match[1], "base64");
  if (!input.length || input.byteLength > 3_000_000) throw new Error("The configured app icon has an invalid size.");
  return input;
}

export async function installBuildAppIcon(projectRoot: string, dataUrl: string) {
  const input = imageBuffer(dataUrl);
  const metadata = await sharp(input, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("The configured app icon could not be decoded.");

  const snapshots = new Map<string, Buffer>();
  for (const density of densities) {
    const directory = join(projectRoot, "app", "src", "main", "res", `mipmap-${density.name}`);
    for (const filename of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
      const path = join(directory, filename);
      snapshots.set(path, await readFile(path));
    }
  }

  try {
    for (const density of densities) {
      const directory = join(projectRoot, "app", "src", "main", "res", `mipmap-${density.name}`);
      const launcher = await sharp(input)
        .rotate()
        .resize(density.launcher, density.launcher, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
      const foregroundSize = Math.round(density.foreground * 0.68);
      const foregroundIcon = await sharp(input)
        .rotate()
        .resize(foregroundSize, foregroundSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const foreground = await sharp({
        create: { width: density.foreground, height: density.foreground, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([{ input: foregroundIcon, gravity: "centre" }]).png().toBuffer();
      await Promise.all([
        writeFile(join(directory, "ic_launcher.png"), launcher),
        writeFile(join(directory, "ic_launcher_round.png"), launcher),
        writeFile(join(directory, "ic_launcher_foreground.png"), foreground),
      ]);
    }
  } catch (error) {
    await Promise.all([...snapshots].map(([path, content]) => writeFile(path, content)));
    throw error;
  }

  let restored = false;
  return async () => {
    if (restored) return;
    restored = true;
    await Promise.all([...snapshots].map(([path, content]) => writeFile(path, content)));
  };
}
