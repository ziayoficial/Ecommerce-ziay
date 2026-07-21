# ADR-0007: Own Stack Over Meta Business Agent

**Status:** Accepted
**Date:** 2026-07-14 (updated 2026-07-19)

## Context
Meta launched Business Agent (June 2026) for WhatsApp/Messenger/Instagram. It's no-code, free until Aug 2026, then charges per-token. It handles FAQ responses, product suggestions, appointment booking, and lead qualification — overlapping with several of ZIAY's 24 agents. On July 1, 2026, Meta opened the Business Agent Platform for enterprise, enabling Shopify/Zendesk integrations.

**Market research (July 2026):** The conversational commerce market in LATAM reached $18.2B in 2025 (+35% YoY). Competitors like Leadsales (2,800+ companies), Kommo, and Tecca are active in Colombia. Meta Business Agent commoditizes the basic "FAQ + product suggestion" layer for free.

## Decision
Use `own_stack` strategy (configurable via `META_AGENT_STRATEGY` env var). Build on WhatsApp Cloud API directly. Keep the option to switch to `hybrid` or `meta_native` without code changes.

## Why ZIAY Over Meta Business Agent (positioning)

Meta Business Agent is free (until Aug 2026) and handles basic FAQ + product suggestions. ZIAY competes on **depth, not breadth**:

| Capability | Meta Business Agent | ZIAY |
|-----------|--------------------|----|
| FAQ responses | ✅ Free | ✅ |
| Product catalog suggestions | ✅ Free | ✅ |
| Appointment booking | ✅ Free | ✅ |
| **Multi-profile orchestration** (mayorista/detal/emprendedor) | ❌ | ✅ 8-step pipeline |
| **Real logistics quoting** (Dropi, 99envios, Aveonline) | ❌ | ✅ 3 carrier adapters |
| **Checkout with own payment gateways** (Wompi, MP, Stripe, PayU) | ❌ | ✅ 8 payment methods |
| **QA Reviewer** (self-reflection on revenue-critical outputs) | ❌ | ✅ Reflexion loop |
| **Multi-tenant white-label** (agencies resell to hundreds of tenants) | ❌ (1 business = 1 agent) | ✅ |
| **AP2/UCP/ACP/MCP/A2A protocols** (agent interoperability) | ❌ | ✅ |
| **Anti-fraud** (velocity, blocklist, OFAC, 3DS, CVV/AVS) | ❌ | ✅ |
| **Circuit breaker + retry + fallback** (production resilience) | ❌ | ✅ |
| **Cost per conversation** | ~$0.04-0.05 (Meta charges ~$2.00 per million tokens from Aug 2026; a typical conversation uses ~20K tokens) | ~$0.02 (ZIAY uses cheap-tier models for classification + standard for reasoning) |
| **Data ownership** | Shared with Meta | 100% tenant-owned |

**Target customer:** SMB merchants and agencies in LATAM who need more than FAQ bots — they need real sales orchestration with logistics, payments, and multi-tenant white-label.

## Consequences
- **Positive:** Cheaper per conversation ($0.02 vs ~$0.04-0.05) — the cost advantage is ~2× not 100× as previously stated (corrected: Meta charges per million tokens, not per conversation)
- **Positive:** Full control of conversation data (no Meta data sharing)
- **Positive:** AP2/UCP compliance requires control of the signing service (impossible with Meta Native)
- **Positive:** Multi-tenant white-label (Meta Business Agent is per-business, not a platform)
- **Negative:** Higher development + maintenance cost
- **Negative:** Must maintain WhatsApp Cloud API integration ourselves
- **Mitigation:** `shouldEscalateToOwnAgent()` routing function enables hybrid mode if needed
- **Future:** When WhatsApp Pay arrives in Colombia (expected 2026), evaluate `hybrid` mode where Meta handles payments natively and ZIAY handles orchestration

## Regulatory Risk — WhatsApp Business Terms of Service (Jan 2026)

**Risk:** The WhatsApp Business Terms of Service (effective January 15, 2026) include a clause that prohibits using the API if the "primary service" of the business is an AI chatbot. This is under active litigation in the EU and Brazil (CADE ordered a preliminary suspension in January 2026).

**ZIAY's position:** ZIAY is NOT primarily a chatbot — it is a **commerce platform** that uses WhatsApp as a channel. The primary service is selling products (catalog, quoting, checkout, logistics), not providing a conversational AI. The AI agents are a mechanism to automate the sales process, analogous to how Shopify uses AI for product recommendations — the AI is a feature, not the product.

**Mitigation:**
1. ZIAY's marketing and onboarding materials describe it as "comercio conversacional" (conversational commerce), not as a "chatbot platform"
2. The handoff-to-human feature (botEnabled/pausedReason) ensures a human is always in the loop — the AI never fully replaces human oversight
3. ZIAY operates as a Business Solution Provider (BSP) under Meta's official partner program, not as an unauthorized API wrapper
4. If the litigation outcome restricts AI-on-WhatsApp, ZIAY can pivot to Instagram DM + Messenger (same API, different ToS) or to its own web chat (Embed SDK)

**Monitoring:** The legal team should track the CADE (Brazil) and EU DSA cases. If a final ruling prohibits AI agents on WhatsApp, the `meta_native` strategy (ADR-0007) becomes the fallback — let Meta's own agent handle the conversation layer while ZIAY handles the commerce layer via webhooks.
