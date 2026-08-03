# Iteration 4 Conclusion

## Outcome

Iteration 4 is implemented, verified, and deployed. The platform now has
persistent enterprise orchestration for email, dynamic channels, release rings,
encrypted backups, and Redis-backed background work. The Android client consumes
the live channel catalog without requiring a new app build for each provider.

## Delivered

- Added encrypted SMTP configuration, editable HTML templates, a sandboxed live
  preview, test delivery, announcements, and new-IP sign-in alerts. Templates
  escape runtime values, credentials remain server-side, and automatic release
  email fan-out is skipped cleanly while SMTP is disabled.
- Added the no-code Dynamic Channel Builder. Admins can configure an arbitrary
  OpenAI-compatible provider, server-only key, upstream model mappings, icon,
  gradient, accent/surface/text colors, typography, animation, priority, and
  visibility. `/v1/config` exposes only safe client tokens and model aliases.
- Refactored Android channel/model types into a runtime catalog. Compose applies
  downloaded icons, colors, gradients, typography, and animated backgrounds;
  channel switching still changes the UI while model switching changes only the
  OpenAI-compatible API payload. Existing Room history remains compatible.
- Added Standard and Beta user groups with persistent membership management.
  Build Beta targets `grp_beta`; Publish Production targets all users. OTA update
  selection is authenticated and release-ring aware.
- Added a PostgreSQL-backed build/release pipeline with persisted logs and APK
  checksums. Release notifications are queued only when SMTP is enabled.
- Added scheduled encrypted backups for local storage, WebDAV, and S3-compatible
  services. Backups stream through `pg_dump`, AES-256-GCM encryption, and the
  selected destination without buffering the complete archive in memory.
- Added the `ACBACKUP1` restore utility and a precise recovery runbook covering
  decryption, `pg_restore`, Redis queue recovery, validation, and rollback.
- Added the Redis worker for email, backup, and Android build jobs with durable
  PostgreSQL status/logs, retries, stale-job recovery, and non-blocking API
  requests. PostgreSQL, Redis, backup data, and APK artifacts use persistent
  Docker volumes or host storage.
- Expanded the Admin Console with Email, Channels, Groups & builds, Backups &
  recovery, and Jobs views. The deployed console remains protected by Nginx HTTP
  Basic Auth and proxies authenticated Admin API calls through Next.js.

## Verification

- API and worker: TypeScript build passed; 13 Vitest tests passed across two test
  files, including runtime Qwen publication, suspicious-IP queuing, release-ring
  jobs, backup triggering, and encrypted backup/restore round trips.
- Admin: the Next.js 16 production build and TypeScript validation passed. All six
  new deployed Admin data surfaces return HTTP 200 through the authenticated API.
- Android: Kotlin compilation and all 5 unit tests passed. APK metadata reports
  package `com.zengjunjie.adaptivechat`, version code 5, version `1.3.0`, target
  SDK 36, application label `Adaptive Chat`, and adaptive launcher resources.
- Security: `npm audit --omit=dev` reports 0 vulnerabilities. Public console
  access immediately returns HTTP 401 with `WWW-Authenticate: Basic`; valid
  credentials return HTTP 200. The API health route returns HTTPS 200.
- Database: all nine Iteration 4 tables are present. Standard and Beta groups are
  seeded, and existing accounts were assigned to Standard during migration.
- Queue and backup: a live Redis job produced a full encrypted PostgreSQL snapshot
  in persistent storage (40,358 bytes), recorded its checksum, and finished as
  `succeeded`; the Redis pending queue then returned to zero.
- Release pipeline: production `1.3.0` was compiled and published globally. Beta
  `1.3.0-beta.1` was separately compiled with audience `grp_beta`. Both jobs
  succeeded, both public downloads return HTTP 200, and their file hashes match
  the worker records. The disabled-SMTP guard was verified on the beta build.
- Runtime: API, Admin, worker, PostgreSQL, and Redis containers are running;
  health checks pass and Nginx configuration validation succeeds.

## Access

- Admin Console: `https://console.zengjunjie.com`
- API Gateway: `https://chatapi.zengjunjie.com`
- Production APK:
  `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.3.0-production.apk`
- Beta APK:
  `https://chatapi.zengjunjie.com/downloads/adaptive-chat-1.3.0-beta.1-beta.apk`
- Local production APK:
  `app/build/outputs/apk/iteration4/adaptive-chat-1.3.0-production.apk`
- Canonical local APK: `app/build/outputs/apk/debug/app-debug.apk`
- Production SHA-256:
  `a468a97d472ab8fb065a8ff061676b57deb362d2c9b87f961bf626cd2036d432`
- Beta SHA-256:
  `3a917d2096600007c42b80daedfc352d62cc66727986e840ec9c7e4c87669422`

Android visual validation remains with the Product Owner. No emulator, Xvfb,
noVNC, Lavapipe, or other headless UI environment was used.
