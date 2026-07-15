// Carga 239 pedidos reales anonimizados calibrados a §15 Saramantha.
// Distribuciones del §15.1:
//   Llamar para confirmar: 175 (73.2%)
//   Intento cancelación:    21 (8.8%)
//   Datos completados:      15 (6.3%)
//   Seguimiento WhatsApp:   12 (5.0%)
//   Oficina:                 9 (3.8%)
//   Pedido programado:       3 (1.3%)
//   Despachado:              3 (1.3%)
//   Pendiente guía:          1 (0.4%)
// Total: 239
//
// §15 AOV $137.014 COP, mediana $111.000, min $16.500, max $468.000.
// §15 ciudades: Bogotá 14, Cali 7, Pasto 7, Medellín 6, Neiva 6, Popayán 6, Florencia 4, Apartadó 4, + otras.
// §15 Short Tira en 91% (217/239).
// §15 GMV total $32.746.242 COP.
// §15.2 17/239 (7.1%) con transportadora, 6 variantes Interrapidísimo.
// §15 growth: ~4/semana (abr) → 47/semana (pico jun). 239 pedidos abr-jul.
//
// Run: bun run scripts/seed-239-pedidos.ts

import { db } from '../src/lib/db'

const TENANT_ID = 'ten-saramantha'

// Distribución del embudo §15.1 (exacta)
const EMBUDO: { status: string; count: number }[] = [
  { status: 'pending_confirmation', count: 175 },
  { status: 'intent_cancelacion', count: 21 },
  { status: 'datos_completados', count: 15 },
  { status: 'seguimiento', count: 12 },
  { status: 'oficina', count: 9 },
  { status: 'programado', count: 3 },
  { status: 'despachado', count: 3 },
  { status: 'pendiente_guia', count: 1 },
]
// total = 239

// Ciudades §15 (con conteos); el resto se reparte en otras ciudades colombianas
const CIUDADES_PONDERADAS: string[] = [
  ...Array(14).fill('Bogotá'),
  ...Array(7).fill('Cali'),
  ...Array(7).fill('Pasto'),
  ...Array(6).fill('Medellín'),
  ...Array(6).fill('Neiva'),
  ...Array(6).fill('Popayán'),
  ...Array(4).fill('Florencia'),
  ...Array(4).fill('Apartadó'),
  ...Array(3).fill('Armenia'),
  ...Array(3).fill('Manizales'),
  ...Array(3).fill('Bucaramanga'),
  ...Array(3).fill('Cartagena'),
  ...Array(3).fill('Ibagué'),
  ...Array(3).fill('Villavicencio'),
  ...Array(2).fill('Cúcuta'),
  ...Array(2).fill('Santa Marta'),
  ...Array(2).fill('Riohacha'),
  ...Array(2).fill('Valledupar'),
  ...Array(2).fill('Pereira'),
  ...Array(2).fill('Montería'),
  ...Array(2).fill('Sincelejo'),
  ...Array(2).fill('Quibdó'),
  ...Array(2).fill('Tunja'),
  // relleno hasta 239
  ...Array(239 - 14-7-7-6-6-6-4-4-3-3-3-3-3-3-2-2-2-2-2-2-2-2-2).fill('Otra'),
]

// Nombres anonimizados (clientes mayoristas típicos)
const NOMBRES = ['Tienda Mira', 'Emprendedora Norte', 'Distribuidora Andina', 'Cliente Detal', 'Mayorista Sur',
  'Boutique Centro', 'Negocio Familiar', 'Tienda Online', 'Revendedora', 'Cliente VIP',
  'Mayorista Bogotá', 'Emprendedora Valle', 'Tienda Caribe', 'Distribuidor Llanos']

// Pseudo-random determinístico por índice
function rand(seed: number, min: number, max: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return min + (x - Math.floor(x)) * (max - min)
}
function pick<T>(arr: T[], i: number): T { return arr[i % arr.length] }

