# IA-1 — Build Governor + QA Reviewer + Memory Curator + Sentiment Analyzer agents

**Task ID:** IA-1
**Agent:** full-stack-developer (agent-builder)
**Date:** 2026-07-19
**Base branch:** main (post v0.4.1 IA-3 consolidation — 20 agents baseline)
**Result:** 4 new control-plane agents wired in, total agent count 20 → 24.

> **Note on agent count:** the task spec said "26 original + 4 new = 30". The actual baseline
> was 20 agents (the IA-3 task v0.4.1 consolidated 8 redundant agents into 2 merged ones — see
> `src/lib/agents/prompts/types.ts` header comment). After IA-1 the total is 20 + 4 = **24 agents**.
> The 4 new agents are all present in `AGENT_NAMES` with correct labels and are fully wired.

---

## Work Log

### 1. Context loading
- Read `worklog.md` tail (~300 lines) — found prior `MR-AGENTS` market-research entry that
  recommended these exact 4 agents + the IA-3 consolidation note (26 → 20 agents via merging
  guide_alert/tracking/notifier → postventa_logistics, customer_score/carrier_score → scoring,
  theme/cart_builder folded into catalog/quote, address_analysis folded into address).
- Read `public/presentaciones/INVESTIGACION-AGENTES-IA.md` (§9 Recomendaciones) for the
  architecture rationale (Hybrid Supervisor + Pipeline, Governor → Specialists → QA Reviewer
  → Memory Curator async).
- Read existing agent prompt pattern (`prompts/profile.ts`, `prompts/quote.ts`,
  `prompts/objection.ts`) — confirmed the `buildAgentPrompt(ctx): Promise<{system, user}>`
  contract + `AgentContext` shape.
- Read `orchestrator/orchestrator.ts` + `app/api/orchestrate/route.ts` — found the
  9-step pipeline walk + `callAgent` helper + `escalateIfLowConfidence` + pipelineMemory
  load/persist.
- Read `app/api/webhooks/whatsapp/route.ts` — confirmed the webhook persists inbound
  messages + emits socket events but doesn't itself run agents (the actual agent run happens
  via `/api/orchestrate` and `/api/ai-reply`).
- Read `lib/llm/adapter.ts` (chat() + provider registry), `lib/llm/budget.ts`
  (`checkBudgetBeforeCall`), `lib/agents/sanitize.ts` (ANTI_INJECTION_PREFIX + wrapUserInput),
  `lib/agents/schemas.ts` (parseAgentOutput), `lib/embeddings/service.ts` (embed +
  cosineSimilarity + bufferToVector).
- Read `prisma/schema.prisma` Customer + DecisionLog + Conversation models — found the
  `Bytes?` pattern for embeddings (used by `Product.embeddingTexto` / `Message.embedding`)
  which is portable across SQLite (dev) and PostgreSQL+pgvector (prod).

### 2. Prisma schema — added CustomerMemory model
- Added `model CustomerMemory` to `prisma/schema.prisma` (after Customer, before Conversation).
  Fields: `id`, `tenantId`, `customerId`, `type` (preference|purchase_history|objection|budget|
  brand|style|other), `key` (canonical snake_case), `value`, `confidence` (0-1, default 0.8),
  `extractedFrom` (conversationId audit trail), `embeddingTexto Bytes?` (portable embedding
  storage — same pattern as `Product.embeddingTexto`), `createdAt`, `updatedAt`.
- Indexes: `@@index([tenantId, customerId])` (recall-by-customer), `@@index([tenantId,
  customerId, type])` (filter-by-type), `@@index([tenantId, customerId, type, key])` (dedup
  upsert lookup). `@@map("customer_memory")`.
- Added the reverse relation `customerMemories CustomerMemory[]` on the Tenant model (required
  by Prisma — the first `db:push` failed with P1012 until this was added).
