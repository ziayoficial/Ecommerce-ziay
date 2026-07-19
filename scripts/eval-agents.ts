/**
 * IA-2 — Agent evaluation runner.
 *
 * Runs the full agent-evaluation suite against the real LLM (via the
 * pluggable adapter) and writes a JSON report. Mirrors the existing
 * `scripts/eval-live.ts` contract (log per case to stdout + a final
 * summary + a `eval-results.json` artifact), but uses the typed
 * `AgentTestCase` / `EvaluationResult` shapes from
 * `src/lib/agents/evaluation.ts`.
 *
 * Usage:
 *   bun run scripts/eval-agents.ts                    # default: all 25 cases
 *   AGENT_EVAL_FILTER=profile bun run scripts/eval-agents.ts   # one agent
 *
 * Requires: `LLM_API_KEY` (or whichever provider env var the adapter
 * resolves). Without a key, the runner exits 1 with a clear message —
 * the unit-test path (which skips the LLM call) is what runs in CI.
 *
 * Output:
 *   - Per-case log line on stdout (✅/❌ + latency + score).
 *   - Summary (pass rate, avg latency, total cost).
 *   - `eval-results-agent.json` (full structured report).
 *
 * Promotion gate (study §7.4): pass rate must be ≥ 90% AND no case may
 * have overall score < 0.7. If either fails, the script exits 1 so a CI
 * gate can block the merge.
 */

/* eslint-disable no-console -- CLI script: console.log is intentional. */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { chat } from '../src/lib/llm/adapter'
import { buildAgentPrompt } from '../src/lib/agents/prompts'
import { getModelForAgent, estimateCost } from '../src/lib/agents/model-router'
import {
  runEvaluationSuite,
  type AgentTestCase,
} from '../src/lib/agents/evaluation'

// ───────────────────────────────────────────────────────────────────────────
// Test cases — 5 per critical agent × 5 agents = 25 cases.
//
// These are the same cases defined in tests/agent-evaluation/*.test.ts,
// but inlined here so the runner is self-contained (no test-framework
// dependency). Keep them in sync with the test files — the test files
// are the CI gate; this script is the pre-promotion manual run.
// ───────────────────────────────────────────────────────────────────────────

const TENANT_ID = process.env.AGENT_EVAL_TENANT_ID ?? 't-eval'

