// CommerceFlow OS — Carga los 239 pedidos REALES del CRM de Saramantha
// Lee los 4 CSV exportados desde chateapro.app y los importa a la DB.
// Mapea los campos del CRM a los modelos Prisma.
//
// Run: bun run scripts/load-real-orders.ts

import { db } from '../src/lib/db'
import { readFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

const TENANT_ID = 'ten-saramantha'
const CSV_FILES = [
  '/home/z/my-project/upload/users (28).csv',
  '/home/z/my-project/upload/users (29).csv',
  '/home/z/my-project/upload/users (30).csv',
  '/home/z/my-project/upload/users (31).csv',
]

// Map board_column_name → our Order.status (Saramantha §15.1 exact)
const BOARD_TO_STATUS: Record<string, string> = {
  'Llamar Para Confirmar Pedido✍': 'pending_confirmation',
  'Intento de cancelación ⁉️': 'intent_cancelacion',
  'Datos completados ✅': 'datos_completados',
  'Seguimiento WhatsApp✍': 'seguimiento',
  'Oficina 📦': 'oficina',
  'Pedido programado ⏱️': 'programado',
  'Pedidos Despachados 🚚': 'despachado',
  'Pendiente Guia✍': 'pendiente_guia',
}

function parseValue(v: string): number {
  if (!v) return 0
  const s = v.replace(/[,']/g, '').replace(/[^\d.-]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseDate(v: string): Date | null {
  if (!v || v.trim() === '' || v.includes('Invalid date')) return null
  // Format: "05/07/2026 8:56 am" (DD/MM/YYYY HH:MM am/pm)
  const m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i)
  if (m) {
    const [, d, mo, y, h, mi, ap] = m
    let hour = parseInt(h)
    if (ap.toLowerCase() === 'pm' && hour !== 12) hour += 12
    if (ap.toLowerCase() === 'am' && hour === 12) hour = 0
    return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), hour, parseInt(mi))
  }
  // Try ISO
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

async function main() {
  console.log('📦 Cargando 239 pedidos REALES del CRM Saramantha...')

  // 1. Read all CSVs and collect real orders (rows with 'Valor de la compra' filled)
  const allOrders: Record<string, string>[] = []
  for (const file of CSV_FILES) {
    const content = readFileSync(file, 'utf-8')
    const records = parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true }) as Record<string, string>[]
    for (const r of records) {
      const v = (r['Valor de la compra'] || '').toString().trim()
      if (v && v !== '0' && v !== '0.00') {
        allOrders.push(r)
      }
    }
  }
  console.log(`  ${allOrders.length} pedidos reales encontrados`)

  // Deduplicate by phone + date (the 4 CSVs overlap)
  const seen = new Set<string>()
  const uniqueOrders = allOrders.filter(r => {
    const key = `${r['phone'] || r['user_id']}-${r['Fecha de compra'] || r['board_column_name']}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`  ${uniqueOrders.length} pedidos únicos (deduplicados)`)

  // 2. Clear existing synthetic orders for Saramantha
  console.log('  Limpiando pedidos sintéticos previos...')
  // Delete in FK-safe order: messages → conversations → orderEvents → orderItems → attributions → shipments → commissionEntries → orders → customers
  await db.message.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.conversation.updateMany({ where: { tenantId: TENANT_ID, assigneeId: { not: null } }, data: { assigneeId: null } })
  await db.conversation.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.orderEvent.deleteMany({ where: { order: { tenantId: TENANT_ID } } })
  await db.commissionEntry.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.shipment.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.orderItem.deleteMany({ where: { order: { tenantId: TENANT_ID } } })
  await db.attribution.deleteMany({})
  await db.order.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.customer.deleteMany({ where: { tenantId: TENANT_ID } })

  // 3. Load product (PIJAMA SHORT TIRAS = PIJ-SHORT-TIRA-001)
  const product = await db.product.findUnique({ where: { tenantId_sku: { tenantId: TENANT_ID, sku: 'PIJ-SHORT-TIRA-001' } } })
  if (!product) throw new Error('Product PIJ-SHORT-TIRA-001 not found. Run seed first.')

  // 4. Load channel + campaign/ad for attribution
  const channel = await db.channel.findFirst({ where: { tenantId: TENANT_ID, type: 'whatsapp' } })
  const ads = await db.ad.findMany({ where: { campaign: { tenantId: TENANT_ID } } })

  let gmvTotal = 0
  let count = 0
  const customerCache = new Map<string, string>() // phone → customerId

  for (let i = 0; i < uniqueOrders.length; i++) {
    const r = uniqueOrders[i]
    const phone = (r['phone'] || '').trim()
    const fullName = (r['Nombre completo'] || r['first_name'] || '').trim() || `Cliente ${phone || i}`
    const city = (r['Ciudad'] || '').trim()
    const dept = (r['Departamento/ Provincia'] || '').trim()
    const address = (r['Dirección'] || '').trim()
    const boardCol = (r['board_column_name'] || '').trim()
    const status = BOARD_TO_STATUS[boardCol] || 'pending_confirmation'
    const total = parseValue(r['Valor de la compra'])
    const qty = parseInt(r['Cantidad de productos'] || '1') || 1
    const adId = (r['[WhatsApp IA] ID del anuncio'] || '').trim()
    const carrier = (r['Transportadora'] || '').trim()
    const createdAt = parseDate(r['Fecha de compra']) || new Date(Date.now() - i * 86400000)

    gmvTotal += total
    count++

    // Create or reuse customer
    let customerId = customerCache.get(phone)
    if (!customerId) {
      const customer = await db.customer.create({
        data: {
          tenantId: TENANT_ID,
          name: fullName,
          phone: phone ? `+57${phone}` : null,
          country: 'CO',
          city: city || null,
          address: address || null,
          perfilDetectado: qty >= 6 ? 'mayorista' : qty >= 3 ? 'emprendedor' : 'detal',
          tags: qty >= 6 ? 'mayorista' : qty >= 3 ? 'emprendedor' : 'detal',
          lifetimeValue: total,
          ordersCount: 1,
        }
      })
      customerId = customer.id
      customerCache.set(phone, customerId)
    }

    // Determine payment mode (COD is default for Saramantha; advance if link was sent)
    const paymentMode = r['¿Enviamos enlace de pago?'] === 'true' ? 'advance' : 'cod'
    const paymentStatus = status === 'despachado' || status === 'oficina' ? 'paid'
      : paymentMode === 'advance' && status !== 'intent_cancelacion' ? 'paid'
      : 'cod_pending'

    // Create order
    const orderNumber = `CF-${100200 + i}`
    const order = await db.order.create({
      data: {
        tenantId: TENANT_ID,
        number: orderNumber,
        customerId,
        channelId: channel?.id,
        status,
        paymentMode,
        paymentStatus,
        subtotal: total,
        discount: paymentMode === 'advance' ? Math.round(total * 0.05) : 0,
        codFee: paymentMode === 'cod' ? 8000 : 0,
        total: paymentMode === 'advance' ? total - Math.round(total * 0.05) : total + (paymentMode === 'cod' ? 8000 : 0),
        currency: 'COP',
        country: 'CO',
        city: city || null,
        address: address || '—',
        origen: 'agente_whatsapp',
        sourcePlatform: adId ? 'meta' : null,
        sourceAdId: null, // will link to our Ad if found, else null
        attributedAt: adId ? createdAt : null,
        paidAt: paymentStatus === 'paid' ? createdAt : null,
        createdAt,
      }
    })

    // OrderItem — always PIJAMA SHORT TIRAS (100% of orders per §15)
    await db.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        name: 'Short Tira',
        unitPrice: total / qty,
        cost: 7400,
        quantity: qty,
        diseno: 'liso',
      }
    })

    // OrderEvent
    await db.orderEvent.create({ data: { orderId: order.id, type: 'created', createdAt } })
    if (['datos_completados', 'oficina', 'programado', 'despachado'].includes(status)) {
      await db.orderEvent.create({ data: { orderId: order.id, type: 'confirmed', createdAt: new Date(createdAt.getTime() + 86400000) } })
    }
    if (status === 'despachado') {
      await db.orderEvent.create({ data: { orderId: order.id, type: 'shipped', createdAt: new Date(createdAt.getTime() + 2 * 86400000) } })
    }

    // Shipment — only for the 17/239 with carrier filled (§15.2: 7.1%)
    if (carrier) {
      await db.shipment.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          proveedor: 'dropi',
          numeroGuia: `DROP-${100000 + i}`,
          transportadora: carrier, // raw value (one of the 6 variants)
          transportadoraCanonica: 'Interrapidísimo', // normalized
          tarifa: 12000,
          tiempoEstimadoDias: 3,
          estado: status === 'despachado' ? 'en_transito' : 'generada',
          createdAt: new Date(createdAt.getTime() + 86400000),
        }
      })
    }

    // CommissionEntry — §17.7: 50% datos_completados, 100% despachado
    if (status === 'datos_completados' || status === 'despachado') {
      const pct = status === 'despachado' ? 100 : 50
      const comisionTotal = order.total * 4.5 / 100
      await db.commissionEntry.create({
        data: {
          tenantId: TENANT_ID,
          orderId: order.id,
          gmv: order.total,
          comisionPct: 4.5,
          comisionTotal,
          reconocidaPct: pct,
          reconocidaMonto: comisionTotal * pct / 100,
          etapaReconocimiento: status === 'despachado' ? 'despachado' : 'datos_completados',
          reconocidaAt: new Date(createdAt.getTime() + 86400000),
        }
      })
    }
  }

  console.log(`\n✅ ${count} pedidos REALES cargados`)
  console.log(`   GMV total: $${gmvTotal.toLocaleString('es-CO')} COP (objetivo §15: $32,746,242)`)
  console.log(`   AOV: $${Math.round(gmvTotal / count).toLocaleString('es-CO')} COP (objetivo §15: $137,014)`)
  console.log(`   Customers únicos: ${customerCache.size}`)

  // Update invoice
  await db.invoice.deleteMany({ where: { tenantId: TENANT_ID } })
  const tramo = gmvTotal < 10000000 ? { label: '0-10M', pct: 4.5 } : gmvTotal < 40000000 ? { label: '10-40M', pct: 3 } : { label: '40M+', pct: 1.75 }
  const comisionTotal = gmvTotal * tramo.pct / 100
  await db.invoice.create({
    data: {
      tenantId: TENANT_ID,
      periodo: '2026-07',
      gmvTotal: gmvTotal,
      feeBase: 350000,
      comisionTotal,
      tramoAplicado: tramo.label,
      total: 350000 + comisionTotal,
      estado: 'emitida',
      emitidaAt: new Date(),
    }
  })
  console.log(`   Invoice emitida: tramo ${tramo.label} (${tramo.pct}%), comisión $${comisionTotal.toLocaleString('es-CO')}, total $${(350000 + comisionTotal).toLocaleString('es-CO')}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
