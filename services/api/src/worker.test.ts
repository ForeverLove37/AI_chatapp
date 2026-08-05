import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryEnterpriseStore } from "./enterprise.js";
import { encryptBackup, executeArchive, missingArchiveTables } from "./worker.js";

const executeFile = promisify(execFile);
const restoreScript = fileURLToPath(new URL("../../../scripts/restore-backup.mjs", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_API_URL;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.APK_OUTPUT_DIR;
});

describe("Adaptive Chat backup format", () => {
  it("rejects an archive listing that omits any active table data", () => {
    const listing = [
      "; 1259 100 TABLE public users adaptive_chat",
      "; 0 100 TABLE DATA public users adaptive_chat",
      "; 1259 101 TABLE public chat_sessions adaptive_chat",
      "; 0 101 TABLE DATA public chat_sessions adaptive_chat",
      "; 1259 102 TABLE public chat_messages adaptive_chat",
    ].join("\n");
    const missing = missingArchiveTables(listing, [
      { schema: "public", table: "users", rows: 2 },
      { schema: "public", table: "chat_sessions", rows: 1 },
      { schema: "public", table: "chat_messages", rows: 4 },
    ]);
    expect(missing).toEqual([{ schema: "public", table: "chat_messages", rows: 4 }]);
  });

  it("round-trips an authenticated encrypted snapshot through the operator utility", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adaptive-chat-backup-test-"));
    const source = join(directory, "source.dump");
    const encrypted = join(directory, "snapshot.dump.acb");
    const restored = join(directory, "restored.dump");
    const content = Buffer.from("PostgreSQL custom dump test payload\n".repeat(100));
    try {
      await writeFile(source, content);
      await encryptBackup(source, encrypted, "test-backup-passphrase");
      await executeFile(process.execPath, [restoreScript, "decrypt", encrypted, restored], {
        env: { ...process.env, ADAPTIVE_BACKUP_PASSPHRASE: "test-backup-passphrase" },
      });
      expect(await readFile(restored)).toEqual(content);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uploads a published artifact to GitHub before deleting the final local copy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adaptive-chat-archive-test-"));
    const apkPath = join(directory, "adaptive-chat-test.apk");
    const content = Buffer.from("test apk artifact");
    await writeFile(apkPath, content);
    const store = new MemoryEnterpriseStore();
    try {
      const artifact = await store.createArtifact({ versionCode: 42, versionName: "4.2.0", releaseNotes: "Archive test" });
      await store.markArtifactBuilt(artifact.id, {
        fileName: "adaptive-chat-test.apk",
        localPath: apkPath,
        downloadUrl: "https://chatapi.example.test/downloads/adaptive-chat-test.apk",
        sha256: "a".repeat(64),
        bytes: content.length,
      });
      const release = await store.publishArtifact(artifact.id, "beta", "grp_beta");
      const queued = await store.enqueueJob("archive", { releaseId: release.id }, 1);
      const job = await store.claimJob(queued.id);
      expect(job).toBeDefined();
      process.env.GITHUB_TOKEN = "archive-test-token";
      process.env.GITHUB_API_URL = "https://github.test/api/v3";
      process.env.GITHUB_REPOSITORY = "ForeverLove37/AI_chatapp";
      process.env.APK_OUTPUT_DIR = directory;
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 101, html_url: "https://github.test/releases/101", upload_url: "https://uploads.github.test/repos/ForeverLove37/AI_chatapp/releases/101/assets{?name,label}", tag_name: "android-v4.2.0" }), { status: 201 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 202, name: "adaptive-chat-test.apk", size: content.length, state: "uploaded", browser_download_url: "https://github.test/releases/101/download/test.apk" }), { status: 201 }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await executeArchive(store, job!);
      expect(result).toMatchObject({ releaseId: release.id, localFileRemoved: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(stat(apkPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await store.getRelease(release.id)).toMatchObject({
        status: "archived",
        downloadUrl: "https://github.test/releases/101/download/test.apk",
      });
      expect((await store.getArtifact(artifact.id))?.status).toBe("archived");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
