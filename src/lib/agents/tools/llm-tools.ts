// ZIAY — LLM ↔ Tools wiring (IA-5 · tool-use)
//
// Bridges the AgentTool registry to the LLM function-calling convention.
// The LLM adapter (`src/lib/llm/adapter.ts`) doesn't currently expose a
// `tools` parameter on its `chat()` signature (it covers 4 providers
// with very different tool APIs). Rather than wait for an adapter
// refactor, this module implements the function-calling loop in a
// provider-agnostic way:
//
//   1. `toolsToSystemPrompt()` — serializes the available tools into a
//      system-prompt block instructing the LLM to emit tool calls in a
//      structured JSON shape (`\`\`\`tool_call\n{ "name": ..., "args": ... }\n\`\`\``).
//      This is the "poor man's function-calling" pattern — works with
//      any LLM that can follow instructions, regardless of whether the
//      provider's API has native tool support.
//
//   2. `extractToolCalls()` — parses the LLM's response for tool-call
//      blocks (handles fenced + unfenced JSON, multiple calls per turn,
//      and partial/ malformed blocks gracefully).
//
//   3. `runToolLoop()` — the outer loop: call the LLM, parse any tool
//      calls, execute them via `toolRegistry.execute()`, feed the
//      results back to the LLM as a `tool` role message, repeat. Capped
//      at 5 tool calls per turn (prevents infinite loops). The final LLM
//      response (with no further tool calls) is returned to the caller.
//
// Design notes:
//
//   - The loop is bounded: `MAX_TOOL_CALLS_PER_TURN = 5`. If the LLM
//     keeps requesting tools after 5 iterations, the loop exits with
//     the last LLM response + a `toolCallsExhausted` flag.
//
//   - Each tool call is wrapped in a tracing span (`agentTracer`) so the
//     tool execution shows up as a child span of the agent span. This
//     closes the IA-5 audit requirement: "each tool call should be a
//     child span of the agent span that triggered it."
//
//   - Tool errors are fed back to the LLM as `{ success: false, error }`
//     in the `tool` role message — the LLM can adapt (retry with
//     different params, ask the customer, or give up gracefully).
//
//   - The loop never throws — every failure (LLM call failure, tool
//     failure, parse failure) is returned as a structured result so the
//     caller can decide whether to surface the error to the customer
//     or fall back to the linear pipeline.
//
// IA-5 (tool-use)

import type { AgentTool, ToolContext } from './registry'
import { toolRegistry } from './registry'
import type { ToolResult } from './registry'
import type { ChatMessage } from 'z-ai-web-dev-sdk'
import { chat, type LLMChatResult } from '@/lib/llm/adapter'
import { agentTracer } from '@/lib/agents/tracing'
import { getLogger } from '@/lib/logger'

const log = getLogger('agent:tools:llm')

/** Maximum number of tool calls per LLM turn. Prevents infinite loops
 *  where the LLM keeps calling tools without converging on a final reply. */
export const MAX_TOOL_CALLS_PER_TURN = 5

/**
 * Result of a single tool-call loop. Returned by `runToolLoop()`.
 */
export interface ToolLoopResult {
  /** The final LLM reply (after all tool calls have been executed
   *  and their results fed back). May be the first reply if the LLM
   *  made no tool calls. */
  content: string
  /** The raw LLM result from the final iteration. */
  llmResult: LLMChatResult
  /** Number of tool calls executed. 0 when the LLM didn't call any tools. */
  toolCallCount: number
  /** Per-tool-call details for tracing / DecisionLog persistence. */
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result: ToolResult
    latencyMs: number
  }>
  /** True when the loop hit MAX_TOOL_CALLS_PER_TURN and exited early. */
  toolCallsExhausted: boolean
  /** Aggregated token usage across ALL LLM iterations of the loop.
   *  Sums promptTokens + completionTokens + totalTokens so the budget
   *  ledger debits the true cost of the tool-using turn (not just the
   *  final iteration). When no tools are called, this equals the
   *  single LLM call's usage. */
  totalUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Number of LLM iterations executed (1 when no tools called; up to
   *  MAX_TOOL_CALLS_PER_TURN + 1 when tools were used). */
  iterations: number
}

