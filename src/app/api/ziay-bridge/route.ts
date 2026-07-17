/**
 * POST /api/ziay-bridge
 *
 * Puente entre ChateaPro y ZIAY.
 *
 * ChateaPro tiene limitaciones (12K chars, alucinación, flete estático).
 * Este endpoint resuelve TODAS las fricciones:
 *
 * 1. ChateaPro envía el mensaje del cliente + contexto
 * 2. ZIAY ejecuta la lógica (cotización, flete, identificación, pago)
 * 3. ZIAY devuelve la respuesta lista para enviar al cliente
 *
 * De esta forma, el prompt de ChateaPro solo necesita ser un "router"
 * que llame a este endpoint — no necesita contener tablas de precios
 * ni fletes ni reglas de negocio.
 *
 * Body:
 * {
 *   "tenantId": "ten-saramantha",
 *   "action": "quote" | "identify" | "freight" | "payment" | "catalog",
 *   "data": { ... } // depende del action
 * }
 *
 * Actions:
 * - "quote": cotización dinámica con flete + pago
 * - "identify": identificar producto desde imagen
 * - "freight": solo cotizar flete
 * - "payment": calcular estrategia de pago
 * - "catalog": buscar productos por texto
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { generateDynamicQuote, formatQuoteForWhatsApp, quoteFreight } from '@/lib/agents/dynamic-quote'
import { identifyImage } from '@/lib/vision/pipeline'
import { logger } from '@/lib/logger'

const BridgeSchema = z.object({
  tenantId: z.string(),
  action: z.enum(['quote', 'identify', 'freight', 'payment', 'catalog']),
  data: z.record(z.unknown()),
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json()
  const parseResult = BridgeSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  const { tenantId, action, data } = parseResult.data

  const tenantError = requireTenantAccess(tenantId)
  if (tenantError) return tenantError

  switch (action) {
    // ─── COTIZACIÓN COMPLETA ──────────────────────────────────────
    case 'quote': {
      const items = (data.items as { sku: string; quantity: number }[]) || []
      const city = (data.city as string) || ''
      const country = (data.country as string) || 'CO'
      const channelType = (data.channelType as string) || 'whatsapp'

      if (!items.length || !city) {
        return NextResponse.json({ error: 'Se requiere items[] y city' }, { status: 400 })
      }

      const quote = await generateDynamicQuote(tenantId, items, city, country, channelType)
      return NextResponse.json({
        action: 'quote',
        result: quote,
        whatsappMessage: formatQuoteForWhatsApp(quote),
      })
    }

    // ─── IDENTIFICAR PRODUCTO POR IMAGEN ──────────────────────────
    case 'identify': {
      const imageUrl = data.imageUrl as string
      const customerMessage = data.customerMessage as string | undefined

      if (!imageUrl) {
        return NextResponse.json({ error: 'Se requiere imageUrl' }, { status: 400 })
      }

      let vlmResult: { sku?: string; productName?: string; confianza?: number } | null = null
      try {
        vlmResult = await identifyImage(imageUrl, tenantId)
      } catch (e) {
        logger.warn({ err: e }, 'VLM failed in bridge')
      }

      // Búsqueda fuzzy en catálogo
      let products = await db.product.findMany({
        where: {
          tenantId,
          active: true,
          ...(vlmResult?.productName ? {
            OR: [
              { name: { contains: vlmResult.productName, mode: 'insensitive' } },
              { diseno: { contains: vlmResult.productName, mode: 'insensitive' } },
            ],
          } : customerMessage ? {
            OR: [
              { name: { contains: customerMessage, mode: 'insensitive' } },
              { diseno: { contains: customerMessage, mode: 'insensitive' } },
              { categoria: { contains: customerMessage, mode: 'insensitive' } },
            ],
          } : {}),
        },
        select: { sku: true, name: true, price: true, stock: true, imageUrl: true, diseno: true, categoria: true },
        take: 5,
      })

      if (products.length === 0) {
        return NextResponse.json({
          action: 'identify',
          result: { identified: false, product: null, alternatives: [] },
          whatsappMessage: 'No logré identificar el producto. ¿Podrías decirme el nombre o diseño? 👀',
        })
      }

      const main = products[0]
      return NextResponse.json({
        action: 'identify',
        result: {
          identified: true,
          product: { sku: main.sku, name: main.name, price: main.price, stock: main.stock, design: main.diseno, category: main.categoria },
          alternatives: products.slice(1, 4).map(p => ({ sku: p.sku, name: p.name, price: p.price })),
          confidence: vlmResult?.confianza || 0.5,
        },
        whatsappMessage: `¡Ese es nuestro ${main.name}! Precio: $${main.price.toLocaleString('es-CO')}. ¿Cuántas unidades? 💗`,
      })
    }

    // ─── SOLO FLETE ───────────────────────────────────────────────
    case 'freight': {
      const city = data.city as string
      const country = (data.country as string) || 'CO'
      const units = (data.units as number) || 1

      if (!city) {
        return NextResponse.json({ error: 'Se requiere city' }, { status: 400 })
      }

      const freight = await quoteFreight(tenantId, city, country, units)
      return NextResponse.json({
        action: 'freight',
        result: freight,
        whatsappMessage: freight
          ? `Envío a ${city} (${freight.carrier}): $${freight.cost.toLocaleString('es-CO')}. Entrega: ${freight.estimatedDays}.`
          : `No pude cotizar el envío a ${city}. ¿Podrías confirmar la ciudad? 📍`,
      })
    }

    // ─── BUSCAR CATÁLOGO ──────────────────────────────────────────
    case 'catalog': {
      const query = (data.query as string) || ''
      const limit = Math.min((data.limit as number) || 5, 10)

      const products = await db.product.findMany({
        where: {
          tenantId,
          active: true,
          ...(query ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { sku: { contains: query, mode: 'insensitive' } },
              { diseno: { contains: query, mode: 'insensitive' } },
              { categoria: { contains: query, mode: 'insensitive' } },
            ],
          } : {}),
        },
        select: { sku: true, name: true, price: true, stock: true, imageUrl: true, diseno: true, categoria: true },
        take: limit,
      })

      return NextResponse.json({
        action: 'catalog',
        result: products,
        whatsappMessage: products.length > 0
          ? `Encontré ${products.length} producto(s):\n${products.map(p => `• ${p.name} — $${p.price.toLocaleString('es-CO')}`).join('\n')}`
          : 'No encontré productos con ese criterio. ¿Qué tipo de prenda buscas? 👀',
      })
    }

    // ─── CALCULAR PAGO ────────────────────────────────────────────
    case 'payment': {
      const subtotal = data.subtotal as number
      const freightCost = (data.freightCost as number) || 0
      const channelType = (data.channelType as string) || 'whatsapp'

      if (!subtotal) {
        return NextResponse.json({ error: 'Se requiere subtotal' }, { status: 400 })
      }

      // Reutilizar la lógica de calculatePaymentStrategy
      const { calculatePaymentStrategy } = await import('@/lib/agents/dynamic-quote')
      const payment = await calculatePaymentStrategy(tenantId, channelType, subtotal, freightCost)

      return NextResponse.json({
        action: 'payment',
        result: payment,
        whatsappMessage: payment.explanation,
      })
    }

    default:
      return NextResponse.json({ error: `Action ${action} no soportado` }, { status: 400 })
  }
})
