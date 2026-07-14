// CommerceFlow OS — Seed v2 (multi-tenant + Saramantha real data)
// 4 tenants Indisutex: Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina
// Run: bun run db:seed
import { db } from '../src/lib/db'
import * as bcrypt from 'bcryptjs'

const daysAgo = (n: number, h = 0, m = 0) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d
}
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]
const rand = (seed: number, min: number, max: number) => {
  const x = Math.sin(seed) * 10000; const r = x - Math.floor(x)
  return Math.round(min + r * (max - min))
}

async function main() {
  console.warn('🌱 Seeding CommerceFlow OS v2 (multi-tenant + Saramantha real data)...')

  // ── 4 Tenants (Indisutex SAS brands) ─────────────────────────────
  const saramantha = await db.tenant.upsert({
    where: { slug: 'saramantha' }, update: {},
    create: {
      id: 'ten-saramantha', slug: 'saramantha',
      nombreNegocio: 'Saramantha', marca: 'Saramantha',
      plataformaCatalogo: 'whatsapp_catalog', bdCatalogo: 'supabase_nuestro',
      proveedorIa: 'zai', proveedorLogistico: 'dropi',
      wabaId: 'waba_saramantha', tonoMarca: 'Tutea, certeza total, sin disculpas. Cierra con acción. Máx 20 palabras por mensaje, 2 emojis.',
      nombreAsesora: 'Sara', politicaPago: 'híbrido: prepay 5% off > $250k, COD debajo con $8k COP recargo',
      preguntaPerfil: '¿Para ti o para surtir tu negocio?',
      planMonetizacion: 'catalogo_incluido', feeBaseMensual: 350000, comisionPctInicial: 4.5,
    },
  })
  const majestic = await db.tenant.upsert({
    where: { slug: 'majestic' }, update: {},
    create: {
      id: 'ten-majestic', slug: 'majestic',
      nombreNegocio: 'Sublimados Majestic', marca: 'Majestic',
      plataformaCatalogo: 'whatsapp_catalog', proveedorIa: 'zai', proveedorLogistico: 'dropi',
      wabaId: 'waba_majestic', tonoMarca: 'Cercano, juvenil, emojis moderados.',
      nombreAsesora: 'Majé', politicaPago: 'híbrido', preguntaPerfil: '¿Para ti o para venta?',
      planMonetizacion: 'conecta', feeBaseMensual: 250000, comisionPctInicial: 4.5,
    },
  })
  const lovely = await db.tenant.upsert({
    where: { slug: 'lovely' }, update: {},
    create: {
      id: 'ten-lovely', slug: 'lovely',
      nombreNegocio: 'Lovely Pijamas', marca: 'Lovely',
      plataformaCatalogo: 'whatsapp_catalog', proveedorIa: 'zai', proveedorLogistico: '99envios',
      wabaId: 'waba_lovely', tonoMarca: 'Dulce, femenino, max 2 emojis.',
      nombreAsesora: 'Valentina', politicaPago: 'cod', preguntaPerfil: '¿Para regalo o para ti?',
      planMonetizacion: 'completo', feeBaseMensual: 500000, comisionPctInicial: 4.5,
    },
  })
  const reina = await db.tenant.upsert({
    where: { slug: 'reina' }, update: {},
    create: {
      id: 'ten-reina', slug: 'reina',
      nombreNegocio: 'Sueño de Reina', marca: 'Reina',
      plataformaCatalogo: 'whatsapp_catalog', proveedorIa: 'zai', proveedorLogistico: 'aveonline',
      wabaId: 'waba_reina', tonoMarca: 'Elegante, formal, sin emojis excesivos.',
      nombreAsesora: 'Reina', politicaPago: 'advance', preguntaPerfil: '¿Para ti o para regalar?',
      planMonetizacion: 'catalogo_incluido', feeBaseMensual: 350000, comisionPctInicial: 4.5,
    },
  })

  // Plus the original demo tenant for the international Messenger/IG case
  const intl = await db.tenant.upsert({
    where: { slug: 'intl' }, update: {},
    create: {
      id: 'ten-intl', slug: 'intl',
      nombreNegocio: 'CommerceFlow Demo INTL', marca: 'Demo',
      plataformaCatalogo: 'catalogo_nuestro', proveedorIa: 'zai', proveedorLogistico: 'dropi',
      tonoMarca: 'Bilingüe ES/EN, friendly, emojis moderate.',
      nombreAsesora: 'Lucía', politicaPago: 'advance',
      preguntaPerfil: '¿Para ti o para tu tienda?',
      planMonetizacion: 'conecta', feeBaseMensual: 250000, comisionPctInicial: 4.5,
    },
  })

  // ── Users (1 admin per tenant + shared agents) ────────────────────
  // Existing demo users (commerceflow.co domain) — preserve IDs, add auth.
  const demoPasswordHash = await bcrypt.hash('demo123', 10)
  await db.user.upsert({ where: { email: 'valentina@commerceflow.co' },
    update: { passwordHash: demoPasswordHash, status: 'active' },
    create: { id: 'user-valentina', tenantId: saramantha.id, email: 'valentina@commerceflow.co', name: 'Valentina Restrepo', role: 'admin', passwordHash: demoPasswordHash, status: 'active' }})
  await db.user.upsert({ where: { email: 'camila@commerceflow.co' },
    update: { passwordHash: demoPasswordHash, status: 'active' },
    create: { id: 'user-camila', tenantId: saramantha.id, email: 'camila@commerceflow.co', name: 'Camila Torres', role: 'agent', passwordHash: demoPasswordHash, status: 'active' }})
  await db.user.upsert({ where: { email: 'sebastian@commerceflow.co' },
    update: { passwordHash: demoPasswordHash, status: 'active' },
    create: { id: 'user-sebastian', tenantId: saramantha.id, email: 'sebastian@commerceflow.co', name: 'Sebastián Marín', role: 'trafficker', passwordHash: demoPasswordHash, status: 'active' }})

  // ── Auth demo users (canonical @saramantha.co / @trafficker.co) ──
  // These are the credentials advertised on the /login page:
  //   valentina@saramantha.co / demo123   → admin  · Saramantha
  //   camila@saramantha.co    / demo123   → agent  · Saramantha
  //   sebastian@trafficker.co / demo123   → trafficker (platform, no tenant)
  await db.user.upsert({ where: { email: 'valentina@saramantha.co' },
    update: { passwordHash: demoPasswordHash, status: 'active', tenantId: saramantha.id, role: 'admin', name: 'Valentina Restrepo' },
    create: { id: 'user-valentina-sara', tenantId: saramantha.id, email: 'valentina@saramantha.co', name: 'Valentina Restrepo', role: 'admin', passwordHash: demoPasswordHash, status: 'active' }})
  await db.user.upsert({ where: { email: 'camila@saramantha.co' },
    update: { passwordHash: demoPasswordHash, status: 'active', tenantId: saramantha.id, role: 'agent', name: 'Camila Torres' },
    create: { id: 'user-camila-sara', tenantId: saramantha.id, email: 'camila@saramantha.co', name: 'Camila Torres', role: 'agent', passwordHash: demoPasswordHash, status: 'active' }})
  await db.user.upsert({ where: { email: 'sebastian@trafficker.co' },
    update: { passwordHash: demoPasswordHash, status: 'active', tenantId: null, role: 'trafficker', name: 'Sebastián Marín' },
    create: { id: 'user-sebastian-traf', tenantId: null, email: 'sebastian@trafficker.co', name: 'Sebastián Marín', role: 'trafficker', passwordHash: demoPasswordHash, status: 'active' }})

  // ── Channels ─────────────────────────────────────────────────────
  // Saramantha: WhatsApp CO + Messenger INTL + Instagram
  const waSara = await db.channel.upsert({ where: { id: 'ch-wa-sara' }, update: {},
    create: { id: 'ch-wa-sara', tenantId: saramantha.id, type: 'whatsapp', name: 'WhatsApp Saramantha CO', displayName: 'WhatsApp · Saramantha', accountId: '+573001112233', verified: true, country: 'CO', paymentStrategy: 'hybrid', requirePrepayMin: 250000, prepayDiscountPct: 5, codFee: 8000 }})
  const _msgSara = await db.channel.upsert({ where: { id: 'ch-msg-sara' }, update: {},
    create: { id: 'ch-msg-sara', tenantId: saramantha.id, type: 'messenger', name: 'Messenger Saramantha INTL', displayName: 'Messenger · INTL', verified: true, paymentStrategy: 'advance', prepayDiscountPct: 7 }})
  const _igSara = await db.channel.upsert({ where: { id: 'ch-ig-sara' }, update: {},
    create: { id: 'ch-ig-sara', tenantId: saramantha.id, type: 'instagram', name: 'Instagram Saramantha', displayName: 'Instagram · Saramantha', verified: true, paymentStrategy: 'hybrid', requirePrepayMin: 80, prepayDiscountPct: 5, codFee: 4 }})

  await db.channel.upsert({ where: { id: 'ch-wa-majestic' }, update: {},
    create: { id: 'ch-wa-majestic', tenantId: majestic.id, type: 'whatsapp', name: 'WhatsApp Majestic', displayName: 'WhatsApp · Majestic', accountId: '+573009988776', verified: true, country: 'CO', paymentStrategy: 'hybrid', requirePrepayMin: 200000, prepayDiscountPct: 5, codFee: 8000 }})
  await db.channel.upsert({ where: { id: 'ch-wa-lovely' }, update: {},
    create: { id: 'ch-wa-lovely', tenantId: lovely.id, type: 'whatsapp', name: 'WhatsApp Lovely', displayName: 'WhatsApp · Lovely', accountId: '+573004433221', verified: true, country: 'CO', paymentStrategy: 'cod', codFee: 8000 }})
  await db.channel.upsert({ where: { id: 'ch-wa-reina' }, update: {},
    create: { id: 'ch-wa-reina', tenantId: reina.id, type: 'whatsapp', name: 'WhatsApp Reina', displayName: 'WhatsApp · Reina', accountId: '+573007766554', verified: true, country: 'CO', paymentStrategy: 'advance', prepayDiscountPct: 6 }})

  // INTL tenant
  const _waIntl = await db.channel.upsert({ where: { id: 'ch-wa-intl' }, update: {},
    create: { id: 'ch-wa-intl', tenantId: intl.id, type: 'whatsapp', name: 'WhatsApp INTL', displayName: 'WhatsApp · INTL', verified: true, country: null, paymentStrategy: 'cod', codFee: 60 }})
  const msgIntl = await db.channel.upsert({ where: { id: 'ch-msg-intl' }, update: {},
    create: { id: 'ch-msg-intl', tenantId: intl.id, type: 'messenger', name: 'Messenger INTL', displayName: 'Messenger · INTL', verified: true, paymentStrategy: 'advance', prepayDiscountPct: 7 }})
  const _igIntl = await db.channel.upsert({ where: { id: 'ch-ig-intl' }, update: {},
    create: { id: 'ch-ig-intl', tenantId: intl.id, type: 'instagram', name: 'Instagram INTL', displayName: 'Instagram · INTL', verified: true, paymentStrategy: 'hybrid', requirePrepayMin: 80, prepayDiscountPct: 5, codFee: 4 }})

  // ── Saramantha: REAL catalog (Short Tira, Pantalón, Batola + designs) ─
  console.warn('  → Saramantha real catalog...')
  const pShort = await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-SHORT-TIRA-001' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-SHORT-TIRA-001', name: 'Short Tira', description: 'Short de pijama tela fría, tiras ajustables', price: 16500, cost: 7400, stock: 480, imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400', categoria: 'short', diseno: 'liso', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  const pPant = await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-PANT-TIRA-002' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-PANT-TIRA-002', name: 'Pantalón Tira', description: 'Pantalón tejido plano, elástico', price: 19000, cost: 8600, stock: 320, imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400', categoria: 'pantalon', diseno: 'liso', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  const pBatola = await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-BATOLA-003' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-BATOLA-003', name: 'Batola', description: 'Batola fresca de descanso', price: 23000, cost: 10500, stock: 240, imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400', categoria: 'batola', diseno: 'liso', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  // Variants with designs (Stitch, Hello Kitty)
  await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-SHORT-STITCH-001' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-SHORT-STITCH-001', name: 'Short Tira Stitch', description: 'Short Tira estampado Stitch', price: 18500, cost: 8400, stock: 180, imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400', categoria: 'short', diseno: 'Stitch', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-SHORT-HELLO-001' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-SHORT-HELLO-001', name: 'Short Tira Hello Kitty', description: 'Short Tira estampado Hello Kitty', price: 18500, cost: 8400, stock: 150, imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400', categoria: 'short', diseno: 'Hello Kitty', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-PANT-STITCH-002' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-PANT-STITCH-002', name: 'Pantalón Tira Stitch', description: 'Pantalón estampado Stitch', price: 21000, cost: 9600, stock: 140, imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400', categoria: 'pantalon', diseno: 'Stitch', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})
  await db.product.upsert({ where: { tenantId_sku: { tenantId: saramantha.id, sku: 'PIJ-BATOLA-STITCH-003' } }, update: {},
    create: { tenantId: saramantha.id, sku: 'PIJ-BATOLA-STITCH-003', name: 'Batola Stitch', description: 'Batola estampada Stitch', price: 25000, cost: 11500, stock: 90, imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400', categoria: 'batola', diseno: 'Stitch', imagenMetadataVisible: true, fuenteSincronizacion: 'whatsapp_catalog' }})

  // Volume prices (Saramantha §15: 43% pedidos 12+ unidades, AOV $137k)
  const volTiers = [
    { tipo: 'mayorista', min: 6, max: 11, pct: 0.92 },
    { tipo: 'mayorista', min: 12, max: 35, pct: 0.83 },
    { tipo: 'mayorista', min: 36, max: 999, pct: 0.75 },
    { tipo: 'emprendedor', min: 3, max: 5, pct: 0.95 },
    { tipo: 'emprendedor', min: 6, max: 11, pct: 0.90 },
    { tipo: 'detal', min: 1, max: 2, pct: 1.0 },
    { tipo: 'regalo', min: 1, max: 2, pct: 1.0 },
  ]
  for (const p of [pShort, pPant, pBatola]) {
    for (const t of volTiers) {
      await db.volumePrice.create({ data: { tenantId: saramantha.id, productId: p.id, sku: p.sku, tipoCliente: t.tipo, cantidadMinima: t.min, cantidadMaxima: t.max, precioUnitario: Math.round(p.price * t.pct) }})
    }
  }

  // Sales speeches by profile
  await db.salesSpeech.upsert({ where: { tenantId_perfil: { tenantId: saramantha.id, perfil: 'mayorista' } }, update: {},
    create: { tenantId: saramantha.id, perfil: 'mayorista', aperturaTexto: '¡Hola! Sara de Saramantha. Para surtir tienda tienes precio mayorista desde 6 unidades. ¿Qué tema buscas?', pruebaSocial: 'Llegamos a 240 tiendas en 12 ciudades esta temporada.' }})
  await db.salesSpeech.upsert({ where: { tenantId_perfil: { tenantId: saramantha.id, perfil: 'emprendedor' } }, update: {},
    create: { tenantId: saramantha.id, perfil: 'emprendedor', aperturaTexto: '¡Hola! Empiezas tu emprendimiento. Te llevo combo desde 3 unidades con precio emprendedor.', pruebaSocial: '+180 emprendedores arrancaron con Saramantha este año.' }})
  await db.salesSpeech.upsert({ where: { tenantId_perfil: { tenantId: saramantha.id, perfil: 'detal' } }, update: {},
    create: { tenantId: saramantha.id, perfil: 'detal', aperturaTexto: '¡Hola! Para ti, precio unitario. ¿Stitch, Hello Kitty o liso?', pruebaSocial: '+5.000 clientes felices con su pijama.' }})
  await db.salesSpeech.upsert({ where: { tenantId_perfil: { tenantId: saramantha.id, perfil: 'regalo' } }, update: {},
    create: { tenantId: saramantha.id, perfil: 'regalo', aperturaTexto: '¡Hola! Para regalo te recomiendo Short + Pantalón del mismo tema. ¿Qué le gusta a la persona?', pruebaSocial: 'El combo Stitch es nuestro regalo más pedido.' }})

  // Objections
  for (const o of [
    { tipo: 'desconfianza', resp: 'Entiendo. Llevamos 3 años, sede en Itagüí, pago contra entrega si prefieres. ¿Bogotá, Cali o Medellín?', gatillo: 'prueba_social' },
    { tipo: 'precio', resp: 'El precio mayorista baja 17% desde 12 unidades. ¿Cuántas querías?', gatillo: 'escasez' },
    { tipo: 'talla', resp: 'Tenemos S, M, L. Si no sirve, cambio sin costo en 7 días.', gatillo: 'garantia' },
    { tipo: 'lo_pienso', resp: 'Claro. Te guardo el precio 24h. ¿Stitch o Hello Kitty te gustó más?', gatillo: 'urgencia' },
    { tipo: 'producto_no_disponible', resp: 'Ese tema se agotó pero llegó Stitch nuevo ayer. ¿Te lo muestro?', gatillo: 'sustitucion' },
  ]) {
    await db.objection.upsert({ where: { tenantId_tipoObjecion: { tenantId: saramantha.id, tipoObjecion: o.tipo } }, update: {},
      create: { tenantId: saramantha.id, tipoObjecion: o.tipo, respuestaBase: o.resp, gatilloMentalAsociado: o.gatillo }})
  }

  // Themes (Stitch, Hello Kitty)
  await db.themeDesign.upsert({ where: { tenantId_tema: { tenantId: saramantha.id, tema: 'Stitch' } }, update: {},
    create: { tenantId: saramantha.id, tema: 'Stitch', nombreDiseno: 'Stitch', skusAsociados: 'PIJ-SHORT-STITCH-001,PIJ-PANT-STITCH-002,PIJ-BATOLA-STITCH-003' }})
  await db.themeDesign.upsert({ where: { tenantId_tema: { tenantId: saramantha.id, tema: 'Hello Kitty' } }, update: {},
    create: { tenantId: saramantha.id, tema: 'Hello Kitty', nombreDiseno: 'Hello Kitty', skusAsociados: 'PIJ-SHORT-HELLO-001' }})

  // Category combos (familia = mínimo 3 prendas)
  await db.categoryCombo.upsert({ where: { tenantId_categoria: { tenantId: saramantha.id, categoria: 'familia' } }, update: {},
    create: { tenantId: saramantha.id, categoria: 'familia', skusRecomendados: 'PIJ-SHORT-TIRA-001,PIJ-PANT-TIRA-002,PIJ-BATOLA-003' }})

  // ── Carriers (canonical + 6 variants of Interrapidísimo) ─────────
  await db.carrier.upsert({ where: { tenantId_nombreCanonico: { tenantId: saramantha.id, nombreCanonico: 'Interrapidísimo' } }, update: {},
    create: { tenantId: saramantha.id, nombreCanonico: 'Interrapidísimo', variantes: 'Interrapidisimo,interrapidisimo,Interrapidicimo,Interrapidismo,Interrapidísimo,Interapidisimo', cobertura: 'nacional' }})
  await db.carrier.upsert({ where: { tenantId_nombreCanonico: { tenantId: saramantha.id, nombreCanonico: 'TCC' } }, update: {},
    create: { tenantId: saramantha.id, nombreCanonico: 'TCC', variantes: 'TCC,tcc,Transportadora TCC', cobertura: 'nacional' }})
  await db.carrier.upsert({ where: { tenantId_nombreCanonico: { tenantId: saramantha.id, nombreCanonico: 'Coordinadora' } }, update: {},
    create: { tenantId: saramantha.id, nombreCanonico: 'Coordinadora', variantes: 'Coordinadora,coordinadora,Coordinadora Mercantil', cobertura: 'nacional' }})
  await db.carrier.upsert({ where: { tenantId_nombreCanonico: { tenantId: saramantha.id, nombreCanonico: 'Servientrega' } }, update: {},
    create: { tenantId: saramantha.id, nombreCanonico: 'Servientrega', variantes: 'Servientrega,servientrega', cobertura: 'nacional' }})
  await db.carrier.upsert({ where: { tenantId_nombreCanonico: { tenantId: saramantha.id, nombreCanonico: 'Envía' } }, update: {},
    create: { tenantId: saramantha.id, nombreCanonico: 'Envía', variantes: 'Envia,Envía,envia', cobertura: 'nacional' }})

  // ── Ad Platforms + Campaigns + Ads (Meta, Google, TikTok) ────────
  const meta = await db.adPlatform.upsert({ where: { name: 'meta' }, update: {}, create: { id: 'ap-meta', name: 'meta', displayName: 'Meta Ads', accountId: 'act_102455', active: true }})
  const google = await db.adPlatform.upsert({ where: { name: 'google' }, update: {}, create: { id: 'ap-google', name: 'google', displayName: 'Google Ads', accountId: '123-456-7890', active: true }})
  const tiktok = await db.adPlatform.upsert({ where: { name: 'tiktok' }, update: {}, create: { id: 'ap-tiktok', name: 'tiktok', displayName: 'TikTok Ads', accountId: 'tt_act_9981', active: true }})

  // Saramantha campaigns
  const campSaraGlow = await db.campaign.upsert({ where: { id: 'camp-sara-familia' }, update: {},
    create: { id: 'camp-sara-familia', tenantId: saramantha.id, platformId: meta.id, externalId: 'meta_camp_sara_familia', name: 'CO · Pijama Familia · Sales', objective: 'sales', budgetDaily: 180000, currency: 'COP', status: 'active', country: 'CO' }})
  const campSaraStitch = await db.campaign.upsert({ where: { id: 'camp-sara-stitch' }, update: {},
    create: { id: 'camp-sara-stitch', tenantId: saramantha.id, platformId: meta.id, externalId: 'meta_camp_sara_stitch', name: 'CO · Stitch · Sales', objective: 'sales', budgetDaily: 120000, currency: 'COP', status: 'active', country: 'CO' }})
  const campSaraPerder = await db.campaign.upsert({ where: { id: 'camp-sara-coll' }, update: {},
    create: { id: 'camp-sara-coll', tenantId: saramantha.id, platformId: meta.id, externalId: 'meta_camp_sara_perdedor', name: 'CO · Batola liso (perdedor)', objective: 'sales', budgetDaily: 90000, currency: 'COP', status: 'active', country: 'CO' }})
  const campSaraTT = await db.campaign.upsert({ where: { id: 'camp-sara-tt' }, update: {},
    create: { id: 'camp-sara-tt', tenantId: saramantha.id, platformId: tiktok.id, externalId: 'tt_camp_sara_spark', name: 'CO · Saramantha TikTok Spark', objective: 'sales', budgetDaily: 110000, currency: 'COP', status: 'active', country: 'CO' }})
  const campSaraG = await db.campaign.upsert({ where: { id: 'camp-sara-g' }, update: {},
    create: { id: 'camp-sara-g', tenantId: saramantha.id, platformId: google.id, externalId: 'g_camp_sara_search', name: 'CO · Search Brand', objective: 'traffic', budgetDaily: 60000, currency: 'COP', status: 'active', country: 'CO' }})

  // INTL tenant campaigns (Messenger focus)
  const campIntlMsg = await db.campaign.upsert({ where: { id: 'camp-intl-msg' }, update: {},
    create: { id: 'camp-intl-msg', tenantId: intl.id, platformId: meta.id, externalId: 'meta_camp_intl_msg', name: 'INTL · Messenger · Sales', objective: 'sales', budgetDaily: 45, currency: 'USD', status: 'active', country: null }})

  const ads = [
    { id: 'ad-sara-fam-1', ext: 'meta_220101_fam_carousel', name: 'Familia · Carrusel UGC', camp: campSaraGlow.id, status: 'active', creative: 'video_ugc_01' },
    { id: 'ad-sara-fam-2', ext: 'meta_220102_fam_static', name: 'Familia · Estático antes/después', camp: campSaraGlow.id, status: 'active', creative: 'static_ba_01' },
    { id: 'ad-sara-fam-3', ext: 'meta_220103_fam_reel', name: 'Familia · Reel influencer', camp: campSaraGlow.id, status: 'active', creative: 'reel_inf_01' },
    { id: 'ad-sara-stitch-1', ext: 'meta_220201_stitch_video', name: 'Stitch · Video 30s', camp: campSaraStitch.id, status: 'active', creative: 'video_stitch' },
    { id: 'ad-sara-coll-1', ext: 'meta_220301_batola_carousel', name: 'Batola liso · Carrusel (perdedor)', camp: campSaraPerder.id, status: 'active', creative: 'carousel_liso' },
    { id: 'ad-sara-coll-2', ext: 'meta_220302_batola_static', name: 'Batola liso · Estático precio (perdedor)', camp: campSaraPerder.id, status: 'active', creative: 'static_price' },
    { id: 'ad-sara-tt-1', ext: 'tt_220401_sara_spark', name: 'Saramantha · Spark Ad creator', camp: campSaraTT.id, status: 'active', creative: 'spark_01' },
    { id: 'ad-sara-g-1', ext: 'g_220501_sara_kwd', name: 'Keyword · pijama mayorista', camp: campSaraG.id, status: 'active', creative: 'rsa_sara' },
    { id: 'ad-intl-msg-1', ext: 'meta_220601_intl_msg', name: 'INTL · Messenger video producto', camp: campIntlMsg.id, status: 'active', creative: 'video_intl' },
  ]
  for (const a of ads) {
    await db.ad.upsert({ where: { externalId: a.ext }, update: {},
      create: { id: a.id, externalId: a.ext, campaignId: a.camp, name: a.name, creative: a.creative, status: a.status }})
  }

  // Ad spend (14 days)
  console.warn('  → generating ad spend (14 days)...')
  const profiles: Record<string, { spend: number, conv: number }> = {
    'ad-sara-fam-1': { spend: 14000, conv: 3 }, 'ad-sara-fam-2': { spend: 9000, conv: 2 },
    'ad-sara-fam-3': { spend: 12000, conv: 2 }, 'ad-sara-stitch-1': { spend: 11000, conv: 2 },
    'ad-sara-coll-1': { spend: 11000, conv: 0 }, 'ad-sara-coll-2': { spend: 8000, conv: 0 },
    'ad-sara-tt-1': { spend: 9500, conv: 1 }, 'ad-sara-g-1': { spend: 5000, conv: 1 },
    'ad-intl-msg-1': { spend: 4, conv: 1 },
  }
  for (let d = 13; d >= 0; d--) {
    for (const a of ads) {
      const p = profiles[a.id]
      const daySpend = p.spend + rand(d + a.id.length, -p.spend * 0.3, p.spend * 0.4)
      const dayConv = Math.max(0, p.conv + (rand(d + a.id.length * 2, -1, 2)))
      const imp = rand(d, 800, 4500); const clk = Math.round(imp * (0.012 + (rand(d, 0, 8) / 1000)))
      await db.adSpend.upsert({ where: { adId_date: { adId: a.id, date: daysAgo(d) } }, update: {},
        create: { adId: a.id, date: daysAgo(d), spend: Math.round(daySpend), impressions: imp, clicks: clk, convReported: dayConv }})
    }
  }

  // ── Saramantha customers + conversations (real-ish based on §15) ─
  console.warn('  → Saramantha conversations + 239-pedido summary...')
  // Sample customers across cities (§15: Bogotá 14, Cali 7, Pasto 7, Medellín 6, Neiva 6, Popayán 6, Florencia 4, Apartadó 4)
  const cities = ['Bogotá', 'Cali', 'Pasto', 'Medellín', 'Neiva', 'Popayán', 'Florencia', 'Apartadó']
  const saraCustomers = []
  for (let i = 0; i < 12; i++) {
    const city = pick(cities, i)
    const c = await db.customer.create({ data: {
      tenantId: saramantha.id,
      name: ['Diana Cárdenas', 'Andrés Gómez', 'Mariana López', 'Carlos Ramírez', 'Luisa Fernández', 'Pedro Castillo', 'Ana Molina', 'Jorge Ríos', 'Elena Vargas', 'Raúl Peña', 'Sofía Castro', 'Diego Moreno'][i],
      phone: `+5731${rand(i, 1000000, 9999999)}`,
      country: 'CO', city,
      perfilDetectado: i % 3 === 0 ? 'mayorista' : i % 3 === 1 ? 'emprendedor' : 'detal',
      tags: i % 3 === 0 ? 'mayorista' : i % 3 === 1 ? 'emprendedor' : 'detal',
      lifetimeValue: rand(i, 50000, 500000), ordersCount: rand(i, 1, 5),
    }})
    saraCustomers.push(c)
  }

  // INTL customers (Messenger)
  const intlCustomers = await Promise.all([
    db.customer.create({ data: { tenantId: intl.id, name: 'Jessica Müller', psid: 'messenger_psid_8841', country: 'DE', city: 'Berlin', perfilDetectado: 'detal', tags: 'intl' }}),
    db.customer.create({ data: { tenantId: intl.id, name: 'Sofía Fernández', psid: 'messenger_psid_2093', country: 'ES', city: 'Madrid', perfilDetectado: 'detal', tags: 'intl,repeat' }}),
    db.customer.create({ data: { tenantId: intl.id, name: 'Ricardo Mendoza', phone: '+525511448899', country: 'MX', city: 'CDMX', perfilDetectado: 'detal', tags: 'cod,mx' }}),
  ])

  // Conversations
  const convos = [
    { id: 'conv-sara-001', tenant: saramantha.id, cust: saraCustomers[0].id, ch: waSara.id, status: 'open', priority: 'high', perfil: 'mayorista', sourceAd: 'ad-sara-fam-1', sourceCampaign: campSaraGlow.name, msgs: [
      { dir: 'inbound', body: 'Hola! Vi el anuncio de pijama familia. Para surtir mi tienda.', t: 12 },
      { dir: 'outbound', body: '¡Hola Diana! Sara de Saramantha 💛 Para surtir tienda tienes precio mayorista desde 6 und. ¿Qué tema buscas?', t: 11 },
      { dir: 'inbound', body: 'Stitch, lo tienes?', t: 10 },
      { dir: 'outbound', body: 'Sí 👀 Short, Pantalón y Batola en Stitch. ¿Cuántas de cada uno?', t: 9 },
      { dir: 'inbound', body: '6 short + 6 pantalón', t: 8 },
      { dir: 'outbound', body: '6 Short Stitch + 6 Pantalón Stitch: pagas $224.400 → vendes $468.000 → margen $243.600 💰 ¿Confirmas ciudad y dirección?', t: 7 },
    ]},
    { id: 'conv-sara-002', tenant: saramantha.id, cust: saraCustomers[1].id, ch: waSara.id, status: 'pending', priority: 'normal', perfil: 'emprendedor', sourceAd: 'ad-sara-tt-1', sourceCampaign: campSaraTT.name, msgs: [
      { dir: 'inbound', body: 'Buenas, quieren contra entrega en Bogotá?', t: 8 },
      { dir: 'outbound', body: 'Hola Andrés 👋 Sí, contra entrega en Bogotá. ¿Qué tema te gusta?', t: 7 },
    ]},
    { id: 'conv-sara-003', tenant: saramantha.id, cust: saraCustomers[2].id, ch: waSara.id, status: 'open', priority: 'urgent', perfil: 'mayorista', sourceAd: 'ad-sara-fam-2', sourceCampaign: campSaraGlow.name, msgs: [
      { dir: 'inbound', body: 'Mi pedido CF-100040 no llegó, ya pasaron 3 días', t: 5 },
    ]},
    { id: 'conv-sara-004', tenant: saramantha.id, cust: saraCustomers[3].id, ch: waSara.id, status: 'open', priority: 'normal', perfil: 'detal', sourceAd: 'ad-sara-stitch-1', sourceCampaign: campSaraStitch.name, msgs: [
      { dir: 'inbound', body: 'Quiero 2 short de Stitch para regalo', t: 4 },
    ]},
    { id: 'conv-intl-001', tenant: intl.id, cust: intlCustomers[0].id, ch: msgIntl.id, status: 'open', priority: 'normal', perfil: 'detal', sourceAd: 'ad-intl-msg-1', sourceCampaign: campIntlMsg.name, msgs: [
      { dir: 'inbound', body: 'Hi! Do you ship to Germany?', t: 6 },
      { dir: 'outbound', body: 'Hi Jessica! Yes, we ship to EU 🇪🇺. Prepayment required for international orders.', t: 5 },
    ]},
    { id: 'conv-intl-002', tenant: intl.id, cust: intlCustomers[1].id, ch: msgIntl.id, status: 'resolved', priority: 'low', perfil: 'detal', sourceAd: 'ad-intl-msg-1', sourceCampaign: campIntlMsg.name, msgs: [
      { dir: 'inbound', body: 'Hola, ¿hacen envíos a Madrid?', t: 9 },
      { dir: 'outbound', body: '¡Hola Sofía! Sí, enviamos a toda la UE. Pago anticipado por carrito.', t: 8 },
      { dir: 'inbound', body: 'Perfecto, ya compré por la web. Gracias!', t: 7 },
    ]},
  ]

  for (const c of convos) {
    await db.conversation.upsert({ where: { id: c.id }, update: {},
      create: {
        id: c.id, tenantId: c.tenant, customerId: c.cust, channelId: c.ch,
        status: c.status, priority: c.priority, perfilConversacion: c.perfil,
        sourceAdId: c.sourceAd, sourceCampaign: c.sourceCampaign,
        lastMessageAt: daysAgo(0, c.msgs[c.msgs.length-1]?.t || 1),
        unreadCount: c.status === 'open' ? 1 : 0,
      }
    })
    for (const m of c.msgs) {
      await db.message.create({ data: { tenantId: c.tenant, conversationId: c.id, direction: m.dir, body: m.body, type: 'text', status: m.dir === 'inbound' ? 'delivered' : 'read', createdAt: daysAgo(0, m.t) }})
    }
  }

  // ── Orders: simulate the 239-pedido summary (we create ~15 representative) ─
  console.warn('  → generating orders (239-pedido summary, 15 representative)...')
  // Embudo (§15.1): 73.2% "Llamar para confirmar", 1.3% "Despachado"
  const orderStatuses = [
    ...Array(10).fill('pending_confirmation'), // 73% Llamar para confirmar
    ...Array(2).fill('intent_cancelacion'),
    ...Array(1).fill('datos_completados'),
    ...Array(1).fill('oficina'),
    ...Array(1).fill('despachado'),
  ]
  const orders = []
  for (let i = 0; i < 15; i++) {
    const cust = saraCustomers[i % saraCustomers.length]
    const status = orderStatuses[i]
    const items = [
      { p: pShort, q: rand(i, 6, 12), diseno: i % 2 === 0 ? 'Stitch' : 'liso' },
    ]
    if (i % 3 === 0) items.push({ p: pPant, q: rand(i, 6, 12), diseno: 'Stitch' })
    const subtotal = items.reduce((s, it) => s + it.p.price * it.q, 0)
    const discount = i % 2 === 0 ? subtotal * 0.05 : 0
    const codFee = i % 3 === 0 ? 8000 : 0
    const total = subtotal - discount + codFee
    const num = `CF-${100040 + i}`
    const ad = pick(['ad-sara-fam-1', 'ad-sara-fam-2', 'ad-sara-stitch-1', 'ad-sara-tt-1', 'ad-sara-g-1'], i)
    const camp = ad.startsWith('ad-sara-fam') ? campSaraGlow.name : ad.startsWith('ad-sara-stitch') ? campSaraStitch.name : ad.startsWith('ad-sara-tt') ? campSaraTT.name : campSaraG.name
    const plat = ad.startsWith('ad-sara-tt') ? 'tiktok' : ad.startsWith('ad-sara-g') ? 'google' : 'meta'
    const da = i + 1
    const paymentMode = i % 3 === 0 ? 'advance' : i % 3 === 1 ? 'cod' : 'hybrid'
    const paymentStatus = paymentMode === 'advance' ? 'paid' : paymentMode === 'cod' ? (status === 'despachado' || status === 'oficina' ? 'paid' : 'cod_pending') : 'partial'
    const o = await db.order.upsert({ where: { number: num }, update: {},
      create: {
        id: `ord-sara-${i}`, tenantId: saramantha.id, number: num,
        customerId: cust.id, conversationId: null, channelId: waSara.id,
        status, paymentMode, paymentStatus,
        subtotal, discount, codFee, total, currency: 'COP',
        country: 'CO', city: cust.city, address: '—',
        origen: 'agente_whatsapp',
        imagenReferenciaUrl: items[0].p.imageUrl,
        sourceAdId: ad, sourceCampaign: camp, sourcePlatform: plat, clickId: `clk_${i}`,
        attributedAt: daysAgo(da), paidAt: paymentStatus === 'paid' ? daysAgo(da) : null,
        createdAt: daysAgo(da),
      }
    })
    for (const it of items) {
      await db.orderItem.create({ data: { orderId: o.id, productId: it.p.id, name: it.p.name, unitPrice: it.p.price, cost: it.p.cost, quantity: it.q, diseno: it.diseno }})
    }
    // Order events
    await db.orderEvent.create({ data: { orderId: o.id, type: 'created', createdAt: daysAgo(da) }})
    if (['datos_completados', 'oficina', 'despachado'].includes(status)) {
      await db.orderEvent.create({ data: { orderId: o.id, type: 'confirmed', createdAt: daysAgo(da - 1) }})
    }
    if (status === 'despachado') {
      await db.orderEvent.create({ data: { orderId: o.id, type: 'shipped', createdAt: daysAgo(da - 2) }})
      // Shipment (§15.2: 17/239 had carrier filled, 6 variants of Interrapidísimo)
      await db.shipment.create({ data: {
        tenantId: saramantha.id, orderId: o.id, proveedor: 'dropi',
        numeroGuia: `DROP-${1000 + i}`, transportadora: pick(['Interrapidisimo', 'interrapidisimo', 'Interrapidicimo'], i),
        transportadoraCanonica: 'Interrapidísimo', tarifa: 12000, tiempoEstimadoDias: 3,
        estado: 'en_transito', createdAt: daysAgo(da - 2),
      }})
      // Commission entry (§17.7: 100% recognition at Despachado)
      const comisionPct = 4.5
      const comisionTotal = total * comisionPct / 100
      await db.commissionEntry.create({ data: {
        tenantId: saramantha.id, orderId: o.id, gmv: total, comisionPct,
        comisionTotal, reconocidaPct: 100, reconocidaMonto: comisionTotal,
        etapaReconocimiento: 'despachado', reconocidaAt: daysAgo(da - 2),
      }})
    } else if (status === 'datos_completados') {
      // §17.7: 50% recognition at Datos completados
      const comisionPct = 4.5
      const comisionTotal = total * comisionPct / 100
      await db.commissionEntry.create({ data: {
        tenantId: saramantha.id, orderId: o.id, gmv: total, comisionPct,
        comisionTotal, reconocidaPct: 50, reconocidaMonto: comisionTotal * 0.5,
        etapaReconocimiento: 'datos_completados', reconocidaAt: daysAgo(da - 1),
      }})
    }
    orders.push(o)
  }

  // INTL orders
  await db.order.upsert({ where: { number: 'CF-200001' }, update: {},
    create: {
      id: 'ord-intl-1', tenantId: intl.id, number: 'CF-200001',
      customerId: intlCustomers[1].id, conversationId: 'conv-intl-002', channelId: msgIntl.id,
      status: 'delivered', paymentMode: 'advance', paymentStatus: 'paid',
      subtotal: 48, discount: 3, codFee: 0, total: 48, currency: 'EUR',
      country: 'ES', city: 'Madrid', origen: 'agente_whatsapp',
      sourceAdId: 'ad-intl-msg-1', sourceCampaign: campIntlMsg.name, sourcePlatform: 'meta', clickId: 'fbclk_700',
      attributedAt: daysAgo(8), paidAt: daysAgo(8), createdAt: daysAgo(8),
    }
  })

  // ── Invoice for current period (Saramantha) ──────────────────────
  const saraOrders = await db.order.findMany({ where: { tenantId: saramantha.id } })
  const gmvSara = saraOrders.reduce((s, o) => s + o.total, 0)
  const tramo = gmvSara < 10000000 ? '0-10M' : gmvSara < 40000000 ? '10-40M' : '40M+'
  const pct = tramo === '0-10M' ? 4.5 : tramo === '10-40M' ? 3 : 1.75
  const comisionTotal = gmvSara * pct / 100
  await db.invoice.create({ data: {
    tenantId: saramantha.id, periodo: '2026-07',
    gmvTotal: gmvSara, feeBase: 350000, comisionTotal, tramoAplicado: tramo,
    total: 350000 + comisionTotal, estado: 'emitida', emitidaAt: new Date(),
  }})

  // ── Settings + automation rules ──────────────────────────────────
  await db.setting.upsert({ where: { key: 'default_currency' }, update: {}, create: { key: 'default_currency', value: 'COP' }})
  await db.setting.upsert({ where: { key: 'roas_kill_threshold' }, update: {}, create: { key: 'roas_kill_threshold', value: '0.8' }})
  await db.setting.upsert({ where: { key: 'cpa_target' }, update: {}, create: { key: 'cpa_target', value: '35000' }})
  await db.setting.upsert({ where: { key: 'cod_max_order_value' }, update: {}, create: { key: 'cod_max_order_value', value: '250000' }})

  await db.automationRule.upsert({ where: { id: 'rule-bienvenida' }, update: {},
    create: { id: 'rule-bienvenida', tenantId: saramantha.id, name: 'Bienvenida WhatsApp Sara', trigger: 'new_conversation', condition: '{"channel":"whatsapp"}', action: 'auto_reply', active: true }})
  await db.automationRule.upsert({ where: { id: 'rule-kill' }, update: {},
    create: { id: 'rule-kill', tenantId: saramantha.id, name: 'Pausar anuncios con ROAS < 0.8', trigger: 'ad_underperforming', condition: '{"roas_lt":0.8,"spend_gt":50000}', action: 'pause_ad', active: true }})

  console.warn('✅ Seed v2 complete.')
  console.warn(`   Tenants: 5 (4 Indisutex + 1 INTL) | Channels: 9 | Products: 7 Saramantha`)
  console.warn(`   Customers: 15 | Conversations: 6 | Orders: 16 (Saramantha embudo 73% pending)`)
  console.warn(`   Ads: 9 | Carriers canonical: 5 (Interrapidísimo + 6 variants)`)
  console.warn(`   Commission entries: ${['despachado', 'datos_completados'].length}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
