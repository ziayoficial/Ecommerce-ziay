// CommerceFlow OS — LLM Provider Adapter
//
// Pluggable abstraction over multiple LLM providers so the agent layer
// (src/lib/agents) and other callers can switch between ZAI (default),
// OpenAI, xAI (Grok), and Ollama (local) without code changes.
//
// The active provider is selected via:
//   1. Explicit `name` argument to `getLLMProvider(name?)`
//   2. `tenant.proveedorIa` (resolved by the caller)
//   3. `LLM_PROVIDER` env var
//   4. Default: 'zai'
//
// BUILD-AGENTS-LIB-001

import ZAI from 'z-ai-web-dev-sdk'
import type { ChatMessage } from 'z-ai-web-dev-sdk'

// The ZAI SDK exports a class with a private constructor; the only way to get
// an instance is `ZAI.create()` (async). We type the instance as the resolved
// type of that factory so we never reference the private constructor.
type ZAIClient = Awaited<ReturnType<typeof ZAI.create>>

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type LLMProviderName = 'zai' | 'openai' | 'xai' | 'ollama'

export interface LLMChatOptions {
  /** Model identifier. Defaults to provider default. */
  model?: string
  /** Sampling temperature 0-2. Defaults to 0.7. */
  temperature?: number
  /** Max tokens in the completion. */
  maxTokens?: number
  /** Enable streaming (provider-dependent). */
  stream?: boolean
  /** Optional system prompt override. */
  system?: string
}

export interface LLMChatResult {
  /** The assistant's reply text. */
  content: string
  /** Model used. */
  model: string
  /** Provider name. */
  provider: LLMProviderName
  /** Raw upstream response (provider-specific). */
  raw: unknown
  /** Token usage if reported by the provider. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export interface LLMProvider {
  readonly name: LLMProviderName
  readonly defaultModel: string
  /** Chat completion given a list of messages. */
  chat(messages: ChatMessage[], opts?: LLMChatOptions): Promise<LLMChatResult>
}

// ────────────────────────────────────────────────────────────────────
// ZAI Provider (default — uses z-ai-web-dev-sdk)
// ────────────────────────────────────────────────────────────────────

export class ZaiProvider implements LLMProvider {
  readonly name = 'zai' as const
  readonly defaultModel = 'glm-4.6'
  private clientPromise: Promise<ZAIClient> | null = null

  private async client(): Promise<ZAIClient> {
    if (!this.clientPromise) {
      this.clientPromise = ZAI.create()
    }
    return this.clientPromise
  }