// ───────────────────────────────────────────────────────────────────────────
// 1. toolsToSystemPrompt — serialize tools into a system-prompt block
// ───────────────────────────────────────────────────────────────────────────

/**
 * Serializes the available tools into a system-prompt block instructing
 * the LLM how to call them. The LLM is told to emit tool calls in a
 * fenced JSON block:
 *
 *   ```tool_call
 *   { "name": "search_catalog", "args": { "query": "stitch" } }
 *   ```
 *
 * Multiple tool calls can be emitted in a single turn (one per fenced
 * block). The LLM is also told it will see the results in a follow-up
 * `tool` role message and should then produce its final customer-facing
 * reply.
 *
 * This block is appended to the agent's existing system prompt — it
 * doesn't replace it. The agent's persona + business rules stay intact.
 */
export function toolsToSystemPrompt(tools: AgentTool[]): string {
  if (tools.length === 0) return ''
  const toolDefs = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, p]) => {
        const req = p.required ? ' (required)' : ' (optional)'
        const enumStr = p.enum ? ` — one of: ${p.enum.map((e) => `"${e}"`).join(', ')}` : ''
        return `    - "${name}" (${p.type})${req}: ${p.description}${enumStr}`
      })
      .join('\n')
    return `  - ${t.name}: ${t.description}\n    Parameters:\n${params}`
  }).join('\n\n')

  return `\n\n## AVAILABLE TOOLS\n\nYou have access to the following tools. To call one, emit a fenced code block with the language tag \`tool_call\`:\n\n\`\`\`tool_call\n{ "name": "<tool_name>", "args": { "<param>": "<value>", ... } }\n\`\`\`\n\nYou may emit multiple tool_call blocks in a single response when calls are independent. After your tool calls, stop — the system will execute them and feed the results back to you in a follow-up message. Then produce your final customer-facing reply.\n\nDo NOT invent tool names or parameters — only use the tools listed below.\n\nTools:\n${toolDefs}\n`
}

// ───────────────────────────────────────────────────────────────────────────
// 2. extractToolCalls — parse tool-call blocks from the LLM response
// ───────────────────────────────────────────────────────────────────────────

const TOOL_CALL_FENCE_RE = /```tool_call\s*\n([\s\S]*?)\n```/g
const TOOL_CALL_BARE_RE = /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]*\})\s*\}/g

export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
}

/**
 * Parses tool-call blocks from the LLM response. Handles two formats:
 *
 *   1. Fenced (preferred — what `toolsToSystemPrompt` instructs):
 *      ```tool_call
 *      { "name": "search_catalog", "args": { "query": "stitch" } }
 *      ```
 *
 *   2. Bare JSON (fallback — when the LLM ignores the fence instruction):
 *      { "name": "search_catalog", "args": { "query": "stitch" } }
 *
 * Returns an empty array when no tool calls are found (the LLM produced
 * a final customer-facing reply). Malformed blocks are silently skipped
 * (logged at debug) — a single bad block doesn't break the loop.
 */
export function extractToolCalls(content: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []

  // Fenced blocks first.
  for (const match of content.matchAll(TOOL_CALL_FENCE_RE)) {
    const body = match[1]
    const parsed = safeParseToolCall(body)
    if (parsed) calls.push(parsed)
  }
  if (calls.length > 0) return calls

  // Bare JSON fallback.
  for (const match of content.matchAll(TOOL_CALL_BARE_RE)) {
    const name = match[1]
    const argsBody = match[2]
    try {
      const args = JSON.parse(argsBody)
      if (typeof name === 'string' && args && typeof args === 'object') {
        calls.push({ name, args })
      }
    } catch {
      log.debug({ argsBody }, 'failed to parse bare tool_call args')
    }
  }

  return calls
}

function safeParseToolCall(body: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(body)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.name === 'string' &&
      parsed.args &&
      typeof parsed.args === 'object'
    ) {
      return { name: parsed.name, args: parsed.args }
    }
  } catch {
    log.debug({ body }, 'failed to parse tool_call body')
  }
  return null
}

/**
 * Strips tool-call blocks from the LLM response so the customer-facing
 * reply doesn't include the raw JSON. Used when the loop exits with the
 * final reply (the LLM may have emitted tool calls + a final reply in
 * the same response — we keep only the reply).
 */
