import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts'],
    // IA-4 — disable the AgentTracer's parallel DecisionLog DB sink during
    // tests so existing `decisionLog.create` call-count assertions stay
    // stable (the route's own `agentsService.persistDecisionLog` is the
    // authoritative DB sink; the tracer's row was a parallel write with
    // traceId/parentId metadata that doubles the mock count).
    env: {
      DISABLE_TRACER_DB_SINK: '1',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
