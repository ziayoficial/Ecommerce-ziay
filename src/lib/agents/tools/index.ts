// ZIAY — Agent Tools barrel (IA-5 · tool-use)
//
// Single import point for the tool registry + built-ins + LLM wiring.
// Importing this module triggers the eager registration of all 10
// built-in tools on the singleton `toolRegistry`.

export {
  toolRegistry,
  ToolRegistry,
  TOOL_PERMISSIONS,
  type AgentTool,
  type ToolContext,
  type ToolResult,
  type ToolParameter,
} from './registry'

export {
  BUILTIN_TOOLS,
  registerBuiltins,
} from './builtins'

export {
  toolsToSystemPrompt,
  extractToolCalls,
  stripToolCalls,
  runToolLoop,
  runToolLoopWithResilience,
  MAX_TOOL_CALLS_PER_TURN,
  type ToolLoopResult,
  type ResilientToolLoopResult,
  type ParsedToolCall,
} from './llm-tools'
