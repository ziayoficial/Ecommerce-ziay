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
| **Cost per conversation** | $2.00 (from Aug 2026) | $0.02 (100× cheaper) |
| **Data ownership** | Shared with Meta | 100% tenant-owned |

**Target customer:** SMB merchants and agencies in LATAM who need more than FAQ bots — they need real sales orchestration with logistics, payments, and multi-tenant white-label.

## Consequences
- **Positive:** 100x cheaper per conversation ($0.02 vs $2.00)
- **Positive:** Full control of conversation data (no Meta data sharing)
- **Positive:** AP2/UCP compliance requires control of the signing service (impossible with Meta Native)
- **Positive:** Multi-tenant white-label (Meta Business Agent is per-business, not a platform)
- **Negative:** Higher development + maintenance cost
- **Negative:** Must maintain WhatsApp Cloud API integration ourselves
- **Mitigation:** `shouldEscalateToOwnAgent()` routing function enables hybrid mode if needed
- **Future:** When WhatsApp Pay arrives in Colombia (expected 2026), evaluate `hybrid` mode where Meta handles payments natively and ZIAY handles orchestration
