# Adaptive Chat Disaster Recovery

The worker creates a complete PostgreSQL custom-format dump from one exported,
serializable, read-only snapshot. The coordinator transaction remains open until
`pg_dump` finishes, so users, chat sessions, messages, channels, feedback, and all
foreign-key references represent the same database instant.

Before encryption, the worker asks `pg_restore --list` to prove that every active
non-system PostgreSQL table has both a schema entry and a table-data entry. The
completed job stores the table names and snapshot row counts in `tableManifest`.
An omitted table makes the backup job fail before upload.

Every verified dump is encrypted using AES-256-GCM. A unique 128-bit scrypt salt
and 96-bit GCM IV are generated for every snapshot. The final authentication tag
prevents a corrupted or modified snapshot from being restored.

Redis contains transient queue and rate-limit state. PostgreSQL contains the
authoritative application configuration, users, synchronized conversations,
routing, templates, job history, release rings, and backup metadata.

## Prerequisites

- A copy of the `.dump.acb` snapshot from the configured Local, WebDAV, or S3 destination.
- The encryption passphrase entered when that backup destination was created.
- The same repository revision, Docker Compose project, and PostgreSQL major version, or a compatible newer `pg_restore` client.
- A separate copy of the current `.env` deployment secrets. They are not included inside the database snapshot.

## Restore Procedure

1. Stop all services that write application state:

   ```bash
   docker compose stop api worker admin web
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

5. Validate the restored relational graph before admitting application traffic:

   ```bash
   docker compose exec -T postgres psql -U adaptive_chat -d adaptive_chat -v ON_ERROR_STOP=1 -c \
     "SELECT conname FROM pg_constraint WHERE contype = 'f' AND NOT convalidated;"
   docker compose exec -T postgres psql -U adaptive_chat -d adaptive_chat -v ON_ERROR_STOP=1 -c \
     "SELECT (SELECT COUNT(*) FROM users) AS users,
             (SELECT COUNT(*) FROM chat_sessions) AS sessions,
             (SELECT COUNT(*) FROM chat_messages) AS messages,
             (SELECT COUNT(*) FROM dynamic_channels) AS channels,
             (SELECT COUNT(*) FROM feedbacks) AS feedbacks;"
   ```

   The first query must return zero rows. Compare the second query with the
   completed backup job's `tableManifest`. If a table differs, keep application
   writers stopped and investigate before proceeding.

6. Start the application services:

   ```bash
   docker compose up -d api worker admin web
   ```

7. Validate recovery:

   ```bash
   curl --fail https://chatapi.zengjunjie.com/health
   docker compose ps
   docker compose logs --tail=100 worker
   ```

   Then sign in at `https://chat.zengjunjie.com`, confirm that synchronized chat
   history is present, open the Admin Console, inspect dynamic channels and
   provider routing, run an SMTP test, and trigger a new backup.

## Queue Recovery

The worker treats PostgreSQL `background_jobs` rows as authoritative. On startup, queued and retrying jobs are pushed back into Redis. A running job older than 15 minutes is also recovered. Jobs that were actively transferring data when a host failed may therefore retry; backup filenames are unique and external storage should allow multiple objects.

## S3 Recovery Notes

The worker performs `PutObject`, followed by `HeadObject`, against the configured
endpoint. A backup is successful only when the remote `ContentLength` equals the
encrypted file size and object metadata `sha256` equals the local checksum. This
works with AWS S3 and S3-compatible endpoints that implement the standard path-
style or virtual-hosted operations selected in the destination settings.

Download the object without modifying it. The object key is the configured prefix
followed by `adaptive-chat-<UTC timestamp>.dump.acb`. Its metadata contains
`format=adaptive-chat-backup-v1` and `sha256=<encrypted-file checksum>`. Compare
that checksum with both the completed worker job and the downloaded encrypted file
before decryption.

## WebDAV Recovery Notes

Download the `.dump.acb` resource as binary data. Disable any proxy feature that automatically decompresses or transforms content. Compare the encrypted-file checksum with the worker job result before decryption.
