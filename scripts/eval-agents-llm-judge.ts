/**
 * IA-6B (Gap 6) — LLM-as-judge evaluation runner.
 *
 * Runs every agent-evaluation test case through TWO LLM calls:
 *   1. The agent itself (via the pluggable adapter, same as
 *      `eval-agents.ts`).
 *   2. The LLM judge (`evaluateWithLLMJudge`) — a frontier model that
 *      scores the agent's output 0-1 on 5 criteria (relevance, accuracy,
 *      tone, completeness, safety) with free-form reasoning.
 *
 * Output:
 *   - Per-case log line on stdout (✅/❌ + agent score + judge score +
 *     per-criterion breakdown + reasoning snippet).
 *   - Summary (pass rate, avg agent score, avg judge score, total cost).
 *   - `eval-results-agent-llm-judge.json` artifact (full structured
 *     report with per-criterion scores + reasoning for every case).
 *
 * Promotion gate (stricter than the deterministic runner):
 *   - passRate >= 0.9 (same as `eval-agents.ts`)
 *   - avgJudgeScore >= 0.8 (judge must agree the outputs are good)
 *   - no case may have judge score < 0.6 (a single bad output blocks
 *     promotion — the judge catches issues the rubric misses)
 *
 * Usage:
 *   bun run scripts/eval-agents-llm-judge.ts
 *   AGENT_EVAL_FILTER=quote bun run scripts/eval-agents-llm-judge.ts
 *
 * Requires: `LLM_API_KEY` (or whichever provider env var the adapter
 * resolves). Without a key, the runner exits 1 — this script is the
 * pre-promotion manual run, not the CI baseline.
 */

/* eslint-disable no-console -- CLI script: console.log is intentional. */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { chat } from '../src/lib/llm/adapter'
import { buildAgentPrompt } from '../src/lib/agents/prompts'
import { getModelForAgent, estimateCost } from '../src/lib/agents/model-router'
import {
  runEvaluationSuiteWithJudge,
  DEFAULT_JUDGE_MODEL,
  JUDGE_CRITERIA,
  type AgentTestCase,
} from '../src/lib/agents/evaluation'

// ───────────────────────────────────────────────────────────────────────────
// Test cases — same 25 as eval-agents.ts (kept in sync manually).
// Inlining here so the judge runner is self-contained.
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
// LLM callers — agent + judge, both via the adapter.
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

