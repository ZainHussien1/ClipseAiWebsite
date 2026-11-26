# Clipse Radar — Threat Model & Security Architecture (v1)

## 1. Scope & Trust Boundaries
- **Edge Boundary:** Browser/PWA -> Cloudflare Access -> `edge` Worker (Hono API + Static Assets + `WorkspaceDO`).
- **Webhook Boundary:** YouTube WebSub, Twitch EventSub, Kick Webhooks -> `/hooks/*` (bypasses Access; verified by provider cryptographic signatures).
- **Internal Boundary:** `edge` -> D1, Queues (`ingest`, `notify`), `engine` Worker (Service Binding RPC).
- **Trust Rule:** All external inputs (HTTP, headers, query, D1 rows, queue messages, provider responses, AI outputs) are untrusted and validated with `zod`.

## 2. Threat Matrix

| Threat | Attack Vector | Mitigation & Control | Verification |
|---|---|---|---|
| **Tenant Isolation / IDOR** | Client supplies `?workspaceId=` or body `workspace_id` to read/mutate another tenant's data | `workspaceId` is derived **only** from verified Access JWT `sub` + D1 `memberships` lookup. Every tenant query/mutation filters by `principal.workspaceId` at the repository layer. | Cross-tenant IDOR matrix in `apps/edge/src/app.test.ts` and Phase 6 audit. |
| **Webhook Forgery & Replay** | Spoofed `/hooks/{youtube,twitch,kick}` POSTs or replayed valid payloads | Verify HMAC-SHA1/SHA256 (`timingSafeEqual`) or Kick `Ed25519` (`GET /public/v1/public-key`). Enforce 10-min timestamp window and 24h `message_id` dedupe in D1/KV. Enforce body size caps. | Forgery, expired timestamp, oversize body, and replay tests in Phase 2. |
| **SSRF** | User submits internal/metadata URL (`http://169.254.169.254/...`) in "Add source" | Users never supply fetchable URLs. Input is parsed into strict `(platform, externalId)` via regex/zod. Server calls only hardcoded provider API origins with `redirect: 'error'`/`manual`. | Fuzz tests on source URL parser; static check for dynamic `fetch(userUrl)`. |
| **XSS via Titles / Metadata** | Creator video/stream title contains `<script>`, `onerror=`, or `javascript:` URLs | React auto-escaping; zero `dangerouslySetInnerHTML`. External links/thumbnails allowlisted to `https:` only. Strict CSP (`default-src 'none'`, `script-src 'self'`, no `unsafe-inline`/`unsafe-eval`). | XSS payload tests in Phase 2/3; CSP header scanner on staging. |
| **CSRF** | Malicious third-party site triggers state-changing `POST`/`PATCH`/`DELETE` to `/api/*` | Reject mutations if `Sec-Fetch-Site` is `cross-site`/`same-site` or if `Origin` does not match the request origin (or both are absent). Cookies (if any) use `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`. | CSRF rejection tests in `apps/edge/src/app.test.ts`. |
| **Auth Bypass / Header Spoofing** | Attacker sends `Cf-Access-Authenticated-User-Email` directly or forged JWT | `edge` never trusts identity headers alone. Independently verifies `Cf-Access-Jwt-Assertion` via `jose` JWKS (`aud`, `iss`, `exp`, `alg`). Deny by default (`401`/`403`). | Missing/invalid/expired/wrong-aud JWT tests in `apps/edge/src/app.test.ts`. |
| **Secret Leakage** | Secrets committed to git, logged, or bundled into `apps/web` | Secrets live only in `.dev.vars` (gitignored) and Worker Secrets. `env.ts` never serializes secrets. Workspace webhook URLs/push keys encrypted at rest with AES-GCM (WebCrypto). | Pre-commit + CI secret scan; bundle inspection. |
| **Mention Injection (Discord)** | Creator title contains `@everyone`, `@here`, or `<@role>` forwarded to Discord | All Discord webhook payloads set `allowed_mentions: { parse: [] }` and strip/escape control sequences. | Unit tests on Discord notifier payload builder. |
| **Supply Chain** | Compromised npm package, postinstall script, or mutable GitHub Action | Pinned `pnpm-lock.yaml`, `pnpm audit` in CI (fail on high/critical), `ignore-scripts=true` (allowlist only), GitHub Actions pinned by full commit SHA, scoped Cloudflare API tokens. | CI audit gate + `package.json` dependency budget (`<=25` runtime deps). |
| **Cost-Exhaustion DoS** | Flood of API calls, large payloads, or noisy workspace draining D1/Queues/YouTube quota | Cloudflare WAF + Workers Rate Limiting per principal; strict request body size caps; per-workspace quotas (sources, notifications, exports); token-bucket provider governor. | Load & quota-exhaustion tests in Phase 6. |
| **Prompt Injection (AI)** | Hostile instructions embedded in video titles/descriptions passed to Gemini | AI insights are **OFF by default** (`AI_INSIGHTS_ENABLED=false`). When enabled, titles are delimited as untrusted data, output must pass numeric grounding check (every number in output must exist in input) or fall back to deterministic template; daily spend cap enforced. | Grounding-check unit tests & prompt-injection fixtures in Phase 5. |

## 3. Browser & Transport Hardening Headers
Every `edge` response sets:
- `Content-Security-Policy`: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https:; connect-src 'self' wss:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
- `Strict-Transport-Security`: `max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options`: `nosniff`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Cross-Origin-Opener-Policy`: `same-origin`
- `Cross-Origin-Resource-Policy`: `same-origin`
- `Permissions-Policy`: `camera=(), microphone=(), geolocation=(), payment=(), usb=()`

## 4. Logging, Audit & Data Lifecycle
- **Structured Logs:** Emit request ID, route, status, latency, and `workspaceId` hash/ID; **never** log JWTs, API keys, webhook URLs, or PII emails.
- **Audit Log:** `audit_logs` records all privileged actions (member role changes, source bulk edits, integration updates, exports, workspace deletion).
- **Compliance Retention:** YouTube raw metadata refreshed/purged `<=30` days; Twitch non-authorized public cache `<=24` hours.
