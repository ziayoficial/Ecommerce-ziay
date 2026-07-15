# ADR-0014: Input Sanitization Strategy

**Status:** Accepted
**Date:** 2026-07-15

## Context
User-generated content (messages, notes, case descriptions) flows into the DB + LLM prompts. Risk: XSS (on display), log injection, prototype pollution, prompt injection.

## Decision
Implement `sanitizeParsed()` middleware in `src/lib/middleware/sanitize.ts`:
- Strips null bytes
- Trims whitespace
- Truncates to max length (10K chars)
- Blocks `__proto__`, `constructor`, `prototype` keys (prototype pollution defense)
- Applied AFTER Zod validation (so Zod's constraints still apply)
- Applied to 5 user-content endpoints (conversations, orders, novedades, ai-reply, agents)

## Consequences
- **Positive:** Defense-in-depth against XSS + prototype pollution
- **Positive:** Zod validation still runs first (type safety)
- **Negative:** Extra processing on every mutation
- **Negative:** Sanitization happens after Zod — if Zod passes but sanitization changes the data, the validated shape may differ slightly