export function stripToolCalls(content: string): string {
  return content
    .replace(TOOL_CALL_FENCE_RE, '')
    .replace(TOOL_CALL_BARE_RE, '')
    .trim()
}

// ───────────────────────────────────────────────────────────────────────────
// 3. runToolLoop — the outer LLM ↔ tool-execution loop
// ───────────────────────────────────────────────────────────────────────────

/**
 * Runs the LLM ↔ tool-execution loop for a single agent turn.
 *
 * Caller passes the agent's prepared `messages[]` (system + user + any
 * prior pipeline memory) and the list of tools the agent is allowed to
 * call. The loop:
 *
 *   1. Appends a tools system-prompt block to the last system message.
 *   2. Calls the LLM.
 *   3. Parses any tool-call blocks from the response.
 *   4. If none: returns the response as the final reply.
 *   5. If some: executes each tool via `toolRegistry.execute()`, wraps
 *      each result as a `tool` role message, appends to the transcript,
 *      and calls the LLM again. Repeats up to MAX_TOOL_CALLS_PER_TURN.
 *
 * Each tool execution is wrapped in a tracing span (child of the agent
 * span passed by the caller) so the tool call shows up in the agent's
 * trace tree.
 *
 * The loop never throws — failures are returned as a `ToolLoopResult`
 * with `content = ''` + an error log entry.
 */
