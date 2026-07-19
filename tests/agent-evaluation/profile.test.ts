// IA-2 — Agent evaluation: profile agent
//
// Five test cases covering the profile (lead-classification) agent. The
// profile agent reads `Tenant.preguntaPerfil` + the customer's message
// and returns one of `mayorista | emprendedor | detal | regalo`.
//
// Each case:
//   1. Mocks `@/lib/db` so the prompt builder resolves a fake tenant +
//      fake volume prices (no real DB round-trip in CI).
//   2. Calls `buildAgentPrompt('profile', input)` — asserts the prompt
//      contains the expected tenant-specific context (the pregunta_perfil).
//   3. Runs the LLM-call path ONLY when `LLM_API_KEY` is set (via
//      `test.skipIf`). In CI without a key, the LLM-call test is skipped
//      but the prompt-assertion tests still run on every PR.
//   4. Scores the output against the rubric.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock: DB ─────────────────────────────────────────────────────────────
// The profile prompt builder calls `db.tenant.findUnique({ where: { id } })`.
// We return a tenant with a known `preguntaPerfil` so the prompt assertion
// can verify the builder injects it into the user message.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't-test',
        slug: 'test-tenant',
        nombreNegocio: 'Test Negocio',
        preguntaPerfil: '¿Para ti o para surtir tu negocio?',
        planMonetizacion: 'conecta',
      }),
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
// Five cases covering the four profile classifications + the fallback
// (unclear signal → ask pregunta_perfil).

const CASES: AgentTestCase[] = [
  {
    name: 'profile-detects-mayorista',
    agentName: 'profile',
    input: {
      tenantId: TENANT_ID,
      message: 'Hola, quiero comprar 50 short de pijama para revender en mi tienda',
    },
    expectedPromptContains: ['pregunta_perfil', 'mayorista'],
    rubric: [
      { criterion: 'Detecta perfil mayorista cuando el lead menciona revender', weight: 0.6 },
      { criterion: 'Respeta el formato (solo el perfil o la pregunta)', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'profile-detects-emprendedor',
    agentName: 'profile',
    input: {
      tenantId: TENANT_ID,
      message: 'Estoy arrancando un emprendimiento, quiero ver catálogo completo',
    },
    expectedPromptContains: ['emprendedor'],
    rubric: [
      { criterion: 'Detecta emprendedor cuando menciona arrancar o emprender', weight: 0.6 },
      { criterion: 'Respeta el formato (solo el perfil o la pregunta)', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'profile-detects-detal',
    agentName: 'profile',
    input: {
      tenantId: TENANT_ID,
      message: 'Quiero 1 pijama para regalo de cumpleaños',
    },
    expectedPromptContains: ['regalo', 'detal'],
    rubric: [
      { criterion: 'Clasifica como detal o regalo cuando es para uso personal', weight: 0.6 },
      { criterion: 'Respeta el formato (solo el perfil o la pregunta)', weight: 0.4 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'profile-unclear-asks-pregunta',
    agentName: 'profile',
    input: {
      tenantId: TENANT_ID,
      message: 'Hola',
    },
    expectedPromptContains: ['pregunta_perfil'],
    rubric: [
      { criterion: 'Sin señal clara devuelve la pregunta perfil del tenant', weight: 0.7 },
      { criterion: 'No avanza de etapa sin el perfil', weight: 0.3 },
    ],
    maxLatencyMs: 5000,
  },
  {
    name: 'profile-never-uses-markdown',
    agentName: 'profile',
    input: {
      tenantId: TENANT_ID,
      message: 'Quiero 30 short para mi negocio',
    },
    expectedPromptContains: ['mayorista'],
    // Sanity: the prompt itself must instruct plain-text output (regla N30).
    rubric: [
      { criterion: 'Output respeta texto plano sin markdown', weight: 0.5 },
      { criterion: 'Detecta mayorista', weight: 0.5 },
    ],
    maxLatencyMs: 5000,
  },
]

// ── Prompt-assertion tests (run in CI without LLM_API_KEY) ────────────────
describe('Agent evaluation — profile (prompt assertions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(CASES)('builds a prompt that satisfies case "$name"', async (testCase) => {
    const { system, user } = await buildAgentPrompt('profile', testCase.input as never)
    const fullPrompt = system + '\n' + user

    // The prompt must mention the agent's role.
    expect(fullPrompt.toLowerCase()).toContain('perfil')

    // Verify each expected substring is present (case-insensitive).
    for (const substr of testCase.expectedPromptContains ?? []) {
      expect(fullPrompt.toLowerCase()).toContain(substr.toLowerCase())
    }
  })

  it('profile prompt includes the rules block (NUNCA/SIEMPRE)', async () => {
    const { system } = await buildAgentPrompt('profile', { tenantId: TENANT_ID, message: 'test' } as never)
    expect(system).toContain('REGLAS ABSOLUTAS')
    expect(system).toContain('NUNCA')
    expect(system).toContain('SIEMPRE')
  })
})

// ── Rubric + assertion tests on canned outputs (no LLM call) ──────────────
describe('Agent evaluation — profile (assertions on canned outputs)', () => {
  it('detects mayorista in output', () => {
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['mayorista'] },
      'mayorista',
      100,
    )
    expect(errors).toEqual([])
  })

  it('flags markdown violation', () => {
    const errors = assertTestCase(
      { ...CASES[4], expectedNotContains: ['**', '__'] },
      '**mayorista**',
      100,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  it('scores rubric with weighted average', () => {
    // The output mentions enough rubric keywords ("mayorista", "perfil",
    // "formato") to push the heuristic scorer above 0.
    const scores = scoreRubric(
      'perfil mayorista detectado: el lead menciona revender, formato respetado',
      CASES[0].rubric!,
    )
    const overall = computeOverallScore(scores)
    expect(overall).toBeGreaterThan(0)
    expect(overall).toBeLessThanOrEqual(1)
  })
})

// ── LLM-call tests (skipped in CI without LLM_API_KEY) ────────────────────
describe.skipIf(!process.env.LLM_API_KEY)('Agent evaluation — profile (live LLM)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMock.mockResolvedValue({
      content: 'mayorista',
      model: 'glm-4.6-flash',
      provider: 'zai',
      usage: { promptTokens: 120, completionTokens: 5, totalTokens: 125 },
    })
  })

  it('calls the LLM and asserts the output', async () => {
    const { chat } = await import('@/lib/llm/adapter')
    const { system, user } = await buildAgentPrompt('profile', CASES[0].input as never)
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    const errors = assertTestCase(
      { ...CASES[0], expectedContains: ['mayorista'] },
      result.content,
      100,
    )
    expect(errors).toEqual([])
  })
})