async function callJudge(system: string, user: string) {
  // The judge uses the frontier tier — critique is harder than generation.
  const result = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { model: DEFAULT_JUDGE_MODEL, thinking: 'disabled', temperature: 0, maxTokens: 600 },
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
  if (!process.env.LLM_API_KEY) {
    console.error(
      '⛔ LLM_API_KEY is required for the LLM-as-judge runner.\n' +
        '   Set it in your environment or .env file.\n' +
        '   The deterministic runner (eval-agents.ts) is the CI baseline;\n' +
        '   this script is the pre-promotion manual run.',
    )
    process.exit(1)
  }

  const filter = process.env.AGENT_EVAL_FILTER
  const cases = filter ? CASES.filter((c) => c.agentName === filter) : CASES

  console.log(
    `\n🧪 Agent evaluation + LLM-as-judge — ${cases.length} cases` +
      `${filter ? ` (filter: ${filter})` : ''}\n` +
      `   Judge model: ${DEFAULT_JUDGE_MODEL}\n` +
      `   Judge criteria: ${JUDGE_CRITERIA.join(', ')}\n`,
  )

  // Pre-flight: build every prompt up-front so we fail fast on a builder
  // bug before spending LLM budget.
  for (const testCase of cases) {
    try {
      await buildAgentPrompt(testCase.agentName as never, testCase.input as never)
    } catch (e) {
      console.error(
        `❌ Prompt build failed for ${testCase.name}: ${e instanceof Error ? e.message : e}`,
      )
      process.exit(1)
    }
  }

  const report = await runEvaluationSuiteWithJudge(cases, {
    callLLM,
    callJudge,
    judgeModel: DEFAULT_JUDGE_MODEL,
  })

  // Per-case log line — agent result + judge result side by side.
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i]
    const j = report.judgeResults[i]
    const icon = r.passed && j.parsed && j.score >= 0.6 ? '✅' : '❌'
    const judgeSummary = j.parsed
      ? ` · judge ${j.score.toFixed(2)} ` +
        `(${j.rubricScores.map((s) => `${s.criterion.slice(0, 3)}=${s.score.toFixed(1)}`).join(' ')})`
      : ' · judge N/A'
    const rubric = r.rubricScores ? ` · rubric ${r.overallScore.toFixed(2)}` : ''
    console.log(
      `${icon} ${r.testCase.padEnd(40)} ${r.agentName.padEnd(12)} ${r.latencyMs.toString().padStart(5)}ms${rubric}${judgeSummary}`,
    )
    if (r.errors.length > 0) {
      for (const err of r.errors) console.log(`     ↳ assertion: ${err}`)
    }
    if (j.parsed && j.reasoning) {
      // Truncate reasoning to ~120 chars for the log line; full text is
      // in the JSON artifact.
      const snippet = j.reasoning.length > 120 ? j.reasoning.slice(0, 117) + '...' : j.reasoning
      console.log(`     ↳ judge: ${snippet}`)
    } else if (!j.parsed && j.rawOutput) {
      console.log(
        `     ↳ judge parse failed. raw head: ${j.rawOutput.slice(0, 100)}...`,
      )
    }
  }

  // Aggregate judge stats.
  const judgeParsed = report.judgeResults.filter((j) => j.parsed)
  const avgJudgeScore =
    judgeParsed.length > 0
      ? judgeParsed.reduce((s, j) => s + j.score, 0) / judgeParsed.length
      : 0
  const minJudgeScore = judgeParsed.length > 0
    ? Math.min(...judgeParsed.map((j) => j.score))
    : 0
  const lowJudgeCases = judgeParsed
    .map((j, i) => ({ j, name: report.results[i].testCase }))
    .filter((x) => x.j.score < 0.6)

  // Cost projection — agent calls + judge calls.
  const agentCost = report.results.reduce((s, _r, i) => {
    const tc = cases[i]
    const { tier } = getModelForAgent(tc.agentName)
    return s + (tier === 'cheap' ? 0.0001 : tier === 'standard' ? 0.0008 : 0.004)
  }, 0)
  const judgeCost = judgeParsed.length * 0.004 // frontier tier estimate per judge call
  const totalCost = agentCost + judgeCost

  // Summary.
  console.log(`\n────────────────────────────────────────`)
  console.log(`Agent pass rate:    ${(report.passRate * 100).toFixed(1)}% (${report.passed}/${report.totalCases})`)
  console.log(`Agent avg latency:  ${report.avgLatencyMs}ms`)
  console.log(`Judge parsed:       ${judgeParsed.length}/${report.judgeResults.length}`)
  console.log(`Judge avg score:    ${avgJudgeScore.toFixed(3)}`)
  console.log(`Judge min score:    ${minJudgeScore.toFixed(3)}`)
  console.log(`Low judge cases:    ${lowJudgeCases.length} (< 0.6)`)
  console.log(`Total cost (est):   $${totalCost.toFixed(6)}`)
  console.log(`────────────────────────────────────────\n`)

  // Artifact.
  const artifactPath = resolve(process.cwd(), 'eval-results-agent-llm-judge.json')
  writeFileSync(artifactPath, JSON.stringify(report, null, 2))
  console.log(`📄 Report written to ${artifactPath}\n`)

  // Promotion gate (stricter than the deterministic runner):
  //   - passRate >= 0.9 (agent assertions)
  //   - avgJudgeScore >= 0.8 (judge agrees outputs are good)
  //   - no case with judge score < 0.6 (no single bad output)
  //   - at least 80% of judge calls parsed (judge is reliable)
  const minPassRate = 0.9
  const minAvgJudgeScore = 0.8
  const minJudgeScorePerCase = 0.6
  const minJudgeParseRate = 0.8
  const judgeParseRate = judgeParsed.length / report.judgeResults.length

  const failures: string[] = []
  if (report.passRate < minPassRate) {
    failures.push(`passRate=${report.passRate.toFixed(2)} (need >= ${minPassRate})`)
  }
  if (avgJudgeScore < minAvgJudgeScore) {
    failures.push(`avgJudgeScore=${avgJudgeScore.toFixed(2)} (need >= ${minAvgJudgeScore})`)
  }
  if (lowJudgeCases.length > 0) {
    failures.push(
      `${lowJudgeCases.length} cases below judge score ${minJudgeScorePerCase}: ` +
        lowJudgeCases.map((c) => `${c.name}=${c.j.score.toFixed(2)}`).join(', '),
    )
  }
  if (judgeParseRate < minJudgeParseRate) {
    failures.push(
      `judgeParseRate=${judgeParseRate.toFixed(2)} (need >= ${minJudgeParseRate}) — judge LLM is unstable`,
    )
  }

  if (failures.length > 0) {
    console.error('⛔ Promotion gate FAILED:')
    for (const f of failures) console.error(`   - ${f}`)
    process.exit(1)
  }

  console.log('✅ Promotion gate passed (agent + LLM judge).\n')
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