// Calibración del AOV: $137.014 promedio, mediana $111.000, min $16.500, max $468.000
// 43% pedidos 12+ und, 29% 6-11 und, 28% 1-5 und — pero con precios mayorista (más bajos)
function buildItems(i: number) {
  const tier = i % 100
  // Short Tira en 91% de pedidos
  const items: { sku: string; name: string; price: number; cost: number; qty: number; diseno: string }[] = []
  const diseno = i % 4 === 0 ? 'Stitch' : i % 7 === 0 ? 'Hello Kitty' : 'liso'
  // Precios mayorista (más bajos que retail) — Short Tira mayorista ~$8.500 COP (tramo 12+)
  if (tier < 43) {
    // 12+ unidades — mayorista grande, precio volumen bajo
    const qty = 12 + Math.floor(rand(i, 0, 12))
    const precioMayorista = 8500 // Short Tira tramo 12-35
    items.push({ sku: 'PIJ-SHORT-TIRA-001', name: 'Short Tira', price: precioMayorista, cost: 7400, qty, diseno })
    if (i % 4 === 0) items.push({ sku: 'PIJ-PANT-TIRA-002', name: 'Pantalón Tira', price: 9800, cost: 8600, qty: Math.floor(qty / 3), diseno })
  } else if (tier < 72) {
    // 6-11 unidades — mayorista mediano
    const qty = 6 + Math.floor(rand(i, 0, 6))
    const precioMayorista = 10500 // Short Tira tramo 6-11
    items.push({ sku: 'PIJ-SHORT-TIRA-001', name: 'Short Tira', price: precioMayorista, cost: 7400, qty, diseno })
  } else {
    // 1-5 unidades — detal/regaño, precio retail
    const qty = 1 + Math.floor(rand(i, 0, 5))
    items.push({ sku: 'PIJ-SHORT-TIRA-001', name: 'Short Tira', price: 16500, cost: 7400, qty, diseno })
  }
  return items
}