const CASES: AgentTestCase[] = [
  // ── profile (5) ──
  {
    name: 'profile-detects-mayorista',
    agentName: 'profile',
    input: { tenantId: TENANT_ID, message: 'Hola, quiero comprar 50 short para revender en mi tienda' },
    expectedContains: ['mayorista'],
    expectedNotContains: ['descuento'],
    rubric: [
      { criterion: 'Detecta perfil mayorista cuando el lead menciona revender', weight: 0.6 },
      { criterion: 'Respeta el formato (solo el perfil o la pregunta)', weight: 0.4 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'profile-detects-emprendedor',
    agentName: 'profile',
    input: { tenantId: TENANT_ID, message: 'Estoy arrancando un emprendimiento, quiero ver catálogo' },
    expectedContains: ['emprendedor'],
    rubric: [
      { criterion: 'Detecta emprendedor cuando menciona arrancar o emprender', weight: 0.6 },
      { criterion: 'Respeta el formato', weight: 0.4 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'profile-detects-detal',
    agentName: 'profile',
    input: { tenantId: TENANT_ID, message: 'Quiero 1 pijama para regalo de cumpleaños' },
    expectedContains: ['detal', 'regalo'],
    rubric: [
      { criterion: 'Clasifica como detal o regalo cuando es para uso personal', weight: 0.6 },
      { criterion: 'Respeta el formato', weight: 0.4 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'profile-unclear-asks-pregunta',
    agentName: 'profile',
    input: { tenantId: TENANT_ID, message: 'Hola' },
    rubric: [
      { criterion: 'Sin señal clara devuelve la pregunta perfil', weight: 0.7 },
      { criterion: 'No avanza sin perfil', weight: 0.3 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'profile-no-markdown',
    agentName: 'profile',
    input: { tenantId: TENANT_ID, message: 'Quiero 30 short para mi negocio' },
    expectedContains: ['mayorista'],
    expectedNotContains: ['**', '__', '#'],
    rubric: [
      { criterion: 'Output respeta texto plano sin markdown', weight: 0.5 },
      { criterion: 'Detecta mayorista', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },

  // ── quote (5) ──
  {
    name: 'quote-single-sku',
    agentName: 'quote',
    input: { tenantId: TENANT_ID, perfil: 'mayorista', items: [{ sku: 'PIJ-001', cantidad: 10 }] },
    rubric: [
      { criterion: 'Menciona el SKU cotizado', weight: 0.4 },
      { criterion: 'Consulta la tabla de precios por volumen', weight: 0.4 },
      { criterion: 'Formato mayorista: pagas → vendes → sobran', weight: 0.2 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'quote-multi-sku',
    agentName: 'quote',
    input: { tenantId: TENANT_ID, perfil: 'mayorista', items: [{ sku: 'PIJ-001', cantidad: 10 }, { sku: 'PIJ-002', cantidad: 6 }] },
    rubric: [
      { criterion: 'Lista todos los SKUs del carrito', weight: 0.5 },
      { criterion: 'Suma el total a pagar', weight: 0.3 },
      { criterion: 'No mezcla precios entre referencias', weight: 0.2 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'quote-invalid-sku',
    agentName: 'quote',
    input: { tenantId: TENANT_ID, perfil: 'detal', items: [{ sku: 'NO-EXIST', cantidad: 1 }] },
    expectedContains: ['no existe', 'NO-EXIST'],
    rubric: [
      { criterion: 'Informa explícitamente que el SKU no existe', weight: 0.7 },
      { criterion: 'No inventa un precio', weight: 0.3 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'quote-no-descuento',
    agentName: 'quote',
    input: { tenantId: TENANT_ID, perfil: 'detal', items: [{ sku: 'PIJ-001', cantidad: 1 }] },
    expectedNotContains: ['descuento'],
    rubric: [
      { criterion: 'No dice descuento (regla N01)', weight: 0.5 },
      { criterion: 'Solo usa precios de la tabla', weight: 0.5 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'quote-no-markdown',
    agentName: 'quote',
    input: { tenantId: TENANT_ID, perfil: 'mayorista', items: [{ sku: 'PIJ-001', cantidad: 25 }] },
    expectedNotContains: ['**', '__'],
    rubric: [
      { criterion: 'Texto plano sin markdown', weight: 0.4 },
      { criterion: 'Aplica el tramo correcto para 25 unidades', weight: 0.6 },
    ],
    maxLatencyMs: 10000,
  },

  // ── objection (5) ──
  {
    name: 'objection-price',
    agentName: 'objection',
    input: { tenantId: TENANT_ID, message: 'Me parece muy caro' },
    expectedNotContains: ['descuento'],
    rubric: [
      { criterion: 'Clasifica la objeción como precio', weight: 0.4 },
      { criterion: 'Usa la respuesta base configurada', weight: 0.3 },
      { criterion: 'No dice descuento (regla N01)', weight: 0.3 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'objection-trust',
    agentName: 'objection',
    input: { tenantId: TENANT_ID, message: 'No conozco la marca, no estoy seguro' },
    rubric: [
      { criterion: 'Clasifica la objeción como desconfianza', weight: 0.5 },
      { criterion: 'Aplica el gatillo mental de prueba social', weight: 0.5 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'objection-competitor',
    agentName: 'objection',
    input: { tenantId: TENANT_ID, message: 'En la tienda de la esquina lo venden más barato' },
    rubric: [
      { criterion: 'Clasifica la objeción como competencia', weight: 0.5 },
      { criterion: 'No menciona el nombre del competidor (regla N18)', weight: 0.5 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'objection-no-repeat',
    agentName: 'objection',
    input: { tenantId: TENANT_ID, message: 'Sigue siendo muy caro, ya te dije' },
    rubric: [
      { criterion: 'No repite el mismo argumento (regla N16)', weight: 0.6 },
      { criterion: 'Busca un ángulo nuevo de persuasión', weight: 0.4 },
    ],
    maxLatencyMs: 10000,
  },
  {
    name: 'objection-no-urgencia-falsa',
    agentName: 'objection',
    input: { tenantId: TENANT_ID, message: 'Lo voy a pensar' },
    expectedNotContains: ['última oportunidad', 'solo hoy'],
    rubric: [
      { criterion: 'No crea urgencia falsa (regla N13)', weight: 0.5 },
      { criterion: 'Mantiene el tono de certeza (regla S04)', weight: 0.5 },
    ],
    maxLatencyMs: 10000,
  },

  // ── checkout (5) ──
  {
    name: 'checkout-binary-confirmation',
    agentName: 'checkout',
    input: { tenantId: TENANT_ID },
    expectedContains: ['confirm'],
    expectedNotContains: ['todo confirmado'],
    rubric: [
      { criterion: 'Termina con pregunta binaria de confirmación', weight: 0.6 },
      { criterion: 'No confirma sin el sí del cliente (regla N09)', weight: 0.4 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'checkout-summary-format',
    agentName: 'checkout',
    input: { tenantId: TENANT_ID },
    rubric: [
      { criterion: 'Prepara el resumen final', weight: 0.5 },
      { criterion: 'Respeta el máximo de 30 palabras + items', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'checkout-no-urgencia-falsa',
    agentName: 'checkout',
    input: { tenantId: TENANT_ID },
    expectedNotContains: ['última oportunidad', 'solo hoy'],
    rubric: [
      { criterion: 'No crea urgencia falsa (regla N13)', weight: 0.5 },
      { criterion: 'No dice "Todo confirmado!" sin el sí (regla N09)', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'checkout-no-markdown',
    agentName: 'checkout',
    input: { tenantId: TENANT_ID },
    expectedNotContains: ['**', '__'],
    rubric: [
      { criterion: 'Texto plano sin markdown', weight: 0.5 },
      { criterion: 'Incluye la política de pago', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'checkout-no-descuento',
    agentName: 'checkout',
    input: { tenantId: TENANT_ID },
    expectedNotContains: ['descuento'],
    rubric: [
      { criterion: 'No dice descuento (regla N01)', weight: 0.5 },
      { criterion: 'Usa "precio especial" si aplica', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },

  // ── novedades (5) ──
  {
    name: 'novedades-direccion-erronea',
    agentName: 'novedades',
    input: { tenantId: TENANT_ID, guia: 'GUIA-123', novedadTipo: 'dirección errónea' },
    rubric: [
      { criterion: 'Clasifica la novedad como dirección errónea', weight: 0.4 },
      { criterion: 'Pide SOLO la información necesaria', weight: 0.3 },
      { criterion: 'No culpa al cliente', weight: 0.3 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'novedades-destinatario-no-encontrado',
    agentName: 'novedades',
    input: { tenantId: TENANT_ID, guia: 'GUIA-123', novedadTipo: 'destinatario no encontrado' },
    rubric: [
      { criterion: 'Clasifica la novedad como destinatario no encontrado', weight: 0.5 },
      { criterion: 'Propone reprogramar la entrega', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'novedades-customer-message',
    agentName: 'novedades',
    input: { tenantId: TENANT_ID, guia: 'GUIA-123', novedadTipo: 'rechazo', message: 'No lo quiero, llegó tarde' },
    rubric: [
      { criterion: 'Clasifica la novedad como rechazo', weight: 0.4 },
      { criterion: 'No procesa devolución directamente (regla N11)', weight: 0.3 },
      { criterion: 'Deriva a asesor humano para devoluciones', weight: 0.3 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'novedades-no-culpa-cliente',
    agentName: 'novedades',
    input: { tenantId: TENANT_ID, guia: 'GUIA-123', novedadTipo: 'dirección errónea' },
    expectedNotContains: ['tu culpa', 'tu error'],
    rubric: [
      { criterion: 'No culpa al cliente', weight: 0.6 },
      { criterion: 'Tono de marca respetado', weight: 0.4 },
    ],
    maxLatencyMs: 8000,
  },
  {
    name: 'novedades-no-markdown',
    agentName: 'novedades',
    input: { tenantId: TENANT_ID, guia: 'GUIA-123', novedadTipo: 'dirección errónea' },
    expectedNotContains: ['**', '__'],
    rubric: [
      { criterion: 'Texto plano sin markdown', weight: 0.5 },
      { criterion: 'Máximo 30 palabras + dato', weight: 0.5 },
    ],
    maxLatencyMs: 8000,
  },
]

// ───────────────────────────────────────────────────────────────────────────
// LLM caller — wires the adapter into the evaluation framework.
//
// The adapter returns `{ content, usage, model, provider }`. We extract
// the bits the framework needs: content + usage (for token-aware cost).
// ───────────────────────────────────────────────────────────────────────────

async function callLLM(system: string, user: string, agentName: string) {
  const { model: tierModel } = getModelForAgent(agentName)
  const result = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { model: tierModel, thinking: 'disabled' },
  )
  return {
    content: result.content,
    usage: result.usage
      ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        }
      : undefined,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const filter = process.env.AGENT_EVAL_FILTER
  const cases = filter ? CASES.filter((c) => c.agentName === filter) : CASES

  console.log(`\n🧪 Agent evaluation — ${cases.length} cases${filter ? ` (filter: ${filter})` : ''}\n`)

  // Pre-flight: build every prompt up-front so we fail fast on a builder
  // bug before spending LLM budget. Uses the real `buildAgentPrompt` so
  // the runner catches prompt regressions even when assertions pass.
  for (const testCase of cases) {
    try {
      await buildAgentPrompt(testCase.agentName as never, testCase.input as never)
    } catch (e) {
      console.error(`❌ Prompt build failed for ${testCase.name}: ${e instanceof Error ? e.message : e}`)
      process.exit(1)
    }
  }

  const report = await runEvaluationSuite(cases, { callLLM })

  // Per-case log line.
  for (const r of report.results) {
    const icon = r.passed ? '✅' : '❌'
    const rubric = r.rubricScores
      ? ` · rubric ${r.overallScore.toFixed(2)}`
      : ''
    console.log(
      `${icon} ${r.testCase.padEnd(40)} ${r.agentName.padEnd(12)} ${r.latencyMs.toString().padStart(5)}ms${rubric}`,
    )
    if (r.errors.length > 0) {
      for (const err of r.errors) console.log(`     ↳ ${err}`)
    }
  }

  // Summary.
  console.log(`\n────────────────────────────────────────`)
  console.log(`Pass rate:   ${(report.passRate * 100).toFixed(1)}% (${report.passed}/${report.totalCases})`)
  console.log(`Avg latency: ${report.avgLatencyMs}ms`)
  console.log(`Total cost:  $${report.totalCostUsd.toFixed(6)}`)
  console.log(`────────────────────────────────────────\n`)

  // Artifact.
  const artifactPath = resolve(process.cwd(), 'eval-results-agent.json')
  writeFileSync(artifactPath, JSON.stringify(report, null, 2))
  console.log(`📄 Report written to ${artifactPath}\n`)

  // Promotion gate (study §7.4): ≥ 90% pass rate, no case below 0.7.
  const minPassRate = 0.9
  const minCaseScore = 0.7
  const lowScoreCases = report.results.filter((r) => r.overallScore < minCaseScore)
  if (report.passRate < minPassRate || lowScoreCases.length > 0) {
    console.error(
      `⛔ Promotion gate FAILED: passRate=${report.passRate.toFixed(2)} (need ≥ ${minPassRate}), ` +
        `${lowScoreCases.length} cases below ${minCaseScore} score.`,
    )
    process.exit(1)
  }

  console.log('✅ Promotion gate passed.\n')
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
