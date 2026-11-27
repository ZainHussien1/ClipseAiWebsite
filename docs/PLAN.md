# Clipse Radar — V0–V7 Architecture & Execution Plan (100% Free Tier)

## 1. Reality Audit Gaps Found in V0
1. **Missing HTML/Asset Security Headers:** `apps/edge/wrangler.jsonc` uses `run_worker_first: ["/api/*", "/hooks/*"]`, so `/` HTML and `/assets/*` returned **zero** `CSP`, `HSTS`, `frame-ancestors`, or `X-Robots-Tag: noindex` headers. Fix: ship `apps/web/public/_headers` + `X-Robots-Tag: noindex` in `security.ts`.
2. **Bare-Email Login Bypass:** `POST /api/v1/auth/bootstrap` currently accepts an email without proof of ownership and lacks a 3-user allowlist gate. Fix: 3-user allowlist + PBKDF2-SHA256 salted passphrase/OTP verification (`__Host-clipse_session` `HttpOnly; Secure; SameSite=Lax`, zero user enumeration).
3. **False Alerts & Test Data on Staging (`F-01`, `F-07`):** Staging D1 (`clipse-radar-db`) holds 3 false `viral` alerts (`535.6x`, `305.8x`, `4404.2x` cross-creator baseline on backfilled items) and 2 test claims (`"test"`, `"E2E test claim..."`). Fix: purge both via targeted SQL, add `is_backfill` tracking, and isolate Vitest/Playwright DBs.
4. **Providers Diagnosis (`§0.1B`):**
   - **YouTube:** Public Atom RSS works; `YOUTUBE_API_KEY` not yet bound on staging (`0.00x` engagement, missing duration/likes/comments). Needs batched `videos.list` enrichment + 30-day refresh/purge cron.
   - **Twitch & Kick:** `credentials_missing` (`TWITCH_CLIENT_ID/SECRET`, `KICK_CLIENT_ID/SECRET`), missing app-token OAuth exchange in `sync.ts`, no `Settings -> Integrations` UI, and no live EventSub/Kick callback routes (`/api/v1/integrations/{twitch,kick}/callback`).
5. **Pipeline & UX Gaps (`F-02..F-18`):** `notify-queue` not wired from `sync.ts`; `alert_deliveries` missing; `Feed` mixes Videos & Shorts (`F-15`); `Overview` & `My Work` use Phase-1/raw-ID scaffolding (`F-10`, `F-14`).

## 2. Verified Cloudflare 100% Free-Tier Limits ($0/month)
- **Workers Free (`edge` + `engine`):** 100k req/day, 10 ms CPU/req, 50 subrequests/req, `<=5` crons total. Static Assets requests are free.
- **D1 Free:** 5M reads/day, 100k writes/day, 500 MB/DB, 7-day Time Travel (queries fail on daily limit; write-budget governor skips no-op writes + surfaces degraded banner).
- **Queues Free:** 10k ops/day (~3,300 msgs/day). Batch messages (`<=25`) + D1 cron fallback if nearing daily cap.
- **SQLite Durable Objects Free (`new_sqlite_classes`):** 100k req/day, 13k GB-s/day, WebSocket Hibernation (pushes event IDs only).
- **KV Free:** 100k reads/day, 1k writes/day (read-mostly config/token cache).
- **Backups:** D1 7-day Time Travel + downloadable JSON/CSV workspace exports (no R2 billing/card dependency).

## 3. Architecture & Data Model
```mermaid
flowchart LR
  User["Browser / PWA"] -->|HTTPS + __Host- Cookie| Edge["edge Worker (Assets + _headers + Hono API + /hooks/*)"]
  YT["YouTube WebSub/RSS/API"] -->|HMAC / Poll| Edge
  TW["Twitch EventSub/Helix"] -->|HMAC / App Token| Edge
  KK["Kick Webhooks/OAuth2.1"] -->|PubKey Sig / Poll| Edge
  Edge <-->|WS Hibernation| DO["WorkspaceDO (SQLite Free)"]
  Edge -->|RPC EngineEntrypoint| Engine["engine Worker (<=5 Crons + 2 Batched Queues)"]
  Engine <--> D1[("D1 Free + 7d Time Travel")]
  Edge <--> D1
  Engine -->|AI Gateway Optional| Gemini["Gemini Free Tier"]
  Engine -->|allowed_mentions:[]| Discord["Discord / Web Push"]
```
- **Schema (`0006_v2_upgrade.sql`):** Add `items.(is_backfill, duration_sec, shorts_classification, last_synced_at)`, `follows.last_viewed_at`, `memberships.(passphrase_hash, availability_json, timezone)`, `saved_views`, `item_seen`, `creator_notes`, `alert_deliveries`, `clips.(manual_revenue_cents, publish_time)`, `notification_prefs.discord_daily_digest`.

## 4. Provider 1-Page Setup Guides (Summary in Settings -> Integrations)
- **YouTube (`YOUTUBE_API_KEY`):** `console.cloud.google.com` -> Enable YouTube Data API v3 -> Create API Key (restrict to YouTube Data API v3) -> `wrangler secret put YOUTUBE_API_KEY`.
- **Twitch (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`):** Enable 2FA -> `dev.twitch.tv/console` -> Register Application (`Application Integration`, Redirect URL `https://<host>/api/v1/integrations/twitch/callback`) -> wire secrets.
- **Kick (`KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`):** Enable 2FA -> `kick.com` Account Settings -> Developer / OAuth Apps (Redirect URI `https://<host>/api/v1/integrations/kick/callback`) -> wire secrets.

## 5. V0–V7 Execution Task Map
| ID | Phase & Task | Agent | Depends | Exit Criteria | Status |
|---|---|---|---|---|---|
| V0 | Brief redact, `.dev.vars`, Reality Audit, `PLAN.md`, ADR-003 | lead, reviewer | — | Audit gaps logged, git history clean | done |
| V1 | `_headers`, 3-user verified login, purge F-01/F-07, `0006`, fix F-02..F-12 | backend, frontend, reviewer | V0 | Regression tests for F-01..F-12 pass | done |
| V2 | Twitch/Kick OAuth+EventSub+webhooks, YT `videos.list`+30d purge, Integrations UI | ingestion, backend, frontend | V1 | Live YT/mocked TW+KK contract tests pass | done |
| V3 | 3-lane Discover (`>=100` Shorts precision `>=98%`), Mission Control, Kanban Work Board, responsive `F-18` | backend, frontend, reviewer | V2 | Lane, Kanban overlap, WS sync tests pass | done |
| V4 | Rising v2 (creator baseline, backfill-safe), Live Moments, Alerts v2 lifecycle/Discord/Push/shift | signals, backend, frontend | V3 | Rising/Live/Discord/Push tests pass | done |
| V5 | Creators Intelligence, Clip Log + Our Channels + ROI + Scorecard, Daily/Weekly + Gemini AI, Admin | backend, frontend, reviewer | V4 | All 14 E2E scenarios & truth audit pass | done |
| V6 | Playwright 3-engine x 4-viewport + axe + Lighthouse + bundle budgets + D1 restore drill | qa, perf, reviewer | V5 | Zero violations, JS `<=170KB`, CSS `<=25KB` | in_progress |
| V7 | Production deploy (`wrangler secret put`, D1 migrate, deploy, live smoke, Discord alert, `RUNBOOK.md`) | platform, lead | V6 | Live Prod URL green + Discord verified | pending |
