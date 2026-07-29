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
| **Cost per conversation** | ~$0.04-0.05 (Meta Business Agent: ~$2.00/M tokens × ~20K tokens/conversation = $0.04; from Aug 2026. Plus service message rate $0.0068 from Oct 2026) | ~$0.02 (ZIAY: cheap-tier LLM for classification ~$0.001 + standard for reasoning ~$0.015 + WA service message $0.0068 = ~$0.023) |
| **Data ownership** | Shared with Meta | 100% tenant-owned |

**Target customer:** SMB merchants and agencies in LATAM who need more than FAQ bots — they need real sales orchestration with logistics, payments, and multi-tenant white-label.

## Consequences
- **Positive:** Cheaper per conversation (~$0.023 vs ~$0.047 with Meta Business Agent) — the cost advantage is ~2× not 100× as previously stated
- **Positive:** Full control of conversation data (no Meta data sharing)
- **Positive:** AP2/UCP compliance requires control of the signing service (impossible with Meta Native)
- **Positive:** Multi-tenant white-label (Meta Business Agent is per-business, not a platform)
- **Positive:** UCP is winning the protocol race — Amazon, Meta, Microsoft, Salesforce, Stripe joined the UCP Tech Council (Apr 2026); Shopify made UCP self-service (Jun 2026). ZIAY's UCP implementation is well-positioned.
- **Negative:** ACP/Instant Checkout (OpenAI) collapsed — discontinued Mar 2026 after only 5 months and 8% adoption. The ACP protocol survives (Stripe maintains it, PayPal joined), but the ChatGPT checkout surface is dead. ZIAY should deprioritize ACP as a consumer-facing channel and focus on UCP.
- **Negative:** Consumer trust ceiling — only 17% of shoppers in US/UK/EU feel comfortable completing purchases with AI. ZIAY's handoff-to-human feature is critical for the other 83%.
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

## Regulatory Updates (Jul 2026)

### Ley 2573 de 2026 (carga dinámica de la prueba)
- **Promulgada:** 19 de mayo de 2026
- **Vigencia:** régimen general entra en vigor hacia noviembre de 2026 (6 meses después)
- **Impacto:** cualquier flujo de compra financiada o automatizada debe cumplir con KYC + trazabilidad de decisiones de IA antes de noviembre 2026
- **ZIAY:** ya tiene KYC gate (`kyc-gate.ts`) y DecisionLog — está preparado

### Ley 2502 de 2025 (suplantación por IA)
- Agrava penalmente la suplantación cometida mediante IA
- Complementa la protección a la víctima que da la Ley 2573
- **ZIAY:** el Governor agent + ANTI_INJECTION_PREFIX + sanitización de input son mitigaciones directas

### TikTok Shop llegó a Colombia
- Confirmado en mayo-julio 2026: TikTok habilitó checkout nativo en Colombia
- Categorías líderes: moda (60%), belleza (20%), hogar (10%), accesorios (10%)
- Comisión de TikTok: 5-8% según categoría
- **Impacto en ZIAY:** el canal TikTok ya no es solo "link en bio" — es un competidor directo de WhatsApp Commerce para moda/belleza. ZIAY debe evaluar integración con TikTok Shop API o posicionarse como complemento (gestión post-venta + CRM)

### WhatsApp Service Messages pricing (Oct 2026)
- Desde el 1 de octubre de 2026: mensajes de servicio se cobran sin descuentos por volumen
- Templates de utilidad/autenticación sí escalan con volumen
- Meta Business Agent: ~$0.04-0.05 por mensaje desde Ago 2026
- Agente propio (ZIAY): $0.0068 (service message) + costo LLM (~$0.015) = ~$0.023
- **Confirma la decisión own_stack del ADR-0007**: ZIAY es ~2× más barato que Meta Business Agent

### ACP/Instant Checkout colapsó (Mar 2026)
- OpenAI lanzó Instant Checkout el 29 Sep 2025, lo discontinuó el 4-5 Mar 2026
- Solo 8% de adopción en el primer mes, <15 comercios Shopify activaron
- El protocolo ACP sobrevive (Stripe lo mantiene, PayPal se unió) pero la superficie de consumo dentro de ChatGPT está muerta
- **ZIAY:** deprioritizar ACP como canal de checkout consumer-facing. Mantener el manifest ACP por compatibilidad protocolaria pero no invertir en integración con ChatGPT checkout

### UCP ganando la carrera de adopción
- 24 Abr 2026: Amazon, Meta, Microsoft, Salesforce, Stripe se unieron al UCP Tech Council
- 17 Jun 2026: Shopify hizo UCP autoservicio (cualquier dev puede registrar un perfil de agente sin aprobación)
- Solo 17% de compradores en US/UK/EU se siente cómodo completando compras con IA
- **ZIAY:** la implementación UCP (`/.well-known/ucp`) está bien posicionada. El handoff-to-human es crítico para el 83% que no confía en IA pura
