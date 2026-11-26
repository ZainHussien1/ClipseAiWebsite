# Clipse Radar — Agent Rules

English-only for all code, UI, docs, and commits. Never read `.dev.vars` or print/log secrets.

## Commands (Windows 10, Build 19045 / PowerShell 5.1)
`pnpm.ps1` is blocked by PowerShell execution policy; always run via `cmd /c`:
- `cmd /c pnpm install` — install workspace dependencies
- `cmd /c pnpm typecheck` — strict TypeScript check across all packages
- `cmd /c pnpm lint` — lint with zero warnings
- `cmd /c pnpm test` — unit + integration tests (`vitest`)
- `cmd /c pnpm build` — build `packages/core`, `apps/web`, `apps/edge`, `apps/engine`

Scripts must be cross-platform Node (no bash-isms). Commit with Conventional Commits after checking `git status` and `git diff --stat`.

## Architecture
- **Monorepo:** `apps/web` (React, TS strict, Vite, Tailwind v4, TanStack Router/Query), `apps/edge` (Hono API + Static Assets + DO WebSocket Hibernation), `apps/engine` (crons + Queues + reconcilers), `packages/core` (pure domain).
- **Hexagonal:** handlers only parse (`zod`), authorize, call a use-case, and map results. Adapters (D1, providers, notifiers, AI, auth) sit behind ports.
- **`packages/core`:** 100% pure, zero I/O, 100% unit-tested. No circular dependencies.
- **Truthfulness & code limits:** no mock, seed, or demo data in app/prod paths; fixtures live only in tests. Every UI metric shows source and age; unknown is never `0`. Files `<=300` lines, functions `<=50` lines, runtime deps `<=25` repo-wide.

## Security
- **Secrets:** only in `.dev.vars` (gitignored) and Worker Secrets. Validate env with `zod` at startup. Never expose secrets in client bundles or logs.
- **Auth & Tenant Isolation:** Cloudflare Access in front of app; `edge` independently verifies `Cf-Access-Jwt-Assertion` via `jose` JWKS (`aud`, `iss`, `exp`). `workspaceId` comes only from verified principal, enforced at repository layer.
- **Boundaries:** `zod` on all inputs/outputs; D1 prepared statements only; no `dangerouslySetInnerHTML`; `https:` allowlisted URLs only; fixed provider hosts (no SSRF); CSRF Origin/`Sec-Fetch-Site` check on mutations; Discord webhooks use `allowed_mentions: { parse: [] }`.

## Design & Tokens (`stageshow`)
- Use `stageshow` for all UI work (tokens -> primitives -> patterns -> pages -> QA at 375/768/1280/1920).
- Dark theme only (`#101215` bg, `#17191c` surface, `#26272a` border, `#eceef0` text, `#18b9cc` ONLY accent).
- Inter variable (self-hosted WOFF2) + monospace keycaps; `12-13px` body; `1px` borders (no shadows); zero emoji in UI; `prefers-reduced-motion` honoured.
