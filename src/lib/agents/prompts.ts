// ZIAY — Backward-compatibility barrel for `@/lib/agents/prompts`.
//
// SPRINT3-REFACTOR-001 split this 935-line file into 26 individual agent
// files under `./prompts/{agentName}.ts`, plus a `./prompts/index.ts`
// barrel that owns the router, AGENT_NAMES, AGENT_LABELS, and FALLBACKS map.
//
// All 26 builders produce byte-for-byte identical system/user prompts — only
// the file layout changed. This file just re-exports the new module so any
// existing `import { … } from '@/lib/agents/prompts'` continues to resolve.

export * from './prompts/index'
