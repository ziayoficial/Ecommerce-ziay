# IA-2 — Agent Hardening (Observability + Cost Control + Evaluation)

**Task ID:** IA-2
**Agent:** full-stack-developer (agent-hardening)
**Date:** 2026-07-18
**Status:** ✅ Complete

## Scope

Added 3 production-hardening systems for the ZIAY AI agent layer:
1. **Observability / Tracing** — `AgentTracer` + `AgentSpan` with in-memory + DecisionLog + pino sinks.
2. **Cost Control / Token Budgets** — `BudgetManager` with daily/monthly/conversation caps, plan-based defaults, `TokenUsage` Prisma ledger.
3. **Agent Evaluation Framework** — `AgentTestCase` + `AgentRubric` + 5 test files (5 cases each) + standalone runner script.

Plus a **Model Router** (`src/lib/agents/model-router.ts`) that assigns each of the 26 agents to a `cheap | standard | frontier` tier with per-tier pricing — the cost-control layer uses these prices to debit the budget ledger.

## Files Created (13)

| Path | Purpose |
|---|---|
| `src/lib/agents/model-router.ts` | 3-tier model routing + per-agent tier map + `estimateCost()` |
| `src/lib/agents/tracing.ts` | `AgentTracer` + `AgentSpan`, 1h TTL in-memory + DecisionLog + pino sinks |
| `src/lib/agents/budget.ts` | `BudgetManager`, plan defaults, `TokenUsage` persistence |
| `src/lib/agents/evaluation.ts` | `AgentTestCase` + `AgentRubric` + suite runner |
| `src/app/api/agents/traces/route.ts` | Admin-only recent-traces endpoint |
| `src/app/api/agents/traces/[conversationId]/route.ts` | Per-conversation traces endpoint |
| `src/app/api/agents/budget/route.ts` | Admin budget status + limits endpoint |
| `tests/agent-evaluation/profile.test.ts` | 5 cases × 3 describe blocks |
| `tests/agent-evaluation/quote.test.ts` | 5 cases × 3 describe blocks |
| `tests/agent-evaluation/objection.test.ts` | 5 cases × 3 describe blocks |
| `tests/agent-evaluation/checkout.test.ts` | 5 cases × 3 describe blocks |
| `tests/agent-evaluation/novedades.test.ts` | 5 cases × 3 describe blocks |
| `scripts/eval-agents.ts` | Standalone runner, 25 cases, promotion gate (≥90% pass rate) |

## Files Modified (6)

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Added `TokenUsage` model + `Tenant.tokenUsages` reverse relation |
| `src/lib/orchestrator/orchestrator.ts` | Wired `agentTracer.startSpan()` + `budgetManager.checkBudget()` + `budgetManager.recordUsage()` into `callAgentDirect()` |
| `src/app/api/agents/[agentName]/route.ts` | Added 4 missing `AGENT_FALLBACKS` entries (pre-existing IA-1 gap: governor/qa_reviewer/memory_curator/sentiment) |
| `src/lib/agents/governor.service.ts` | Widened `persistGovernorDecision` input type (pre-existing IA-1 gap) |
| `src/app/api/orchestrate/route.ts` | Added `qaReviewed?` / `qaIssues?` to timeline type (pre-existing IA-1 gap) |
| `tests/unit/agent-schemas.test.ts` | Updated registry-count test 8 → 12 schemas (pre-existing IA-1 gap) |

## Architecture Decisions

### Tracing — three sinks, no external dependency
- **In-memory Map<traceId, AgentTrace>** with 1h TTL + 10min sweep timer (unref'd so it doesn't keep the event loop alive). Powers `/api/agents/traces` for live debugging.
- **DecisionLog Prisma write** — parallel row to the one written by `agentsService.persistDecisionLog`, but with the tracer's richer metadata (latency, tokens, cost, parent/child). Fire-and-forget — slow DB never blocks the agent reply.
- **pino structured JSON log** (`logger.info({ trace }, 'agent.trace')`) — shaped to match Langfuse's `Generation` schema, so a future migration to Langfuse/LangSmith only needs to swap the sink.

