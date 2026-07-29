// ZIAY — Vision Pipeline
//
// Uses ZAI's VLM (glm-4.6v) to:
//   1. `identifyImage(imageUrl, tenantCtx?)` — identify a product in a customer
//      image against the tenant's catalog (used by the `vision` agent).
//   2. `enrichProductImage(imageUrl, productName, tenantCtx?)` — generate SEO
//      alt text and tags for a catalog image (used by `product_enrichment`).
//
// All VLM calls go through `z-ai-web-dev-sdk`. The tenant context is used to
// fetch the catalog for visual comparison and to record the identification
// in the `ImageIdentification` table for audit.
//
// BUILD-AGENTS-LIB-001

import ZAI from 'z-ai-web-dev-sdk'
import type { VisionMessage } from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'

const log = getLogger('vision:pipeline')

// The ZAI SDK exports a class with a private constructor; we type the instance
// as the resolved type of `ZAI.create()` to avoid referencing the private ctor.
type ZAIClient = Awaited<ReturnType<typeof ZAI.create>>

const VLM_MODEL = 'glm-4.6v'

export interface TenantVisionContext {
  tenantId: string
  customerId?: string
  conversationId?: string
}

export interface ImageIdentificationResult {
  sku: string | null
  confianza: number // 0-1
  metodo: 'ocr_franja' | 'comparacion_visual' | 'sin_match'
  pregunta_confirmacion: string | null
  raw: unknown
}

export interface ProductImageEnrichmentResult {
  alt_image: string
  tags: string[]
  description_seo: string
  raw: unknown
}

let _zaiPromise: Promise<ZAIClient> | null = null
async function getVLM(): Promise<ZAIClient> {
  if (!_zaiPromise) _zaiPromise = ZAI.create()
  return _zaiPromise
}

/**
 * Identify a product in a customer-provided image using the ZAI VLM (glm-4.6v).
 *
 * Strategy:
 *   1. Read the metadata stripe visible on the catalog image (OCR-like via VLM).
 *   2. If the stripe is unreadable, compare visually against the tenant's catalog.
 *   3. Return a JSON result with SKU, confidence (0-1), method, and an optional
 *      confirmation question for the customer.
 *
 * The result is also persisted to the `ImageIdentification` table for audit
 * and future retraining.
 *
 * @param imageUrl    - Public URL of the customer image.
 * @param tenantCtx   - Tenant context for catalog lookup & audit.
 */
