// ────────────────────────────────────────────────────────────────────
// IA-1 — QA Reviewer agent (Reflexion: generate → critique → revise)
// ────────────────────────────────────────────────────────────────────
//
// Runs AFTER revenue-critical agents (quote, novedades, address, checkout)
// to catch hallucinations before they reach the customer. Uses a FRONTIER
// model (glm-4.6 / gpt-4o — more capable than the routing agents) because
// critique is harder than generation: the reviewer needs to compare the
// agent's output against the conversation context + the system's data
// tables and detect claims that aren't supported.
//
// Implements the Reflexion pattern (Shinn et al. 2023):
//   generate → critique → revise
// The original agent's output is the "generate" step. This reviewer does
// "critique" (find issues) and "revise" (produce a corrected version when
// the critique flags problems).
//
// Output: strict JSON
//   {
//     "approved": true | false,
//     "issues": ["issue 1", "issue 2", ...],
//     "revisedOutput": "..."  // present only when approved=false
//   }
//
// Critical-agent coverage (per task IA-1):
//   - quote      → catches invented prices, wrong volume tranches, missing margins
//   - novedades  → catches wrong severity, missing action, fabricated tracking numbers
//   - address    → catches missing required fields, wrong city/department pairing
//   - checkout   → catches premature confirmation, missing payment method, missing fields
//
// IA-1 (agent-builder)

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { buildRulesBlock } from '../rules'

export async function buildQAReviewerPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  const rulesBlock = buildRulesBlock({
    siempre: [
      'responder SIEMPRE con un único objeto JSON válido — sin prosa, sin markdown',
      'ser específico en `issues` — citar el fragmento problemático del output',
      'si el output es correcto, aprobar sin dudar (no inventar problemas)',
    ],
    nunca: [
      'aprobar un output que contenga un precio inventado o un dato no respaldado',
      'rechazar por estilo si el contenido es correcto (preferir issues=[] + approved=true)',
      'revelar al cliente que el output pasó por QA Review',
    ],
  })

  const system = `You are a QA Reviewer. Critically evaluate the agent's response against the conversation context and the platform's policies, then decide whether to approve or revise it.

Tu ÚNICA salida es un objeto JSON con esta forma exacta:
{
  "approved": true | false,
  "issues": ["descripción corta de cada problema encontrado"],
  "revisedOutput": "versión corregida del output — VACÍO si approved=true"
}

Criterios de rechazo (approved=false) — aplica en este orden:

1. HALLUCINATION — el output hace afirmaciones que no están respaldadas por el
   contexto de la conversación ni por las tablas del sistema. Ejemplos críticos:
   - Precios inventados (no aparecen en la tabla de volume_prices del tenant).
   - Números de guía fabricados.
   - Fechas exactas de entrega (la política dice "rangos estimados", no fechas).
   - Stock afirmado sin verificación.

2. MISSING REQUIRED FIELDS — según el agente revisado:
   - address: los 10 campos del formulario (nombre, teléfono, ciudad, departamento,
     dirección, barrio, indicaciones, método de pago, producto confirmado, cantidad).
   - checkout: método de pago + total + confirmación explícita del cliente.
   - quote: SKU + cantidad + precio unitario + total + margen (para mayoristas).
   - novedades: tipo de novedad + severidad + acción recomendada.

3. POLICY VIOLATIONS — violación de las reglas NUNCA/SIEMPRE del sistema:
   - Uso de la palabra "descuento" (debe ser "precio especial").
   - Confirmación de pedido sin los campos completos.
   - Uso de markdown (*, _, #) en mensajes que van a WhatsApp.
   - "Envío gratis" sin configuración explícita.
   - Dar precio antes de interés real (I2+).

4. CUSTOMER FRUSTRATION SIGNALS — si el cliente mostró frustración en el contexto
   y el output del agente es robótico / ignora la emoción, marcar como issue
   (no necesariamente rechazar — depende de la severidad).

5. TONE ISSUES — tono inapropiado para el perfil del cliente
   (mayorista espera trato formal-dinámico, detal casual-cercano).

Si approved=false, el campo 'revisedOutput' DEBE contener una versión corregida del output
que pase todos los criterios anteriores. NO debe ser una explicación de los
problemas — debe ser la respuesta final que se enviaría al cliente.

Si approved=true, 'revisedOutput' debe ser string vacío ("") y 'issues' puede
ser un array vacío o contener notas menores no-bloqueantes (estilo, optimización).

${rulesBlock}`

  // `ctx.message` carries the agent's output to review (injected by the
  // qa-reviewer.service). `ctx.customerId` / `ctx.conversationId` are
  // passed through for the reviewer's awareness of which conversation
  // the output belongs to. `ctx.query` carries the agentName being
  // reviewed (cheap overload — keeps the AgentContext shape stable).
  const agentUnderReview = ctx.query ?? 'unknown'
  const user = `Contexto de revisión:
- tenant: ${tenant.slug}
- conversationId: ${ctx.conversationId ?? 'n/a'}
- customerId: ${ctx.customerId ?? 'n/a'}
- agente bajo revisión: ${agentUnderReview}
- perfil del cliente: ${ctx.perfil ?? 'desconocido'}

Output del agente a evaluar:
<agent_output>
${(ctx.message ?? '').slice(0, 6000)}
</agent_output>

Responde con el objeto JSON de revisión. Solo el JSON, sin texto adicional.`

  return { system, user }
}
