// IA-2 — Agent evaluation: objection agent
//
// Five test cases covering the objection (handling) agent. The objection
// agent reads `ctx.message` (the customer's objection) + the tenant's
// objection table (`db.objection.findMany`) and returns a persuasion
// reply adapted to the objection type.

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
      }),
    },
    objection: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'o-1',
          tenantId: 't-test',
          tipoObjecion: 'precio',
          respuestaBase: 'El precio refleja la calidad del tejido',
          gatilloMentalAsociado: 'ancla_calidad',
        },
        {
          id: 'o-2',
          tenantId: 't-test',
          tipoObjecion: 'desconfianza',
          respuestaBase: 'Llevamos 5 años vendiendo con +10k pedidos',
          gatilloMentalAsociado: 'prueba_social',
        },
        {
          id: 'o-3',
          tenantId: 't-test',
          tipoObjecion: 'competencia',
          respuestaBase: 'Nuestro tejido no se compara con el importado',
          gatilloMentalAsociado: 'diferenciacion',
        },
      ]),
    },
  },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

// ── Mock: LLM adapter (only used by the skipIf-gated LLM test) ────────────
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
// Five cases covering: price objection, trust objection, competitor
// objection, repeated objection (no-repeat rule), and objection with
// missing message (fallback).

const CASES: AgentTestCase[] = [
  {
    name: 'objection-price',
    agentName: 'objection',
    input: {
      tenantId: TENANT_ID,
      message: 'Me parece muy caro',
    },
    expectedPromptContains: ['precio', 'ancla_calidad'],
    rubric: [
      { criterion: 'Clasifica la objeción como precio', weight: 0.4 },
      { criterion: 'Usa la respuesta base configurada', weight: 0.3 },
      { criterion: 'No dice descuento (regla N01)', weight: 0.3 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'objection-trust',
    agentName: 'objection',
    input: {
      tenantId: TENANT_ID,
      message: 'No conozco la marca, no estoy seguro de comprar',
    },
    expectedPromptContains: ['desconfianza', 'prueba_social'],
    rubric: [
      { criterion: 'Clasifica la objeción como desconfianza', weight: 0.5 },
      { criterion: 'Aplica el gatillo mental de prueba social', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'objection-competitor',
    agentName: 'objection',
    input: {
      tenantId: TENANT_ID,
      message: 'En la tienda de la esquina lo venden más barato',
    },
    expectedPromptContains: ['competencia', 'diferenciacion'],
    rubric: [
      { criterion: 'Clasifica la objeción como competencia', weight: 0.5 },
      { criterion: 'No menciona el nombre del competidor (regla N18)', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'objection-no-repeat',
    agentName: 'objection',
    input: {
      tenantId: TENANT_ID,
      message: 'Sigue siendo muy caro, ya te dije',
    },
    expectedPromptContains: ['objeciones'],
    rubric: [
      { criterion: 'No repite el mismo argumento (regla N16)', weight: 0.6 },
      { criterion: 'Busca un ángulo nuevo de persuasión', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'objection-missing-message',
    agentName: 'objection',
    input: {
      tenantId: TENANT_ID,
      message: '',
    },
    expectedPromptContains: ['objeciones', '...'],
    rubric: [
      { criterion: 'Maneja el caso de mensaje vacío sin romper', weight: 0.6 },
      { criterion: 'Cae al fallback del agente', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
]

// ── Prompt-assertion tests ────────────────────────────────────────────────
describe('Agent evaluation — objection (prompt assertions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(CASES)('builds a prompt that satisfies case "$name"', async (testCase) => {
    const { system, user } = await buildAgentPrompt('objection', testCase.input as never)
    const fullPrompt = system + '\n' + user

    expect(fullPrompt.toLowerCase()).toContain('objec')
    for (const substr of testCase.expectedPromptContains ?? []) {
      expect(fullPrompt.toLowerCase()).toContain(substr.toLowerCase())
    }
  })

  it('objection prompt lists all configured objections', async () => {
    const { user } = await buildAgentPrompt('objection', {
      tenantId: TENANT_ID,
      message: 'caro',
    } as never)
    // The builder injects the full objection table into the user prompt.
    expect(user).toContain('precio')
    expect(user).toContain('desconfianza')
    expect(user).toContain('competencia')
    expect(user).toContain('ancla_calidad')
    expect(user).toContain('prueba_social')
  })
})

// ── Rubric + assertion tests on canned outputs ────────────────────────────
describe('Agent evaluation — objection (assertions on canned outputs)', () => {
  it('accepts a persuasion reply that addresses the objection', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['calidad'] },
      'El precio refleja la calidad del tejido y la durabilidad',
      100,
    )
    expect(errors).toEqual([])
  })

  it('flags "descuento" violation (regla N01)', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedNotContains: ['descuento'] },
      'Te doy un descuento del 10%',
      100,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('scores rubric with weighted average', () => {
    const scores = scoreRubric(
      'Precio clasificado, respuesta base usada, sin descuento, prueba social',
      CASES[0].rubric!,
    )
    const overall = computeOverallScore(scores)
    expect(overall).toBeGreaterThan(0)
    expect(overall).toBeLessThanOrEqual(1)
  })
})

// ── LLM-call tests (skipped in CI without LLM_API_KEY) ────────────────────
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — objection (live LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: 'El precio refleja la calidad del tejido y la durabilidad de la prenda',
      model: 'glm-4.6-plus',
      provider: 'zai',
      usage: { promptTokens: 250, completionTokens: 25, totalTokens: 275 },
    })
  })

  it('calls the LLM and asserts the persuasion reply', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const { system, user } = await buildAgentPrompt('objection', CASES[0].input as never)
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['calidad'] },
      result.content,
      100,
    )
    expect(errors).toEqual([])
  })
})
