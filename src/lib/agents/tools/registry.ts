// ZIAY — Agent Tool Registry (IA-5 · tool-use)
//
// Function-calling registry that agents can use to invoke real tools
// (DB queries, logistics quotes, memory recall, etc.) during an LLM turn.
// Closes the gap surfaced by the IA-5 audit: previously the agents only
// had "tools" baked into their prompt-builder (DB lookups that fed the
// system prompt statically). There was no LLM-driven function calling,
// no parallel tool invocations, no permission scoping. This module
// provides that layer:
//
//   - `AgentTool`           — declarative tool definition (name, schema,
//                              handler, allowedAgents, timeout).
//   - `ToolRegistry`        — singleton registry with `register`, `get`,
//                              `list`, `listForAgent`, and `execute`.
//   - `ToolContext`         — tenant-isolated execution context (always
//                              filters by `tenantId`).
//   - `ToolResult`          — structured success/error + latency.
//
// Design notes:
//
//   - Tenant isolation is the contract. Every `handler` MUST scope its
//     DB queries by `ctx.tenantId`. The registry does not enforce this
//     itself (it can't introspect the handler's queries), but the
//     built-ins (`builtins.ts`) all do it and any third-party tool
//     registered later must follow the same rule.
//
//   - Permission scoping is enforced centrally: `execute()` checks the
//     agent name against `tool.allowedAgents` BEFORE running the handler.
//     A misconfigured agent that tries to call a tool it isn't allowed
//     to use gets a structured `ToolResult.error` (not a throw) so the
//     LLM conversation can continue with the rejection as context.
//
//   - Timeouts are per-tool (`tool.timeout`, default 5s). The registry
//     wraps the handler call in `Promise.race` with a timeout promise.
//     On timeout, the tool returns `{ success: false, error: 'timeout',
//     latencyMs: <timeout> }` — the LLM gets the structured error.
//
//   - The registry never throws. Every failure (unknown tool, permission
//     denied, validation error, timeout, handler exception) is surfaced
//     as a `ToolResult` with `success: false`. This matches the
//     conversation-loop requirement: a tool failure must never crash
//     the agent turn, it must be fed back to the LLM so it can adapt.
//
//   - The registry is a singleton (`toolRegistry` export). The built-in
//     tools in `builtins.ts` register themselves on first import
//     (idempotent — `register` is a no-op if the name already exists).
//     Tests can construct their own `new ToolRegistry()` instance for
//     isolation.
//
// IA-5 (tool-use)

import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import type { z } from 'zod'

const log = getLogger('agent:tools')

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

/**
 * JSON-schema-ish parameter descriptor for a tool. Mirrors the OpenAI
 * function-calling `parameters` shape (subset) so the LLM gets a familiar
 * contract regardless of the underlying provider.
 *
 *   - `type`         — JSON schema type ('string' | 'number' | 'boolean' | 'array' | 'object').
 *   - `description`  — natural-language description for the LLM.
 *   - `required`     — whether the parameter must be present.
 *   - `enum`         — enumerated values (for string parameters).
 *
 * The full JSON schema is built dynamically by `toolToFunctionSchema()`
 * (see `llm-tools.ts`) — this interface is the developer-facing shorthand.
 */
export interface ToolParameter {
  type: string
  description: string
  required?: boolean
  enum?: string[]
  /** For array/object types — the nested item/property schema (same shape). */
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
}

/**
 * Tenant-isolated execution context. Every tool handler receives this
 * and MUST scope its DB queries by `tenantId`. The `conversationId`,
 * `customerId`, and `userId` are optional metadata tools can use for
 * richer context (e.g. `recall_memory` needs `customerId`).
 */
export interface ToolContext {
  tenantId: string
  conversationId?: string
  customerId?: string
  userId?: string
}

/**
 * Structured tool execution result. Always returned (never thrown).
 * `latencyMs` is always present so the agent's tracing layer can record
 * the per-tool cost.
 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  latencyMs: number
  /** When the tool timed out — surfaced distinctly so the LLM can retry
   *  with different params instead of giving up. */
  timedOut?: boolean
}

/**
 * A registered tool. Tools are immutable once registered (re-registering
 * with the same name is a no-op — keeps the registry idempotent).
 */
export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  handler: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
  /** Agent names allowed to invoke this tool. Empty array = deny all
   *  (must be explicitly populated by the tool author). */
  allowedAgents: string[]
  /** Per-call timeout in milliseconds. Default 5000 (5s). */
  timeout: number
  /** Optional Zod schema for parameter validation. When provided, the
   *  registry validates `params` BEFORE calling the handler. Validation
   *  failures become `ToolResult.error` (not throws). */
  schema?: z.ZodType<Record<string, unknown>>
}

