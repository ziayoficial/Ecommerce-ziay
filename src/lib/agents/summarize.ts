// ZIAY — Historial con resumen LLM
//
// SPRINT-AI-AGENTS-002 §3 — versión enriquecida del truncado de historial
// (§A-7 de SPRINT-AI-LLM-ADAPTER-001). En lugar del resumen simple basado
// en intents del usuario (truncateHistory en ./history.ts), aquí se invoca
// al LLM para generar un resumen más rico de los mensajes antiguos antes
// de descartarlos.
//
// Caso de uso: conversaciones largas (>20 mensajes) donde el resumen
// simple pierde contexto crítico (precios cotizados, preocupaciones del
// cliente, próximos pasos acordados). El costo de la llamada LLM extra se
// justifica cuando el agente necesita ese contexto para responder bien.
//
// NOTA: esta función aún NO está cableada en /api/ai-reply/route.ts ni en
// /api/agents/[agentName]/route.ts. El truncado simple (truncateHistory)
// sigue siendo el default. truncateWithSummary queda como opt-in para
// callers que explicitamente quieran el resumen LLM — el cableado real es
// follow-up (ver "Next Actions" en worklog SPRINT-AI-AGENTS-002).

import { chat } from '@/lib/llm/adapter'
import type { Message } from '@/lib/agents/history'

/**
 * Resumen LLM de un historial de conversación.
 *
 * Si hay menos de 5 mensajes, no vale la pena gastar tokens en un resumen
 * — se concatena los intents del usuario (mismo comportamiento que el
 * truncateHistory simple, así los callers pueden reemplazarlo sin cambio
 * de comportamiento para conversaciones cortas).
 *
 * Para historiales más largos, invoca al LLM con un prompt de resumen en
 * español. Si la llamada falla (timeout, provider error, etc.), cae al
 * resumen simple — la función NUNCA lanza.
 */
export async function summarizeHistory(messages: Message[]): Promise<string> {
  if (messages.length < 5) {
    // No hay suficiente material para resumir — devolver la lista de
    // intents del usuario (mismo formato que truncateHistory).
    return messages
      .filter((m) => m.role === 'user')
      .map((m) => `- ${m.content.slice(0, 100)}`)
      .join('\n')
  }

  const summaryPrompt = `Resume la siguiente conversación en 3-5 puntos clave.
Incluye: qué quiere el cliente, productos mencionados, precios cotizados,
preocupaciones, y próximos pasos acordados. Sé conciso.

Conversación:
${messages.map((m) => `[${m.role}]: ${m.content}`).join('\n')}`

  try {
    const result = await chat(
      [{ role: 'user', content: summaryPrompt }],
      {
        temperature: 0.2,
        maxTokens: 200,
        thinking: 'disabled',
      },
    )
    return result.content.trim() || fallbackSimpleSummary(messages)
  } catch {
    // Si el LLM no responde, caemos al resumen simple. La función
    // nunca lanza — el caller puede usarla en un pipeline crítico.
    return fallbackSimpleSummary(messages)
  }
}

/**
 * Truncado de historial con resumen LLM de los mensajes antiguos.
 *
 * Comportamiento:
 *   - Si `history.length <= maxRecentMessages`, retorna el system prompt
 *     + el historial completo (sin llamada LLM).
 *   - Si no, divide el historial en antiguos (resumidos vía LLM) y
 *     recientes (mantenidos íntegros), e inyecta el resumen como un
 *     mensaje `system` con el prefijo "Contexto anterior de la
 *     conversación:".
 *
 * Es drop-in compatible con `truncateHistory` del mismo módulo — misma
 * firma, mismo shape de retorno — pero asíncrono y con resumen LLM.
 *
 * @param systemPrompt — prompt del agente (role: 'system').
 * @param history — historial completo, en orden cronológico.
 * @param maxRecentMessages — cuántos mensajes recientes mantener íntegros.
 */
export async function truncateWithSummary(
  systemPrompt: string,
  history: Message[],
  maxRecentMessages: number = 10,
): Promise<Message[]> {
  const result: Message[] = [{ role: 'system', content: systemPrompt }]

  if (history.length <= maxRecentMessages) {
    return [...result, ...history]
  }

  // Dividir en antiguos (resumidos) y recientes (íntegros).
  const olderMessages = history.slice(0, history.length - maxRecentMessages)
  const recentMessages = history.slice(-maxRecentMessages)

  const summary = await summarizeHistory(olderMessages)

  if (summary) {
    result.push({
      role: 'system',
      content: `Contexto anterior de la conversación:\n${summary}`,
    })
  }

  return [...result, ...recentMessages]
}

/**
 * Resumen simple sin LLM — se usa como fallback cuando la llamada LLM
 * falla o cuando hay pocos mensajes. Idéntico al resumen que produce
 * `truncateHistory` (mantenemos la misma forma para que el cambio de
 * un caller a `truncateWithSummary` sea transparente).
 */
function fallbackSimpleSummary(messages: Message[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => `- ${m.content.slice(0, 100)}`)
    .join('\n')
}
