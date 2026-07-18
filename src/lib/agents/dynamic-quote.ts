// ════════════════════════════════════════════════════════════════════
// ZIAY — Motor de Cotización Dinámica
// ════════════════════════════════════════════════════════════════════
//
// Resuelve las fricciones de ChateaPro:
// 1. Alucinación de precios → consulta DB real, nunca inventa
// 2. Cotizaciones cruzadas confusas → una referencia a la vez, estructurada
// 3. Flete estático → cotización dinámica vía adaptadores (Dropi/99envios/Aveonline)
// 4. Estrategia híbrida de cobro → calcula anticipado vs COD según reglas
// 5. Flete internacional → tabla separada + confirmación de ciudad
// 6. No confirma antes de cobrar → flujo obligatorio de verificación
//

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { DropiAdapter } from '@/lib/adapters/dropi'
import { Envios99Adapter } from '@/lib/adapters/99envios'
import { AveonlineAdapter } from '@/lib/adapters/aveonline'

// ─── Tipos ───────────────────────────────────────────────────────────

export interface QuoteItem {
  sku: string
  productName: string
  quantity: number
  unitPrice: number       // precio unitario real (de DB o tramo de volumen)
  subtotal: number
  tramoAplicado?: string  // ej: "10-49 unidades"
  designNote?: string     // ej: "Short Tira Stitch"
}

export interface FreightQuote {
  carrier: string
  city: string
  country: string
  cost: number
  currency: string
  estimatedDays: string   // ej: "2-3 días hábiles"
  isInternational: boolean
  quoted_at: Date
}

export interface HybridPaymentStrategy {
  strategy: 'advance' | 'cod' | 'hybrid'
  prepayAmount: number    // monto a pagar por anticipado (si hybrid)
  codAmount: number       // monto a pagar contra entrega (si hybrid)
  codFee: number          // recargo contra entrega
  prepayDiscount: number  // descuento por prepago
  totalWithFreight: number
  totalAdvance: number    // total si paga todo anticipado
  totalCOD: number        // total si paga todo contra entrega
  explanation: string     // explicación para el cliente
}

export interface DynamicQuote {
  items: QuoteItem[]
  subtotal: number
  freight: FreightQuote | null
  total: number
  payment: HybridPaymentStrategy
  warnings: string[]      // ej: "Cantidad solicitada supera stock disponible"
  confirmed: boolean      // false hasta que el cliente confirme
}

// ─── Motor de Cotización ─────────────────────────────────────────────

/**
 * Cotiza productos consultando precios REALES de la DB.
 * Nunca inventa precios — si un SKU no existe, lo reporta.
 *
 * Resuelve fricción #1: alucinación de precios
 * Resuelve fricción #2: cotización cruzada estructurada (una ref a la vez)
 */
export async function quoteProducts(
  tenantId: string,
  items: { sku: string; quantity: number }[]
): Promise<{ items: QuoteItem[]; subtotal: number; warnings: string[] }> {
  const warnings: string[] = []
  const quoteItems: QuoteItem[] = []

  for (const item of items) {
    const product = await db.product.findFirst({
      where: { tenantId, sku: item.sku, active: true },
      select: { id: true, sku: true, name: true, price: true, cost: true, stock: true, diseno: true, categoria: true },
    })

    if (!product) {
      warnings.push(`SKU ${item.sku} no encontrado en el catálogo`)
      continue
    }

    if (product.stock !== null && product.stock < item.quantity) {
      warnings.push(`Stock insuficiente para ${product.name}: solicitado ${item.quantity}, disponible ${product.stock}`)
    }

    // Buscar tramos de volumen (si existen en el schema del tenant)
    let volumeTiers: { cantidadMinima: number; cantidadMaxima: number; precioUnitario: number }[] = []
    try {
      // VolumeTier puede no existir en todos los schemas — intentar catch
      const result = await (db as any).volumeTier?.findMany({
        where: { tenantId, productSku: item.sku },
        orderBy: { cantidadMinima: 'asc' },
      })
      if (result) volumeTiers = result
    } catch {
      // Tabla volumeTier no existe en este schema — usar precio base
    }

    let unitPrice = product.price
    let tramoAplicado: string | undefined

    for (const tier of volumeTiers) {
      if (item.quantity >= tier.cantidadMinima && item.quantity <= tier.cantidadMaxima) {
        unitPrice = tier.precioUnitario
        tramoAplicado = `${tier.cantidadMinima}-${tier.cantidadMaxima} unidades`
        break
      }
    }

    quoteItems.push({
      sku: product.sku,
      productName: product.name,
      quantity: item.quantity,
      unitPrice,
      subtotal: unitPrice * item.quantity,
      tramoAplicado,
      designNote: product.diseno || undefined,
    })
  }

  const subtotal = quoteItems.reduce((sum, i) => sum + i.subtotal, 0)
  return { items: quoteItems, subtotal, warnings }
}