// ───────────────────────────────────────────────────────────────────────────
// ToolRegistry
// ───────────────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, AgentTool>()

  /**
   * Register a tool. Idempotent — re-registering with the same name is
   * a no-op (logged at debug). This lets `builtins.ts` be imported
   * multiple times (e.g. across hot reloads in dev) without bloating
   * the registry.
   */
  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      log.debug({ tool: tool.name }, 'tool already registered — skipping')
      return
    }
    this.tools.set(tool.name, tool)
    log.debug({ tool: tool.name, allowedAgents: tool.allowedAgents, timeout: tool.timeout }, 'tool registered')
  }

  /** Look up a tool by name. Returns undefined when not registered. */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  /** List all registered tools. */
  list(): AgentTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * List tools available to a specific agent. Used by the LLM-calling
   * layer to build the `functions` array passed to the model — only
   * tools the agent is allowed to call are surfaced.
   */
  listForAgent(agentName: string): AgentTool[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.allowedAgents.includes(agentName),
    )
  }

  /**
   * Execute a tool by name. The registry enforces:
   *   1. The tool exists (else `error: 'unknown tool'`).
   *   2. The agent name (from `ctx`) is in `allowedAgents` (else
   *      `error: 'permission denied'`). When `ctx` carries no agent
   *      hint, the call is allowed — the caller (orchestrator/agent
   *      route) is responsible for setting `ctx.__agentName` before
   *      invoking tools on behalf of an LLM.
   *   3. Params validate against the tool's Zod schema (if provided).
   *   4. The handler completes within `tool.timeout` ms (else
   *      `error: 'timeout'`, `timedOut: true`).
   *
   * NEVER throws — every failure path returns a `ToolResult` so the
   * calling LLM conversation loop can keep going with the error as
   * context (matching the function-calling convention where a tool
   * error is a structured response, not an exception).
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
    ctx: ToolContext & { __agentName?: string },
  ): Promise<ToolResult> {
    const start = Date.now()
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        error: `unknown tool: ${name}`,
        latencyMs: Date.now() - start,
      }
    }

    // Permission check — when the caller passes an agent name (via the
    // private `__agentName` slot the orchestrator injects), enforce the
    // allowedAgents list. Without an agent hint we allow the call
    // (trust the caller — used by admin/debug endpoints).
    if (ctx.__agentName && !tool.allowedAgents.includes(ctx.__agentName)) {
      log.warn(
        { tool: name, agent: ctx.__agentName, tenantId: ctx.tenantId },
        'tool permission denied — agent not in allowedAgents',
      )
      return {
        success: false,
        error: `permission denied: agent '${ctx.__agentName}' cannot use tool '${name}'`,
        latencyMs: Date.now() - start,
      }
    }

    // Parameter validation (when a Zod schema is provided).
    if (tool.schema) {
      const parsed = tool.schema.safeParse(params)
      if (!parsed.success) {
        const errMsg = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        return {
          success: false,
          error: `invalid params: ${errMsg}`,
          latencyMs: Date.now() - start,
        }
      }
      // Replace `params` with the validated + defaulted version.
      params = parsed.data
    }

    // Handler execution with timeout.
    try {
      const result = await Promise.race([
        tool.handler(params, ctx),
        new Promise<ToolResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: false,
                error: `timeout after ${tool.timeout}ms`,
                latencyMs: tool.timeout,
                timedOut: true,
              }),
            tool.timeout,
          ),
        ),
      ])
      // Defensive: if the handler returned without `latencyMs`, fill it in.
      if (result.latencyMs === undefined) {
        result.latencyMs = Date.now() - start
      }
      return result
    } catch (err) {
      captureError(err as Error, {
        service: 'agent-tools',
        method: 'registry.execute',
        tool: name,
        tenantId: ctx.tenantId,
      })
      return {
        success: false,
        error: err instanceof Error ? err.message : 'unknown tool error',
        latencyMs: Date.now() - start,
      }
    }
  }

  /**
   * Test-only: clear all registered tools. Used by the test suite to
   * isolate test runs from the production built-ins. Not part of the
   * public API — exported for tests.
   */
  clearForTesting(): void {
    this.tools.clear()
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Singleton registry
// ───────────────────────────────────────────────────────────────────────────

/**
 * Singleton tool registry. The built-in tools (in `builtins.ts`)
 * self-register on first import — any module that wants to use the
 * registry just imports `toolRegistry` and the built-ins are ready.
 *
 * Tests that need isolation should construct their own
 * `new ToolRegistry()` instead of using this singleton.
 */
export const toolRegistry = new ToolRegistry()

/**
 * Permission matrix mapping each tool to the agents allowed to invoke
 * it. Single source of truth — `builtins.ts` imports this and applies
 * it when registering each tool. Keeping it here (next to the registry)
 * makes it easy to audit "who can call what" without grepping the
 * individual tool definitions.
 *
 * Rationale per row:
 *   - search_catalog → catalog + quote — both need product discovery.
 *   - get_product    → catalog + quote + checkout — read access for
 *     three revenue-critical agents.
 *   - calculate_quote → quote — only the quote agent prices orders.
 *   - check_stock    → catalog + quote + checkout — informs stock-aware
 *     replies at three points in the funnel.
 *   - validate_address → address — only the address agent validates.
 *   - calculate_shipping → logistics + quote — both compute freight.
 *   - get_customer_history → profile + quote + objection — context for
 *     opening + closing + objection handling.
 *   - recall_memory → quote + objection + address + checkout + speech —
 *     the five agents that benefit most from long-term memory.
 *   - create_order → checkout — only checkout can create a draft order.
 *   - check_budget → governor — the governor is the budget gatekeeper.
 */
export const TOOL_PERMISSIONS: Record<string, string[]> = {
  search_catalog: ['catalog', 'quote'],
  get_product: ['catalog', 'quote', 'checkout'],
  calculate_quote: ['quote'],
  check_stock: ['catalog', 'quote', 'checkout'],
  validate_address: ['address'],
  calculate_shipping: ['logistics', 'quote'],
  get_customer_history: ['profile', 'quote', 'objection'],
  recall_memory: ['quote', 'objection', 'address', 'checkout', 'speech'],
  create_order: ['checkout'],
  check_budget: ['governor'],
}
