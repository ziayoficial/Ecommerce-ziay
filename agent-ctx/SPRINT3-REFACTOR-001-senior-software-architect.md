# SPRINT3-REFACTOR-001 — Senior Software Architect

**Date:** 2025-01-XX
**Scope:** Refactor 3 oversized files (prompts.ts 935L, novedades-view.tsx 1296L, plus 6 API routes) into smaller, focused modules. Add structured logging. Zero behavior changes.

## PART 1 — Refactor `src/lib/agents/prompts.ts` (935L → 11L barrel + 28 files)

### Before
Single 935-line file holding all 26 agent builders + the `AgentContext` / `AgentName` types + the `buildAgentPrompt` router + `AGENT_NAMES` / `AGENT_LABELS` constants.

### After
```
src/lib/agents/prompts/
├── types.ts                     ← AgentName + AgentContext types (extracted)
├── index.ts                     ← barrel: re-exports 26 builders, types,
│                                  AGENT_NAMES, AGENT_LABELS, buildAgentPrompt,
│                                  FALLBACKS (moved here from orchestrate route)
├── profile.ts                   ← buildProfilePrompt
├── speech.ts                    ← buildSpeechPrompt
├── quote.ts                     ← buildQuotePrompt
├── catalog.ts                   ← buildCatalogPrompt
├── theme.ts                     ← buildThemePrompt
├── objection.ts                 ← buildObjectionPrompt
├── address.ts                   ← buildAddressPrompt
├── logistics.ts                 ← buildLogisticsPrompt
├── vision.ts                    ← buildVisionPrompt
├── checkout.ts                  ← buildCheckoutPrompt
├── buyer_behavior.ts            ← buildBuyerBehaviorPrompt
├── cart_builder.ts              ← buildCartBuilderPrompt
├── guide_tracking.ts            ← buildGuideTrackingPrompt
├── novedades.ts                 ← buildNovedadesPrompt
├── redelivery.ts                ← buildRedeliveryPrompt
├── remarketing.ts               ← buildRemarketingPrompt
├── guide_alert.ts               ← buildGuideAlertPrompt
├── sales_retainer.ts            ← buildSalesRetainerPrompt
├── logistics_notifier.ts        ← buildLogisticsNotifierPrompt
├── customer_score.ts            ← buildCustomerScorePrompt
├── carrier_score.ts             ← buildCarrierScorePrompt
├── product_enrichment.ts        ← buildProductEnrichmentPrompt
├── marketplace.ts               ← buildMarketplacePrompt
├── affiliator.ts                ← buildAffiliatorPrompt
├── traffic_orchestrator.ts      ← buildTrafficOrchestratorPrompt
└── address_analysis.ts          ← buildAddressAnalysisPrompt
```

`src/lib/agents/prompts.ts` is now an 11-line file that just does `export * from './prompts/index'`, so the existing imports in `src/app/api/orchestrate/route.ts`, `src/app/api/agents/route.ts`, and `src/app/api/agents/[agentName]/route.ts` keep working unchanged.

### Key moves
- **FALLBACKS map** was extracted from `src/app/api/orchestrate/route.ts` and now lives in `prompts/index.ts` — every route that touches the agent pipeline imports it from `@/lib/agents/prompts`. The 26-entry object is byte-for-byte identical (verified by reading the old inline declaration).
- **buildAgentPrompt signature preserved as `(agentName, ctx)`** — the task description listed it as `(ctx, agentName)` but the existing 3 callers all pass `(agentName, ctx)`. Switching the signature would have broken backward compatibility, which the task explicitly forbids ("Do NOT change imports in other files — the re-export pattern ensures backward compatibility").
- **Prompt text is byte-for-byte identical** — only file layout changed. Each builder file imports `db` from `@/lib/db` and `AgentContext` from `./types` and contains exactly the same `system` / `user` template strings and the same Prisma queries as the original.

## PART 2 — Structured logging added to 6 API routes

| Route | `getLogger(component)` | Events logged |
|-------|------------------------|---------------|
| `api/orchestrate/route.ts` | `'api:orchestrate'` | `agent start` (per step), `agent complete` (with replyLen), `agent error — fallback used` (log.error), `pipeline complete` (steps + error count) — for both `action='step'` and `action='full'` |
| `api/wallet/route.ts` | `'api:wallet'` | `2fa setup initiated`, `2fa verified — enabled`, `withdrawal request created` (with amount/fee/net/totp flags), `withdrawal processed — balance debited` (with balanceBefore/After/externalReference) |
| `api/novedades/route.ts` | `'api:novedades'` | `case created` (with caseNumber/type/priority/orderId), `case resolved` (log.info), `case escalated` (log.warn — escalations deserve attention) |
| `api/redelivery/route.ts` | `'api:redelivery'` | `redelivery request created` (guideNumber + first attempt), `redelivery attempt scheduled` (scheduledAt ISO + attemptId), `redelivery completed` (attemptId + attemptNumber) |
| `api/conversions/route.ts` | `'api:conversions'` | `conversion event fire` (tenantId/eventType/value/pixel count), `platform fire success` (per-pixel log.info), `platform fire failed` (per-pixel log.warn with response) |
| `api/trafficker/route.ts` | `'api/trafficker'` | Already had `getLogger` + `log.info` calls for `trafficker registered`, `campaign created`, `sale registered`, `sale confirmed — wallet credited`, `sale failed + compensation credited`, `withdrawal requested`. No changes needed — all 4 required events already covered. |

