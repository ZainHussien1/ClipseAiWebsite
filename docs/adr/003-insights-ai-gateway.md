# ADR 003: AI Insights via Cloudflare AI Gateway (Free Tier Only)

**Status:** Accepted  
**Date:** 2026-11-26

## Context
Clipse Radar needs optional Daily Report narrative phrasing and untagged YouTube topic hints (§0.1, §4.7, F-16) at `$0/month` without exposing workspace-private data or hallucinating metrics.

## Decision
1. **Candidates:** Workers AI Free (`10k neurons/day`) vs Google Gemini Free Tier (`GEMINI_API_KEY`) via **Cloudflare AI Gateway** (free tier).
2. **Choice:** Route `InsightsProvider` server-side through **Cloudflare AI Gateway** to **Gemini** (using `GEMINI_API_KEY`), with a feature toggle (`AI_INSIGHTS_ENABLED` / per-workspace opt-in in Reports) and automatic deterministic template fallback.
3. **Guardrails:** Send **public metadata only** (never member emails, private notes, or claim internals). Enforce content-hash caching, hard daily request cap, prompt-injection sanitization, and strict numeric grounding (reject any AI output containing numbers absent from the deterministic input payload).

## Consequences
- Zero cost on free tier; deterministic metrics always work when AI is off or rate-limited.
- Full request logging, caching, and spend protection via AI Gateway.
