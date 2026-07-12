// CommerceFlow OS — LLM Provider public API
//
// Re-exports everything from `./adapter` so callers do `import { ... } from '@/lib/llm'`.
//
// BUILD-AGENTS-LIB-001

export {
  ZaiProvider,
  OpenAIProvider,
  XAIProvider,
  OllamaProvider,
  getLLMProvider,
  getAvailableProviders,
  chat,
} from './adapter'

export type {
  LLMProviderName,
  LLMChatOptions,
  LLMChatResult,
  LLMProvider,
  ChatMessage,
} from './adapter'
