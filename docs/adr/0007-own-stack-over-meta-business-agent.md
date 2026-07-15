# ADR-0007: Own Stack Over Meta Business Agent

**Status:** Accepted
**Date:** 2026-07-14

## Context
Meta launched Business Agent (June 2026) for WhatsApp/Messenger/Instagram. It's no-code but charges per-token from Aug 2026 and cedes conversation data to Meta. ZIAY already has 26 custom agents.

## Decision
Use `own_stack` strategy (configurable via `META_AGENT_STRATEGY` env var). Build on WhatsApp Cloud API directly. Keep the option to switch to `hybrid` or `meta_native` without code changes.

## Consequences
- **Positive:** 100x cheaper per conversation ($0.02 vs $2.00)
- **Positive:** Full control of conversation data (no Meta data sharing)
- **Positive:** AP2/UCP compliance requires control of the signing service (impossible with Meta Native)
- **Negative:** Higher development + maintenance cost
- **Negative:** Must maintain WhatsApp Cloud API integration ourselves
- **Mitigation:** `shouldEscalateToOwnAgent()` routing function enables hybrid mode if needed
