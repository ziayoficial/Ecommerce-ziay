// IA-2 — Agent evaluation: quote agent
//
// Five test cases covering the quote (pricing + cross-sell) agent. The
// quote agent reads `ctx.items` + `ctx.perfil` + the tenant's volume
// price table, and returns a quote in the format:
//   "[cantidad] [producto] + [cantidad] [producto]: pagas $[total] →
//    vendes $[venta] → te sobran $[margen] limpios"
//
// Mock strategy mirrors profile.test.ts: mock `@/lib/db` so the prompt
// builder resolves a fake tenant + fake products + fake volume prices.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock: DB ─────────────────────────────────────────────────────────────
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't-test',
        slug: 'test-tenant',
        nombreNegocio: 'Test Negocio',
        planMonetizacion: 'catalogo_incluido',
      }),
    },
    product: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        // Return a fake product whose SKU matches the lookup key.
        const sku = where?.tenantId_sku?.sku ?? where?.sku
        if (!sku) return null
        return {
          id: `p-${sku}`,
          tenantId: 't-test',
          sku,
          name: `Producto ${sku}`,
          price: 16500,
        }
      }),
    },
    volumePrice: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'vp-1',
          tenantId: 't-test',
          productId: 'p-PIJ-001',
          tipoCliente: 'mayorista',
          cantidadMinima: 6,
          cantidadMaxima: 20,
          precioUnitario: 14500,
        },
        {
          id: 'vp-2',
          tenantId: 't-test',
          productId: 'p-PIJ-001',
          tipoCliente: 'mayorista',
          cantidadMinima: 21,
          cantidadMaxima: 100,
          precioUnitario: 12500,
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
  evaluateWithLLMJudge,
  JUDGE_CRITERIA,
  type AgentTestCase,
} from '@/lib/agents/evaluation'

const TENANT_ID = 't-test'

// ── Test cases ────────────────────────────────────────────────────────────
// Five cases covering: single-SKU quote, multi-SKU quote, mayorista
// margin format, invalid SKU handling, and price-table consultation.

const CASES: AgentTestCase[] = [
  {
    name: 'quote-single-sku-mayorista',
    agentName: 'quote',
    input: {
      tenantId: TENANT_ID,
      perfil: 'mayorista',
      items: [{ sku: 'PIJ-001', cantidad: 10 }],
    },
    expectedPromptContains: ['PIJ-001', '16500', 'cotización'],
    rubric: [
      { criterion: 'Menciona el SKU cotizado', weight: 0.4 },
      { criterion: 'Consulta la tabla de precios por volumen', weight: 0.4 },
      { criterion: 'Formato mayorista: pagas → vendes → sobran', weight: 0.2 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'quote-multi-sku',
    agentName: 'quote',
    input: {
      tenantId: TENANT_ID,
      perfil: 'mayorista',
      items: [
        { sku: 'PIJ-001', cantidad: 10 },
        { sku: 'PIJ-002', cantidad: 6 },
      ],
    },
    expectedPromptContains: ['PIJ-001', 'PIJ-002', 'cotización'],
    rubric: [
      { criterion: 'Lista todos los SKUs del carrito', weight: 0.5 },
      { criterion: 'Suma el total a pagar', weight: 0.3 },
      { criterion: 'No mezcla precios entre referencias', weight: 0.2 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'quote-volume-tramo',
    agentName: 'quote',
    input: {
      tenantId: TENANT_ID,
      perfil: 'mayorista',
      items: [{ sku: 'PIJ-001', cantidad: 25 }],
    },
    expectedPromptContains: ['PIJ-001', '12500'], // second tramo (21-100)
    rubric: [
      { criterion: 'Aplica el tramo correcto para 25 unidades', weight: 0.6 },
      { criterion: 'No inventa precios fuera de la tabla', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'quote-invalid-sku',
    agentName: 'quote',
    input: {
      tenantId: TENANT_ID,
      perfil: 'detal',
      items: [{ sku: 'NO-EXIST', cantidad: 1 }],
    },
    expectedPromptContains: ['NO EXISTE', 'NO-EXIST'],
    rubric: [
      { criterion: 'Informa explícitamente que el SKU no existe', weight: 0.7 },
      { criterion: 'No inventa un precio para un SKU desconocido', weight: 0.3 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'quote-no-inventa-precios',
    agentName: 'quote',
    input: {
      tenantId: TENANT_ID,
      perfil: 'detal',
      items: [{ sku: 'PIJ-001', cantidad: 1 }],
    },
    expectedPromptContains: ['PIJ-001', 'precio'],
    rubric: [
      { criterion: 'Solo usa precios que existen en la tabla', weight: 0.5 },
      { criterion: 'Respeta el perfil detal (sin margen)', weight: 0.3 },
      { criterion: 'No dice descuento (regla N01)', weight: 0.2 },
    ],
    maxLatencyMs: 5000,
  },
]

// ── Prompt-assertion tests (run in CI without LLM_API_KEY) ────────────────
describe('Agent evaluation — quote (prompt assertions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(CASES)('builds a prompt that satisfies case "$name"', async (testCase) => {
    const { system, user } = await buildAgentPrompt('quote', testCase.input as never)
    const fullPrompt = system + '\n' + user

    expect(fullPrompt.toLowerCase()).toContain('cotización')
    for (const substr of testCase.expectedPromptContains ?? []) {
      expect(fullPrompt.toLowerCase()).toContain(substr.toLowerCase())
    }
  })

  it('quote prompt includes the volume-price info per SKU', async () => {
    const { user } = await buildAgentPrompt('quote', {
      tenantId: TENANT_ID,
      perfil: 'mayorista',
      items: [{ sku: 'PIJ-001', cantidad: 10 }],
    } as never)
    // The builder fetches the product + the volume tramos and injects
    // them into the user message — the LLM uses these to format the quote.
    expect(user).toContain('PIJ-001')
    expect(user).toContain('16500') // base price
    expect(user).toContain('14500') // first-tramo price
  })
})

// ── Rubric + assertion tests on canned outputs (no LLM call) ──────────────
describe('Agent evaluation — quote (assertions on canned outputs)', () => {
  it('accepts a quote that contains the SKU + total', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['PIJ-001', '145000'] },
      '10 short PIJ-001: pagas $145000 → vendes $250000 → te sobran $105000 limpios',
      100,
    )
    expect(errors).toEqual([])
  })

  it('flags an output that invents a price not in the table', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedNotContains: ['999999'] },
      '10 PIJ-001: pagas $999999',
      100,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('scores rubric with weighted average', () => {
    const scores = scoreRubric(
      'PIJ-001 cotizado con tabla de volumen, formato mayorista, sin descuento',
      CASES[0].rubric!,
    )
    const overall = computeOverallScore(scores)
    expect(overall).toBeGreaterThan(0)
    expect(overall).toBeLessThanOrEqual(1)
  })
})

// ── LLM-call tests (skipped in CI without LLM_API_KEY) ────────────────────
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — quote (live LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: '10 short PIJ-001: pagas $145000 → vendes $250000 → te sobran $105000 limpios',
      model: 'glm-4.6-plus',
      provider: 'zai',
      usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
    })
  })

  it('calls the LLM and asserts the quote format', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const { system, user } = await buildAgentPrompt('quote', CASES[0].input as never)
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['PIJ-001'] },
      result.content,
      100,
    )
    expect(errors).toEqual([])
  })
})

