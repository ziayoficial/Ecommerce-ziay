// VLM eval pipeline tests — CI fixtures.
// SPRINT-TESTS-FINAL-001 · §1.
//
// Tests `src/lib/vision/pipeline.ts::identifyImage` with the ZAI SDK mocked
// so no real API calls are made. The mock returns a canned JSON response
// shaped like a real VLM identification (`{ sku, confianza, metodo,
// pregunta_confirmacion }`). The DB is also mocked so the audit-persistence
// side effect doesn't require a real Prisma client.
//
// Covers:
//   - happy path: identifies a product from an image URL
//   - VLM API error: pipeline surfaces the error (caller can `.catch(() => null)`)
//   - audit persistence: `db.imageIdentification.create` is called with the
//     detected SKU + tenant context
//   - no-tenant path: audit persistence is skipped (no `tenantId`)
//   - markdown-fenced JSON: the loose JSON parser strips ```json fences
//   - malformed VLM response: returns `sin_match` + `confianza: 0` defaults
//
// Mock strategy:
//   - `vi.mock('z-ai-web-dev-sdk')` — factory returns a singleton client so
//     the same `createVision` mock is reused across `ZAI.create()` calls
//     (the pipeline caches the client in `_zaiPromise`). Tests that need to
//     override the response get the mock fn via `(await ZAI.create()).chat.completions.createVision`
//     and call `mockResolvedValueOnce`.
//   - `vi.mock('@/lib/db')` — provides `product.findMany` (catalog lookup),
//     `imageIdentification.create` (audit), `tenant.findUnique`, `product.findFirst`.
//   - `vi.mock('@/lib/logger')` — silences pino output.
//   - `vi.resetModules()` in `beforeEach` — clears the module cache so the
//     pipeline's `_zaiPromise` is reset to `null` between tests (otherwise
//     the cached client from a prior test would leak + mask error-path
//     mocks on the next).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock ZAI SDK ────────────────────────────────────────────────────────────
// Singleton client: `ZAI.create()` always returns the SAME client object so
// `mockResolvedValueOnce` on `createVision` carries through to the pipeline's
// cached `_zaiPromise`.
vi.mock('z-ai-web-dev-sdk', () => {
  const createVision = vi.fn(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            sku: 'PIJ-SHORT-TIRA-001',
            confianza: 0.92,
            metodo: 'vlm_glm_4_6v',
            pregunta_confirmacion: '¿Es un short de pijama azul?',
          }),
        },
      },
    ],
  }))
  const client = {
    chat: {
      completions: {
        createVision,
      },
    },
  }
  return {
    default: {
      create: vi.fn(async () => client),
    },
  }
})

// ── Mock DB ─────────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => {
  const mockDb = {
    imageIdentification: {
      create: vi.fn(async (data: any) => ({ id: 'img-1', ...data.data })),
      findMany: vi.fn(),
    },
    product: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(),
    },
    tenant: { findUnique: vi.fn() },
  }
  return { db: mockDb }
})

