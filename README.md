# Clipse Radar

Real-time creator monitoring, rising-signal detection, and clip-team workflow platform running on Cloudflare's 100% Free Tier ($0/mo).

## Architecture

- `apps/web` — React 19 + Vite + Tailwind v4 + TanStack Router/Query SPA
- `apps/edge` — Workers Static Assets + Hono API + `/hooks/*` + SQLite `WorkspaceDO`
- `apps/engine` — Cron reconcilers + batched Queue consumers (`ingest`, `notify`)
- `packages/core` — Pure domain logic, Zod schemas, and hexagonal ports (zero I/O)

## Commands (Windows 11)

`pnpm.ps1` is blocked by PowerShell execution policy; run `pnpm` via `cmd /c`:

```powershell
cmd /c pnpm install
cmd /c pnpm typecheck
cmd /c pnpm lint
cmd /c pnpm test
cmd /c pnpm build
```

## Documentation

- [AGENTS.md](./AGENTS.md) — Repository rules and limits
- [docs/PLAN.md](./docs/PLAN.md) — Architecture, free-tier budgets, and delivery plan
- [docs/adr/001-worker-topology.md](./docs/adr/001-worker-topology.md) — Two-Worker topology
- [docs/adr/002-ai-insights-decision.md](./docs/adr/002-ai-insights-decision.md) — Deterministic-first AI policy