### Budget — plan-based defaults + admin overrides
- Plans mapped from `Tenant.planMonetizacion`: `conecta` → Starter (50K/day, 1.5M/month, $5/$100), `catalogo_incluido` → Business (250K/day, 5M/month, $20/$400), `completo` → Enterprise (unlimited but tracked).
- Admin overrides via `Setting` table (keys `agent_budget::{tenantId}::{period}::{field}`), 5min-cached.
- Fail-open on DB errors (matches `llm/budget.ts` semantics — prefer serving the user over blocking on infra).
- Daily reset at local midnight, monthly on the 1st — no cron needed.

### Model Router — 3 tiers
- **cheap** (`glm-4.6-flash`): governor, sentiment, memory_curator, profile — classification / triage.
- **standard** (`glm-4.6`): speech, catalog, address, logistics, novedades, etc. — reasoning / formatting.
- **frontier** (`glm-4.6-plus`): quote, objection, checkout, qa_reviewer — revenue-critical, needs accuracy.
- Estimated 55-65% cost saving vs routing every call through the frontier model (per `INVESTIGACION-AGENTES-IA.md` §7.2).

### Evaluation — deterministic heuristic scorer (upgradeable to LLM-as-judge)
- `scoreRubric()` uses keyword-overlap with Spanish + English stopwords. Scores 0/0.5/1 per criterion. Deterministic — catches regressions without an LLM-as-judge dependency.
- To upgrade: replace `scoreRubric()` with a call to the adapter (cheap tier) that asks "does the output satisfy this criterion? reply 0, 0.5, or 1". The `RubricScore[]` shape stays the same.
- Test files use `describe.skipIf(!process.env.LLM_API_KEY)` for the live-LLM path — CI runs the prompt-assertion + canned-output paths on every PR; the LLM path runs only when a key is configured.
- Promotion gate (study §7.4): passRate ≥ 90% AND no case below 0.7 overall score. The runner script exits 1 if either fails.

## Integration with IA-1 (Governor)

The orchestrator's `callAgentDirect()` now does:
1. `budgetManager.checkBudget(tenantId, estimatedTokens)` — if `allowed === false`, returns `"(presupuesto excedido: ...)"` so the orchestrator history shows why the step short-circuited. The Governor agent (IA-1) is responsible for surfacing this to the end user as a friendly message.

## Verification Results

```bash
$ npx tsc --noEmit 2>&1 | grep -c "error TS"
0

$ bun run lint 2>&1 | tail -3
✖ 53 problems (0 errors, 53 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

$ bun run db:push 2>&1 | tail -3
✔ Generated Entity-relationship-diagram (0.2.0) to /home/z/my-project/docs/erd.svg in 7.97s
[db-push] ✅ Done

$ bun run test 2>&1 | tail -5
 Test Files  57 passed (57)
      Tests  1029 passed | 5 skipped (1034)
```

The 5 skips are the `describe.skipIf(!process.env.LLM_API_KEY)` live-LLM tests in the new agent-evaluation suite — they only run when an LLM API key is configured, as designed.

## Notes for Downstream Agents

- The new `TokenUsage` table is the canonical cost ledger. The existing `DecisionLog.costUsd` is still written by `agentsService.persistDecisionLog` (the agent route) and `persistGovernorDecision` (IA-1) — those writes are unchanged. Future agents that need cost data should query `TokenUsage` (normalized, indexed for aggregates) rather than `DecisionLog` (which is optimized for decision audit, not cost analysis).
- The `agentTracer` singleton is exported from `src/lib/agents/tracing.ts`. Any new agent invocation site (e.g. a future batch governance sweeper) should wrap its LLM call with `tracer.startSpan()` / `span.end()` to participate in observability.
- The `budgetManager` singleton is exported from `src/lib/agents/budget.ts`. The Governor agent (IA-1) should call `budgetManager.checkBudget()` before allowing a message through — when the check fails, the Governor returns a user-friendly "el sistema está procesando muchas solicitudes ahora mismo, intenta en unos minutos" message rather than leaking internal budget mechanics.
- The model router is the single source of truth for per-agent tier assignment. When a new agent is added (e.g. by the parallel IA-1 expansion), add it to `AGENT_MODEL_TIER` in `src/lib/agents/model-router.ts` — default is `standard` if missing, which is safe but not optimal.