// ── Mock logger ─────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => {
  const mock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => mock),
  }
  return {
    getLogger: vi.fn(() => mock),
    logger: mock,
    default: mock,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the module registry so the pipeline's `_zaiPromise` singleton
  // starts as `null` for each test. Without this, the cached client from
  // a prior test would mask `mockRejectedValueOnce` overrides on `ZAI.create`.
  vi.resetModules()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('VLM Pipeline (mocked)', () => {
  it('identifies product from image URL', async () => {
    const { identifyImage } = await import('@/lib/vision/pipeline')

    const result = await identifyImage(
      'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400',
      { tenantId: 'ten-1' },
    )

    // Verify the pipeline returned a result with the VLM-extracted fields.
    expect(result).toBeDefined()
    expect(result.sku).toBe('PIJ-SHORT-TIRA-001')
    expect(result.confianza).toBe(0.92)
    expect(result.pregunta_confirmacion).toContain('short')
    expect(result.metodo).toBe('vlm_glm_4_6v')
    // `raw` carries the full VLM response for audit / retraining.
    expect(result.raw).toBeDefined()
  })

  it('handles VLM API error gracefully (caller can swallow to null)', async () => {
    // Configure the next `ZAI.create()` call to reject — simulates a VLM
    // provider timeout. The pipeline does NOT catch this internally (only
    // the DB persistence is wrapped in try/catch), so `identifyImage`
    // rejects. The caller is expected to `.catch(() => null)` to degrade
    // gracefully.
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    vi.mocked(ZAI.create).mockRejectedValueOnce(new Error('VLM API timeout'))

    const { identifyImage } = await import('@/lib/vision/pipeline')

    const result = await identifyImage(
      'https://example.com/image.jpg',
      { tenantId: 'ten-1' },
    ).catch(() => null)

    // `null` is "defined" (not undefined) — the call swallowed the error.
    expect(result).toBeDefined()
    expect(result).toBeNull()
  })

  it('persists identification to DB for audit', async () => {
    const { db } = await import('@/lib/db')
    const { identifyImage } = await import('@/lib/vision/pipeline')

    await identifyImage('https://example.com/test.jpg', { tenantId: 'ten-1' })

    expect(db.imageIdentification.create).toHaveBeenCalledTimes(1)
    expect(db.imageIdentification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'ten-1',
          imagenUrl: 'https://example.com/test.jpg',
          skuDetectado: 'PIJ-SHORT-TIRA-001',
          metodo: 'vlm_glm_4_6v',
          confianza: 0.92,
        }),
      }),
    )
  })

  it('skips DB persistence when no tenant context is provided', async () => {
    const { db } = await import('@/lib/db')
    const { identifyImage } = await import('@/lib/vision/pipeline')

    // No tenantCtx → no audit persistence (the `if (tenantId)` guard in
    // `identifyImage` skips the `db.imageIdentification.create` call).
    await identifyImage('https://example.com/no-tenant.jpg')

    expect(db.imageIdentification.create).not.toHaveBeenCalled()
  })

  it('also persists contactoId when customer context is provided', async () => {
    const { db } = await import('@/lib/db')
    const { identifyImage } = await import('@/lib/vision/pipeline')

    await identifyImage('https://example.com/with-customer.jpg', {
      tenantId: 'ten-1',
      customerId: 'cust-42',
      conversationId: 'conv-99',
    })

    expect(db.imageIdentification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'ten-1',
          contactoId: 'cust-42',
          imagenUrl: 'https://example.com/with-customer.jpg',
        }),
      }),
    )
  })

  it('parses VLM response wrapped in markdown code fences', async () => {
    // VLMs sometimes wrap JSON in ```json fences. The pipeline's
    // `parseJsonLoose` helper strips them before `JSON.parse`.
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const client = await ZAI.create()
    vi.mocked(client.chat.completions.createVision).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              '```json\n{"sku": "MD-FENCED-001", "confianza": 0.77, "metodo": "ocr_franja"}\n```',
          },
        },
      ],
    } as any)

    const { identifyImage } = await import('@/lib/vision/pipeline')
    const result = await identifyImage('https://example.com/fenced.jpg', {
      tenantId: 'ten-1',
    })

    expect(result.sku).toBe('MD-FENCED-001')
    expect(result.confianza).toBe(0.77)
  })

  it('returns nullish defaults when VLM returns malformed JSON', async () => {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const client = await ZAI.create()
    vi.mocked(client.chat.completions.createVision).mockResolvedValueOnce({
      choices: [{ message: { content: 'not-json-at-all' } }],
    } as any)

    const { identifyImage } = await import('@/lib/vision/pipeline')
    const result = await identifyImage('https://example.com/malformed.jpg', {
      tenantId: 'ten-1',
    })

    // `parseJsonLoose` returns null → pipeline falls back to `sin_match`
    // + `confianza: 0` + `sku: null`.
    expect(result.sku).toBeNull()
    expect(result.confianza).toBe(0)
    expect(result.metodo).toBe('sin_match')
    expect(result.pregunta_confirmacion).toBeNull()
  })

  it('fetches catalog for visual comparison when tenantId is provided', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.product.findMany).mockResolvedValueOnce([
      {
        sku: 'PIJ-SHORT-AZUL-001',
        name: 'Short Pijama Azul',
        diseno: 'liso',
        price: 25.5,
        imageUrl: 'https://cdn.test/short-azul.jpg',
      },
    ] as any)

    const { identifyImage } = await import('@/lib/vision/pipeline')
    await identifyImage('https://example.com/with-catalog.jpg', {
      tenantId: 'ten-1',
    })

    // The catalog lookup is bounded to active products for the tenant,
    // top 30 by recency.
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'ten-1', active: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    )
  })
})
