/**
 * POST /api/identify-product
 *
 * Identifica un producto del catálogo a partir de una imagen del cliente.
 * Usa VLM (glm-4.6v) + búsqueda fuzzy en el catálogo.
 *
 * Resuelve fricción: "cuando le comparten imágenes, no sabe de qué
 * referencia o modelo le están hablando"
 *
 * Body:
 * {
 *   "tenantId": "ten-saramantha",
 *   "imageUrl": "https://...",
 *   "customerMessage": "quiero este" (opcional)
 * }
 *
 * Response:
 * {
 *   "identified": true,
 *   "product": {
 *     "sku": "PIJ-SHORT-TIRA-001",
 *     "name": "Short Tira",
 *     "price": 16500,
 *     "stock": 480,
 *     "imageUrl": "...",
 *     "design": "liso",
 *     "category": "short"
 *   },
 *   "confidence": 0.92,
 *   "alternatives": [...], // otros productos similares
 *   "whatsappReply": "¡Ese es nuestro Short Tira! 🩳 Precio: $16.500..."
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { identifyImage } from '@/lib/vision/pipeline'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { logger } from '@/lib/logger'

const IdentifySchema = z.object({
  tenantId: z.string(),
  imageUrl: z.string().url(),
  customerMessage: z.string().optional(),
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json()
  const parseResult = IdentifySchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  const { tenantId, imageUrl, customerMessage } = parseResult.data

  const tenantError = requireTenantAccess(tenantId)
  if (tenantError) return tenantError

  // 1. Usar VLM para identificar el producto en la imagen
  let vlmResult: { sku?: string; productName?: string; categoria?: string; confianza?: number } | null = null
  try {
    vlmResult = await identifyImage(imageUrl, tenantId)
  } catch (e) {
    logger.warn({ err: e, tenantId, imageUrl }, 'VLM identification failed')
  }

  // 2. Búsqueda fuzzy en catálogo por nombre/diseño/categoría
  let products = await db.product.findMany({
    where: {
      tenantId,
      active: true,
      ...(vlmResult?.productName ? {
        OR: [
          { name: { contains: vlmResult.productName, mode: 'insensitive' } },
          { diseno: { contains: vlmResult.productName, mode: 'insensitive' } },
        ],
      } : {}),
    },
    select: { id: true, sku: true, name: true, price: true, stock: true, imageUrl: true, diseno: true, categoria: true, description: true },
    take: 5,
  })

  // 3. Si VLM identificó un SKU, priorizar ese
  if (vlmResult?.sku) {
    const exactMatch = products.find(p => p.sku === vlmResult.sku)
    if (exactMatch) {
      products = [exactMatch, ...products.filter(p => p.sku !== vlmResult!.sku)]
    }
  }

  // 4. Si no hay matches, buscar por mensaje del cliente
  if (products.length === 0 && customerMessage) {
    products = await db.product.findMany({
      where: {
        tenantId,
        active: true,
        OR: [
          { name: { contains: customerMessage, mode: 'insensitive' } },
          { diseno: { contains: customerMessage, mode: 'insensitive' } },
          { categoria: { contains: customerMessage, mode: 'insensitive' } },
          { description: { contains: customerMessage, mode: 'insensitive' } },
        ],
      },
      select: { id: true, sku: true, name: true, price: true, stock: true, imageUrl: true, diseno: true, categoria: true, description: true },
      take: 5,
    })
  }

  // 5. Construir respuesta
  if (products.length === 0) {
    return NextResponse.json({
      identified: false,
      product: null,
      alternatives: [],
      confidence: 0,
      whatsappReply: 'No logré identificar el producto de la imagen. ¿Podrías decirme el nombre o diseño? 👀',
    })
  }

  const main = products[0]
  const alternatives = products.slice(1, 4)

  const confidence = vlmResult?.confianza || 0.5

  // 6. Generar respuesta de WhatsApp (regla S05: máx 20 palabras por mensaje)
  let reply = `¡Ese es nuestro ${main.name}!`
  if (main.diseno) reply += ` Diseño: ${main.diseno}.`
  reply += ` Precio: $${main.price.toLocaleString('es-CO')}.`
  reply += ` ¿Cuántas unidades? 💗`

  return NextResponse.json({
    identified: true,
    product: {
      sku: main.sku,
      name: main.name,
      price: main.price,
      stock: main.stock,
      imageUrl: main.imageUrl,
      design: main.diseno,
      category: main.categoria,
    },
    confidence,
    alternatives: alternatives.map(p => ({
      sku: p.sku,
      name: p.name,
      price: p.price,
      design: p.diseno,
    })),
    whatsappReply: reply,
  })
})