/**
 * Cotiza flete DINÁMICAMENTE consultando transportadoras reales.
 * NO usa tabla estática — llama a Dropi/99envios/Aveonline.
 *
 * Resuelve fricción #3: flete estático → dinámico
 * Resuelve fricción #5: flete internacional
 */
export async function quoteFreight(
  tenantId: string,
  city: string,
  country: string,
  units: number
): Promise<FreightQuote | null> {
  const isInternational = country !== 'CO' && country !== 'Colombia'

  // Si es internacional, usar Aveonline (único que soporta internacional)
  if (isInternational) {
    const adapter = new AveonlineAdapter(tenantId)
    try {
      const result = await adapter.cotizarFlete(city, country, units)

      if (result && result.tarifa > 0) {
        return {
          carrier: result.transportadora || 'Aveonline',
          city,
          country,
          cost: result.tarifa,
          currency: 'USD',
          estimatedDays: `${result.tiempo_estimado_dias} días hábiles`,
          isInternational: true,
          quoted_at: new Date(),
        }
      }
    } catch (e) {
      logger.warn({ err: e, tenantId, city, country }, 'International freight quote failed')
    }
    return null
  }

  // Nacional: intentar Dropi primero, luego 99envios, luego Aveonline
  const adapters = [
    { name: 'Dropi', fn: () => new DropiAdapter(tenantId).cotizarFlete(city, 'CO', units) },
    { name: '99envios', fn: () => new Envios99Adapter(tenantId).cotizarFlete(city, 'CO', units) },
    { name: 'Aveonline', fn: () => new AveonlineAdapter(tenantId).cotizarFlete(city, 'CO', units) },
  ]

  for (const adapter of adapters) {
    try {
      const result = await adapter.fn()
      if (result && result.tarifa > 0) {
        return {
          carrier: adapter.name,
          city,
          country: 'CO',
          cost: result.tarifa,
          currency: 'COP',
          estimatedDays: `${result.tiempo_estimado_dias} días hábiles`,
          isInternational: false,
          quoted_at: new Date(),
        }
      }
    } catch (e) {
      logger.warn({ adapter: adapter.name, err: e }, 'Freight quote failed, trying next adapter')
    }
  }

  return null
}

/**
 * Calcula estrategia de pago híbrida basada en configuración del canal.
 *
 * Resuelve fricción #4: estrategia híbrida de cobro
 * Resuelve fricción #6: no cobra sin confirmar primero
 */
export async function calculatePaymentStrategy(
  tenantId: string,
  channelType: string,
  subtotal: number,
  freightCost: number
): Promise<HybridPaymentStrategy> {
  // Obtener configuración del canal
  const channel = await db.channel.findFirst({
    where: { tenantId, type: channelType, active: true },
    select: { paymentStrategy: true, requirePrepayMin: true, prepayDiscountPct: true, codFee: true },
  })

  const strategy = channel?.paymentStrategy || 'cod'
  const requirePrepayMin = channel?.requirePrepayMin || 0
  const prepayDiscountPct = channel?.prepayDiscountPct || 0
  const codFee = channel?.codFee || 0

  const totalWithFreight = subtotal + freightCost
  const prepayDiscount = Math.round(totalWithFreight * (prepayDiscountPct / 100))

  let result: HybridPaymentStrategy

  if (strategy === 'advance' || (strategy === 'hybrid' && subtotal >= requirePrepayMin)) {
    // Anticipado o híbrido (si supera el mínimo)
    result = {
      strategy: strategy === 'hybrid' ? 'hybrid' : 'advance',
      prepayAmount: strategy === 'hybrid' ? subtotal + freightCost - codFee : totalWithFreight - prepayDiscount,
      codAmount: strategy === 'hybrid' ? codFee : 0,
      codFee,
      prepayDiscount,
      totalWithFreight,
      totalAdvance: totalWithFreight - prepayDiscount,
      totalCOD: totalWithFreight + codFee,
      explanation: strategy === 'hybrid'
        ? `Pago híbrido: $${(totalWithFreight - codFee).toLocaleString('es-CO')} anticipado + $${codFee.toLocaleString('es-CO')} contra entrega. Descuento prepago: $${prepayDiscount.toLocaleString('es-CO')} (${prepayDiscountPct}%).`
        : `Pago anticipado: $${(totalWithFreight - prepayDiscount).toLocaleString('es-CO')} (incluye ${prepayDiscountPct}% descuento). Sin recargo contra entrega.`,
    }
  } else {
    // Contra entrega
    result = {
      strategy: 'cod',
      prepayAmount: 0,
      codAmount: totalWithFreight + codFee,
      codFee,
      prepayDiscount,
      totalWithFreight,
      totalAdvance: totalWithFreight - prepayDiscount,
      totalCOD: totalWithFreight + codFee,
      explanation: `Pago contra entrega: $${(totalWithFreight + codFee).toLocaleString('es-CO')} (incluye recargo de $${codFee.toLocaleString('es-CO')}). Si prefieres anticipado: $${(totalWithFreight - prepayDiscount).toLocaleString('es-CO')} (ahorras $${(prepayDiscount + codFee).toLocaleString('es-CO')}).`,
    }
  }

  return result
}

