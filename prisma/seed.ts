// CommerceFlow OS — Seed script
// Run: bun run db:seed
import { PrismaClient } from '@prisma/client'
import { db } from '../src/lib/db'

// Deterministic helpers
const daysAgo = (n: number, h = 0, m = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, m, 0, 0)
  return d
}
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]
const rand = (seed: number, min: number, max: number) => {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return Math.round(min + r * (max - min))
}

async function main() {
  console.log('🌱 Seeding CommerceFlow OS...')

  // ── Users ────────────────────────────────────────────────────────
  const admin = await db.user.upsert({
    where: { email: 'admin@commerceflow.co' },
    update: {},
    create: { email: 'admin@commerceflow.co', name: 'Valentina Restrepo', role: 'admin' },
  })
  const agent1 = await db.user.upsert({
    where: { email: 'agent@commerceflow.co' },
    update: {},
    create: { email: 'agent@commerceflow.co', name: 'Camila Torres', role: 'agent' },
  })
  const trafficker = await db.user.upsert({
    where: { email: 'traffick@commerceflow.co' },
    update: {},
    create: { email: 'traffick@commerceflow.co', name: 'Sebastián Marín', role: 'trafficker' },
  })

  // ── Channels ─────────────────────────────────────────────────────
  const waCO = await db.channel.upsert({
    where: { id: 'ch-wa-co' },
    update: {},
    create: {
      id: 'ch-wa-co',
      type: 'whatsapp', name: 'WhatsApp Colombia', displayName: 'WhatsApp · CO',
      accountId: '+573001112233', verified: true, active: true, country: 'CO',
      paymentStrategy: 'hybrid', requirePrepayMin: 250000, prepayDiscountPct: 5, codFee: 8000,
    },
  })
  const waMX = await db.channel.upsert({
    where: { id: 'ch-wa-mx' },
    update: {},
    create: {
      id: 'ch-wa-mx',
      type: 'whatsapp', name: 'WhatsApp México', displayName: 'WhatsApp · MX',
      accountId: '+525511223344', verified: true, active: true, country: 'MX',
      paymentStrategy: 'cod', codFee: 60,
    },
  })
  const msgGlobal = await db.channel.upsert({
    where: { id: 'ch-msg-global' },
    update: {},
    create: {
      id: 'ch-msg-global',
      type: 'messenger', name: 'Messenger Global', displayName: 'Messenger · INTL',
      accountId: 'page_8821', verified: true, active: true, country: null,
      paymentStrategy: 'advance', prepayDiscountPct: 7,
    },
  })
  const igGlobal = await db.channel.upsert({
    where: { id: 'ch-ig-global' },
    update: {},
    create: {
      id: 'ch-ig-global',
      type: 'instagram', name: 'Instagram DM', displayName: 'Instagram · INTL',
      accountId: 'ig_shop_421', verified: true, active: true, country: null,
      paymentStrategy: 'hybrid', requirePrepayMin: 80, prepayDiscountPct: 5, codFee: 4,
    },
  })

  // ── Products ─────────────────────────────────────────────────────
  const products = await Promise.all([
    db.product.upsert({ where: { sku: 'SKN-GLOW-01' }, update: {}, create: { sku: 'SKN-GLOW-01', name: 'Serum Vitamina C Glow', description: 'Serum facial 30ml con vitamina C 15%', price: 89000, cost: 31000, stock: 420, imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400' }}),
    db.product.upsert({ where: { sku: 'SKN-HYD-02' }, update: {}, create: { sku: 'SKN-HYD-02', name: 'Crema Hidratante Ácido Hialurónico', description: 'Hidratante 50ml', price: 72000, cost: 24000, stock: 350, imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400' }}),
    db.product.upsert({ where: { sku: 'HAIR-KER-03' }, update: {}, create: { sku: 'HAIR-KER-03', name: 'Shampoo Keratina Reparador', description: 'Shampoo 400ml sin sulfatos', price: 54000, cost: 18000, stock: 600, imageUrl: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=400' }}),
    db.product.upsert({ where: { sku: 'PERF-AMR-04' }, update: {}, create: { sku: 'PERF-AMR-04', name: 'Perfume Ámbar Noir 50ml', description: 'Eau de parfum', price: 145000, cost: 52000, stock: 180, imageUrl: 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=400' }}),
    db.product.upsert({ where: { sku: 'SUP-COL-05' }, update: {}, create: { sku: 'SUP-COL-05', name: 'Colágeno Hidrolizado 300g', description: 'Suplemento vitalidad', price: 99000, cost: 36000, stock: 240, imageUrl: 'https://images.unsplash.com/photo-1556228852-80b6e5eeff06?w=400' }}),
  ])

  // ── Customers ────────────────────────────────────────────────────
  const customers = await Promise.all([
    db.customer.upsert({ where: { id: 'cus-001' }, update: {}, create: { id: 'cus-001', name: 'Diana Cárdenas', phone: '+573101234567', country: 'CO', city: 'Medellín', address: 'Calle 34 # 45-12, El Poblado', tags: 'vip,repeat', lifetimeValue: 534000, ordersCount: 4 }}),
    db.customer.upsert({ where: { id: 'cus-002' }, update: {}, create: { id: 'cus-002', name: 'Andrés Gómez', phone: '+573112345678', country: 'CO', city: 'Bogotá', address: 'Cra 15 # 93-47', tags: 'new', lifetimeValue: 89000, ordersCount: 1 }}),
    db.customer.upsert({ where: { id: 'cus-003' }, update: {}, create: { id: 'cus-003', name: 'Mariana López', phone: '+573213456789', country: 'CO', city: 'Cali', address: 'Av 6N # 22-15', tags: 'repeat', lifetimeValue: 218000, ordersCount: 2 }}),
    db.customer.upsert({ where: { id: 'cus-004' }, update: {}, create: { id: 'cus-004', name: 'Carlos Ramírez', phone: '+573004567890', country: 'CO', city: 'Barranquilla', address: 'Calle 70 # 40-21', tags: 'cod', lifetimeValue: 145000, ordersCount: 1 }}),
    db.customer.upsert({ where: { id: 'cus-005' }, update: {}, create: { id: 'cus-005', name: 'Jessica Müller', psid: 'messenger_psid_8841', country: 'DE', city: 'Berlin', address: 'Hauptstrasse 12', tags: 'intl', lifetimeValue: 0, ordersCount: 0 }}),
    db.customer.upsert({ where: { id: 'cus-006' }, update: {}, create: { id: 'cus-006', name: 'Sofía Fernández', psid: 'messenger_psid_2093', country: 'ES', city: 'Madrid', tags: 'intl,repeat', lifetimeValue: 0, ordersCount: 0 }}),
    db.customer.upsert({ where: { id: 'cus-007' }, update: {}, create: { id: 'cus-007', name: 'Ricardo Mendoza', phone: '+525511448899', country: 'MX', city: 'CDMX', address: 'Polanco', tags: 'cod,mx', lifetimeValue: 0, ordersCount: 0 }}),
    db.customer.upsert({ where: { id: 'cus-008' }, update: {}, create: { id: 'cus-008', name: 'Laura Sánchez', phone: '+573155566778', country: 'CO', city: 'Bucaramanga', tags: 'new', lifetimeValue: 0, ordersCount: 0 }}),
  ])

  // ── Ad Platforms ─────────────────────────────────────────────────
  const meta = await db.adPlatform.upsert({ where: { name: 'meta' }, update: {}, create: { id: 'ap-meta', name: 'meta', displayName: 'Meta Ads', accountId: 'act_102455', active: true }})
  const google = await db.adPlatform.upsert({ where: { name: 'google' }, update: {}, create: { id: 'ap-google', name: 'google', displayName: 'Google Ads', accountId: '123-456-7890', active: true }})
  const tiktok = await db.adPlatform.upsert({ where: { name: 'tiktok' }, update: {}, create: { id: 'ap-tiktok', name: 'tiktok', displayName: 'TikTok Ads', accountId: 'tt_act_9981', active: true }})

  // ── Campaigns & Ads ──────────────────────────────────────────────
  // Meta
  const campMetaGlow = await db.campaign.upsert({ where: { id: 'camp-meta-glow' }, update: {}, create: { id: 'camp-meta-glow', platformId: meta.id, externalId: 'meta_camp_glow', name: 'CO · Glow Serum · Sales', objective: 'sales', budgetDaily: 180000, currency: 'COP', status: 'active', country: 'CO' }})
  const campMetaPerfume = await db.campaign.upsert({ where: { id: 'camp-meta-perf' }, update: {}, create: { id: 'camp-meta-perf', platformId: meta.id, externalId: 'meta_camp_perf', name: 'CO · Ámbar Noir · Sales', objective: 'sales', budgetDaily: 220000, currency: 'COP', status: 'active', country: 'CO' }})
  const campMetaCollagen = await db.campaign.upsert({ where: { id: 'camp-meta-coll' }, update: {}, create: { id: 'camp-meta-coll', platformId: meta.id, externalId: 'meta_camp_coll', name: 'CO · Colágeno · Sales', objective: 'sales', budgetDaily: 90000, currency: 'COP', status: 'active', country: 'CO' }})
  const campMessengerIntl = await db.campaign.upsert({ where: { id: 'camp-meta-msg' }, update: {}, create: { id: 'camp-meta-msg', platformId: meta.id, externalId: 'meta_camp_msg', name: 'INTL · Messenger · Sales', objective: 'sales', budgetDaily: 45, currency: 'USD', status: 'active', country: null }})

  // Google
  const campGoogleSearch = await db.campaign.upsert({ where: { id: 'camp-g-search' }, update: {}, create: { id: 'camp-g-search', platformId: google.id, externalId: 'g_camp_search', name: 'CO · Search Brand + SKU', objective: 'traffic', budgetDaily: 60000, currency: 'COP', status: 'active', country: 'CO' }})
  const campGooglePMax = await db.campaign.upsert({ where: { id: 'camp-g-pmax' }, update: {}, create: { id: 'camp-g-pmax', platformId: google.id, externalId: 'g_camp_pmax', name: 'CO · Performance Max', objective: 'sales', budgetDaily: 150000, currency: 'COP', status: 'active', country: 'CO' }})

  // TikTok
  const campTikTokGlow = await db.campaign.upsert({ where: { id: 'camp-tt-glow' }, update: {}, create: { id: 'camp-tt-glow', platformId: tiktok.id, externalId: 'tt_camp_glow', name: 'CO · Glow Serum · TikTok Spark', objective: 'sales', budgetDaily: 110000, currency: 'COP', status: 'active', country: 'CO' }})

  // Ads (the key identifiers)
  const ads = [
    // Meta Glow — winner
    { id: 'ad-m-glow-1', ext: 'meta_120201_glow_carousel', name: 'Glow · Carrusel UGC testimonios', camp: campMetaGlow.id, status: 'active', creative: 'video_ugc_01' },
    { id: 'ad-m-glow-2', ext: 'meta_120202_glow_static', name: 'Glow · Estático antes/después', camp: campMetaGlow.id, status: 'active', creative: 'static_ba_01' },
    { id: 'ad-m-glow-3', ext: 'meta_120203_glow_reel', name: 'Glow · Reel influencer', camp: campMetaGlow.id, status: 'active', creative: 'reel_inf_01' },
    // Meta Perfume — mixed
    { id: 'ad-m-perf-1', ext: 'meta_120301_perf_video', name: 'Ámbar Noir · Video 30s', camp: campMetaPerfume.id, status: 'active', creative: 'video_30s' },
    { id: 'ad-m-perf-2', ext: 'meta_120302_perf_static', name: 'Ámbar Noir · Estático lujoso', camp: campMetaPerfume.id, status: 'active', creative: 'static_lux' },
    // Meta Collagen — LOSER (cannibalizing)
    { id: 'ad-m-coll-1', ext: 'meta_120401_coll_carousel', name: 'Colágeno · Carrusel beneficios', camp: campMetaCollagen.id, status: 'active', creative: 'carousel_ben' },
    { id: 'ad-m-coll-2', ext: 'meta_120402_coll_static', name: 'Colágeno · Estático precio', camp: campMetaCollagen.id, status: 'active', creative: 'static_price' },
    // Messenger intl
    { id: 'ad-m-msg-1', ext: 'meta_120501_msg_video', name: 'Messenger · Video producto', camp: campMessengerIntl.id, status: 'active', creative: 'video_intl' },
    // Google
    { id: 'ad-g-srch-1', ext: 'g_kwd_glow', name: 'Keyword · serum vitamina c', camp: campGoogleSearch.id, status: 'active', creative: 'rsa_glow' },
    { id: 'ad-g-pmax-1', ext: 'g_pmax_assets_1', name: 'PMax · Shopping CO', camp: campGooglePMax.id, status: 'active', creative: 'pmax_assets' },
    // TikTok
    { id: 'ad-tt-glow-1', ext: 'tt_glow_spark_01', name: 'Glow · Spark Ad creator', camp: campTikTokGlow.id, status: 'active', creative: 'spark_01' },
    { id: 'ad-tt-glow-2', ext: 'tt_glow_spark_02', name: 'Glow · Spark Ad creator 2', camp: campTikTokGlow.id, status: 'active', creative: 'spark_02' },
  ]
  for (const a of ads) {
    await db.ad.upsert({
      where: { externalId: a.ext },
      update: {},
      create: { id: a.id, externalId: a.ext, campaignId: a.camp, name: a.name, creative: a.creative, status: a.status }
    })
  }

  // ── Ad Spend (last 14 days) ──────────────────────────────────────
  console.log('  → generating ad spend (14 days)...')
  // Spend profiles per ad (some winners, some losers)
  const profiles: Record<string, { spend: number, conv: number }> = {
    'ad-m-glow-1': { spend: 14000, conv: 3 },   // strong ROAS
    'ad-m-glow-2': { spend: 9000, conv: 2 },
    'ad-m-glow-3': { spend: 12000, conv: 2 },
    'ad-m-perf-1': { spend: 18000, conv: 1 },   // weak
    'ad-m-perf-2': { spend: 7000, conv: 1 },
    'ad-m-coll-1': { spend: 11000, conv: 0 },   // LOSER
    'ad-m-coll-2': { spend: 8000, conv: 0 },    // LOSER
    'ad-m-msg-1':  { spend: 4, conv: 1 },       // intl USD
    'ad-g-srch-1': { spend: 5000, conv: 1 },
    'ad-g-pmax-1': { spend: 13000, conv: 2 },
    'ad-tt-glow-1': { spend: 9500, conv: 1 },
    'ad-tt-glow-2': { spend: 8800, conv: 0 },   // LOSER
  }
  for (let d = 13; d >= 0; d--) {
    for (const a of ads) {
      const p = profiles[a.id]
      const daySpend = p.spend + rand(d + a.id.length, -p.spend * 0.3, p.spend * 0.4)
      const dayConv = Math.max(0, p.conv + (rand(d + a.id.length * 2, -1, 2)))
      const imp = rand(d, 800, 4500)
      const clk = Math.round(imp * (0.012 + (rand(d, 0, 8) / 1000)))
      await db.adSpend.upsert({
        where: { adId_date: { adId: a.id, date: daysAgo(d) } },
        update: {},
        create: { adId: a.id, date: daysAgo(d), spend: Math.round(daySpend), impressions: imp, clicks: clk, convReported: dayConv }
      })
    }
  }

  // ── Conversations & Messages ─────────────────────────────────────
  console.log('  → generating conversations...')
  const convos = [
    { id: 'conv-001', cust: 'cus-001', ch: waCO.id, status: 'open', priority: 'high', assignee: agent1.id, sourceAd: 'ad-m-glow-1', sourceCampaign: campMetaGlow.name, utm: 'utm_source=meta&utm_campaign=glow', msgs: [
      { dir: 'inbound', body: 'Hola! Vi el anuncio del serum de vitamina C. Tienen promoción?', t: 12 },
      { dir: 'outbound', body: '¡Hola Diana! Claro 💛 El Serum Vitamina C Glow está a $89.000. Si pagas anticipado por el carrito te damos 5% de descuento y envío gratis.', t: 11 },
      { dir: 'inbound', body: 'Perfecto, lo quiero. Pago anticipado con link', t: 10 },
      { dir: 'outbound', body: 'Genial 🙌 Te paso el link de pago: commerceflow.co/pay/CF-100042. Una vez confirmado despachamos hoy mismo.', t: 9 },
    ]},
    { id: 'conv-002', cust: 'cus-002', ch: waCO.id, status: 'pending', priority: 'normal', sourceAd: 'ad-tt-glow-1', sourceCampaign: campTikTokGlow.name, utm: 'utm_source=tiktok', msgs: [
      { dir: 'inbound', body: 'Buenas, quieren contra entrega en Bogotá?', t: 8 },
      { dir: 'outbound', body: 'Hola Andrés 👋 Sí manejamos contra entrega. El producto llega en 24-48h y pagas al recibir. ¿Confirmo el pedido?', t: 7 },
      { dir: 'inbound', body: 'Si, confirmo', t: 6 },
    ]},
    { id: 'conv-003', cust: 'cus-003', ch: waCO.id, status: 'open', priority: 'urgent', assignee: agent1.id, sourceAd: 'ad-m-glow-2', sourceCampaign: campMetaGlow.name, msgs: [
      { dir: 'inbound', body: 'Mi pedido CF-100040 no llegó, ya pasaron 3 días', t: 5 },
    ]},
    { id: 'conv-004', cust: 'cus-004', ch: waCO.id, status: 'open', priority: 'normal', sourceAd: 'ad-g-pmax-1', sourceCampaign: campGooglePMax.name, msgs: [
      { dir: 'inbound', body: 'Quiero 2 shampoo de keratina, pago contra entrega en Barranquilla', t: 4 },
    ]},
    { id: 'conv-005', cust: 'cus-005', ch: msgGlobal.id, status: 'open', priority: 'normal', sourceAd: 'ad-m-msg-1', sourceCampaign: campMessengerIntl.name, msgs: [
      { dir: 'inbound', body: 'Hi! Do you ship the Glow Serum to Germany?', t: 6 },
      { dir: 'outbound', body: 'Hi Jessica! Yes, we ship to the EU 🇪🇺. The Serum is $24 USD incl. shipping. Prepayment via our cart is required for international orders.', t: 5 },
    ]},
    { id: 'conv-006', cust: 'cus-006', ch: msgGlobal.id, status: 'resolved', priority: 'low', sourceAd: 'ad-m-msg-1', sourceCampaign: campMessengerIntl.name, msgs: [
      { dir: 'inbound', body: 'Hola, ¿hacen envíos a Madrid?', t: 9 },
      { dir: 'outbound', body: '¡Hola Sofía! Sí, enviamos a toda la UE. El Ámbar Noir está a 48€. Pago anticipado por el carrito.', t: 8 },
      { dir: 'inbound', body: 'Perfecto, ya compré por la web. Gracias!', t: 7 },
    ]},
    { id: 'conv-007', cust: 'cus-007', ch: waMX.id, status: 'open', priority: 'normal', sourceAd: 'ad-m-glow-3', sourceCampaign: campMetaGlow.name, msgs: [
      { dir: 'inbound', body: 'Buen día, manejan contra entrega en CDMX?', t: 3 },
    ]},
    { id: 'conv-008', cust: 'cus-008', ch: igGlobal.id, status: 'open', priority: 'normal', sourceAd: 'ad-m-glow-1', sourceCampaign: campMetaGlow.name, msgs: [
      { dir: 'inbound', body: 'Me encanta el serum! Cómo compro?', t: 2 },
    ]},
  ]

  for (const c of convos) {
    await db.conversation.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id, customerId: c.cust, channelId: c.ch, status: c.status, priority: c.priority,
        assigneeId: c.assignee, sourceAdId: c.sourceAd, sourceCampaign: c.sourceCampaign,
        utm: c.utm, lastMessageAt: daysAgo(0, c.msgs[c.msgs.length-1]?.t || 1),
        unreadCount: c.status === 'open' ? 1 : 0,
      }
    })
    for (const m of c.msgs) {
      await db.message.create({
        data: { conversationId: c.id, direction: m.dir, body: m.body, type: 'text', status: m.dir === 'inbound' ? 'delivered' : 'read', createdAt: daysAgo(0, m.t) }
      })
    }
  }

  // ── Orders ───────────────────────────────────────────────────────
  console.log('  → generating orders...')
  const orders = [
    { id: 'ord-001', num: 'CF-100040', cust: 'cus-001', conv: 'conv-001', ch: waCO.id, status: 'delivered', pmode: 'advance', pstatus: 'paid', items: [{ p: products[0], q: 1 }], ad: 'ad-m-glow-1', camp: campMetaGlow.name, plat: 'meta', click: 'fbclk_881', daysAgo: 6, paidAt: 6, country: 'CO', city: 'Medellín' },
    { id: 'ord-002', num: 'CF-100041', cust: 'cus-002', conv: 'conv-002', ch: waCO.id, status: 'shipped', pmode: 'cod', pstatus: 'cod_pending', items: [{ p: products[0], q: 1 }], ad: 'ad-tt-glow-1', camp: campTikTokGlow.name, plat: 'tiktok', click: 'ttclk_552', daysAgo: 4, country: 'CO', city: 'Bogotá' },
    { id: 'ord-003', num: 'CF-100042', cust: 'cus-001', conv: null, ch: waCO.id, status: 'preparing', pmode: 'advance', pstatus: 'paid', items: [{ p: products[0], q: 1 }, { p: products[1], q: 1 }], ad: 'ad-m-glow-1', camp: campMetaGlow.name, plat: 'meta', click: 'fbclk_910', daysAgo: 1, paidAt: 1, country: 'CO', city: 'Medellín' },
    { id: 'ord-004', num: 'CF-100043', cust: 'cus-003', conv: 'conv-003', ch: waCO.id, status: 'shipped', pmode: 'advance', pstatus: 'paid', items: [{ p: products[3], q: 1 }], ad: 'ad-m-glow-2', camp: campMetaGlow.name, plat: 'meta', click: 'fbclk_744', daysAgo: 5, paidAt: 5, country: 'CO', city: 'Cali' },
    { id: 'ord-005', num: 'CF-100044', cust: 'cus-004', conv: 'conv-004', ch: waCO.id, status: 'new', pmode: 'cod', pstatus: 'cod_pending', items: [{ p: products[2], q: 2 }], ad: 'ad-g-pmax-1', camp: campGooglePMax.name, plat: 'google', click: 'gclid_330', daysAgo: 0, country: 'CO', city: 'Barranquilla' },
    { id: 'ord-006', num: 'CF-100045', cust: 'cus-001', conv: null, ch: waCO.id, status: 'delivered', pmode: 'advance', pstatus: 'paid', items: [{ p: products[4], q: 1 }], ad: 'ad-m-glow-1', camp: campMetaGlow.name, plat: 'meta', click: 'fbclk_880', daysAgo: 9, paidAt: 9, country: 'CO', city: 'Medellín' },
    { id: 'ord-007', num: 'CF-100046', cust: 'cus-006', conv: 'conv-006', ch: msgGlobal.id, status: 'delivered', pmode: 'advance', pstatus: 'paid', items: [{ p: products[3], q: 1 }], ad: 'ad-m-msg-1', camp: campMessengerIntl.name, plat: 'meta', click: 'fbclk_700', daysAgo: 8, paidAt: 8, country: 'ES', city: 'Madrid', currency: 'EUR', fxTotal: 48 },
    { id: 'ord-008', num: 'CF-100047', cust: 'cus-003', conv: null, ch: waCO.id, status: 'delivered', pmode: 'cod', pstatus: 'paid', items: [{ p: products[1], q: 1 }], ad: 'ad-m-glow-3', camp: campMetaGlow.name, plat: 'meta', click: 'fbclk_665', daysAgo: 7, paidAt: 6, country: 'CO', city: 'Cali' },
    { id: 'ord-009', num: 'CF-100048', cust: 'cus-001', conv: null, ch: waCO.id, status: 'delivered', pmode: 'advance', pstatus: 'paid', items: [{ p: products[0], q: 1 }], ad: 'ad-g-pmax-1', camp: campGooglePMax.name, plat: 'google', click: 'gclid_410', daysAgo: 10, paidAt: 10, country: 'CO', city: 'Medellín' },
    { id: 'ord-010', num: 'CF-100049', cust: 'cus-002', conv: null, ch: waCO.id, status: 'delivered', pmode: 'cod', pstatus: 'paid', items: [{ p: products[0], q: 1 }], ad: 'ad-tt-glow-1', camp: campTikTokGlow.name, plat: 'tiktok', click: 'ttclk_500', daysAgo: 11, paidAt: 10, country: 'CO', city: 'Bogotá' },
  ]

  for (const o of orders) {
    const subtotal = o.items.reduce((s, it) => s + it.p.price * it.q, 0)
    const discount = o.pmode === 'advance' ? subtotal * 0.05 : 0
    const codFee = o.pmode === 'cod' ? 8000 : 0
    const total = subtotal - discount + codFee
    const order = await db.order.upsert({
      where: { number: o.num },
      update: {},
      create: {
        id: o.id, number: o.num, customerId: o.cust, conversationId: o.conv, channelId: o.ch,
        status: o.status, paymentMode: o.pmode, paymentStatus: o.pstatus,
        subtotal, discount, codFee, total, currency: o.currency || 'COP',
        country: o.country, city: o.city, address: '—',
        sourceAdId: o.ad, sourceCampaign: o.camp, sourcePlatform: o.plat, clickId: o.click,
        attributedAt: daysAgo(o.daysAgo), paidAt: o.paidAt != null ? daysAgo(o.paidAt) : null,
        createdAt: daysAgo(o.daysAgo),
      }
    })
    for (const it of o.items) {
      await db.orderItem.create({ data: { orderId: order.id, productId: it.p.id, name: it.p.name, unitPrice: it.p.price, cost: it.p.cost, quantity: it.q }})
    }
    // order events
    await db.orderEvent.create({ data: { orderId: order.id, type: 'created', createdAt: daysAgo(o.daysAgo) }})
    if (o.pstatus === 'paid' || o.pstatus === 'cod_pending') {
      await db.orderEvent.create({ data: { orderId: order.id, type: o.pmode === 'cod' ? 'cod_pending' : 'paid', createdAt: daysAgo(o.daysAgo) }})
    }
    if (['shipped','delivered'].includes(o.status)) {
      await db.orderEvent.create({ data: { orderId: order.id, type: 'shipped', createdAt: daysAgo(o.daysAgo - 1) }})
    }
    if (o.status === 'delivered') {
      await db.orderEvent.create({ data: { orderId: order.id, type: 'delivered', createdAt: daysAgo(o.daysAgo - 2) }})
    }
    // attribution link
    await db.attribution.create({ data: { orderId: order.id, adId: o.ad, weight: 1.0, model: 'last_click', touch: 'click', createdAt: daysAgo(o.daysAgo) }})
  }

  // ── Automation rules & settings ──────────────────────────────────
  await db.automationRule.upsert({ where: { id: 'rule-1' }, update: {}, create: { id: 'rule-1', name: 'Bienvenida WhatsApp CO', trigger: 'new_conversation', condition: '{"channel":"whatsapp"}', action: 'auto_reply', active: true }})
  await db.automationRule.upsert({ where: { id: 'rule-2' }, update: {}, create: { id: 'rule-2', name: 'Pausar anuncios con ROAS < 0.8', trigger: 'ad_underperforming', condition: '{"roas_lt":0.8,"spend_gt":50000}', action: 'pause_ad', active: true }})
  await db.automationRule.upsert({ where: { id: 'rule-3' }, update: {}, create: { id: 'rule-3', name: 'Asignar urgentes a Camila', trigger: 'keyword', condition: '{"keywords":["urgente","no llegó","reclamo"]}', action: 'assign', active: true }})

  await db.setting.upsert({ where: { key: 'default_currency' }, update: {}, create: { key: 'default_currency', value: 'COP' }})
  await db.setting.upsert({ where: { key: 'default_country' }, update: {}, create: { key: 'default_country', value: 'CO' }})
  await db.setting.upsert({ where: { key: 'roas_kill_threshold' }, update: {}, create: { key: 'roas_kill_threshold', value: '0.8' }})
  await db.setting.upsert({ where: { key: 'cpa_target' }, update: {}, create: { key: 'cpa_target', value: '35000' }})
  await db.setting.upsert({ where: { key: 'cod_max_order_value' }, update: {}, create: { key: 'cod_max_order_value', value: '250000' }})

  console.log('✅ Seed complete.')
  console.log(`   Users: 3 | Channels: 4 | Products: 5 | Customers: 8`)
  console.log(`   Conversations: 8 | Orders: 10 | Ads: 12`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
