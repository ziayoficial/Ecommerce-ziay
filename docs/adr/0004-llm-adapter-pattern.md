# ADR-0004: Multi-provider LLM Adapter

**Status:** Accepted
**Date:** 2026-07-14

## Context
ZIAY uses ZAI (glm-4.6) as the default LLM, but tenants may want to use OpenAI, xAI (Grok), or local Ollama. Need a provider-agnostic adapter that doesn't lock in to one vendor.

## Decision
Implement a `chat()` function in `src/lib/llm/adapter.ts` that routes to the correct provider based on `tenant.proveedorIa` or env var. All 3 LLM call sites use `chat()` — no direct `ZAI.create()` calls.

## Consequences
- **Positive:** Tenants can choose their LLM provider
- **Positive:** Token/cost tracking is centralized
- **Negative:** Provider-specific features (e.g., ZAI's `thinking` mode) need adapter extensions
- **Negative:** Fallback between providers not implemented (single provider per call)
