/**
 * POST /api/quote/dynamic
 *
 * Motor de cotización dinámica que resuelve TODAS las fricciones de ChateaPro:
 * 1. No alucina precios — consulta DB real
 * 2. Flete dinámico — llama a transportadoras reales
 * 3. Estrategia híbrida de cobro — configurable por canal
 * 4. No cobra sin confirmación — confirmed: false hasta "sí" del cliente
 * 5. Flete internacional — Aveonline
 * 6. Cotización cruzada estructurada — una referencia a la vez
 *
 * USO DESDE CHATEAPRO:
 * ChateaPro llama este endpoint vía HTTP Request en lugar de intentar
 * calcular precios/fletes en el prompt (que alucina).
 *
 * Body:
 * {
 *   "tenantId": "ten-saramantha",
 *   "items": [{ "sku": "PIJ-SHORT-TIRA-001", "quantity": 10 }],
 *   "city": "Bogotá",
 *   "country": "CO",
 *   "channelType": "whatsapp"
 * }
 *
 * Response:
 * {
 *   "items": [...],
 *   "subtotal": 165000,
 *   "freight": { "carrier": "Dropi", "cost": 8000, ... },
 *   "total": 173000,
 *   "payment": { "strategy": "hybrid", ... },
 *   "warnings": [],
 *   "confirmed": false,
 *   "whatsappMessage": "🧾 Tu cotización:\n..."
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateDynamicQuote, formatQuoteForWhatsApp } from '@/lib/agents/dynamic-quote'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const QuoteSchema = z.object({
  tenantId: z.string(),
  items: z.array(z.object({
    sku: z.string(),
    quantity: z.number().int().positive(),
  })).min(1),
  city: z.string(),
  country: z.string().default('CO'),
  channelType: z.string().default('whatsapp'),
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json()
  const parseResult = QuoteSchema.safeParse(body)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parseResult.error.flatten() },
      { status: 400 }
    )
  }

  const { tenantId, items, city, country, channelType } = parseResult.data

  const tenantError = requireTenantAccess(tenantId)
  if (tenantError) return tenantError

  const quote = await generateDynamicQuote(tenantId, items, city, country, channelType)

  return NextResponse.json({
    ...quote,
    whatsappMessage: formatQuoteForWhatsApp(quote),
  })
})