- **Portability note:** the task spec asked for `Unsupported("vector(1536)")` for the embedding
  field, but the dev DB is SQLite which doesn't support `Unsupported` types. I followed the
  existing convention (`Bytes?` in SQLite, with a comment noting the column should be migrated
  to `vector(1536)` via `prisma/sql/pgvector-setup.sql` in prod PG). The application code uses
  `src/lib/embeddings/service.ts` which is already portable (Buffer ↔ vector).
- `bun run db:push` → ✅ Done. Prisma Client regenerated. ERD regenerated.

### 3. Agent prompt files (4 new)
- `src/lib/agents/prompts/governor.ts` — Governor system prompt + user prompt. Checks for
  prompt injection, PII leaks, banned content (tenant-configurable via `Setting` key
  `governor_banned_keywords::{tenantId}`), flooding. Returns strict JSON
  `{allow, reason, redirect}`. Redirect routing rules: "RETRACTO" → remarketing, frustration
  → sales_retainer, buying intent + budget → quote.
- `src/lib/agents/prompts/qa_reviewer.ts` — QA Reviewer system prompt. Reflexion pattern
  (critique → revise). Checks for hallucination, missing required fields (per agent),
  policy violations (NUNCA rules), customer frustration signals, tone issues. Returns
  `{approved, issues, revisedOutput}`.
- `src/lib/agents/prompts/memory_curator.ts` — Memory Curator system prompt. Extracts
  structured facts (preference, purchase_history, objection, budget, brand, style, other)
  from the latest turn. Confidence thresholds: ≥0.7 explicit, 0.4-0.7 implied, <0.4 skip.
  Returns `{facts: [...]}`.
- `src/lib/agents/prompts/sentiment.ts` — Sentiment Analyzer system prompt. Classifies
  sentiment (positive|neutral|negative|frustrated|excited), score (-1 to +1), urgency,
  buyingIntent, churnRisk. Returns strict JSON.
- All 4 prompts use the existing `buildRulesBlock()` from `lib/agents/rules.ts` for the
  NUNCA/SIEMPRE block (with custom additions per agent).

### 4. Agent registry — types.ts + index.ts + schemas.ts
- `types.ts`: added `| 'governor' | 'qa_reviewer' | 'memory_curator' | 'sentiment'` to the
  `AgentName` union. Updated the header comment to document the IA-1 additions (20 → 24).
- `index.ts`: added 4 new builder imports + router cases + AGENT_NAMES entries + AGENT_LABELS
  (governor → "Gobernador (safety gate)", qa_reviewer → "QA Reviewer (auto-reflexión)",
  memory_curator → "Curador de memoria (long-term)", sentiment → "Análisis de sentimiento") +
  FALLBACKS (JSON-encoded safe defaults — fail-open for governor/sentiment, fail-closed for
  qa_reviewer=approve original, no-op for memory_curator=empty facts).
- `schemas.ts`: added `GovernorSchema`, `QAReviewerSchema`, `MemoryCuratorFactSchema`,
  `MemoryCuratorSchema`, `SentimentSchema` (Zod). Registered them in `AGENT_OUTPUT_SCHEMAS`
  so `parseAgentOutput()` validates the LLM JSON output before the service layer acts on it.
- Verified `AGENT_NAMES.length === 24` via a smoke test script.

### 5. Service files (4 new)
- `src/lib/agents/governor.service.ts` — `runGovernor({tenantId, conversationId, message,
  customerHistory?, customerId?})` → `GovernorResult`. Flow: budget check (reuses
  `checkBudgetBeforeCall`) → build prompt → LLM call with 280ms timeout (Promise.race) →
  JSON parse → DecisionLog persist + socket emit. Fail-open on timeout/error/parse failure
  (allow + no redirect). Uses `GOVERNOR_MODEL` env var (default `glm-4.6-flash`). SLA: 300ms.
- `src/lib/agents/qa-reviewer.service.ts` — `runQAReview({tenantId, agentName, agentOutput,
  conversationContext, conversationId?, customerId?, perfil?})` → `QAReviewResult`. Flow:
  build prompt → LLM call with 8s timeout → JSON parse → DecisionLog persist + socket emit.
  Fail-closed on timeout/error (approve original — never block conversation on QA tooling).
  Uses `QA_REVIEWER_MODEL` env var (default `glm-4.6` — frontier model). Exports
  `shouldReviewAgent(name)` + `QA_REVIEWED_AGENTS` Set (quote, novedades, address, checkout).
