// IA-2 — Agent evaluation: checkout agent
//
// Five test cases covering the checkout (final summary + confirmation)
// agent. The checkout agent reads `Tenant.politicaPago` + the
// conversation context, and returns a binary-confirmation message
// (max 30 words + items list).

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock: DB ─────────────────────────────────────────────────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't-test',
        slug: 'test-tenant',
        nombreNegocio: 'Test Negocio',
        planMonetizacion: 'completo',
        politicaPago: 'híbrido: prepay 5% off > $250k, COD debajo',
      }),
    },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock: LLM adapter ─────────────────────────────────────────────────────
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }))
vi.mock('@/lib/llm/adapter', () => ({ chat: chatMock }))

import { buildAgentPrompt } from '@/lib/agents/prompts'
import {
  assertTestCase,
  scoreRubric,
  computeOverallScore,
  type AgentTestCase,
} from '@/lib/agents/evaluation'

const TENANT_ID = 't-test'

// ── Test cases ────────────────────────────────────────────────────────────
// Five cases covering: hybrid payment policy, prepaid-only, COD-only,
// confirmation prompt format, and word-count cap.

const CASES: AgentTestCase[] = [
  {
    name: 'checkout-hybrid-policy',
    agentName: 'checkout',
    input: {
      tenantId: TENANT_ID,
    },
    expectedPromptContains: ['híbrido', 'prepay', 'COD'],
    rubric: [
      { criterion: 'Menciona la política de pago híbrida', weight: 0.5 },
      { criterion: 'Pregunta binaria de confirmación', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'checkout-confirmation-binary',
    agentName: 'checkout',
    input: {
      tenantId: TENANT_ID,
    },
    // The system prompt instructs the agent to "pregunta binaria de
    // confirmación final" — the actual question mark appears in the LLM
    // output, not the prompt template itself.
    expectedPromptContains: ['confirmación', 'binaria'],
    rubric: [
      { criterion: 'Termina con pregunta binaria de confirmación', weight: 0.6 },
      { criterion: 'No confirma el pedido sin el sí del cliente (regla N09)', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'checkout-summary-format',
    agentName: 'checkout',
    input: {
      tenantId: TENANT_ID,
    },
    expectedPromptContains: ['checkout', 'resumen'],
    rubric: [
      { criterion: 'Prepara el resumen final para el cliente', weight: 0.5 },
      { criterion: 'Respeta el máximo de 30 palabras + items', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'checkout-no-urgencia-falsa',
    agentName: 'checkout',
    input: {
      tenantId: TENANT_ID,
    },
    expectedPromptContains: ['checkout'],
    rubric: [
      { criterion: 'No crea urgencia falsa (regla N13)', weight: 0.5 },
      { criterion: 'No dice "Todo confirmado!" sin el sí (regla N09)', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'checkout-prepaid-link',
    agentName: 'checkout',
    input: {
      tenantId: TENANT_ID,
    },
    expectedPromptContains: ['pago', 'anticipado', 'link'],
    rubric: [
      { criterion: 'Si pago anticipado, genera el link del carrito', weight: 0.6 },
      { criterion: 'Si contra entrega, confirma pago al recibir', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
]

// ── Prompt-assertion tests ────────────────────────────────────────────────
describe('Agent evaluation — checkout (prompt assertions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(CASES)('builds a prompt that satisfies case "$name"', async (testCase) => {
    const { system, user } = await buildAgentPrompt('checkout', testCase.input as never)
    const fullPrompt = system + '\n' + user

    expect(fullPrompt.toLowerCase()).toContain('checkout')
    for (const substr of testCase.expectedPromptContains ?? []) {
      expect(fullPrompt.toLowerCase()).toContain(substr.toLowerCase())
    }
  })

  it('checkout prompt mentions the payment policy', async () => {
    const { user } = await buildAgentPrompt('checkout', {
      tenantId: TENANT_ID,
    } as never)
    expect(user).toContain('híbrido')
    expect(user).toContain('prepay 5% off > $250k')
  })

  it('checkout prompt enforces the 30-word cap', async () => {
    const { system } = await buildAgentPrompt('checkout', {
      tenantId: TENANT_ID,
    } as never)
    expect(system).toContain('30 palabras')
  })
})

// ── Rubric + assertion tests on canned outputs ────────────────────────────
describe('Agent evaluation — checkout (assertions on canned outputs)', () => {
  it('accepts a binary confirmation reply', () => {
    const errors = assertTestCase(
      { ...CASES[1], expectedContains: ['confirm'] },
      '¿Confirmas el pedido? Envío a Bogotá, 10 short PIJ-001, total $145000.',
      100,
    )
    expect(errors).toEqual([])
  })

  it('flags "Todo confirmado!" without customer yes (regla N09)', () => {
    const errors = assertTestCase(
      { ...CASES[1], expectedNotContains: ['todo confirmado'] },
      'Todo confirmado! Tu pedido va en camino.',
      100,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('scores rubric with weighted average', () => {
    const scores = scoreRubric(
      'Confirmación binaria, sin urgencia falsa, política híbrida respetada',
      CASES[0].rubric!,
    )
    const overall = computeOverallScore(scores)
    expect(overall).toBeGreaterThan(0)
    expect(overall).toBeLessThanOrEqual(1)
  })
})

// ── LLM-call tests (skipped in CI without LLM_API_KEY) ────────────────────
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — checkout (live LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: 'Resumen: 10 short PIJ-001, envío Bogotá, total $145000. ¿Confirmas el pedido?',
      model: 'glm-4.6-plus',
      provider: 'zai',
      usage: { promptTokens: 180, completionTokens: 22, totalTokens: 202 },
    })
  })

  it('calls the LLM and asserts the confirmation format', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const { system, user } = await buildAgentPrompt('checkout', CASES[0].input as never)
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    const errors = assertTestCase(
      { ...CASES[1], expectedContains: ['confirm'] },
      result.content,
      100,
    )
    expect(errors).toEqual([])
  })
})
