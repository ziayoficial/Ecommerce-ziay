// ZIAY — LLM Cost Calculator
//
// SPRINT-AI-LLM-ADAPTER-001 §A-6 — cálculo de costo por llamada LLM.
//
// Se invoca desde los 3 call sites (agents/[agentName], orchestrate,
// ai-reply) para persistir el costo USD en DecisionLog. La tabla
// COSTS_PER_1K está indexada por modelo porque los precios varían por
// modelo, no por proveedor (un mismo proveedor puede tener varios
// modelos con precios distintos, p.ej. gpt-4o vs gpt-4o-mini).
//
// `calculateCost(provider, usage)` resuelve el modelo por defecto del
// proveedor cuando el caller no pasa el modelo explícito (caso común:
// el adapter reporta `result.model` pero el caller sólo tiene
// `result.provider` a la mano).

/**
 * Costo por 1K tokens en USD — document §A-6.
 *
 * Fuentes:
 *   - glm-4.6 (ZAI): https://open.bigmodel.cn/pricing — $0.002 input / $0.006 output
 *   - gpt-4o (OpenAI): https://openai.com/pricing — $0.005 / $0.015
 *   - gpt-4o-mini (OpenAI): $0.00015 / $0.0006
 *   - grok-beta (xAI): https://x.ai/api — $0.005 / $0.015
 *   - llama3.2 (Ollama local): $0 / $0 (self-hosted, sin costo API)
 *
 * Si un modelo no está en la tabla, se usa `glm-4.6` como fallback
 * (mismo default que el adapter).
 */
const COSTS_PER_1K: Record<string, { input: number; output: number }> = {
  'glm-4.6': { input: 0.002, output: 0.006 }, // ZAI
  'gpt-4o': { input: 0.005, output: 0.015 }, // OpenAI
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'grok-beta': { input: 0.005, output: 0.015 }, // xAI
  'llama3.2': { input: 0, output: 0 }, // Ollama (local, free)
}

/**
 * Modelo por defecto de cada proveedor — se usa cuando el caller pasa
 * `calculateCost(provider, usage)` sin modelo explícito. Mantenido en
 * sync con `defaultModel` en cada Provider del adapter.
 */
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  zai: 'glm-4.6',
  openai: 'gpt-4o-mini',
  xai: 'grok-beta',
  ollama: 'llama3.2',
}

/**
 * Uso de tokens reportado por el adapter (forma relajada — cualquier
 * subconjunto de campos es válido).
 */
export interface TokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * Calcula el costo USD de una llamada LLM.
 *
 * @param providerOrModel — nombre del proveedor ('zai', 'openai',
 *   'xai', 'ollama') o del modelo ('glm-4.6', 'gpt-4o', …). Si es un
 *   proveedor, se resuelve su modelo por defecto vía
 *   `DEFAULT_MODEL_BY_PROVIDER`.
 * @param usage — uso de tokens reportado por el adapter. Si falta
 *   `promptTokens` o `completionTokens`, devuelve `null` (no se puede
 *   calcular sin ambos).
 * @returns costo en USD con 6 decimales de precisión, o `null` si no
 *   hay datos suficientes.
 */
export function calculateCost(
  providerOrModel: string,
  usage?: TokenUsage,
): number | null {
  if (!usage?.promptTokens || !usage?.completionTokens) return null

  // Si el argumento es un proveedor conocido, resolvemos su modelo
  // por defecto. Si no, asumimos que ya es un nombre de modelo.
  const model =
    DEFAULT_MODEL_BY_PROVIDER[providerOrModel] ?? providerOrModel ?? 'glm-4.6'
  const costs = COSTS_PER_1K[model] ?? COSTS_PER_1K['glm-4.6']

  const inputCost = (usage.promptTokens / 1000) * costs.input
  const outputCost = (usage.completionTokens / 1000) * costs.output
  // 6 decimales — el costo mínimo que podemos distinguir es
  // 1 token × $0.00015/1K = $0.00000015, que redondea a 0.000000.
  return Math.round((inputCost + outputCost) * 1000000) / 1000000
}

/**
 * Devuelve el nombre del proveedor a partir del modelo.
 *
 * Útil cuando el caller tiene `result.model` pero no `result.provider`
 * (p.ej. al loggear desde un wrapper genérico).
 */
export function getModelProvider(model: string): string {
  if (model.startsWith('glm')) return 'zai'
  if (model.startsWith('gpt')) return 'openai'
  if (model.startsWith('grok')) return 'xai'
  if (model.startsWith('llama')) return 'ollama'
  return 'unknown'
}
