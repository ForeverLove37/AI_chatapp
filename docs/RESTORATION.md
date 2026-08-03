# Adaptive Chat Disaster Recovery

The Iteration 4 worker creates a complete PostgreSQL custom-format dump with `pg_dump --format=custom --no-owner --no-acl`. Before upload, every dump is encrypted using AES-256-GCM. A unique 128-bit scrypt salt and 96-bit GCM IV are generated for every snapshot. The final authentication tag prevents a corrupted or modified snapshot from being restored.

Redis contains transient queue and rate-limit state. PostgreSQL contains the authoritative application configuration, users, routing, templates, job history, release rings, and backup metadata.

## Prerequisites

- A copy of the `.dump.acb` snapshot from the configured Local, WebDAV, or S3 destination.
- The encryption passphrase entered when that backup destination was created.
- The same repository revision, Docker Compose project, and PostgreSQL major version, or a compatible newer `pg_restore` client.
- A separate copy of the current `.env` deployment secrets. They are not included inside the database snapshot.

## Restore Procedure

1. Stop all services that write application state:

   ```bash
   docker compose stop api worker admin
   ```

2. Decrypt and authenticate the snapshot. The utility writes to a temporary file and only renames it to the requested output after GCM authentication succeeds:

   ```bash
   node scripts/restore-backup.mjs decrypt snapshot.dump.acb snapshot.dump
   ```

   For unattended recovery, provide the passphrase through the environment instead of a command-line argument so it is not exposed in the process list:

   ```bash
   ADAPTIVE_BACKUP_PASSPHRASE='your-passphrase' node scripts/restore-backup.mjs decrypt snapshot.dump.acb snapshot.dump
   ```

3. Optional but strongly recommended: archive the current database volume before replacing data.

4. Restore all PostgreSQL objects and data:

   ```bash
   docker compose exec -T postgres pg_restore \
     --clean --if-exists --no-owner \
     --dbname adaptive_chat < snapshot.dump
   ```

   When `POSTGRES_DB` differs from `adaptive_chat`, use the configured database name.

5. Start the application services:

   ```bash
   docker compose up -d api worker admin
   ```

6. Validate recovery:

   ```bash
   curl --fail https://chatapi.zengjunjie.com/health
   docker compose ps
   docker compose logs --tail=100 worker
   ```

   Then sign in, open the Admin Console, inspect dynamic channels and provider routing, run an SMTP test, and trigger a new backup.

## Queue Recovery

The worker treats PostgreSQL `background_jobs` rows as authoritative. On startup, queued and retrying jobs are pushed back into Redis. A running job older than 15 minutes is also recovered. Jobs that were actively transferring data when a host failed may therefore retry; backup filenames are unique and external storage should allow multiple objects.

## S3 Recovery Notes

Download the object without modifying it. The object key is the configured prefix followed by `adaptive-chat-<UTC timestamp>.dump.acb`. Its metadata contains `format=adaptive-chat-backup-v1`. Compare the SHA-256 value shown in the completed worker job with the downloaded encrypted file before decryption.

## WebDAV Recovery Notes

Download the `.dump.acb` resource as binary data. Disable any proxy feature that automatically decompresses or transforms content. Compare the encrypted-file checksum with the worker job result before decryption.
