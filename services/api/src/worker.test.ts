import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { encryptBackup, missingArchiveTables } from "./worker.js";

const executeFile = promisify(execFile);
const restoreScript = fileURLToPath(new URL("../../../scripts/restore-backup.mjs", import.meta.url));

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
});
