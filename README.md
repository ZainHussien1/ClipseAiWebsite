# Clipse Radar

Real-time creator monitoring, rising-signal detection, live-moment alerting, and clip-team workflow platform running strictly on **Cloudflare's 100% Free Tier ($0/month)**.

---

## Live Deployments

| Environment | URL | Edge Worker | Engine Worker | D1 Database |
| :--- | :--- | :--- | :--- | :--- |
| **Production** | https://clipse-radar.swattopandhappy.workers.dev/ | `clipse-radar` (`e04e5fb2`) | `clipse-radar-engine-prod` (`9d5ea404`) | `clipse-radar-prod-db` (`007589e9-208a-4aa3-a21a-8f17eafdad1f`) |
| **Staging** | https://clipse-radar-edge.swattopandhappy.workers.dev/ | `clipse-radar-edge` (`8b44dfc7`) | `clipse-radar-engine` (`1f48796c`) | `clipse-radar-db` (`0b4693d5-eec1-4ab6-a6c6-5a9911de24a8`) |

---

## Architecture ($0/Month Free-Tier Design)

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

- **`apps/web`** — React 19 + Vite + Tailwind v4 + TanStack Router/Query SPA with static `_headers` security policy (`CSP`, `HSTS`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `frame-ancestors 'none'`).
- **`apps/edge`** — Cloudflare Workers Static Assets + Hono API + `/hooks/*` webhook receivers + SQLite-backed `WorkspaceDO` (WebSocket Hibernation).
- **`apps/engine`** — Scheduled Cron reconcilers (`<=5` total crons) + batched Queue consumers (`ingest-queue*`, `notify-queue*` + DLQs) + optional Gemini Insights via AI Gateway.
- **`packages/core`** — Pure domain logic, Zod validation schemas, scoring/classification engines, and hexagonal ports (zero I/O).

### Free-Tier Resource Guardrails
- **Workers Free:** `100k` req/day, `10 ms` CPU/req, `50` subrequests/req, `<=5` crons. Static Asset requests are unmetered.
- **D1 Free:** `5M` reads/day, `100k` writes/day, `500 MB`/DB, 7-day Time Travel, plus downloadable workspace JSON/CSV exports.
- **Queues Free:** `10k` ops/day with batched enqueueing (`<=25` messages/batch) and DLQ inspection.
- **Zero-Cost Dependency Profile:** `9` unique runtime dependencies (`@fontsource-variable/inter`, `@tanstack/react-query`, `@tanstack/react-router`, `hono`, `jose`, `lucide-react`, `react`, `react-dom`, `zod`).

---

## V0–V7 Delivery Report

| Phase | Commit | Key Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **V0** | — | Redacted [docs/BRIEF.md](./docs/BRIEF.md), `.dev.vars` local secret wiring (0 secrets in Git history), Reality Audit, [docs/PLAN.md](./docs/PLAN.md), and [docs/adr/003-insights-ai-gateway.md](./docs/adr/003-insights-ai-gateway.md). | Done |
| **V1** | `7c9c625` | Static `_headers` + `X-Robots-Tag: noindex`, removed bare-email bypass (`401`), added 3-user allowlist login (`POST /api/v1/auth/request-code` 6-digit Discord OTP + `PBKDF2-SHA256` passphrase), `Viewer` `403` guard, `VITE_GIT_SHA`/`VITE_BUILD_TIME` injection, `0006_v2_upgrade.sql`, and purged false Staging alerts/claims (`F-01`, `F-07`). | Done |
| **V2** | `8fa5932` | Twitch/Kick app-token OAuth exchanges, dynamic Kick public-key verification (`fetchKickPublicKey`), YouTube `videos.list` enrichment + 30-day compliance (`enforceYouTube30DayCompliance`), `/api/v1/admin/integrations` APIs, and `Settings -> Integrations` UI. | Done |
| **V3** | `c26cf3f` | Upgraded `classifyShort` (`<=180s` + `unclassified` bucket; `100.00%` accuracy on `n=110`), `0007_v3_board.sql`, `MissionControlPage`, 3-lane `FeedPage` + `ItemDetailDrawer`, Kanban `WorkBoardPage`, and `1440px` responsive layout. | Done |
| **V4** | `032e74c` | Creator-normalized `evaluateRisingV2` (7-day baseline, backfill-safe, velocity over `>=2` snapshots `>=10m` apart), raid-safe `isRaidOnly` Live Moments, `0008_v4_alerts.sql`, alert acknowledgement/delivery log/shift availability routes, IANA timezone `<select>`, and Rules Matrix UI. | Done |
| **V5** | `2a35298` | `GeminiInsightsProvider` (public metadata only, strict numeric grounding), `0009_v5_creators.sql`, `CreatorsPage`, clip-picker & manual revenue logging in `ClipLogPage`, Daily/Weekly `ReportsPage`, 3-seat allowlist + sole-Owner guard (`F-17`), and Admin suite (`Health & Accuracy`, `Audit Log`, `Data Quality`, `Our Channels`). | Done |
| **V6–V7** | `f4768db` | `>=44px` mobile touch targets across shell/auth controls, `*-prod` queue routing support, `env.production` bindings, remote Production D1 provisioning + `0001..0009` migrations + secrets upload, Production & Staging deploy, live QA, and Discord deploy alert. | Done |

