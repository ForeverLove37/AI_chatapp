import { createHash, randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CronExpressionParser } from "cron-parser";
import nodemailer from "nodemailer";
import { Client } from "pg";
import { installBuildAppIcon } from "./app-icon.js";
import {
  createPostgresEnterpriseStore,
  type BackgroundJob,
  type BackupExecutionConfig,
  type EnterpriseStore,
} from "./enterprise.js";

const logTime = () => new Date().toISOString();

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  onLine?: (line: string) => Promise<void>,
) {
  return new Promise<{ stdout: string; stderr: string }>((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const consume = (chunk: Buffer, isError: boolean) => {
      const value = chunk.toString("utf8");
      if (isError) stderr = `${stderr}${value}`.slice(-8_000);
      else stdout = `${stdout}${value}`.slice(-4_000_000);
      for (const line of value.split(/\r?\n/).filter(Boolean)) void onLine?.(line);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, true));
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolveCommand({ stdout, stderr })
      : reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`)));
  });
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function encryptBackup(sourcePath: string, targetPath: string, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.from(`ACBACKUP1\n${JSON.stringify({
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    authTagBytes: 16,
  })}\n`, "utf8");

  async function* encryptedChunks() {
    yield header;
    for await (const chunk of createReadStream(sourcePath)) yield cipher.update(chunk as Buffer);
    yield cipher.final();
    yield cipher.getAuthTag();
  }

  await pipeline(encryptedChunks(), createWriteStream(targetPath, { mode: 0o600 }));
}

function postgresEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("DATABASE_URL must use PostgreSQL.");
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

export type BackupTableManifest = {
  schema: string;
  table: string;
  rows: number;
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function missingArchiveTables(listing: string, manifest: BackupTableManifest[]) {
  return manifest.filter(({ schema, table }) => {
    const target = `${regexEscape(schema)}\\s+${regexEscape(table)}(?:\\s|$)`;
    return !new RegExp(`\\bTABLE\\s+${target}`, "m").test(listing)
      || !new RegExp(`\\bTABLE DATA\\s+${target}`, "m").test(listing);
  });
}

export async function createConsistentPostgresDump(
  databaseUrl: string,
  targetPath: string,
  onLine?: (line: string) => Promise<void>,
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE");
    const invalidConstraints = await client.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
       WHERE contype = 'f' AND convalidated = FALSE`,
    );
    if (invalidConstraints.rows.length) {
      throw new Error(`Database has unvalidated foreign keys: ${invalidConstraints.rows.map((row) => row.name).join(", ")}`);
    }
    const snapshot = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
    const snapshotId = snapshot.rows[0]?.snapshot;
    if (!snapshotId) throw new Error("PostgreSQL did not export a backup snapshot.");
    const tableRows = await client.query<{ schema: string; table: string }>(
      `SELECT namespace.nspname AS schema, class.relname AS table
       FROM pg_class AS class
       JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
       WHERE class.relkind = 'r'
         AND namespace.nspname NOT IN ('pg_catalog', 'information_schema')
         AND namespace.nspname !~ '^pg_toast'
       ORDER BY namespace.nspname, class.relname`,
    );
    const manifest: BackupTableManifest[] = [];
    for (const table of tableRows.rows) {
      const count = await client.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`,
      );
      manifest.push({ schema: table.schema, table: table.table, rows: Number(count.rows[0]?.count ?? 0) });
    }
    await runCommand("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      `--snapshot=${snapshotId}`,
      "--file",
      targetPath,
    ], { env: postgresEnvironment(databaseUrl) }, onLine);
    const listing = await runCommand("pg_restore", ["--list", targetPath], {}, onLine);
    const missing = missingArchiveTables(listing.stdout, manifest);
    if (missing.length) {
      throw new Error(`Backup archive omitted table objects: ${missing.map((item) => `${item.schema}.${item.table}`).join(", ")}`);
    }
    await client.query("COMMIT");
    return manifest;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function localDestination(config: BackupExecutionConfig, filename: string) {
  const root = resolve(process.env.BACKUP_LOCAL_ROOT ?? "/backups");
  const requested = config.localDirectory || root;
  const configured = requested.startsWith("/") ? resolve(requested) : resolve(root, requested);
  const traversal = relative(root, configured);
  if (traversal.startsWith("..") || traversal === "..") throw new Error("Local backup path must stay inside BACKUP_LOCAL_ROOT.");
  return { directory: configured, path: join(configured, filename) };
}

async function uploadBackup(
  config: BackupExecutionConfig,
  encryptedPath: string,
  filename: string,
  checksum: string,
  bytes: number,
) {
  if (config.protocol === "local") {
    const destination = localDestination(config, filename);
    await mkdir(destination.directory, { recursive: true, mode: 0o700 });
    try { await rename(encryptedPath, destination.path); }
    catch { await copyFile(encryptedPath, destination.path); await unlink(encryptedPath); }
    const stored = await stat(destination.path);
    if (stored.size !== bytes) throw new Error("Local backup verification failed: stored size differs from the encrypted archive.");
    return destination.path;
  }

  if (config.protocol === "webdav") {
    const base = new URL(config.webdavUrl.endsWith("/") ? config.webdavUrl : `${config.webdavUrl}/`);
    const destination = new URL(encodeURIComponent(filename), base);
    const authorization = config.credentials.username
      ? `Basic ${Buffer.from(`${config.credentials.username}:${config.credentials.password ?? ""}`).toString("base64")}`
      : undefined;
    const response = await fetch(destination, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", ...(authorization ? { Authorization: authorization } : {}) },
      body: createReadStream(encryptedPath) as unknown as BodyInit,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) throw new Error(`WebDAV upload failed with HTTP ${response.status}.`);
    const verification = await fetch(destination, {
      method: "HEAD",
      headers: authorization ? { Authorization: authorization } : {},
    });
    if (!verification.ok) throw new Error(`WebDAV verification failed with HTTP ${verification.status}.`);
    const remoteLength = Number(verification.headers.get("content-length"));
    if (Number.isFinite(remoteLength) && remoteLength > 0 && remoteLength !== bytes) {
      throw new Error("WebDAV verification failed: remote size differs from the encrypted archive.");
    }
    await unlink(encryptedPath);
    return destination.toString();
  }

  const key = [config.s3Prefix.replace(/^\/+|\/+$/g, ""), filename].filter(Boolean).join("/");
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint || undefined,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: config.credentials.accessKeyId && config.credentials.secretAccessKey
      ? { accessKeyId: config.credentials.accessKeyId, secretAccessKey: config.credentials.secretAccessKey }
      : undefined,
  });
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: createReadStream(encryptedPath),
      ContentLength: bytes,
      ContentType: "application/octet-stream",
      Metadata: { format: "adaptive-chat-backup-v1", sha256: checksum },
    }));
    const head = await client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    if (head.ContentLength !== bytes || head.Metadata?.sha256 !== checksum) {
      throw new Error("S3 verification failed: remote size or SHA-256 metadata differs from the encrypted archive.");
    }
  } finally {
    client.destroy();
  }
  await unlink(encryptedPath);
  return `s3://${config.s3Bucket}/${key}`;
}

async function executeEmail(store: EnterpriseStore, job: BackgroundJob) {
  const config = await store.getSmtpDeliveryConfig();
  if (!config.enabled) throw new Error("SMTP delivery is disabled.");
  if (!config.host || !config.fromEmail) throw new Error("SMTP host and sender address are not configured.");
  const to = String(job.payload.to ?? "");
  const subject = String(job.payload.subject ?? "");
  const html = String(job.payload.html ?? "");
  if (!to || !subject || !html) throw new Error("Email job payload is incomplete.");
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const result = await transport.sendMail({
    from: { name: config.fromName, address: config.fromEmail },
    to,
    subject,
    html,
  });
  transport.close();
  return { messageId: result.messageId, accepted: result.accepted.map(String), recipient: to };
}

async function executeBackup(store: EnterpriseStore, job: BackgroundJob) {
  const configId = String(job.payload.configId ?? "");
  const config = await store.getBackupExecutionConfig(configId);
  if (!config) throw new Error("Backup destination was not found.");
  if (!config.credentials.encryptionPassphrase) throw new Error("Backup encryption passphrase is missing.");
  const runId = await store.startBackupRun(config.id, job.id);
  const tempRoot = resolve(process.env.BACKUP_TEMP_ROOT ?? "/tmp/adaptive-chat-backups");
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const rawPath = join(tempRoot, `${runId}.dump`);
  const filename = `adaptive-chat-${timestamp}.dump.acb`;
  const encryptedPath = join(tempRoot, `${runId}.acb`);
  try {
    const databaseUrl = process.env.DATABASE_URL ?? "postgresql://adaptive_chat:adaptive_chat@postgres:5432/adaptive_chat";
    await store.appendJobLog(job.id, "Creating a transactionally consistent PostgreSQL snapshot");
    const manifest = await createConsistentPostgresDump(
      databaseUrl,
      rawPath,
      (line) => store.appendJobLog(job.id, line),
    );
    await store.appendJobLog(job.id, `Verified schema and table-data entries for ${manifest.length} active tables`);
    await store.appendJobLog(job.id, "Encrypting snapshot with AES-256-GCM");
    await encryptBackup(rawPath, encryptedPath, config.credentials.encryptionPassphrase);
    await unlink(rawPath);
    const [checksum, fileStats] = await Promise.all([sha256File(encryptedPath), stat(encryptedPath)]);
    await store.appendJobLog(job.id, `Uploading ${fileStats.size} encrypted bytes to ${config.protocol}`);
    const location = await uploadBackup(config, encryptedPath, filename, checksum, fileStats.size);
    const result = {
      runId,
      location,
      bytes: fileStats.size,
      checksum,
      verifiedTableCount: manifest.length,
      tableManifest: manifest,
      relationalSnapshot: "serializable-read-only-exported-snapshot",
    };
    await store.finishBackupRun(runId, { status: "succeeded", ...result });
    return result;
  } catch (error) {
    await Promise.allSettled([unlink(rawPath), unlink(encryptedPath)]);
    const message = error instanceof Error ? error.message : "Backup failed.";
    await store.finishBackupRun(runId, { status: "failed", error: message });
    throw error;
  }
}

async function executeBuild(store: EnterpriseStore, job: BackgroundJob) {
  const versionCode = Number(job.payload.versionCode);
  const versionName = String(job.payload.versionName ?? "");
  const ring = job.payload.ring === "beta" || job.payload.ring === "production" ? job.payload.ring : undefined;
  const artifactId = String(job.payload.artifactId ?? "");
  if (!Number.isInteger(versionCode) || !versionName) throw new Error("Build job version is invalid.");
  const artifact = artifactId ? await store.getArtifact(artifactId) : undefined;
  if (!artifact) throw new Error("Build artifact tracking record was not found.");
  const projectRoot = resolve(process.env.ANDROID_PROJECT_ROOT ?? "/workspace");
  let restoreIcon: (() => Promise<void>) | undefined;
  try {
    await store.appendJobLog(job.id, `Compiling Android ${versionName}${ring ? ` (requested ${ring} ring)` : ""}`);
    const launcherIcon = await store.getLauncherIcon();
    if (launcherIcon.dataUrl) {
      restoreIcon = await installBuildAppIcon(projectRoot, launcherIcon.dataUrl);
      await store.appendJobLog(job.id, "Bundled the global launcher icon");
    }
    const gradleArgs = [
      ":app:assembleDebug",
      `-PadaptiveVersionCode=${versionCode}`,
      `-PadaptiveVersionName=${versionName}`,
      ...(ring ? [`-PadaptiveReleaseRing=${ring}`] : []),
      "--no-daemon",
      "--max-workers=1",
      "-Pkotlin.compiler.execution.strategy=in-process",
      "--console=plain",
    ];
    await runCommand("./gradlew", gradleArgs, { cwd: projectRoot }, (line) => store.appendJobLog(job.id, line));

    const source = join(projectRoot, "app/build/outputs/apk/debug/app-debug.apk");
    const outputRoot = resolve(process.env.APK_OUTPUT_DIR ?? "/artifacts");
    await mkdir(outputRoot, { recursive: true, mode: 0o755 });
    const filename = `adaptive-chat-${versionName}-${artifact.id}.apk`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const target = join(outputRoot, filename);
    await copyFile(source, target);
    const checksum = await sha256File(target);
    const publicBase = (process.env.PUBLIC_API_BASE_URL ?? "https://chatapi.zengjunjie.com").replace(/\/$/, "");
    const downloadUrl = `${publicBase}/downloads/${basename(target)}`;
    const bytes = (await stat(target)).size;
    const tracked = await store.markArtifactBuilt(artifact.id, { fileName: filename, localPath: target, downloadUrl, sha256: checksum, bytes });
    if (!tracked) throw new Error("Build artifact disappeared before it could be finalized.");
    await store.appendJobLog(job.id, `Artifact ${artifact.id} stored at ${filename}; awaiting Publish stage`);
    return { artifactId: artifact.id, downloadUrl, sha256: checksum, bytes, status: tracked.status };
  } catch (error) {
    await store.markArtifactFailed(artifact.id, error instanceof Error ? error.message : "Android compilation failed.").catch(() => undefined);
    throw error;
  } finally {
    await restoreIcon?.().catch(() => undefined);
  }
}

type GitHubReleaseResponse = { id: number; html_url: string; upload_url: string; tag_name: string };
type GitHubAssetResponse = { browser_download_url: string; id: number; name: string; size: number; state: string };

async function githubRequest(input: string | URL, init: RequestInit, token: string) {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "adaptive-chat-worker",
      ...init.headers,
    },
  });
  const body = await response.text();
  let payload: unknown = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { payload = { message: body }; }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? String((payload as Record<string, unknown>).message) : `GitHub returned HTTP ${response.status}`;
    const details = payload && typeof payload === "object" && "errors" in payload ? `: ${JSON.stringify((payload as Record<string, unknown>).errors)}` : "";
    throw new Error(`${message}${details}`);
  }
  return payload as Record<string, unknown>;
}