  async chat(messages: ChatMessage[], opts: LLMChatOptions = {}): Promise<LLMChatResult> {
    const client = await this.client()
    const body: Parameters<ZAIClient['chat']['completions']['create']>[0] = {
      model: opts.model ?? this.defaultModel,
      messages: opts.system
        ? [{ role: 'system', content: opts.system }, ...messages]
        : messages,
      stream: false,
      temperature: opts.temperature,
    }
    if (opts.maxTokens) (body as Record<string, unknown>).max_tokens = opts.maxTokens

    const res = await client.chat.completions.create(body)
    const content: string =
      res?.choices?.[0]?.message?.content ??
      res?.choices?.[0]?.delta?.content ??
      (typeof res?.content === 'string' ? res.content : '') ??
      ''
    return {
      content,
      model: res?.model ?? body.model ?? this.defaultModel,
      provider: this.name,
      raw: res,
      usage: res?.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
            totalTokens: res.usage.total_tokens,
          }
        : undefined,
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// OpenAI Provider (fetch-based, throws if no API key)
// ────────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const
  readonly defaultModel = 'gpt-4o-mini'
  private readonly apiKey: string | undefined
  private readonly baseUrl: string

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY
    this.baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  async chat(messages: ChatMessage[], opts: LLMChatOptions = {}): Promise<LLMChatResult> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is not set — cannot use OpenAIProvider')
    }
    const body: Record<string, unknown> = {
      model: opts.model ?? this.defaultModel,
      messages: opts.system
        ? [{ role: 'system', content: opts.system }, ...messages]
        : messages,
      stream: false,
    }
    if (typeof opts.temperature === 'number') body.temperature = opts.temperature
    if (opts.maxTokens) body.max_tokens = opts.maxTokens

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`OpenAI API error ${res.status}: ${text.slice(0, 500)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    return {
      content,
      model: json.model ?? (body.model as string),
      provider: this.name,
      raw: json,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// xAI (Grok) Provider
// ────────────────────────────────────────────────────────────────────

export class XAIProvider implements LLMProvider {
  readonly name = 'xai' as const
  readonly defaultModel = 'grok-2-latest'
  private readonly apiKey: string | undefined
  private readonly baseUrl: string

  constructor() {
    this.apiKey = process.env.XAI_API_KEY
    this.baseUrl = process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1'
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey)
  }

  async chat(messages: ChatMessage[], opts: LLMChatOptions = {}): Promise<LLMChatResult> {
    if (!this.apiKey) {
      throw new Error('XAI_API_KEY is not set — cannot use XAIProvider')
    }
    const body: Record<string, unknown> = {
      model: opts.model ?? this.defaultModel,
      messages: opts.system
        ? [{ role: 'system', content: opts.system }, ...messages]
        : messages,
      stream: false,
    }
    if (typeof opts.temperature === 'number') body.temperature = opts.temperature
    if (opts.maxTokens) body.max_tokens = opts.maxTokens

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`xAI API error ${res.status}: ${text.slice(0, 500)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    return {
      content,
      model: json.model ?? (body.model as string),
      provider: this.name,
      raw: json,
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          }
        : undefined,
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Ollama Provider (local — fetch to localhost:11434)
// ────────────────────────────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const
  readonly defaultModel = 'llama3.1:8b'
  private readonly baseUrl: string

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' })
      return res.ok
    } catch {
      return false
    }
  }

  async chat(messages: ChatMessage[], opts: LLMChatOptions = {}): Promise<LLMChatResult> {
    const body: Record<string, unknown> = {
      model: opts.model ?? this.defaultModel,
      messages: opts.system
        ? [{ role: 'system', content: opts.system }, ...messages]
        : messages,
      stream: false,
    }
    if (typeof opts.temperature === 'number') body.options = { temperature: opts.temperature }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 500)}`)
    }
    const json = (await res.json()) as {
      message?: { content?: string }
      model?: string
      prompt_eval_count?: number
      eval_count?: number
    }
    const content = json.message?.content ?? ''
    return {
      content,
      model: json.model ?? (body.model as string),
      provider: this.name,
      raw: json,
      usage: {
        promptTokens: json.prompt_eval_count,
        completionTokens: json.eval_count,
        totalTokens:
          (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0) || undefined,
      },
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Provider registry & factory
// ────────────────────────────────────────────────────────────────────

const _zai = new ZaiProvider()
const _openai = new OpenAIProvider()
const _xai = new XAIProvider()
const _ollama = new OllamaProvider()

const REGISTRY: Record<LLMProviderName, LLMProvider> = {
  zai: _zai,
  openai: _openai,
  xai: _xai,
  ollama: _ollama,
}

/**
 * Resolve the LLM provider to use.
 *
 * Resolution order:
 *   1. Explicit `name` argument
 *   2. `LLM_PROVIDER` env var
 *   3. Default: `'zai'`
 *
 * @throws Error if `name` is unknown or the resolved provider requires
 *         credentials that aren't configured (only for providers that need
 *         them — ZAI and Ollama work without explicit keys).
 */
export function getLLMProvider(name?: LLMProviderName | string): LLMProvider {
  const resolved = (name ?? process.env.LLM_PROVIDER ?? 'zai') as LLMProviderName
  const provider = REGISTRY[resolved]
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${resolved}. Valid: ${Object.keys(REGISTRY).join(', ')}`)
  }
  // Eager validation for credential-based providers
  if (provider.name === 'openai' && !(provider as OpenAIProvider).isAvailable()) {
    throw new Error('OpenAI provider selected but OPENAI_API_KEY is not set')
  }
  if (provider.name === 'xai' && !(provider as XAIProvider).isAvailable()) {
    throw new Error('xAI provider selected but XAI_API_KEY is not set')
  }
  return provider
}

/**
 * List all known providers with their availability status.
 * Useful for the /api/llm/providers health endpoint and the admin UI.
 */
export function getAvailableProviders(): { name: LLMProviderName; available: boolean; defaultModel: string }[] {
  return (Object.keys(REGISTRY) as LLMProviderName[]).map((name) => {
    const p = REGISTRY[name]
    let available = true
    if (p instanceof OpenAIProvider) available = p.isAvailable()
    else if (p instanceof XAIProvider) available = p.isAvailable()
    // ZAI and Ollama are considered available without explicit key checks here.
    // For Ollama, do an async probe separately if needed.
    return { name, available, defaultModel: p.defaultModel }
  })
}

/**
 * Convenience: chat using the resolved provider in a single call.
 *
 * @example
 * ```ts
 * import { chat } from '@/lib/llm'
 * const { content } = await chat([{ role: 'user', content: 'Hola' }], { provider: 'zai' })
 * ```
 */
export async function chat(
  messages: ChatMessage[],
  opts: LLMChatOptions & { provider?: LLMProviderName | string } = {},
): Promise<LLMChatResult> {
  const { provider, ...rest } = opts
  const llm = getLLMProvider(provider)
  return llm.chat(messages, rest)
}

// Re-export ChatMessage type for callers
export type { ChatMessage }
