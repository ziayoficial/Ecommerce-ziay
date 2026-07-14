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
 * SPRINT-AI-AGENTS-003 §2 — ampliado de 5 a los 11 agentes con esquema
 * (profile, quote, cart_builder, buyer_behavior, address_analysis,
 * guide_tracking, customer_score, carrier_score, vision, novedades,
 * remarketing). Cada caso nuevo añade ~$0.001 al costo del harness — total
 * ~$0.011 por run completo.
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
 * Casos de evaluación — uno por cada agente con esquema (los 11). Cada
 * caso incluye un system prompt autocontenido + un user input realista en
 * español. Los system prompts son reducidos respecto a los del catálogo
 * (`src/lib/agents/prompts/<agent>.ts`) porque el harness valida el
 * contrato de salida (schema), no la integración con la DB del tenant —
 * los builders reales leen Tenant/Shipment/Customer/Product y requerirían
 * un setup de DB pesado para el eval.
 *
 * Los 6 casos nuevos (guide_tracking, customer_score, carrier_score,
 * vision, novedades, remarketing) se añadieron en SPRINT-AI-AGENTS-003 §2.
 * Cada uno apunta al esquema Zod correspondiente en
 * `src/lib/agents/schemas.ts` y usa inputs realistas en español LATAM
 * (mensajes de WhatsApp típicos del canal de ventas).
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
  // ── SPRINT-AI-AGENTS-003 §2 — 6 casos nuevos para los agentes ──────────
  // Cada caso nuevo apunta a su esquema Zod (ver AGENT_OUTPUT_SCHEMAS en
  // src/lib/agents/schemas.ts). Los system prompts son reducidos respecto
  // a los builders reales (que leen DB) — el harness valida el contrato
  // de salida, no la integración con el tenant.
  {
    // Esquema GuideTrackingSchema: { estado: en_transito|entregado|...
    //   fechaEstimada?, ultimaActualizacion? }. El prompt incluye un
    // estado simulado (guía 123456 en tránsito con ETA 2 días) — el
    // builder real consultaría LogisticsAdapter.
    agentName: 'guide_tracking',
    systemPrompt:
      'Eres el agente de seguimiento de guías. Devuelves JSON estricta con estado (en_transito/entregado/devuelto/perdido/desconocido), fechaEstimada (ISO date), ultimaActualizacion (ISO date). No inventes estados — usa solo el dato proporcionado.',
    userInput:
      'Mi guía es 123456, ¿dónde está mi pedido? (dato del sistema: guía 123456 con Servientrega, estado actual en_transito, ETA 2025-01-15, última actualización 2025-01-12)',
    description: 'Guide tracking — should return estado=en_transito with ETA',
  },
  {
    // Esquema CustomerScoreSchema: { score: 0-100, nivel: vip|regular|
    //   en_riesgo|nuevo, razon }. El cliente del input tiene 15 compras
    // en 6 meses con ticket promedio $80k — claramente VIP.
    agentName: 'customer_score',
    systemPrompt:
      'Eres el motor de scoring de clientes. Recibes el historial del cliente y devuelves JSON estricta con score (0-100), nivel (vip/regular/en_riesgo/nuevo), razon. Score basado en frecuencia de compra, ticket promedio, recencia y riesgo de churn.',
    userInput:
      'Cliente que ha comprado 15 veces en 6 meses, ticket promedio $80k. Última compra hace 5 días. Sin cancelaciones. Perfil: mayorista.',
    description: 'Customer score — VIP signal (15 compras, $80k avg)',
  },
  {
    // Esquema CarrierScoreSchema: { carrier: string, score: 0-100,
    //   onTimeRate: 0-1, issues: array }. Servientrega entregó 45/50 a
    // tiempo → onTimeRate=0.9, score alto.
    agentName: 'carrier_score',
    systemPrompt:
      'Eres el motor de scoring de transportadoras. Para la transportadora indicada, devuelves JSON estricta con carrier (nombre), score (0-100), onTimeRate (0-1), issues (array de strings con problemas detectados). Basado en volumen, % on-time, % novedad, % devolución.',
    userInput:
      'Servientrega ha entregado 45 de 50 paquetes a tiempo. 3 tuvieron novedad (dirección errónea), 2 fueron devueltos. Volumen total: 50 envíos en 30 días.',
    description: 'Carrier score — Servientrega 90% on-time, high score',
  },
  {
    // Esquema VisionSchema: { producto: string, categoria?, atributos?:
    //   record<string,string>, altText? }. Nota: el eval harness no
    // puede invocar al VLM real (zai-vlm) porque el adapter de chat()
    // es texto-only. Le pasamos al LLM una descripción textual de la
    // imagen (mock) y validamos que la salida cumpla VisionSchema.
    agentName: 'vision',
    systemPrompt:
      'Eres el agente de visión. Identificas productos a partir de descripciones de imágenes. Devuelves JSON estricta con producto (nombre), categoria (opcional), atributos (objeto de pares clave-valor: color, talla, marca, etc., opcional), altText (descripción accesible, opcional).',
    userInput:
      'Descripción de la imagen: short de pijama color azul con estampado de estrellas, talla M, marca ZIAY. SKU visible en la franja: SHORT-AZUL-M. Confianza alta en la identificación.',
    description: 'Vision (mock) — should return producto + atributos from description',
  },
  {
    // Esquema NovedadesSchema: { tipo: string, severidad: baja|media|
    //   alta, accion: string }. El cliente reporta que nunca recibió el
    // paquete — novedad de "extravío" o "no entregado", severidad alta.
    agentName: 'novedades',
    systemPrompt:
      'Eres el agente de novedades logísticas. Clasificas la novedad reportada y propones acción correctiva. Devuelves JSON estricta con tipo (string descriptivo: extravio/direccion_errona/rechazo/etc.), severidad (baja/media/alta), accion (string con el siguiente paso a tomar).',
    userInput:
      'El cliente dice que nunca recibió el paquete. Guía 123456 con Servientrega, marcada como entregada hace 3 días pero el cliente no la recibió. Reclamación urgente.',
    description: 'Novedades — extravío reportado, severidad alta',
  },
  {
    // Esquema RemarketingSchema: { mensaje: string, canal: whatsapp|
    //   messenger|instagram, momento: string }. Cliente abandonó carrito
    // hace 2 horas — momento óptimo para re-enganche.
    agentName: 'remarketing',
    systemPrompt:
      'Eres el agente de remarketing. Redactas un mensaje de re-enganche personalizado. Devuelves JSON estricta con mensaje (string, máximo 25 palabras, 1 pregunta binaria al cierre), canal (whatsapp/messenger/instagram), momento (string: cuándo enviar — inmediato/1h/24h/etc.).',
    userInput:
      'Cliente abandonó carrito hace 2 horas. Carrito: 2 short tira azul ($45k c/u), 1 pantalón tira ($65k). Perfil: mayorista. Canal preferido: WhatsApp.',
    description: 'Remarketing — abandoned cart 2h ago, WhatsApp channel',
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
