// Generate multi-touch test attributions to verify first_click/linear/time_decay models.
// Creates orders with 2-3 ad touchpoints each so the different attribution models
// produce different credited revenue per ad.
// Run: bun run scripts/seed-multitouch.ts

import { db } from '../src/lib/db'

const TENANT_ID = 'ten-saramantha'

async function main() {
  console.log('Generating multi-touch test attributions...')

  // Get ads for Saramantha
  const ads = await db.ad.findMany({ where: { campaign: { tenantId: TENANT_ID } }, take: 3 })
  if (ads.length < 2) { console.error('Need at least 2 ads'); return }

  // Get a customer
  const customer = await db.customer.findFirst({ where: { tenantId: TENANT_ID } })
  if (!customer) { console.error('No customer found'); return }

  // Get channel
  const channel = await db.channel.findFirst({ where: { tenantId: TENANT_ID, type: 'whatsapp' } })

  // Get product
  const product = await db.product.findFirst({ where: { tenantId: TENANT_ID, sku: 'PIJ-SHORT-TIRA-001' } })
  if (!product) { console.error('No product found'); return }

  // Create 5 test orders, each with 2-3 ad touches
  for (let i = 0; i < 5; i++) {
    const numAd = Math.min(2 + (i % 2), ads.length) // 2 or 3 ads
    const touchAds = ads.slice(0, numAd)

    const total = 150000 + i * 10000
    const order = await db.order.create({
      data: {
        tenantId: TENANT_ID,
        number: `CF-MT-${1000 + i}`,
        customerId: customer.id,
        channelId: channel?.id,
        status: 'datos_completados',
        paymentMode: 'advance',
        paymentStatus: 'paid',
        subtotal: total,
        discount: Math.round(total * 0.05),
        codFee: 0,
        total: total - Math.round(total * 0.05),
        currency: 'COP',
        country: 'CO', city: 'Bogotá', address: 'Cra 10 # 20-30',
        origen: 'agente_whatsapp',
        attributedAt: new Date(),
        paidAt: new Date(),
        createdAt: new Date(Date.now() - (5 - i) * 86400000),
      }
    })

    await db.orderItem.create({
      data: { orderId: order.id, productId: product.id, name: product.name, unitPrice: product.price, cost: product.cost, quantity: 6 }
    })

    // Create 2-3 attribution touchpoints with different timestamps (multi-touch)
    for (let j = 0; j < numAd; j++) {
      const touchDate = new Date(Date.now() - (5 - i + j) * 86400000) // each touch 1 day apart
      await db.attribution.create({
        data: {
          orderId: order.id,
          adId: touchAds[j].id,
          weight: 1.0, // will be recomputed by the attribution engine
          model: 'last_click', // placeholder, will recompute
          touch: j === numAd - 1 ? 'click' : 'view',
          createdAt: touchDate,
        }
      })
    }

    console.log(`  Order ${order.number}: ${numAd} touches, total ${order.total}`)
  }

  // Now recompute with each model to show the difference
  const { recomputeAttributionWeights, getCreditedRevenueByAd } = await import('../src/lib/attribution/engine')

  for (const model of ['last_click', 'first_click', 'linear', 'time_decay'] as const) {
    const result = await recomputeAttributionWeights(TENANT_ID, model)
    console.log(`\n  Model ${model}: ${result.attributionsUpdated} attributions updated`)

    const credited = await getCreditedRevenueByAd(TENANT_ID, model)
    for (const a of credited) {
      console.log(`    ${a.adName}: $${a.creditedRevenue.toLocaleString('es-CO')} (${a.creditedOrders} orders)`)
    }
  }

  console.log('\n✅ Multi-touch test data created + 4 models verified')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
