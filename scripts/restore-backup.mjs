#!/usr/bin/env node

import { createDecipheriv, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { pipeline } from "node:stream/promises";

const [, , command, sourceArgument, destinationArgument] = process.argv;

if (command !== "decrypt" || !sourceArgument || !destinationArgument) {
  console.error("Usage: node scripts/restore-backup.mjs decrypt <snapshot.dump.acb> <snapshot.dump>");
  process.exit(2);
}

const source = resolve(sourceArgument);
const destination = resolve(destinationArgument);
const partial = `${destination}.partial-${process.pid}`;

async function passphrase() {
  if (process.env.ADAPTIVE_BACKUP_PASSPHRASE) return process.env.ADAPTIVE_BACKUP_PASSPHRASE;
  if (!stdin.isTTY) throw new Error("Set ADAPTIVE_BACKUP_PASSPHRASE when standard input is not interactive.");
  emitKeypressEvents(stdin);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write("Backup passphrase: ");
  return new Promise((resolvePassphrase, rejectPassphrase) => {
    let value = "";
    const finish = (error) => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
      if (error) rejectPassphrase(error);
      else resolvePassphrase(value);
    };
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new Error("Backup decryption was cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") {
        if (value) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (!key.ctrl && !key.meta && text) {
        value += text;
        stdout.write("*");
      }
    };
    stdin.on("keypress", onKeypress);
  });
}

async function readHeader() {
  const handle = await open(source, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead);
    const firstBreak = prefix.indexOf(0x0a);
    const secondBreak = prefix.indexOf(0x0a, firstBreak + 1);
    if (firstBreak < 0 || secondBreak < 0 || prefix.subarray(0, firstBreak).toString("utf8") !== "ACBACKUP1") {
      throw new Error("The source is not an Adaptive Chat backup v1 file.");
    }
    const metadata = JSON.parse(prefix.subarray(firstBreak + 1, secondBreak).toString("utf8"));
    if (metadata.version !== 1 || metadata.cipher !== "aes-256-gcm" || metadata.kdf !== "scrypt" || metadata.authTagBytes !== 16) {
      throw new Error("The backup encryption metadata is unsupported.");
    }
    return { metadata, ciphertextOffset: secondBreak + 1 };
  } finally { await handle.close(); }
}

async function main() {
  const { metadata, ciphertextOffset } = await readHeader();
  const sourceStats = await stat(source);
  const tagOffset = sourceStats.size - metadata.authTagBytes;
  if (tagOffset <= ciphertextOffset) throw new Error("The encrypted backup is truncated.");
  const handle = await open(source, "r");
  const tag = Buffer.alloc(metadata.authTagBytes);
  try { await handle.read(tag, 0, tag.length, tagOffset); }
  finally { await handle.close(); }
  const secret = await passphrase();
  if (secret.length < 12) throw new Error("The backup passphrase must contain at least 12 characters.");
  const key = scryptSync(secret, Buffer.from(metadata.salt, "base64url"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(metadata.iv, "base64url"));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source, { start: ciphertextOffset, end: tagOffset - 1 }),
      decipher,
      createWriteStream(partial, { mode: 0o600 }),
    );
    await rename(partial, destination);
    console.log(`Authenticated PostgreSQL dump written to ${destination}`);
  } catch (error) {
    await rm(partial, { force: true });
    throw new Error(`Backup authentication or decryption failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