export async function executeArchive(store: EnterpriseStore, job: BackgroundJob) {
  const releaseId = String(job.payload.releaseId ?? "");
  const release = releaseId ? await store.getRelease(releaseId) : undefined;
  if (!release) throw new Error("Release was not found for archive.");
  const artifact = await store.getArtifact(release.artifactId);
  if (release.status === "archived") {
    if (artifact?.status === "archived" && artifact.localPath) {
      const artifactRoot = resolve(process.env.APK_OUTPUT_DIR ?? "/artifacts");
      const artifactPath = resolve(artifact.localPath);
      const relativePath = relative(artifactRoot, artifactPath);
      if (relativePath.startsWith("..") || relativePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Artifact path is outside the configured APK output directory.");
      await unlink(artifactPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { releaseId, status: "archived", localFileRemoved: artifact?.status === "archived" };
  }
  if (!artifact || !artifact.localPath || !artifact.fileName) throw new Error("The published artifact has no local file to archive.");
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN is required before an artifact can be archived.");
  const repository = (process.env.GITHUB_REPOSITORY ?? "ForeverLove37/AI_chatapp").trim();
  if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must use owner/name format.");
  const apiBase = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
  const artifactRoot = resolve(process.env.APK_OUTPUT_DIR ?? "/artifacts");
  const artifactPath = resolve(artifact.localPath);
  const relativePath = relative(artifactRoot, artifactPath);
  if (relativePath.startsWith("..") || relativePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Artifact path is outside the configured APK output directory.");
  const file = await readFile(artifactPath);
  if (file.length !== artifact.bytes) throw new Error("Artifact size changed before GitHub upload.");
  const tag = `android-v${release.versionName}-${release.id}`.replace(/[^a-zA-Z0-9._-]/g, "-");
  await store.appendJobLog(job.id, `Creating GitHub release ${tag}`);
  let githubRelease: GitHubReleaseResponse;
  try {
    githubRelease = await githubRequest(`${apiBase}/repos/${repository}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: `Adaptive Chat ${release.versionName}`, body: release.releaseNotes, draft: false, prerelease: release.releaseRing === "beta" }),
    }, token) as unknown as GitHubReleaseResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("already_exists") && !message.includes("already exists")) throw error;
    githubRelease = await githubRequest(`${apiBase}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, { method: "GET" }, token) as unknown as GitHubReleaseResponse;
  }
  const uploadUrl = githubRelease.upload_url.replace(/\{\?name,label\}$/, "");
  let asset: GitHubAssetResponse;
  try {
    asset = await githubRequest(`${uploadUrl}?name=${encodeURIComponent(artifact.fileName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Length": String(file.length) },
      body: file,
    }, token) as unknown as GitHubAssetResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("already_exists") && !message.includes("already exists")) throw error;
    const assets = await githubRequest(`${apiBase}/repos/${repository}/releases/${githubRelease.id}/assets`, { method: "GET" }, token) as unknown as GitHubAssetResponse[];
    const existing = Array.isArray(assets) ? assets.find((candidate) => candidate?.name === artifact.fileName) : undefined;
    if (!existing) throw error;
    asset = existing;
  }
  if (!asset.browser_download_url) throw new Error("GitHub did not return a browser download URL for the uploaded APK.");
  if (asset.state !== "uploaded" || asset.size !== file.length) throw new Error("GitHub asset verification failed: upload state or byte length does not match the local APK.");
  const archived = await store.markReleaseArchived(release.id, { tag, releaseUrl: githubRelease.html_url, assetUrl: asset.browser_download_url });
  if (archived.deleteLocalFile) await unlink(artifactPath);
  await store.appendJobLog(job.id, `Uploaded ${artifact.fileName} to GitHub and ${archived.deleteLocalFile ? "removed the local artifact" : "retained the local artifact for another published ring"}`);
  return { releaseId: release.id, tag, githubReleaseUrl: githubRelease.html_url, githubAssetUrl: asset.browser_download_url, localFileRemoved: archived.deleteLocalFile };
}

async function scheduleBackups(store: EnterpriseStore) {
  const now = new Date();
  for (const config of await store.listBackupDestinations()) {
    if (!config.enabled) continue;
    try {
      const previous = CronExpressionParser.parse(config.scheduleCron, { currentDate: now }).prev().toDate();
      const last = config.lastScheduledAt ? new Date(config.lastScheduledAt) : undefined;
      if (!last || last < previous) {
        await store.markBackupScheduled(config.id, now.toISOString());
        await store.enqueueJob("backup", { configId: config.id, scheduled: true });
      }
    } catch (error) {
      console.error(`[${logTime()}] Invalid backup schedule for ${config.id}`, error);
    }
  }
}

async function processJob(store: EnterpriseStore, id: string) {
  const job = await store.claimJob(id);
  if (!job) return;
  await store.appendJobLog(job.id, `Worker started ${job.type} job at ${logTime()}`);
  try {
    const result = job.type === "email"
      ? await executeEmail(store, job)
      : job.type === "backup"
        ? await executeBackup(store, job)
        : job.type === "build"
          ? await executeBuild(store, job)
          : await executeArchive(store, job);
    await store.completeJob(job.id, result);
    console.log(`[${logTime()}] Completed ${job.type} job ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background job failed.";
    await store.appendJobLog(job.id, message);
    await store.failJob(job.id, message);
    console.error(`[${logTime()}] Failed ${job.type} job ${job.id}: ${message}`);
  }
}

export async function startWorker() {
  const store = await createPostgresEnterpriseStore();
  let running = true;
  let nextScheduleCheck = 0;
  const stop = () => { running = false; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`[${logTime()}] Adaptive Chat worker is ready`);
  try {
    while (running) {
      if (Date.now() >= nextScheduleCheck) {
        await scheduleBackups(store);
        nextScheduleCheck = Date.now() + 60_000;
      }
      const id = await store.waitForJob(5);
      if (id) await processJob(store, id);
    }
  } finally {
    await store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startWorker().catch((error) => {
    console.error("Unable to start Adaptive Chat worker", error);
    process.exitCode = 1;
  });
}
