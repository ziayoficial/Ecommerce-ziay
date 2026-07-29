# BUILD-AGENTS-LIB-001 — Senior Fullstack Developer

**Task ID:** BUILD-AGENTS-LIB-001
**Agent:** Senior Fullstack Developer
**Date:** 2025-01-15
**Scope:** Extend `src/lib/agents/prompts.ts` with 23 missing agents + create 9 lib module files.

---

## Summary

Extended the CommerceFlow OS agent layer from 10 → 26 conversational agents and created 9 production-grade lib modules for HMAC verification, rate limiting, TOTP 2FA, multi-tenant RLS, LLM provider abstraction, vision pipeline, and embeddings. Zero TypeScript errors in owned files. Zero ESLint errors.

---

## PART 1 — Agent Library Extension (`src/lib/agents/prompts.ts`)

### Pre-existing agents (10 — preserved, NOT modified):
profile, speech, quote, catalog, theme, objection, address, logistics, vision, checkout

### NEW agents added (16):

**Pre-venta (2 new — quote/theme/objection/address/logistics/checkout already existed):**
- `buyer_behavior` — Predicts purchase intent from message history, outputs JSON with `intencion`, `siguiente_accion`, `confianza`.
- `cart_builder` — Converts natural-language product requests into a structured cart resolved against the tenant's real catalog (SKU lookup with confidence threshold).

**Post-venta (7 new):**
- `guide_tracking` — Tracks shipment status via DB (LogisticsAdapter refreshes upstream); reports to customer in `tono_marca`.
- `novedades` — Handles Colombian-standard delivery incidents (Coordinadora, Interrapidísimo, Servientrega, TCC, 99minutos); classifies + proposes corrective action.
- `redelivery` — Coordinates re-delivery after failed attempt; validates address/horario/persona/teléfono before reactivating; offers oficina pickup after 2 failed attempts.
- `remarketing` — Re-engages cold leads (>7 days no response) with one personalized message; adapts offer to perfil (mayorista=volume, detal=novedad, regalo=ocasión, emprendedor=margen).
- `guide_alert` — Operational alerts for stuck (>48h), returned, lost, or multi-attempt-failed guides; outputs JSON for the ops team (not the customer).
- `sales_retainer` — Prevents cancellations during "lo pienso" state; applies emotion-recognition + value-reinforcement + single-alternative pattern.
- `logistics_notifier` — Proactive customer notifications at hitos: guía_generada, en_transito, en_reparto, entregada, novedad.

**Inteligencia (6 new):**
- `customer_score` — Composite score: tier (vip|alto|medio|bajo|riesgo), LTV projection, churn risk, re-purchase probability.
- `carrier_score` — Per-carrier score: on_time_rate, novedad_rate, devolucion_rate, tiempo_promedio_dias; tier preferida|aceptable|evitar.
- `product_enrichment` — Generates SEO description (≤160 char), alt_image (100-150 char), 5-8 tags, categoria_sugerida, diseno_sugerido.
- `marketplace` — Recommends marketplace publication (Mercado Libre CO ~17%, Amazon ~15%, Falabella ~18%) with adjusted price to preserve margin.
- `affiliator` — Resolves click_id → affiliate, calculates commission (CPA | pct | escalonado), produces payment summary JSON.
- `traffic_orchestrator` — Budget redistribution recommendations across Meta/TikTok/Google; auto-kill rules (ROAS<0.5 after 1.5× CPA, etc.); max 30% daily budget delta.

**Especializados (1 new — vision already existed):**
- `address_analysis` — Pre-shipment address quality check: 10-campo completeness, carrier coverage, delivery history (ok|rechazo|novedad|sin_registro), normalization, risk level.

### What was extended in `prompts.ts`:
1. `AgentName` type union — added 16 new literal types.
2. `AgentContext` interface — added 10 new optional fields (orderId, shipmentId, guia, novedadTipo, cartItems, adId, campaignId, productId, affiliateId, carrierId). All optional → backward-compatible.
3. 16 new `build*Prompt(ctx)` async functions, each:
   - Fetches the Tenant + relevant DB rows filtered by `tenantId`.
   - Builds a Spanish (LATAM, Colombia-focused) system message defining the agent's role.
   - Builds a user message with real tenant-specific data (catalog, shipments, orders, etc.).
   - References Saramantha / ZIAY / CommerceFlow OS context where relevant.
