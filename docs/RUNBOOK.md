# Clipse Radar — Operations & Deployment Runbook

## 1. Zero-Cost ($0/mo) Cloudflare Free Deployment

All services run on Cloudflare Free Tier (`$0/mo`, no paid add-ons required):

1. **Create D1 database & Queues (one-time):**
   - Create D1 database `clipse-radar-db` and set `database_id` in `apps/edge/wrangler.jsonc` and `apps/engine/wrangler.jsonc`.
   - Create Queues: `ingest-queue`, `ingest-dlq`, `notify-queue`, `notify-dlq`.
2. **Apply D1 Migrations (`0001..0005`):**
   ```powershell
   cmd /c pnpm --filter @clipse/edge exec wrangler d1 migrations apply clipse-radar-db --remote
   ```
3. **Upload Worker Secrets (NEVER commit `.dev.vars`):**
   ```powershell
   cmd /c pnpm --filter @clipse/edge exec wrangler secret bulk .dev.vars
   cmd /c pnpm --filter @clipse/engine exec wrangler secret bulk .dev.vars
   ```
4. **Deploy `engine` first, then `edge`:**
   ```powershell
   cmd /c pnpm --filter @clipse/web build
   cmd /c pnpm --filter @clipse/engine exec wrangler deploy
   cmd /c pnpm --filter @clipse/edge exec wrangler deploy
   ```
5. **Cloudflare Access Free (<=50 users) & `/hooks/*` Bypass:**
   - Protect the app domain with Cloudflare Access; `edge` independently verifies `Cf-Access-Jwt-Assertion` via `jose` JWKS (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`).
   - Add an Access **Bypass** policy for `/hooks/*` so YouTube WebSub, Twitch EventSub, and Kick webhooks reach `edge` over public HTTPS (verified via HMAC/Ed25519 signatures + 24h replay dedupe).

## 2. Windows 10/11 Local Development

`pnpm.ps1` is blocked by PowerShell execution policy; run all commands via `cmd /c`:

```powershell
cmd /c pnpm install
cmd /c pnpm typecheck
cmd /c pnpm lint
cmd /c pnpm test
cmd /c pnpm build
cmd /c pnpm --filter @clipse/edge dev
cmd /c pnpm --filter @clipse/engine dev
cmd /c pnpm --filter @clipse/web dev
```

## 3. D1 Backup, Restore & Measured DR Drill

### Procedure
```powershell
cmd /c pnpm --filter @clipse/edge exec wrangler d1 export clipse-radar-db --remote --output d1-backup.sql
cmd /c pnpm --filter @clipse/edge exec wrangler d1 execute clipse-radar-db --remote --file d1-backup.sql
```

### Measured Local DR Drill (2026-11-26)
Executed on `clipse-radar-db` (`--local`) with `.artifacts/` cleaned after verification:
- **Migrations (`0001_init.sql`..`0005_phase5.sql`):** `22.88s` (exit `0`).
- **Export (`wrangler d1 export --local`):** `5.49s`, `10,952 bytes` (exit `0`).
- **Clean-slate Restore (`rm apps/edge/.wrangler` + `wrangler d1 execute --local --file`):** `7.93s`, 47 SQL statements (exit `0`).
- **Verification (`SELECT count(*) FROM sqlite_master WHERE type='table'`):** `21` tables restored (exit `0`).
- **Targets:** **RTO < 5 min** (measured schema+empty-state restore `7.93s`); **RPO <= 24h** with daily scheduled `d1 export` (or **0** for user-triggered workspace JSON/CSV exports via `/api/v1/export`).

## 4. Dependency & Security Audit (2026-11-26)

- **Unique Runtime Dependencies:** `9` (`@fontsource-variable/inter`, `@tanstack/react-query`, `@tanstack/react-router`, `hono`, `jose`, `lucide-react`, `react`, `react-dom`, `zod`) — within `<=25` cap.
- **`cmd /c pnpm audit --audit-level=high`:**
  - `tinypool <2.1.2` (2 critical, **dev-only** via `vitest`/`wrangler`; not bundled in Workers or SPA).
  - `zod 3.25.76` (1 high `GHSA-mrhx-c7xc-m3w5` `<4.6.6`; mitigated by 64KB request body cap and bounded Zod schemas; schedule v4 upgrade in a dedicated pass).

## 5. Secret Rotation & Incident Response

- **Secret Rotation:** Update `.dev.vars` (never read/logged by agents), run `wrangler secret bulk .dev.vars` on `edge` and `engine`, then revoke the old key at the provider/Cloudflare dashboard. For `WEBHOOK_ENC_KEY`, re-encrypt stored workspace Discord webhooks before retiring the old key.
- **429 Circuit Breaker:** `TokenBucketQuotaGovernor` trips on HTTP 429 and backs off (`Retry-After`); inspect `/api/v1/admin/scorecard` for quota telemetry and reduce non-starred polling frequency if sustained.
- **D1 Daily Limit (100k writes/day, fail-on-limit):** `edge` returns degraded status on `/api/v1/health` (UI displays `Degraded` banner); wait for midnight UTC reset, prune old `item_stats`/`live_samples` (>7d), and inspect `reconcile_runs`.
- **DLQ Inspection (`ingest-dlq`, `notify-dlq`):** Check Cloudflare Dashboard -> Queues -> DLQ messages or `wrangler queues consumer` logs; replay only after fixing malformed payloads or transient provider errors.
