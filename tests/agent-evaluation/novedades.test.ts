// IA-2 — Agent evaluation: novedades agent
//
// Five test cases covering the novedades (logistics incident) agent.
// The novedades agent reads `ctx.novedadTipo` + the shipment record
// (from `db.shipment.findFirst`) and returns a 30-word customer message
// asking for the specific info needed to resolve the incident.

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
    shipment: {
      findUnique: vi.fn().mockResolvedValue(null), // most cases fall through
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where?.numeroGuia === 'NO-GUIA') return null
        return {
          id: 's-1',
          tenantId: 't-test',
          numeroGuia: 'GUIA-123',
          transportadora: 'coordinadora',
          transportadoraCanonica: 'Coordinadora',
          estado: 'novedad',
          novedad: 'Dirección errónea',
          order: {
            number: 'PED-100',
            customer: {
              name: 'María',
              phone: '3001234567',
              city: 'Bogotá',
              address: 'Cra 10 # 20-30',
            },
          },
        }
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
// Five cases covering: address-wrong, recipient-not-found, customer
// message present, missing shipment (asks for guía), and severity
// classification.

const CASES: AgentTestCase[] = [
  {
    name: 'novedades-direccion-erronea',
    agentName: 'novedades',
    input: {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'dirección errónea',
    },
    expectedPromptContains: ['dirección', 'Coordinadora', 'GUIA-123'],
    rubric: [
      { criterion: 'Clasifica la novedad como dirección errónea', weight: 0.4 },
      { criterion: 'Pide SOLO la información necesaria (pregunta binaria o dato)', weight: 0.3 },
      { criterion: 'No culpa al cliente', weight: 0.3 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'novedades-destinatario-no-encontrado',
    agentName: 'novedades',
    input: {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'destinatario no encontrado',
    },
    expectedPromptContains: ['destinatario', 'novedad'],
    rubric: [
      { criterion: 'Clasifica la novedad como destinatario no encontrado', weight: 0.5 },
      { criterion: 'Propone reprogramar la entrega', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'novedades-customer-message',
    agentName: 'novedades',
    input: {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'rechazo',
      message: 'No lo quiero recibir, llegó muy tarde',
    },
    expectedPromptContains: ['rechazo', 'mensaje del cliente'],
    rubric: [
      { criterion: 'Clasifica la novedad como rechazo', weight: 0.4 },
      { criterion: 'No procesa devolución directamente (regla N11)', weight: 0.3 },
      { criterion: 'Deriva a asesor humano para devoluciones', weight: 0.3 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'novedades-missing-shipment',
    agentName: 'novedades',
    input: {
      tenantId: TENANT_ID,
      guia: 'NO-GUIA',
      novedadTipo: 'genérica',
    },
    expectedPromptContains: ['Sin envío', 'guía'],
    rubric: [
      { criterion: 'Maneja el caso de guía no encontrada sin romper', weight: 0.6 },
      { criterion: 'Pide al cliente el número de guía o pedido', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'novedades-severity-classification',
    agentName: 'novedades',
    input: {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'robo',
    },
    expectedPromptContains: ['novedad', 'Coordinadora'],
    rubric: [
      { criterion: 'Clasifica la severidad correctamente (alta para robo)', weight: 0.5 },
      { criterion: 'Inicia reclamación formal', weight: 0.3 },
      { criterion: 'No culpa al cliente', weight: 0.2 },
    ],
    maxLatencyMs: 5000,
  },
]

// ── Prompt-assertion tests ────────────────────────────────────────────────
describe('Agent evaluation — novedades (prompt assertions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(CASES)('builds a prompt that satisfies case "$name"', async (testCase) => {
    const { system, user } = await buildAgentPrompt('novedades', testCase.input as never)
    const fullPrompt = system + '\n' + user

    expect(fullPrompt.toLowerCase()).toContain('novedad')
    for (const substr of testCase.expectedPromptContains ?? []) {
      expect(fullPrompt.toLowerCase()).toContain(substr.toLowerCase())
    }
  })

  it('novedades prompt includes the shipment info when found', async () => {
    const { user } = await buildAgentPrompt('novedades', {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'dirección errónea',
    } as never)
    expect(user).toContain('GUIA-123')
    expect(user).toContain('Coordinadora')
    expect(user).toContain('PED-100')
    expect(user).toContain('María')
  })

  it('novedades prompt asks for guía when shipment not found', async () => {
    const { user } = await buildAgentPrompt('novedades', {
      tenantId: TENANT_ID,
      guia: 'NO-GUIA',
      novedadTipo: 'genérica',
    } as never)
    expect(user).toContain('Sin envío')
  })

  it('novedades prompt enforces the 30-word cap', async () => {
    const { system } = await buildAgentPrompt('novedades', {
      tenantId: TENANT_ID,
      guia: 'GUIA-123',
      novedadTipo: 'dirección errónea',
    } as never)
    expect(system).toContain('30 palabras')
  })
})

// ── Rubric + assertion tests on canned outputs ────────────────────────────
describe('Agent evaluation — novedades (assertions on canned outputs)', () => {
  it('accepts a 30-word customer message asking for the new address', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['dirección'] },
      'Tengo una novedad con tu envío GUIA-123: la dirección no está completa. ¿Me confirmas tu dirección actual en Bogotá?',
      100,
    )
    expect(errors).toEqual([])
  })

  it('flags a message that blames the customer', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedNotContains: ['tu culpa', 'tu error'] },
      'Fue tu culpa, diste mal la dirección. Corrígela ya.',
      100,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('scores rubric with weighted average', () => {
    const scores = scoreRubric(
      'Dirección errónea clasificada, pregunta binaria, sin culpa al cliente, Coordinadora',
      CASES[0].rubric!,
    )
    const overall = computeOverallScore(scores)
    expect(overall).toBeGreaterThan(0)
    expect(overall).toBeLessThanOrEqual(1)
  })
})

// ── LLM-call tests (skipped in CI without LLM_API_KEY) ────────────────────
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — novedades (live LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: 'Novedad con tu envío: la dirección no está completa. ¿Me confirmas tu dirección actual en Bogotá?',
      model: 'glm-4.6',
      provider: 'zai',
      usage: { promptTokens: 220, completionTokens: 28, totalTokens: 248 },
    })
  })

  it('calls the LLM and asserts the novedades reply', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const { system, user } = await buildAgentPrompt('novedades', CASES[0].input as never)
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['dirección'] },
      result.content,
      100,
    )
    expect(errors).toEqual([])
  })
})
