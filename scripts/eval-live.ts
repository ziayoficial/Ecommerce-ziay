/**
 * Live LLM evaluation harness.
 *
 * SPRINT-AI-AGENTS-002 §1 — corre los 11 agentes con esquema contra entradas
 * conocidas y mide:
 *   - Schema validation pass rate
 *   - Average confidence
 *   - Token usage
 *   - Latency
 *   - Cost per call
 *
 * Usage:  bun run scripts/eval-live.ts
 * Requiere: ZAI_API_KEY en .env (o el provider alternativo configurado vía
 * LLM_PROVIDER).
 *
 * El script NO es parte del suite de vitest — es una herramienta de
 * evaluación en vivo que se invoca manualmente o desde CI contra el LLM
 * real. Los tests automatizados (golden-cases.test.ts) validan los esquemas
 * sin llamar al LLM.
 *
 * Output:
 *   - Log por caso en stdout (✅/❌ + métricas).
 *   - Resumen final (pass rate, avg latency, total cost).
 *   - Reporte JSON completo en `eval-results.json` (raíz del proyecto).
 */

/* eslint-disable no-console -- script de CLI: el uso de console.log es intencional. */

import { chat } from '../src/lib/llm/adapter'
import {
  parseAgentOutput,
  AGENT_OUTPUT_SCHEMAS,
} from '../src/lib/agents/schemas'
import { calculateCost } from '../src/lib/llm/costs'

interface EvalCase {
  agentName: string
  systemPrompt: string
  userInput: string
  description: string
}

/**
 * Casos de evaluación — uno por agente con esquema (5 de los 11 para
 * mantener el costo del harness bajo; ampliar según se requiera). Cada
 * caso incluye un system prompt autocontenido + un user input realista.
 *
 * Los system prompts son reducidos respecto a los del catálogo
 * (src/lib/agents/prompts/<agent>.ts) porque el harness valida el contrato
 * de salida (schema), no la integración con la DB del tenant.
 */
const EVAL_CASES: EvalCase[] = [
  {
    agentName: 'profile',
    systemPrompt:
      'Eres un agente que perfila clientes. Analiza el mensaje y devuelve JSON con tipo (mayorista/emprendedor/detal), confianza (0-1), y razon.',
    userInput:
      'Hola, quiero comprar 50 short de pijama para revender en mi tienda. ¿Tienen precio mayorista?',
    description: 'Mayorista signal — should detect tipo=mayorista',
  },
  {
    agentName: 'quote',
    systemPrompt:
      'Eres un agente que cotiza productos. Devuelve JSON con total, moneda, items (sku, nombre, precio, cantidad, subtotal), y envio.',
    userInput: 'Cótame 3 batolas a 23000 cada una con envío a Bogotá',
    description: 'Quote request — should return structured quote',
  },
  {
    agentName: 'cart_builder',
    systemPrompt:
      'Eres un agente que arma carritos. Devuelve JSON con items (sku, cantidad) y total.',
    userInput: 'Quiero 2 short tira y 1 pantalón tira',
    description: 'Cart build — should return items with SKUs',
  },
  {
    agentName: 'buyer_behavior',
    systemPrompt:
      'Eres un agente que analiza comportamiento. Devuelve JSON con intencion (compara/compra/navega/abandona), signals (array), y recomendacion.',
    userInput: 'Estoy comparando precios con otras tiendas, pero me gusta este modelo',
    description: 'Comparison behavior — should detect intencion=compara',
  },
  {
    agentName: 'address_analysis',
    systemPrompt:
      'Eres un agente que valida direcciones. Devuelve JSON con valid (bool), ciudad, barrio, sugerencia.',
    userInput: 'Calle 100 #15-20, Bogotá',
    description: 'Valid Bogotá address',
  },
]

interface EvalResult {
  agent: string
  description: string
  passed: boolean
  latency: number
  tokens?: number
  cost?: number | null
  confidence?: number
  rawOutput?: string
  error?: string
}

