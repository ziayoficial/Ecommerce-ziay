// ZIAY — Orchestrator module (DEPRECATED — re-exports only).
//
// ⚠️  DEPRECATED (ORC-1-FIX): The orchestrator functions that previously
// lived here (runOrchestratorStep, runFullScenario, callAgentDirect) were
// DEAD CODE — not imported by any real API route. They have been REMOVED.
//
// The real orchestration lives in:
//   - src/app/api/orchestrate/route.ts  (1219 lines — pipeline executor
//     with Governor, QA Reviewer, circuit breaker, tracing, budget)
//   - src/app/api/ai-reply/route.ts     (708 lines — real-time message
//     handler with tool-calling, sentiment, memory recall)
//
// This file now ONLY re-exports types and constants from ./constants.ts
// for backward compatibility with any code that imports from
// '@/lib/orchestrator/orchestrator' instead of '@/lib/orchestrator/constants'.
//
// DO NOT add orchestration logic here. Add it to the real API routes.

export type { OrchestratorState, OrchestratorScenario } from './constants'
export { ORCHESTRATOR_STEPS, ORCHESTRATOR_SCENARIOS } from './constants'
