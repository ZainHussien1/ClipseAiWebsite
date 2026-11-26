# ADR 001: Two-Worker Topology (`edge` + `engine`, 100% Free Tier)

**Status:** Accepted  
**Date:** 2026-11-26

## Context
Clipse Radar serves a React SPA, authenticated API routes, public provider webhook endpoints (`/hooks/*`), per-workspace WebSockets, plus background crons, Queue consumers, and periodic reconcilers under a strict **$0/mo (Workers Free)** policy with no billing activation.

## Decision
Split runtime responsibilities across two Workers on **Workers Free** ($0/mo, 10ms CPU/req, 100k req/day) communicating via Service Binding RPC:
1. **`edge` Worker:** Serves `apps/web` via Workers Static Assets (`run_worker_first: ["/api/*", "/hooks/*"]`), runs the Hono API, handles `/hooks/*` webhook verification/dedupe/enqueue, and hosts per-workspace **SQLite-backed Durable Objects** (`new_sqlite_classes`, Free tier: 100k req/day, 13k GB-s/day, WebSocket Hibernation). Same-origin serving eliminates CORS.
2. **`engine` Worker:** Runs cron triggers (<=5 crons), **2 batched Queues + DLQs** (`ingest` and `notify`, keeping total operations well below the 10k ops/day Free tier; `signals` & `enrich` execute in batched `ingest` / cron steps within 10ms CPU), and adaptive reconcilers. Exposes no public HTTP routes; `edge` invokes it only via Service Binding RPC.
3. **`ExportStorage` Port:** Targets R2 Free tier (10GB, $0 egress) with a direct HTTP/D1-export streaming fallback if R2 card-on-file billing is not enabled.

## Consequences
- **Zero Cost:** Entire stack runs at **$0/mo** on Cloudflare Free tiers without credit card activation.
- **CPU & Queue Discipline:** Handlers and queue consumers must process small batches to stay under 10ms CPU/invocation and 10k queue ops/day, degrading gracefully on limit.
- **Security:** `engine` has zero public attack surface; `edge` enforces Access JWT validation and webhook signature checks at the perimeter.