/**
 * Corre un caso individual: invoca al LLM, parsea + valida la salida con
 * el esquema del agente, calcula costo USD, y registra el resultado.
 *
 * El `confidence` simulado sigue la convención del route handler real
 * (src/app/api/agents/[agentName]/route.ts §A-3):
 *   - 0.8 si el JSON validó contra el esquema Zod.
 *   - 0.3 si el agente tiene esquema pero la salida no validó.
 *   - 0.1 si la llamada LLM falló completamente (timeout, API error, etc.).
 */
async function runCase(testCase: EvalCase): Promise<EvalResult> {
  const start = Date.now()
  try {
    const result = await chat(
      [
        { role: 'system', content: testCase.systemPrompt },
        { role: 'user', content: testCase.userInput },
      ],
      {
        temperature: 0.3,
        maxTokens: 500,
        thinking: 'disabled',
      },
    )

    const latency = Date.now() - start
    const parsed = parseAgentOutput<unknown>(testCase.agentName, result.content)
    const cost = calculateCost(result.provider || 'zai', result.usage)

    const passed = parsed !== null
    // Miramos el esquema para decidir el confidence: si el agente tiene
    // esquema pero la salida no validó, es 0.3 (fallback). Si validó, 0.8.
    const schemaExists = testCase.agentName in AGENT_OUTPUT_SCHEMAS
    const confidence = passed ? 0.8 : schemaExists ? 0.3 : 0.6

    console.log(
      `  ${passed ? '✅' : '❌'} schema=${passed ? 'valid' : 'invalid'} ` +
        `latency=${latency}ms tokens=${result.usage?.totalTokens ?? 'N/A'} ` +
        `cost=$${cost ?? 'N/A'} confidence=${confidence}`,
    )

    return {
      agent: testCase.agentName,
      description: testCase.description,
      passed,
      latency,
      tokens: result.usage?.totalTokens,
      cost,
      confidence,
      rawOutput: result.content.slice(0, 200),
    }
  } catch (e) {
    const latency = Date.now() - start
    const message = e instanceof Error ? e.message : 'unknown'
    console.log(`  ❌ error: ${message}`)
    return {
      agent: testCase.agentName,
      description: testCase.description,
      passed: false,
      latency,
      confidence: 0.1,
      error: message,
    }
  }
}

async function runEval(): Promise<void> {
  console.log('🤖 ZIAY Live LLM Eval Harness\n')
  console.log(`Running ${EVAL_CASES.length} eval cases...\n`)

  const results: EvalResult[] = []

  for (const testCase of EVAL_CASES) {
    console.log(`▶ ${testCase.agentName}: ${testCase.description}`)
    const result = await runCase(testCase)
    results.push(result)
    console.log()
  }

  // Resumen final — pass rate, latencia promedio, costo total.
  const passed = results.filter((r) => r.passed).length
  const avgLatency =
    results.reduce((s, r) => s + r.latency, 0) / results.length
  const totalCost = results.reduce((s, r) => s + (r.cost ?? 0), 0)
  const avgConfidence =
    results.reduce((s, r) => s + (r.confidence ?? 0), 0) / results.length

  console.log('━'.repeat(50))
  console.log(`\n📊 Summary:`)
  console.log(
    `  Pass rate: ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%)`,
  )
  console.log(`  Avg latency: ${Math.round(avgLatency)}ms`)
  console.log(`  Avg confidence: ${avgConfidence.toFixed(2)}`)
  console.log(`  Total cost: $${totalCost.toFixed(6)}`)
  console.log()

  // Persistir el reporte JSON para análisis posterior (regresiones,
  // comparación entre providers, etc.).
  const fs = await import('fs/promises')
  const reportPath = 'eval-results.json'
  await fs.writeFile(reportPath, JSON.stringify(results, null, 2))
  console.log(`Results saved to ${reportPath}`)
}

runEval().catch((err) => {
  console.error('Eval harness failed:', err)
  process.exit(1)
})
