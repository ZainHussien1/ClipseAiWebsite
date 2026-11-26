# ADR 002: AI Insights via `InsightsProvider` Port (Off by Default, $0 Cost)

**Status:** Accepted  
**Date:** 2026-11-26

## Context
The brief requires evaluating whether AI earns its place in v1 (`§4.7`) and choosing between Workers AI and Gemini behind Cloudflare AI Gateway (`§0.1`) behind an `InsightsProvider` port, under a strict **$0/mo zero-cost policy**.

## Decision
Ship v1 **deterministic-first** with AI insights **feature-flagged OFF by default** (`AI_INSIGHTS_ENABLED=false`) to guarantee **$0 AI cost** and zero paid API usage:
- Core value (Rising velocity/MAD, Live Moments viewer/clip spikes, Daily Report numbers) is 100% deterministic, explainable, and zero-cost. Twitch/Kick already supply categories and YouTube supplies categories/tags.
- If explicitly enabled later (`AI_INSIGHTS_ENABLED=true`), use **Gemini** (`GEMINI_API_KEY`, server-side only) routed through **Cloudflare AI Gateway** (caching, rate limits, spend cap, logs) for optional Daily Report phrasing and untagged YouTube topic tags only.
- Enforce strict numeric grounding: every number in AI output must appear in the deterministic input payload, or output is rejected and a plain template is used. Send public metadata only; cache by content hash; enforce a hard daily spend cap.

## Consequences
- **Guaranteed $0 AI Cost:** Product ships 100% deterministic Rising, Live Moments, and Daily Report with zero AI spend or paid API dependency.
- **Safe Opt-In:** Enabling AI later requires only flipping the flag and configuring AI Gateway, with prompt-injection boundaries and fail-open fallback already in place.