---

## Defect Resolution Summary (`F-01` – `F-18`)

- **`F-01` (False viral alerts):** Purged false Staging alerts (`alerts_after=0`) and replaced cross-creator scoring with creator-normalized `evaluateRisingV2` and backfill protection.
- **`F-02` – `F-09`, `F-11` – `F-13` (Auth, security headers, truth metrics, build stamp):** Removed bare-email login (`401`), enforced 6-digit Discord OTP / `PBKDF2-SHA256` passphrase and `Viewer` `403` isolation, added `_headers` + `X-Robots-Tag: noindex`, purged test claims (`F-07`, `claims=0`), and injected `VITE_GIT_SHA` / `VITE_BUILD_TIME` (`F-11`).
- **`F-10`, `F-13` – `F-15`, `F-18` (UX & workflow gaps):** Shipped `MissionControlPage`, 3-lane Discover (`FeedPage`) separating Videos / Shorts / Live, Kanban `WorkBoardPage`, and full `1440px` desktop responsiveness.
- **`F-16` (Timezone validation):** Replaced free-text timezone input with a standardized IANA timezone `<select>`.
- **`F-17` (Team governance):** Enforced the 3-seat workspace cap and added sole-Owner delete/demote protection.

---

## Verification & QA Metrics

- **Typecheck (`cmd /c pnpm typecheck`):** Passed (`exit 0` across `core`, `web`, `edge`, `engine`).
- **Lint (`cmd /c pnpm lint`):** Passed (`eslint . --max-warnings=0`, `0` warnings).
- **Unit & Integration Tests (`cmd /c pnpm test`):** **108/108 passed** (`packages/core`: 11 files / 57 tests; `apps/engine`: 4 files / 15 tests; `apps/edge`: 11 files / 36 tests; `apps/web`: 0 test files with `--passWithNoTests`).
- **Production Bundle (`cmd /c pnpm build`):** Passed across all 4 packages (`index-BaNydzSf.js`: `282.42 kB` / `83.42 kB` gzip; `tanstack-DqyJKvKf.js`: `122.19 kB` / `41.08 kB` gzip; `index-CxtG1XcO.css`: `24.66 kB` / `5.88 kB` gzip; `wrangler deploy --dry-run`: `524.33 KiB` / `104.35 KiB` gzip).
- **Truth Audit:** Scanned `108` source files — `0` mock/placeholder data items (`1` benign `Phase 4` comment in `packages/core/src/api-schemas.ts`).
- **D1 Local DR Drill (`0001..0009`):** Migrate `29.25s`, export `6.95s` (`14,433 bytes`), clean-slate restore `7.03s`, verified `26` tables.
- **Live Production Verification (`https://clipse-radar.swattopandhappy.workers.dev/`):**
  - HTTP `200` on HTML, assets, `/api/v1/health` (`environment: "prod"`, `authMode: "session"`, `authConfigured: true`), and `/api/v1/auth/status`; bare-email `POST /api/v1/auth/login` rejected with `401`.
  - Browser QA at `1440x900` and `390x844`: `0` console/JS errors, `0` failed requests, `0` `"Request Failed"` UI errors, `0` horizontal overflow at `390px`, and all TopBar & Auth interactive controls `>= 44px` height (`44px`).
  - Discord deployment notification delivered (`HTTP 204`).

---

## Local Development & Deployment (Windows 10/11)

`pnpm.ps1` is blocked by default PowerShell execution policy; run `pnpm` via `cmd /c`:

```powershell
cmd /c pnpm install
cmd /c pnpm typecheck
cmd /c pnpm lint
cmd /c pnpm test
cmd /c pnpm build
```

Run local workers/UI dev servers:

```powershell
cmd /c pnpm --filter @clipse/edge dev
cmd /c pnpm --filter @clipse/engine dev
cmd /c pnpm --filter @clipse/web dev
```

### First-Time Production Setup & Optional Provider Keys
1. Open the Production URL and sign in with an allowlisted email using `Send 6-digit verification code` (delivered to the configured Discord webhook) or a configured passphrase to initialize the `Owner` workspace.
2. Add optional provider credentials whenever available (YouTube RSS works immediately with `$0` cost):
   ```powershell
   cmd /c pnpm --filter @clipse/edge exec wrangler secret put YOUTUBE_API_KEY --env production
   cmd /c pnpm --filter @clipse/engine exec wrangler secret put YOUTUBE_API_KEY --env production
   ```
   Twitch (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`) and Kick (`KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`) can also be wired via `wrangler secret put ... --env production` once 2FA developer apps are created.

---

## Documentation

- [AGENTS.md](./AGENTS.md) — Repository guardrails, Windows commands, and limits
- [docs/PLAN.md](./docs/PLAN.md) — V0–V7 architecture, free-tier budgets, and task map
- [docs/RUNBOOK.md](./docs/RUNBOOK.md) — Operations, deployment, D1 DR drill, and incident runbook
- [docs/adr/001-worker-topology.md](./docs/adr/001-worker-topology.md) — Two-Worker topology decision
- [docs/adr/002-ai-insights-decision.md](./docs/adr/002-ai-insights-decision.md) — Deterministic-first AI policy
- [docs/adr/003-insights-ai-gateway.md](./docs/adr/003-insights-ai-gateway.md) — AI Gateway integration ADR