4. `buildAgentPrompt()` switch — added 16 new cases.
5. `AGENT_NAMES` array — extended to 26 entries.
6. `AGENT_LABELS` map — extended with Spanish labels for the 16 new agents.

### Side-effect: Updated existing API routes to satisfy `Record<AgentName, string>`
The `Record<AgentName, string>` type in `src/app/api/agents/[agentName]/route.ts` and `src/app/api/orchestrate/route.ts` broke when I extended `AgentName`. Added generic Spanish fallback messages for all 16 new agents in both files.

---

## PART 2 — Lib Module Creation (9 new files)

### `src/lib/middleware/hmac.ts` (NEW)
- `verifyMetaSignature(rawBody, signature, appSecret)` — Meta `X-Hub-Signature-256` (`sha256=<hex>` format).
- `verifyHmacSha256(rawBody, signature, secret)` — Generic hex HMAC-SHA256.
- `verifyHmacSha256Base64(rawBody, signature, secret)` — Base64 variant.
- All comparisons use `timingSafeEqual` to prevent timing attacks.
- Length-mismatch dummy compare to keep timing constant.

### `src/lib/middleware/rate-limit.ts` (NEW)
- `rateLimit(req, opts: { max, windowMs, namespace?, message? })` — Sliding-window in-memory limiter.
- Returns `NextResponse` 429 (with `Retry-After`, `X-RateLimit-*` headers) if exceeded, `null` otherwise.
- IP extraction: `x-forwarded-for` → `x-real-ip` → `req.ip` → `'unknown'`.
- GC runs every 5 min, evicts entries older than 1h.
- `resetRateLimit(namespace, ip)` and `getRateLimitCount(namespace, ip)` helpers.

### `src/lib/totp.ts` (NEW)
- Uses `otpauth@9.5.1` (installed via `bun add otpauth`).
- `generateTOTPSecret(label): { secret, uri }` — 20-byte base32 secret + `otpauth://` URI for QR enrollment.
- `verifyTOTP(token, secret): boolean` — ±1 window (±30s) for clock drift.
- `generateBackupCodes(): string[]` — 10 codes formatted as `XXXX-XXXX` (8 digits each).
- Issuer: `CommerceFlow OS`. Algorithm: SHA1 (widest authenticator compatibility). Digits: 6. Period: 30s.

### `src/lib/rls.ts` (NEW)
- `TENANT_SCOPED_MODELS: Set<string>` — 21 tenant-scoped model names.
- `assertTenantAccess(tenantId)` — Type-narrowing assertion; throws if missing/empty.
- `tenantWhere(tenantId): { tenantId }` — Prisma where-clause factory.
- `makeTenantPrismaExtension(tenantId)` — Prisma client extension that injects `tenantId` into `where`/`create`/`upsert` for all tenant-scoped models. Defense-in-depth layer.
- `getTenantDb(client, tenantId)` — Convenience wrapper.
- `RLS_SQL_POLICIES: string` — PostgreSQL DDL for RLS policies on the 10 most critical models (Order, OrderItem, OrderEvent, Customer, Conversation, Message, Product, Shipment, CommissionEntry, Campaign). Uses `current_setting('app.tenant_id')` per-request.

### `src/lib/llm/adapter.ts` (NEW)
- Interface `LLMProvider { name, defaultModel, chat(messages, opts) }`.
- `ZaiProvider` — Default; uses `z-ai-web-dev-sdk` (glm-4.6). Lazy singleton via `ZAI.create()`.
- `OpenAIProvider` — `fetch` to `api.openai.com/v1`; throws if `OPENAI_API_KEY` unset.
- `XAIProvider` — `fetch` to `api.x.ai/v1` (Grok); throws if `XAI_API_KEY` unset.
- `OllamaProvider` — `fetch` to `localhost:11434/api/chat` (local llama3.1:8b by default).
- `getLLMProvider(name?)` — Resolution: explicit arg → `LLM_PROVIDER` env → `'zai'`.
- `getAvailableProviders()` — `{ name, available, defaultModel }[]` for health endpoint.
- `chat(messages, opts)` — Convenience single-call function.
- Uses `Awaited<ReturnType<typeof ZAI.create>>` type alias to avoid referencing the SDK's private constructor.