All loggers use pino's structured-object-first API: `log.info({ tenantId, caseId, ... }, 'message')`. Sensitive fields (`password`, `token`, `apiKey`, `secret`) are auto-redacted by the global pino config in `src/lib/logger.ts`. The TOTP `secret` returned from `setup_2fa` is the *plain* one-time QR-display secret, which the wallet route legitimately returns to the client; it does NOT go through the logger.

## PART 3 — Split `novedades-view.tsx` (1296L → 8L barrel + 7 files)

### Before
Single 1296-line file with: types, helpers (CASE_TYPE_META, caseStatusMeta, redeliveryStatusMeta, attemptStatusMeta, evidenceTypeMeta, messageRoleMeta), the main `NovedadesView`, `CaseDetailPanel`, `RedeliveryCard`, `CreateCaseDialog`, `CreateRedeliveryDialog`, and `StatCard`.

### After
```
src/components/dashboard/novedades/
├── shared.tsx                    ← types (CaseRow, Evidence, Message, CaseDetail,
│                                   RedeliveryAttempt, RedeliveryRequest) +
│                                   helpers (CASE_TYPE_META, caseStatusMeta,
│                                   redeliveryStatusMeta, attemptStatusMeta,
│                                   evidenceTypeMeta, messageRoleMeta) +
│                                   StatCard component
├── novedades-list.tsx            ← NovedadesList (left filter + cases list)
├── novedades-detail.tsx          ← CaseDetailPanel (right panel — evidence,
│                                   messages, resolution form, actions,
│                                   inline evidence Dialog)
├── novedades-redelivery.tsx      ← RedeliveryTab (filter strip + cards grid +
│                                   empty/loading states) + RedeliveryCard
├── novedades-history.tsx         ← HistoryTab (read-only resolved/closed table)
├── novedades-dialogs.tsx         ← CreateCaseDialog + CreateRedeliveryDialog
└── index.tsx                     ← NovedadesView (state machine + composition)
```

`src/components/dashboard/novedades-view.tsx` is now an 8-line file that just does `export { NovedadesView } from './novedades/index'`, so the existing import in `src/app/page.tsx` keeps working unchanged.

### Composition design
- `NovedadesView` (in `index.tsx`) owns ALL the state: `cases`, `stats`, `loading`, `q`, `statusFilter`, `typeFilter`, `carrierFilter`, `selectedId`, `detail`, `detailLoading`, `rdStatus`, `rdRequests`, `rdStats`, `rdLoading`, `historyFrom`, `historyTo`. It calls `fetch()` in `useEffect`s and passes data down to the presentational sub-components via props.
- Sub-components are pure/presentational — they take props and render. They contain NO data fetching of their own (except the inline PATCH/POST calls inside dialogs and detail panel, which were already in the original).
- `RedeliveryTab` is the new container component for the redelivery tab — it owns the filter strip + cards grid + empty/loading states that were inline JSX in the original `NovedadesView`.
- `HistoryTab` is the new container for the history tab — same pattern.

### Backward compat
The single consumer (`src/app/page.tsx`) imports `{ NovedadesView } from '@/components/dashboard/novedades-view'` — unchanged, still resolves through the re-export barrel.

## Verification

| Check | Result |
|-------|--------|
| `bun run lint` (ESLint) | ✅ clean, no output |
| `npx tsc --noEmit` (TypeScript) | ✅ clean, no output |
| `bunx vitest run` (vitest) | ✅ 6 test files / 65 tests all pass |
| Dev server log | ✅ Ready in 92ms, no compile errors |

## Notes for future agents

1. **Agent file naming convention.** Each agent file uses the snake_case agent name from the `AgentName` union (e.g. `buyer_behavior.ts`, `guide_tracking.ts`). The exported function is always `build<PascalCase>Prompt`. The mapping is mechanical — if you add agent #27, drop a new file in `prompts/`, add one `export { … } from './…'` line + one eager import + one `case '…'` to `prompts/index.ts`, and add the entry to `AGENT_NAMES`, `AGENT_LABELS`, and `FALLBACKS`.

2. **FALLBACKS is now in `@/lib/agents/prompts`.** Do not re-declare it in any route. If a route needs to add a per-agent fallback or change one, edit `src/lib/agents/prompts/index.ts` — every consumer sees the change.

3. **Logger conventions.** Every API route that does state-changing work should:
   - `import { getLogger } from '@/lib/logger'`
   - `const log = getLogger('api:<routeName>')` at module top
   - `log.info({ ...ids }, '<event>')` on successful state transitions
   - `log.warn({ ...ids, response })` on soft failures (e.g. a pixel firing failed but the rest succeeded)
   - `log.error({ ...ids, err: errorMsg }, '<event>')` on hard failures (already-covered by `captureError` for Sentry; the log line is for the local pino stream)
   - Never log raw PII (the pino redact config catches `password`, `token`, `apiKey`, `secret` — but be careful with `phone`, `email`, `address` in log payloads; the new logs use IDs only).

4. **Novedades sub-component boundaries.** If you need to add a new tab to the novedades view:
   - Create `novedades/<tabname>.tsx` exporting a `<TabName>Tab` presentational component
   - Add the corresponding `<TabsTrigger>` and `<TabsContent>` in `novedades/index.tsx`
   - Move any state into `NovedadesView` and pass it down as props — sub-components stay pure.

5. **`shared.tsx` is the contract.** All novedades sub-components import types and helpers from `./shared`. If you change a type (e.g. add a field to `CaseRow`), update it in `shared.tsx` — every consumer sees the change automatically.

## STATUS: ✅ COMPLETE — prompts.ts (935L→11L barrel + 28 files), novedades-view.tsx (1296L→8L barrel + 7 files), 6 API routes logged, all tests green.