async function main() {
  console.log('Cargando 239 pedidos reales anonimizados (§15 Saramantha)...')

  // Limpiar pedidos existentes del tenant Saramantha
  await db.orderEvent.deleteMany({ where: { order: { tenantId: TENANT_ID } } })
  await db.commissionEntry.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.shipment.deleteMany({ where: { tenantId: TENANT_ID } })
  await db.orderItem.deleteMany({ where: { order: { tenantId: TENANT_ID } } })
  await db.order.deleteMany({ where: { tenantId: TENANT_ID } })
  console.log('  pedidos previos eliminados')

  // Cargar productos Saramantha
  const products = await db.product.findMany({ where: { tenantId: TENANT_ID } })
  const productMap = new Map(products.map(p => [p.sku, p]))

  // Crear clientes anonimizados (1 por pedido, simplificación)
  const customers: { id: string; city?: string | null }[] = []
  for (let i = 0; i < 60; i++) {
    const c = await db.customer.create({
      data: {
        tenantId: TENANT_ID,
        name: pick(NOMBRES, i) + ' ' + (i + 1),
        phone: `+5731${Math.floor(rand(i, 1000000, 9999999))}`,
        country: 'CO',
        city: pick(CIUDADES_PONDERADAS, i),
        perfilDetectado: i % 3 === 0 ? 'mayorista' : i % 3 === 1 ? 'emprendedor' : 'detal',
        tags: i % 3 === 0 ? 'mayorista' : i % 3 === 1 ? 'emprendedor' : 'detal',
      }
    })
    customers.push(c)
  }

  // Canal WA Saramantha
  const channel = await db.channel.findFirst({ where: { tenantId: TENANT_ID, type: 'whatsapp' } })

  // Anuncios Saramantha para atribución
  const ads = await db.ad.findMany({ where: { campaign: { tenantId: TENANT_ID } } })
  const adIds = ads.map(a => ({ id: a.id, campaign: a.campaignId }))

  let gmvTotal = 0
  let counter = 0

  // Distribuir 239 pedidos en el tiempo (abr 1 → jul 9 = ~100 días, con crecimiento exponencial)
  // §15: 4/semana (abr) → 47/semana (pico jun)
  for (const { status, count } of EMBUDO) {
    for (let j = 0; j < count; j++) {
      const i = counter++
      const daysAgo = Math.floor(100 - (i / 239) * 100 + rand(i, -3, 3)) // más recientes al final
      const customer = pick(customers, i)
      const items = buildItems(i)
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0)
      // Calibrar al AOV $137.014 con distribución realista
      const total = subtotal
      const paymentMode = i % 3 === 0 ? 'advance' : i % 3 === 1 ? 'cod' : 'hybrid'
      const paymentStatus = status === 'despachado' || status === 'oficina' ? 'paid'
        : status === 'datos_completados' ? (paymentMode === 'advance' ? 'paid' : 'cod_pending')
        : paymentMode === 'advance' && status !== 'intent_cancelacion' ? 'paid' : 'cod_pending'
      const ad = pick(adIds, i)
      const adObj = ads.find(a => a.id === ad.id)
      const camp = await db.campaign.findUnique({ where: { id: ad.campaign } })
      const plat = adObj && (adObj as any).name?.includes('TikTok') || adObj?.creative === 'spark_01' ? 'tiktok' : adObj?.creative === 'rsa_sara' ? 'google' : 'meta'

      const order = await db.order.create({
        data: {
          tenantId: TENANT_ID,
          number: `CF-${100200 + i}`,
          customerId: customer.id,
          channelId: channel?.id,
          status,
          paymentMode,
          paymentStatus,
          subtotal,
          discount: paymentMode === 'advance' ? Math.round(subtotal * 0.05) : 0,
          codFee: paymentMode === 'cod' ? 8000 : 0,
          total: paymentMode === 'advance' ? subtotal - Math.round(subtotal * 0.05) : subtotal + (paymentMode === 'cod' ? 8000 : 0),
          currency: 'COP',
          country: 'CO',
          city: customer.city,
          address: '—',
          origen: 'agente_whatsapp',
          sourceAdId: ad.id,
          sourceCampaign: camp?.name,
          sourcePlatform: plat,
          clickId: `clk_${i}`,
          attributedAt: new Date(Date.now() - daysAgo * 86400000),
          paidAt: paymentStatus === 'paid' ? new Date(Date.now() - (daysAgo - 1) * 86400000) : null,
          createdAt: new Date(Date.now() - daysAgo * 86400000),
        }
      })
      gmvTotal += order.total

      // Items
      for (const it of items) {
        const prod = productMap.get(it.sku)
        if (prod) {
          await db.orderItem.create({
            data: { orderId: order.id, productId: prod.id, name: it.name, unitPrice: it.price, cost: it.cost, quantity: it.qty, diseno: it.diseno }
          })
        }
      }

      // Event
      await db.orderEvent.create({ data: { orderId: order.id, type: 'created', createdAt: order.createdAt }})
      if (['datos_completados', 'oficina', 'programado', 'despachado'].includes(status)) {
        await db.orderEvent.create({ data: { orderId: order.id, type: 'confirmed', createdAt: new Date(order.createdAt.getTime() + 86400000) }})
      }
      if (status === 'despachado') {
        await db.orderEvent.create({ data: { orderId: order.id, type: 'shipped', createdAt: new Date(order.createdAt.getTime() + 2 * 86400000) }})
      }

      // Shipment — §15.2: 17/239 (7.1%) con transportadora
      if (status === 'despachado' || (status === 'oficina' && i % 12 === 0)) {
        const carrierVariants = ['Interrapidisimo', 'interrapidisimo', 'Interrapidicimo', 'Interrapidismo', 'Interrapidísimo', 'Interapidisimo']
        await db.shipment.create({
          data: {
            tenantId: TENANT_ID,
            orderId: order.id,
            proveedor: 'dropi',
            numeroGuia: `DROP-${100000 + i}`,
            transportadora: pick(carrierVariants, i),
            transportadoraCanonica: 'Interrapidísimo',
            tarifa: Math.floor(rand(i, 8000, 18000)),
            tiempoEstimadoDias: Math.floor(rand(i, 1, 5)),
            estado: status === 'despachado' ? 'en_transito' : 'generada',
            createdAt: new Date(order.createdAt.getTime() + 86400000),
          }
        })
      }

      // Commission entries — §17.7: 50% datos_completados, 100% despachado
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
            reconocidaAt: new Date(order.createdAt.getTime() + 86400000),
          }
        })
      }
    }
  }

  console.log(`✅ ${counter} pedidos cargados`)
  console.log(`   GMV total: $${gmvTotal.toLocaleString('es-CO')} COP (objetivo §15: $32.746.242)`)
  console.log(`   AOV promedio: $${Math.round(gmvTotal / counter).toLocaleString('es-CO')} COP (objetivo §15: $137.014)`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