// ── IA-6B (Gap 6) — LLM-as-judge tests (skipped in CI without LLM_API_KEY) ──
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — quote (LLM-as-judge)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: JSON.stringify({
        scores: {
          relevance: 0.95,
          accuracy: 0.9,
          tone: 0.85,
          completeness: 0.95,
          safety: 1.0,
        },
        reasoning: 'Quote includes SKU + correct volume-tramo price.',
      }),
      model: 'glm-4.6-plus',
      provider: 'zai',
      usage: { promptTokens: 500, completionTokens: 80, totalTokens: 580 },
    })
  })

  it('parses the judge JSON response and returns per-criterion scores', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const judgeResult = await evaluateWithLLMJudge(
      CASES[0],
      '10 short PIJ-001: pagas $145000 → vendes $250000 → te sobran $105000 limpios',
      {
        callJudge: async (system, user) => {
          const result = await chat(
            [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            { model: 'glm-4.6-plus' },
          )
          return { content: result.content, usage: result.usage }
        },
      },
    )

    expect(judgeResult.parsed).toBe(true)
    expect(judgeResult.score).toBeGreaterThan(0)
    expect(judgeResult.score).toBeLessThanOrEqual(1)
    expect(judgeResult.rubricScores).toHaveLength(JUDGE_CRITERIA.length)
    // Equal-weight average: (0.95 + 0.9 + 0.85 + 0.95 + 1.0) / 5 = 0.93
    expect(judgeResult.score).toBeCloseTo(0.93, 1)
    expect(judgeResult.reasoning.length).toBeGreaterThan(0)
  })

  it('returns parsed=false when the judge response is unparseable', async () => {
    chatMock.mockResolvedValueOnce({
      content: 'No JSON here.',
      model: 'glm-4.6-plus',
      provider: 'zai',
    })
    const { chat } = await import('@/lib/llm/adapter')
    const judgeResult = await evaluateWithLLMJudge(CASES[0], 'test output', {
      callJudge: async (system, user) => {
        const result = await chat(
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          { model: 'glm-4.6-plus' },
        )
        return { content: result.content }
      },
    })

    expect(judgeResult.parsed).toBe(false)
    expect(judgeResult.score).toBe(0)
    expect(judgeResult.rubricScores).toEqual([])
  })
})