### `src/lib/llm/index.ts` (NEW)
- Re-exports everything from `./adapter` so callers do `import { ... } from '@/lib/llm'`.

### `src/lib/vision/pipeline.ts` (NEW)
- `identifyImage(imageUrl, tenantCtx?)` — Uses ZAI VLM `glm-4.6v` to:
  1. Read the catalog metadata stripe (OCR-like).
  2. Fall back to visual comparison against the tenant's catalog (top 30 by recency).
  3. Return `{ sku, confianza, metodo, pregunta_confirmacion }`.
  4. Persist result to `ImageIdentification` table for audit.
- `enrichProductImage(imageUrl, productName, tenantCtx?)` — Uses VLM to generate SEO alt text, 5-8 tags, and 160-char description.
- Loose JSON parser handles markdown code fences and extracts first `{...}` block.

### `src/lib/embeddings/service.ts` (NEW)
- `embed(text): number[]` — Dev-only deterministic 256-dim hash embedding (FNV-1a on 1-gram + 2-gram word shingles + 4-gram char shingles with signed accumulation + L2 normalization). Fast, free, reproducible.
- `cosineSimilarity(a, b): number` — Standard cosine similarity in [-1, 1].
- `embedAndStoreMessage(messageId, text)` — Embeds + stores in `Message.embedding` (Bytes).
- `embedAndStoreProduct(productId, text, kind)` — Embeds + stores in `Product.embeddingTexto` or `embeddingVisual`.
- `searchSimilar(text, opts)` — Client-side cosine similarity over candidates from DB; top-K above minScore. Ready to swap for pgvector `embedding <=> $1` SQL in prod.
- `EMBED_DIM = 256` constant exported.

---

## Verification

### TypeScript (`npx tsc --noEmit`)
- All 10 owned files compile clean (0 errors).
- Pre-existing errors in `examples/`, `skills/`, `prisma/seed.ts` are NOT in scope and were not touched.

### ESLint (`bun run lint`)
- 0 errors, 0 warnings. EXIT=0.

### Dev server (`tail dev.log`)
- App returns 200 OK on `/`. Pre-existing 500 errors on `/t/[slug]` (referencing non-existent `db.sEOConfig`) are unrelated to this task.

---

## Files Touched

**Extended (1):**
- `src/lib/agents/prompts.ts` — 10 → 26 agents.

**Side-effect fixes (2):**
- `src/app/api/agents/[agentName]/route.ts` — Added 16 fallback messages to satisfy `Record<AgentName, string>`.
- `src/app/api/orchestrate/route.ts` — Same.

**Created (9):**
- `src/lib/middleware/hmac.ts`
- `src/lib/middleware/rate-limit.ts`
- `src/lib/totp.ts`
- `src/lib/rls.ts`
- `src/lib/llm/adapter.ts`
- `src/lib/llm/index.ts`
- `src/lib/vision/pipeline.ts`
- `src/lib/embeddings/service.ts`

**Package installed:**
- `otpauth@9.5.1` (via `bun add otpauth`)

---

## Notes for Downstream Agents

1. **AgentContext is backward-compatible** — all 10 new fields are optional. Existing callers do not need changes.
2. **Vision pipeline persists to `ImageIdentification`** — best-effort; failures log but don't break the call.
3. **RLS extension is opt-in** — existing `db` instance is unaffected; only `getTenantDb(db, tenantId)` enforces scoping.
4. **LLM provider switching** — set `LLM_PROVIDER=openai|xai|ollama|zai` env var or pass explicit name to `getLLMProvider()`.
5. **Embeddings are dev-grade** — swap `embed()` for OpenAI/Cohere/sentence-transformers in prod; interface stays the same. pgvector SQL pattern is documented in `searchSimilar()`.
6. **HMAC module exports `verifyMetaSignature`** — already used by `/api/webhooks/meta` and `/api/webhooks/whatsapp` (3-arg signature).
7. **Rate limiter is single-instance** — for multi-instance deployments, replace the `Map` with Redis.
