import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { encryptBackup } from "./worker.js";

const executeFile = promisify(execFile);
const restoreScript = fileURLToPath(new URL("../../../scripts/restore-backup.mjs", import.meta.url));

describe("Adaptive Chat backup format", () => {
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
