// ZIAY — Conversation History Truncation
//
// SPRINT-AI-LLM-ADAPTER-001 §A-7 — gestión del context window.
//
// Sin truncamiento, una conversación larga (>20 mensajes) puede
// desbordar el context window del modelo (8K–128K tokens según el
// proveedor) y causar errores 400 de la API. Estas helpers recortan
// el historial manteniendo:
//   1. El system prompt (siempre — es la definición del agente).
//   2. Un resumen breve de los mensajes antiguos (intents del usuario).
//   3. Los últimos N mensajes íntegros (los más relevantes para la
//      respuesta actual).
//
// Se invoca desde `/api/ai-reply/route.ts` antes de llamar al LLM.

const MAX_MESSAGES = 20 // mantener los últimos 20 mensajes íntegros
const MAX_TOKENS_ESTIMATE = 4000 // ~4K tokens para historial (excluye system)

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Trunca el historial para que quepa en el context window.
 *
 * Estrategia: system prompt (siempre) + resumen de mensajes antiguos
 * (sólo intents del usuario) + últimos `maxMessages` mensajes íntegros.
 *
 * @param systemPrompt — prompt del agente (role: 'system').
 * @param history — historial completo, en orden cronológico.
 * @param maxMessages — cuántos mensajes recientes mantener íntegros.
 * @returns array de mensajes listo para pasar al adapter `chat()`.
 */
export function truncateHistory(
  systemPrompt: string,
  history: Message[],
  maxMessages: number = MAX_MESSAGES,
): Message[] {
  // El system prompt va siempre primero — define al agente.
  const result: Message[] = [{ role: 'system', content: systemPrompt }]

  if (history.length <= maxMessages) {
    return [...result, ...history]
  }

  // Dividir en antiguos (resumidos) y recientes (íntegros).
  const olderMessages = history.slice(0, history.length - maxMessages)
  const recentMessages = history.slice(-maxMessages)

  // Resumen simple: lista los intents del usuario (primeros 100 chars
  // de cada mensaje). No usamos LLM para resumir — sería otra llamada
  // costosa y el resumen se descarta rápido.
  const summary = olderMessages
    .filter((m) => m.role === 'user')
    .map((m) => `- ${m.content.slice(0, 100)}`)
    .join('\n')

  if (summary) {
    result.push({
      role: 'system',
      content: `Contexto anterior de la conversación:\n${summary}`,
    })
  }

  return [...result, ...recentMessages]
}

/**
 * Estima el conteo de tokens (aproximación: 1 token ≈ 4 chars).
 *
 * No es exacto — el tokenizer real depende del modelo (BPE para GPT,
 * SentencePiece para Llama, etc.). Pero es suficiente para decidir
 * cuándo truncar.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Trunca por presupuesto de tokens en vez de por conteo de mensajes.
 *
 * Trabaja de atrás hacia adelante (mensajes más recientes primero)
 * hasta agotar el presupuesto. Útil cuando los mensajes varían mucho
 * en longitud (p.ej. un mensaje con un JSON grande de catálogo).
 *
 * @param systemPrompt — prompt del agente (siempre se incluye).
 * @param history — historial completo, en orden cronológico.
 * @param maxTokens — presupuesto de tokens para system + history.
 * @returns array de mensajes listo para pasar al adapter `chat()`.
 */
export function truncateByTokens(
  systemPrompt: string,
  history: Message[],
  maxTokens: number = MAX_TOKENS_ESTIMATE,
): Message[] {
  const result: Message[] = [{ role: 'system', content: systemPrompt }]
  let tokenCount = estimateTokens(systemPrompt)

  // Recorrer de atrás hacia adelante — los más recientes son prioritarios.
  const reversed = [...history].reverse()
  for (const msg of reversed) {
    const msgTokens = estimateTokens(msg.content)
    if (tokenCount + msgTokens > maxTokens) break
    result.push(msg)
    tokenCount += msgTokens
  }

  // Reordenar a cronológico (después del system, que va primero).
  return [result[0], ...result.slice(1).reverse()]
}