/**
 * Genera cotización completa y dinámica.
 * Este es el PUNTO DE ENTRADA para resolver TODAS las fricciones.
 *
 * Flujo:
 * 1. Valida productos (no inventa precios)
 * 2. Cotiza flete dinámico (no tabla estática)
 * 3. Calcula estrategia de pago (híbrido configurable)
 * 4. Marca como NO confirmada (no cobra sin sí del cliente)
 */
export async function generateDynamicQuote(
  tenantId: string,
  items: { sku: string; quantity: number }[],
  city: string,
  country: string,
  channelType: string
): Promise<DynamicQuote> {
  // 1. Cotizar productos
  const { items: quoteItems, subtotal, warnings } = await quoteProducts(tenantId, items)

  if (quoteItems.length === 0) {
    return {
      items: [],
      subtotal: 0,
      freight: null,
      total: 0,
      payment: {
        strategy: 'cod',
        prepayAmount: 0,
        codAmount: 0,
        codFee: 0,
        prepayDiscount: 0,
        totalWithFreight: 0,
        totalAdvance: 0,
        totalCOD: 0,
        explanation: 'No se encontraron productos válidos para cotizar.',
      },
      warnings: [...warnings, 'No hay productos válidos en la cotización.'],
      confirmed: false,
    }
  }

  // 2. Cotizar flete dinámico
  const totalUnits = quoteItems.reduce((sum, i) => sum + i.quantity, 0)
  const freight = await quoteFreight(tenantId, city, country, totalUnits)

  if (!freight) {
    warnings.push(`No se pudo cotizar flete para ${city}, ${country}. Se requiere cotización manual.`)
  }

  const freightCost = freight?.cost || 0

  // 3. Calcular estrategia de pago
  const payment = await calculatePaymentStrategy(tenantId, channelType, subtotal, freightCost)

  // 4. Total
  const total = payment.strategy === 'cod'
    ? subtotal + freightCost + payment.codFee
    : subtotal + freightCost - payment.prepayDiscount

  return {
    items: quoteItems,
    subtotal,
    freight,
    total,
    payment,
    warnings,
    confirmed: false, // ← NUNCA true hasta que el cliente diga "sí"
  }
}

/**
 * Convierte la cotización a un mensaje de WhatsApp formateado.
 * Máximo 20 palabras por línea (regla S05).
 */
export function formatQuoteForWhatsApp(quote: DynamicQuote): string {
  const lines: string[] = []

  lines.push('🧾 Tu cotización:')

  for (const item of quote.items) {
    const tramo = item.tramoAplicado ? ` (${item.tramoAplicado})` : ''
    lines.push(`${item.quantity}× ${item.productName}${tramo}`)
    lines.push(`$${item.subtotal.toLocaleString('es-CO')}`)
  }

  lines.push(`Subtotal: $${quote.subtotal.toLocaleString('es-CO')}`)

  if (quote.freight) {
    lines.push(`Envío ${quote.freight.city} (${quote.freight.carrier}): $${quote.freight.cost.toLocaleString('es-CO')}`)
    lines.push(`Entrega: ${quote.freight.estimatedDays}`)
  }

  lines.push(`TOTAL: $${quote.total.toLocaleString('es-CO')}`)

  if (quote.payment.strategy === 'hybrid') {
    lines.push(`💰 Anticipado: $${quote.payment.totalAdvance.toLocaleString('es-CO')}`)
    lines.push(`📦 Contra entrega: $${quote.payment.totalCOD.toLocaleString('es-CO')}`)
  }

  lines.push('¿Confirmamos tu pedido? 💗')

  return lines.join('\n')
}