- `src/lib/agents/memory-curator.service.ts` — `runMemoryCuratorAsync({...})` (fire-and-forget
  wrapper) + `runMemoryCurator({...})` (awaitable) → `MemoryCuratorResult`. Flow: build prompt
  → LLM call with 10s timeout → JSON parse → de-dup + upsert each fact into `CustomerMemory`
  (lookup by tenantId+customerId+type+key, update if exists, create if new). Each fact's
  `${key}: ${value}` is embedded via `embed()` from `lib/embeddings/service.ts` and stored in
  `embeddingTexto` (Float32 Buffer). Also exports `recallCustomerMemory({tenantId, customerId,
  query, topK, minScore})` for semantic recall (cosine similarity — replaceable with a single
  indexed SQL query in prod PG with pgvector).
- `src/lib/agents/sentiment.service.ts` — `runSentimentAsync({...})` (fire-and-forget) +
  `runSentiment({...})` (awaitable) → `SentimentResult`. Flow: build prompt → LLM call with
  1.5s timeout → JSON parse → compute triggeredAgents (frustrated → sales_retainer,
  churnRisk=high → remarketing, buyingIntent=high → quote) → emit `sentiment:classified`
  socket event + `agent:trigger` per trigger → persist a DecisionLog row (agentName='sentiment')
  with the classification stamp for downstream agents + dashboard. Neutral fallback on
  timeout/error. Uses `SENTIMENT_MODEL` env var (default `glm-4.6-flash`).

### 6. Wiring — orchestrator route (`src/app/api/orchestrate/route.ts`)
- Imported `runGovernor`, `runQAReview`, `shouldReviewAgent`, `runMemoryCuratorAsync`,
  `runSentimentAsync` + `db` (for fetching the latest customer message).
- **Governor (BEFORE pipeline):** after budget check + tenant lookup, fetch the latest
  inbound message for the conversation. If present, run the governor. If `allow: false`,
  short-circuit with 403 + `GOVERNOR_BLOCKED` code (no agent runs). If `allow: true`,
  proceed. The governor result is surfaced in the response (`governor` field).
- **Sentiment (parallel, async):** immediately after governor allows, fire-and-forget
  `runSentimentAsync()` — runs in parallel with the pipeline, never blocks. Result emitted
  via socket + may trigger retention agents.