export async function identifyImage(
  imageUrl: string,
  tenantCtx?: TenantVisionContext,
): Promise<ImageIdentificationResult> {
  const tenantId = tenantCtx?.tenantId
  // Fetch catalog for visual comparison (top 30 by recency)
  let catalogLines: string[] = []
  let catalogForAudit: { sku: string; name: string; diseno: string | null }[] = []
  if (tenantId) {
    const products = await db.product.findMany({
      where: { tenantId, active: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { sku: true, name: true, diseno: true, price: true, imageUrl: true },
    })
    catalogLines = products.map(
      (p) => `- ${p.sku}: ${p.name} [${p.diseno ?? 'liso'}] $${p.price} img: ${p.imageUrl ?? 'sin imagen'}`,
    )
    catalogForAudit = products.map((p) => ({ sku: p.sku, name: p.name, diseno: p.diseno }))
  }

  const systemPrompt = `Eres el agente de visión de ZIAY (tenant ${tenantId ?? 'desconocido'}, contexto Saramantha / ZIAY). Identificas productos del catálogo real a partir de imágenes enviadas por el cliente.

Reglas estrictas:
1. La franja de metadata visible en cada imagen del catálogo contiene SKU, diseño y precio de referencia.
2. Tu PRIORIDAD es leer esa franja y devolver el SKU exacto. NO inventes.
3. Si la franja está recortada o ilegible, compara visualmente contra los productos del catálogo provisto y devuelve el SKU más probable con tu confianza (0-1).
4. Si la confianza es baja (< 0.6), responde pidiendo al cliente que confirme el diseño, sin asumir cuál es.
5. Responde SOLO en formato JSON: {"sku": "..." | null, "confianza": 0.0-1.0, "metodo": "ocr_franja" | "comparacion_visual" | "sin_match", "pregunta_confirmacion": "..." | null}`

  const userText = `Catálogo de referencia (compara visualmente contra estos):
${catalogLines.join('\n') || 'Catálogo vacío — responde metodo="sin_match".'}

Imagen del cliente: ${imageUrl}`

  const messages: VisionMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ]

  const vlm = await getVLM()
  const res = await vlm.chat.completions.createVision({
    model: VLM_MODEL,
    messages,
    stream: false,
  })

  const rawContent: string =
    res?.choices?.[0]?.message?.content ??
    res?.choices?.[0]?.delta?.content ??
    (typeof res?.content === 'string' ? res.content : '') ??
    ''

  const parsed = parseJsonLoose<ImageIdentificationResult>(rawContent)

  const result: ImageIdentificationResult = {
    sku: parsed?.sku ?? null,
    confianza: typeof parsed?.confianza === 'number' ? parsed.confianza : 0,
    metodo: parsed?.metodo ?? 'sin_match',
    pregunta_confirmacion: parsed?.pregunta_confirmacion ?? null,
    raw: res,
  }

  // Persist for audit
  if (tenantId) {
    try {
      await db.imageIdentification.create({
        data: {
          tenantId,
          contactoId: tenantCtx?.customerId ?? null,
          imagenUrl: imageUrl,
          skuDetectado: result.sku,
          metodo: result.metodo,
          confianza: result.confianza,
        },
      })
    } catch (err) {
      // Audit persistence is best-effort; do not fail the call.
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to persist ImageIdentification')
    }
  }

  void catalogForAudit
  return result
}

/**
 * Generate SEO alt text, tags, and a short description for a catalog image.
 *
 * Used by the `product_enrichment` agent to enrich catalog entries that have
 * images but no alt text or tags.
 *
 * @param imageUrl    - Public URL of the product image.
 * @param productName - Product name (for context).
 * @param tenantCtx   - Optional tenant context (used for tonal alignment).
 */
export async function enrichProductImage(
  imageUrl: string,
  productName: string,
  tenantCtx?: TenantVisionContext,
): Promise<ProductImageEnrichmentResult> {
  const tenantId = tenantCtx?.tenantId
  const systemPrompt = `Eres el enriquecedor de catálogo de ZIAY (tenant ${tenantId ?? 'desconocido'}). Para la imagen del producto provista, generas:
1) alt_image: descripción accesible de la imagen (100-150 caracteres), útil para lectores de pantalla y SEO.
2) tags: 5-8 tags separados por coma, sin repetir el nombre del producto.
3) description_seo: descripción corta (máx 160 caracteres) con palabras clave comerciales.

Tono: cercano, comercial, sin promesas falsas. No inventes materiales, tallas ni colores que no sean visibles.

Responde SOLO en JSON: {"alt_image": "...", "tags": ["..."], "description_seo": "..."}`

  const userText = `Nombre del producto: ${productName}
URL de la imagen: ${imageUrl}`

  const messages: VisionMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ]

  const vlm = await getVLM()
  const res = await vlm.chat.completions.createVision({
    model: VLM_MODEL,
    messages,
    stream: false,
  })

  const rawContent: string =
    res?.choices?.[0]?.message?.content ??
    res?.choices?.[0]?.delta?.content ??
    (typeof res?.content === 'string' ? res.content : '') ??
    ''

  const parsed = parseJsonLoose<{ alt_image?: string; tags?: string[]; description_seo?: string }>(rawContent)

  return {
    alt_image: parsed?.alt_image ?? '',
    tags: Array.isArray(parsed?.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
    description_seo: parsed?.description_seo ?? '',
    raw: res,
  }
}

/**
 * Best-effort JSON parser that strips markdown code fences and extracts the
 * first JSON object from a model response.
 */
function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null
  let s = text.trim()
  // Strip ```json ... ``` fences
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  }
  // Find first { ... } block
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  const candidate = s.slice(start, end + 1)
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