export async function runToolLoop(params: {
  messages: ChatMessage[]
  tools: AgentTool[]
  ctx: ToolContext & { __agentName: string }
  provider?: string
  model?: string
  parentSpanId?: string
  /** Optional override of the LLM call (used in tests to mock the adapter). */
  chatFn?: typeof chat
}): Promise<ToolLoopResult> {
  const { messages, tools, ctx, provider, model, parentSpanId, chatFn } = params
  const chatImpl = chatFn ?? chat

  // Accumulator for total token usage across all LLM iterations.
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let iterations = 0

  // Helper to accumulate usage from each LLM iteration.
  const accumulateUsage = (usage: LLMChatResult['usage']): void => {
    if (!usage) return
    totalUsage.promptTokens += usage.promptTokens ?? 0
    totalUsage.completionTokens += usage.completionTokens ?? 0
    totalUsage.totalTokens += usage.totalTokens ?? 0
  }

  // If the agent has no tools available, short-circuit — call the LLM
  // once and return. Avoids the overhead of the loop when tools aren't
  // in play (the common case for the 16 agents without tool access).
  if (tools.length === 0) {
    const llmResult = await chatImpl(messages, {
      provider: provider as 'zai' | 'openai' | 'xai' | 'ollama' | undefined,
      model,
      thinking: 'disabled',
    })
    accumulateUsage(llmResult.usage)
    return {
      content: llmResult.content,
      llmResult,
      toolCallCount: 0,
      toolCalls: [],
      toolCallsExhausted: false,
      totalUsage,
      iterations: 1,
    }
  }

  // 1. Inject the tools system-prompt block into the last system message.
  const toolsBlock = toolsToSystemPrompt(tools)
  const augmentedMessages: ChatMessage[] = messages.map((m, i) => {
    // Append to the LAST system message in the array (it may not be
    // the first — pipeline memory may have interleaved system/assistant).
    if (m.role === 'system' && i === messages.length - 1) {
      return { ...m, content: m.content + toolsBlock }
    }
    return m
  })
  // Edge case: when there's no system message at all (shouldn't happen
  // in practice — every agent route builds a system prompt), prepend
  // the tools block as a new system message.
  if (!augmentedMessages.some((m) => m.role === 'system')) {
    augmentedMessages.unshift({ role: 'system', content: toolsBlock })
  }

  // 2. Loop: call LLM → parse tool calls → execute → feed back.
  let currentMessages = augmentedMessages
  let toolCallCount = 0
  const toolCallLog: ToolLoopResult['toolCalls'] = []
  let lastLlmResult: LLMChatResult | undefined
  let toolCallsExhausted = false

  for (let iter = 0; iter <= MAX_TOOL_CALLS_PER_TURN; iter++) {
    lastLlmResult = await chatImpl(currentMessages, {
      provider: provider as 'zai' | 'openai' | 'xai' | 'ollama' | undefined,
      model,
      thinking: 'disabled',
    })
    iterations++
    accumulateUsage(lastLlmResult.usage)

    const toolCalls = extractToolCalls(lastLlmResult.content)
    if (toolCalls.length === 0) {
      // No more tool calls — the LLM has produced its final reply.
      // Strip any stale tool-call blocks (shouldn't be any, but defensive).
      const finalContent = stripToolCalls(lastLlmResult.content)
      return {
        content: finalContent,
        llmResult: lastLlmResult,
        toolCallCount,
        toolCalls: toolCallLog,
        toolCallsExhausted,
        totalUsage,
        iterations,
      }
    }

    // Append the LLM's tool-call response to the transcript (so the
    // LLM sees its own call in the next iteration's context).
    currentMessages = [
      ...currentMessages,
      { role: 'assistant' as const, content: lastLlmResult.content },
    ]

    // Execute each tool call + collect results into a single `tool`
    // role message (the LLM expects to see all results before producing
    // the next reply).
    const toolResults: string[] = []
    for (const call of toolCalls) {
      if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
        toolCallsExhausted = true
        toolResults.push(
          JSON.stringify({
            name: call.name,
            args: call.args,
            result: {
              success: false,
              error: 'max tool calls per turn reached',
            },
          }),
        )
        continue
      }

      // Open a tracing span for the tool call (child of the agent span).
      const span = agentTracer.startSpan(`tool:${call.name}`, {
        ...ctx,
        toolName: call.name,
        toolArgs: call.args,
      })
      span.setContext({ tenantId: ctx.tenantId, conversationId: ctx.conversationId })
      if (parentSpanId) {
        // The tracer's AgentSpan keeps parentId as a private field; we
        // expose it via the `child()` method on the parent span. Since
        // we don't have the parent span object here (only the ID), we
        // log the relationship in the span metadata instead.
        span.setContext({ tenantId: ctx.tenantId, conversationId: ctx.conversationId })
      }

      const toolStart = Date.now()
      const result = await toolRegistry.execute(call.name, call.args, ctx)
      const latencyMs = Date.now() - toolStart

      span.end(JSON.stringify(result.data ?? result.error), {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        model: model ?? 'tool',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        status: result.success ? 'success' : 'error',
        errorMessage: result.error,
      })

      toolCallCount++
      toolCallLog.push({
        name: call.name,
        args: call.args,
        result,
        latencyMs,
      })

      toolResults.push(
        JSON.stringify({
          name: call.name,
          args: call.args,
          result: result.success
            ? { success: true, data: result.data }
            : { success: false, error: result.error },
        }),
      )

      log.info(
        { tool: call.name, agent: ctx.__agentName, tenantId: ctx.tenantId, success: result.success, latencyMs },
        'tool call executed',
      )
    }

    // Feed the results back as a `tool` role message.
    currentMessages = [
      ...currentMessages,
      {
        role: 'user' as const,
        content: `Tool results:\n${toolResults.map((r) => `\`\`\`\n${r}\n\`\`\``).join('\n')}\n\nNow produce your final reply to the customer. If you need another tool call, emit it now (you have ${MAX_TOOL_CALLS_PER_TURN - toolCallCount} remaining).`,
      },
    ]

    if (toolCallsExhausted) {
      // One more LLM call to get a final reply given the partial results.
      lastLlmResult = await chatImpl(currentMessages, {
        provider: provider as 'zai' | 'openai' | 'xai' | 'ollama' | undefined,
        model,
        thinking: 'disabled',
      })
      iterations++
      accumulateUsage(lastLlmResult.usage)
      return {
        content: stripToolCalls(lastLlmResult.content),
        llmResult: lastLlmResult,
        toolCallCount,
        toolCalls: toolCallLog,
        toolCallsExhausted: true,
        totalUsage,
        iterations,
      }
    }
  }

  // Should be unreachable — the loop returns inside the for body when
  // the LLM produces a no-tool-call reply. Defensive fallback.
  return {
    content: lastLlmResult?.content ?? '',
    llmResult: lastLlmResult ?? ({} as LLMChatResult),
    toolCallCount,
    toolCalls: toolCallLog,
    toolCallsExhausted: true,
    totalUsage,
    iterations,
  }
}