- **QA Reviewer (AFTER critical steps):** inside the `for (const step of ORCHESTRATOR_STEPS)`
  loop, after each step's `callAgent` + `escalateIfLowConfidence`, if `shouldReviewAgent(
  step.agent)` is true, call `runQAReview()`. If `approved: false` + `revisedOutput` present,
  replace the `reply` with the revised version (preserve original as `rawReply` for audit),
  bump confidence to ≥0.85, record `qaReviewed: true` + `qaIssues` in the timeline entry.
  Best-effort: QA failure is logged but never blocks.
- **Memory Curator (async, after pipeline):** after `persistPipelineMemory`, fire-and-forget
  `runMemoryCuratorAsync()` with the turn transcript (customer message + all agent replies).
  Never blocks the response.
- Response shape now includes `governor: GovernorResult | null` and each timeline entry
  includes `qaReviewed?: boolean` + `qaIssues?: string[]`.

### 7. Wiring — ai-reply route (`src/app/api/ai-reply/route.ts`)
- Imported `runGovernor`, `runSentimentAsync`, `runMemoryCuratorAsync` + `db`.
- After budget check, fetch the latest inbound message. If present, run the governor. If
  blocked, 403. If allowed, fire-and-forget `runSentimentAsync()`.
- After the LLM reply is generated + DecisionLog persisted, fire-and-forget
  `runMemoryCuratorAsync()` with `Customer: <msg>\n\nAgent: <reply>` as the turn transcript.

### 8. Wiring — agents/[agentName] route (`src/app/api/agents/[agentName]/route.ts`)
- Imported `runGovernor`, `runQAReview`, `shouldReviewAgent`.
- After budget check, if the agent is NOT a control-plane agent (governor/qa_reviewer/
  memory_curator/sentiment) AND `ctx.message` is a non-empty string AND `ctx.conversationId`
  is present, run the governor. If blocked, 403.
- After the LLM call + escalation, if `shouldReviewAgent(agentName)`, call `runQAReview()`.
  If `approved: false` + `revisedOutput`, replace `finalReply`, bump confidence, record
  `qaReviewed` + `qaIssues` in the response.

### 9. Verification
- `npx tsc --noEmit` → **0 errors**.
- `bun run lint` → **0 errors** (53 warnings, all pre-existing in other files — none in
  the new IA-1 code).
- `bun run db:push` → ✅ Done (schema applies, Prisma Client regenerated, ERD regenerated).
- `AGENT_NAMES.length` → **24** (20 baseline + 4 new). All 4 new agents have correct labels.
- Smoke test: created + deleted a `CustomerMemory` row against the live SQLite DB → table
  is accessible, schema is correct.
- Dev server (`bun run dev`) healthy — `/login` returns 200, no compile errors in dev.log.

---

## Stage Summary

### Files created (8)
1. `src/lib/agents/prompts/governor.ts` — Governor agent prompt builder
2. `src/lib/agents/prompts/qa_reviewer.ts` — QA Reviewer agent prompt builder
3. `src/lib/agents/prompts/memory_curator.ts` — Memory Curator agent prompt builder
4. `src/lib/agents/prompts/sentiment.ts` — Sentiment Analyzer agent prompt builder
5. `src/lib/agents/governor.service.ts` — Governor service (<300ms, fail-open, budget gate)
6. `src/lib/agents/qa-reviewer.service.ts` — QA Reviewer service (Reflexion, fail-closed)
7. `src/lib/agents/memory-curator.service.ts` — Memory Curator service (async, embeddings,
   semantic recall helper)
8. `src/lib/agents/sentiment.service.ts` — Sentiment service (parallel, trigger emits)

### Files modified (6)
1. `prisma/schema.prisma` — added `CustomerMemory` model + reverse relation on `Tenant`
2. `src/lib/agents/prompts/types.ts` — added 4 new AgentName union members + header comment
3. `src/lib/agents/prompts/index.ts` — added 4 builders, router cases, AGENT_NAMES entries,
   AGENT_LABELS, FALLBACKS (JSON-encoded safe defaults for control-plane agents)
4. `src/lib/agents/schemas.ts` — added 5 Zod schemas (GovernorSchema, QAReviewerSchema,
   MemoryCuratorFactSchema, MemoryCuratorSchema, SentimentSchema) + registered them in
   AGENT_OUTPUT_SCHEMAS
5. `src/app/api/orchestrate/route.ts` — wired Governor (before pipeline) + Sentiment (parallel
   async) + QA Reviewer (after critical steps) + Memory Curator (async after pipeline)
6. `src/app/api/ai-reply/route.ts` — wired Governor (before LLM) + Sentiment (parallel async)
   + Memory Curator (async after reply)
7. `src/app/api/agents/[agentName]/route.ts` — wired Governor (before LLM, skipped for
   control-plane agents) + QA Reviewer (after LLM for critical agents)

### Prisma model added (1)
- `CustomerMemory` — long-term customer facts with embeddings. Indexes on
  (tenantId, customerId), (tenantId, customerId, type), (tenantId, customerId, type, key).

### Wiring summary
| Route | Governor | QA Reviewer | Sentiment | Memory Curator |
|-------|----------|-------------|-----------|----------------|
| `/api/orchestrate` (full pipeline) | ✅ before pipeline | ✅ after quote/novedades/address/checkout | ✅ parallel async | ✅ async after pipeline |
| `/api/ai-reply` (ad-hoc reply) | ✅ before LLM | n/a (not an agent step) | ✅ parallel async | ✅ async after reply |
| `/api/agents/[agentName]` (direct call) | ✅ before LLM (skipped for control-plane) | ✅ after LLM for critical agents | n/a (no pipeline) | n/a (no turn context) |

### Architecture decisions
- **Fail-open vs fail-closed:** Governor fails OPEN (allow on timeout/error — never block
  conversation). QA Reviewer fails CLOSED (approve original on timeout/error — never block
  on QA tooling, but be conservative about replacing the agent's output). Sentiment fails
  OPEN (neutral fallback). Memory Curator is fire-and-forget (no caller-facing failure mode).
- **Model routing:** Governor + Sentiment use `glm-4.6-flash` (cheap, classification tasks).
  QA Reviewer uses `glm-4.6` (frontier, critique is harder than generation). Memory Curator
  uses `glm-4.6-flash` (extraction is classification). All overridable via env vars.
- **Embeddings portability:** CustomerMemory uses `Bytes?` for `embeddingTexto` (same pattern
  as Product/Message) — works on SQLite (dev) with the deterministic hash embedding from
  `lib/embeddings/service.ts`, and migrates to `vector(1536)` via `prisma/sql/pgvector-setup.sql`
  in prod PG. The `recallCustomerMemory()` helper uses cosine similarity client-side in dev;
  in prod it should be replaced with a single indexed SQL query.
- **No schema migration for sentiment stamp:** the Sentiment Analyzer persists its result as
  a DecisionLog row (agentName='sentiment') instead of writing to Conversation.pipelineMemory
  (which the orchestrator's memory loader expects to be a strict Message[] array — mixing
  sentiment metadata in there would corrupt the pipeline memory). Downstream agents read the
  latest sentiment via `db.decisionLog.findFirst({where:{agentName:'sentiment',conversationId},
  orderBy:{createdAt:'desc'}})`.
- **Reuse over re-implement:** Governor reuses `checkBudgetBeforeCall` from `lib/llm/budget.ts`
  for the budget check (consistent with the daily/monthly caps the rest of the agent layer
  enforces). All 4 agents reuse `parseAgentOutput` from `lib/agents/schemas.ts` for JSON
  validation, `ANTI_INJECTION_PREFIX` + `wrapUserInput` from `lib/agents/sanitize.ts` for
  prompt-injection defense, and `buildRulesBlock` from `lib/agents/rules.ts` for the NUNCA/
  SIEMPRE block.

### Verification results
- `npx tsc --noEmit` → **0 errors**
- `bun run lint` → **0 errors** (53 warnings — all pre-existing in other files)
- `bun run db:push` → ✅ Done
- `AGENT_NAMES.length` → **24** (was 20, +4 new). Task expected 30 (26+4) but the actual
  baseline was 20 (post IA-3 v0.4.1 consolidation — see `types.ts` header comment).

### Known limitations / future work
- The Governor's redirect field is parsed but not yet consumed by the orchestrator to
  override the default agent routing (the orchestrator currently always runs the 9-step
  pipeline in order). A future task could implement dynamic routing based on
  `governorResult.redirect` + `sentimentResult.triggeredAgents`.
- The Memory Curator's `recallCustomerMemory()` is implemented but not yet consumed by
  agent prompts (no agent currently injects "what we know about this customer" into its
  system prompt). A future task could add a `recallCustomerMemory()` call to the profile
  + quote + objection agents' prompt builders.
- The Sentiment Analyzer's result is persisted to DecisionLog but not yet read by
  downstream agents in the same pipeline (the in-process result sharing would require
  passing the SentimentResult through the orchestrator's callAgent ctx). A future task
  could add a `sentiment?: SentimentResult` field to AgentContext.
- The QA Reviewer's `revisedOutput` is used as the final reply, but the original output
  is not preserved in the timeline entry (only `rawReply` is — which is the LLM's raw
  output, not the pre-QA-reply). A future task could add a `preQaReply` field to the
  timeline entry for full audit trail.
