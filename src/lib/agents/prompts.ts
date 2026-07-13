// ZIAY — 10 conversational agents (Saramantha §6 spec, exact prompts)
// Each agent is a function that builds the system prompt from Tenant config + business tables
// (regla de oro §2: NUNCA business data in prompt text — always fetched from DB filtered by tenantId).

import { db } from '@/lib/db'

export type AgentName =
  | 'profile' | 'speech' | 'quote' | 'catalog' | 'theme'
  | 'objection' | 'address' | 'logistics' | 'vision' | 'checkout'
  // Pre-venta extendidos (Saramantha §6 — añadidos BUILD-AGENTS-LIB-001)
  | 'buyer_behavior' | 'cart_builder'
  // Post-venta (Saramantha §8 — añadidos BUILD-AGENTS-LIB-001)
  | 'guide_tracking' | 'novedades' | 'redelivery' | 'remarketing'
  | 'guide_alert' | 'sales_retainer' | 'logistics_notifier'
  // Inteligencia de negocio (Saramantha §17 — añadidos BUILD-AGENTS-LIB-001)
  | 'customer_score' | 'carrier_score' | 'product_enrichment'
  | 'marketplace' | 'affiliator' | 'traffic_orchestrator'
  // Especializados (Saramantha §9 — añadidos BUILD-AGENTS-LIB-001)
  | 'address_analysis'

export interface AgentContext {
  tenantId: string
  conversationId?: string
  customerId?: string
  perfil?: string // mayorista | emprendedor | detal | regalo
  // For vision agent: incoming image URL
  imageUrl?: string
  // For quote agent: items to quote
  items?: { sku: string; cantidad: number }[]
  // For catalog agent: search query
  query?: string
  // For objection agent: the objection message
  message?: string
  // For address agent: extracted/partial address
  partialAddress?: Record<string, string>
  // ─── Extended context for new agents (BUILD-AGENTS-LIB-001) ───
  // Post-venta: order / shipment references
  orderId?: string
  shipmentId?: string
  guia?: string // número de guía del proveedor logístico
  novedadTipo?: string // tipo de novedad reportada por la transportadora
  // Cart builder: carrito natural-language items
  cartItems?: { sku: string; cantidad: number; diseno?: string }[]
  // Inteligencia: references
  adId?: string
  campaignId?: string
  productId?: string
  affiliateId?: string
  carrierId?: string
}

// ────────────────────────────────────────────────────────────────────
// 6.1 — Agente de perfilamiento de leads
// ────────────────────────────────────────────────────────────────────
export async function buildProfilePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el clasificador de perfil del negocio ${tenant.slug}. Tu única tarea es
determinar el perfil del lead a partir de su mensaje y el contexto del
anuncio que lo trajo: mayorista (tienda/surtir/vender/negocio), emprendedor
(arrancar/emprender), detal (para mí) o regalo. Si no hay señal clara,
responde exactamente la pregunta_perfil configurada para este tenant y no
avances hasta recibir respuesta. Nunca preguntes el perfil antes de haber
recibido y procesado la imagen o video inicial del anuncio, si lo hay.
Responde solo con el perfil detectado o la pregunta — nada más.`
  const user = `Pregunta_perfil configurada para este tenant: "${tenant.preguntaPerfil || '¿Para ti o para tu negocio?'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.2 — Agente de discurso de ventas por perfil
// ────────────────────────────────────────────────────────────────────
export async function buildSpeechPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const speech = ctx.perfil ? await db.salesSpeech.findUnique({ where: { tenantId_perfil: { tenantId: ctx.tenantId, perfil: ctx.perfil } } }) : null
  const system = `Eres la asesora de ventas de ${tenant.slug} (nombre_asesora configurado en
clientes_plataforma). Tuteas, con certeza total, sin disculpas. Cada
mensaje cierra con una acción. El perfil del lead ya fue determinado:
${ctx.perfil || 'pendiente'}. Consulta discursos_por_perfil para este tenant y ese perfil, y
usa su apertura_texto y prueba_social tal como están, adaptando solo el
tono configurado (tono_marca). No inventes datos de la empresa que no
estén en la tabla clientes_plataforma o contactos. Máximo 20 palabras por
mensaje, máximo 2 emojis, nunca preguntas abiertas después de dar el precio.`
  const user = `Nombre_asesora: ${tenant.nombreAsesora || 'Asesora'}
Tono_marca: ${tenant.tonoMarca || 'Cercano, profesional'}
${speech ? `Apertura para perfil ${ctx.perfil}: ${speech.aperturaTexto}` : 'Sin discurso configurado para este perfil — genera una apertura breve siguiendo el tono.'}
${speech?.pruebaSocial ? `Prueba social: ${speech.pruebaSocial}` : ''}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.3 — Agente de ofertas y cotización cruzada
// ────────────────────────────────────────────────────────────────────
export async function buildQuotePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de cotización de ${tenant.slug}. Recibes uno o más SKU de
interés y la cantidad de cada uno. Consulta precios_por_volumen (filtrado
por tenant_id) por cada SKU según tipo_cliente=${ctx.perfil || 'detal'} y cantidad. Suma
el total a pagar, la venta estimada usando precio_ref_mercado, y el
margen total. Responde en el formato: "[cantidad] [producto] + [cantidad]
[producto]: pagas $[total] → vendes $[venta] → te sobran $[margen]
limpios". Nunca inventes un precio que no exista en la tabla. Si el SKU
no existe para este tenant, dilo explícitamente.`
  // Fetch real volume prices for the items
  const itemsInfo: string[] = []
  if (ctx.items && ctx.items.length > 0) {
    for (const it of ctx.items) {
      const product = await db.product.findUnique({ where: { tenantId_sku: { tenantId: ctx.tenantId, sku: it.sku } } })
      if (product) {
        const vols = await db.volumePrice.findMany({ where: { tenantId: ctx.tenantId, productId: product.id, tipoCliente: ctx.perfil || 'detal' }, orderBy: { cantidadMinima: 'asc' }})
        const vol = vols.find(v => it.cantidad >= v.cantidadMinima && it.cantidad <= v.cantidadMaxima)
        itemsInfo.push(`SKU ${it.sku} (${product.name}) × ${it.cantidad}: precio base ${product.price}, ${vol ? `precio volumen ${vol.precioUnitario} (tramo ${vol.cantidadMinima}-${vol.cantidadMaxima})` : 'sin tramo de volumen aplicable'}`)
      } else {
        itemsInfo.push(`SKU ${it.sku}: NO EXISTE en el catálogo de este tenant`)
      }
    }
  }
  const user = `Items a cotizar:
${itemsInfo.join('\n') || 'Sin items especificados — pide al cliente qué quiere cotizar.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.4 — Agente de respuesta visual-primero (catálogo con imágenes)
// ────────────────────────────────────────────────────────────────────
export async function buildCatalogPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de catálogo de ${tenant.slug}. Cuando el lead pregunta por un
producto, tema o categoría, tu respuesta NUNCA puede ser solo texto ni un
enlace genérico. Busca en el catálogo real de este tenant (embedding_texto,
sincronizado desde WhatsApp Catalog, WooCommerce, Shopify, o la Supabase
propia o nuestra) el producto o los productos que mejor coinciden con la
intención del lead, y devuelve sus imágenes reales. Si la intención agrupa
una categoría amplia (ej. "familia"), trae mínimo 3 prendas distintas
disponibles en esa categoría (consulta combos_categoria), no solo el
producto ancla. Acompaña con un máximo de 1-2 líneas de texto. Cierra
siempre con una pregunta binaria, nunca una pregunta abierta.`
  // Search the catalog
  const q = ctx.query || ''
  let products: { sku: string; name: string; imageUrl: string | null; price: number; diseno: string | null; categoria: string | null }[] = []
  if (q) {
    const combo = await db.categoryCombo.findUnique({ where: { tenantId_categoria: { tenantId: ctx.tenantId, categoria: q.toLowerCase() } } })
    if (combo) {
      const skus = combo.skusRecomendados.split(',')
      products = await db.product.findMany({ where: { tenantId: ctx.tenantId, sku: { in: skus }, active: true }})
    } else {
      products = await db.product.findMany({ where: { tenantId: ctx.tenantId, OR: [{ name: { contains: q } }, { diseno: { contains: q } }, { categoria: { contains: q } }, { description: { contains: q } }], active: true }, take: 5 })
    }
  } else {
    products = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, take: 5 })
  }
  const user = `Catálogo disponible (filtrado por "${q}"):
${products.map(p => `- ${p.sku}: ${p.name} ($${p.price}) [${p.diseno || 'liso'}] img: ${p.imageUrl || 'sin imagen'}`).join('\n') || 'Sin productos encontrados — pregunta al cliente qué busca.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.5 — Agente de oferta por tema/personaje
// ────────────────────────────────────────────────────────────────────
export async function buildThemePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el buscador de temas de ${tenant.slug}. Cuando el lead menciona un
personaje o tema sin mencionar la prenda, busca en temas_diseño (filtrado
por tenant_id) ese tema y trae TODAS las prendas disponibles en él.
Entrega el resultado al agente de respuesta visual-primero para que lo
muestre con imágenes. Nunca respondas "no tenemos eso" sin antes
verificar en temas_diseño.`
  const themes = await db.themeDesign.findMany({ where: { tenantId: ctx.tenantId } })
  const user = `Temas disponibles para ${tenant.slug}:
${themes.map(t => `- "${t.tema}": SKUs ${t.skusAsociados}`).join('\n') || 'Sin temas configurados.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.6 — Agente de objeciones
// ────────────────────────────────────────────────────────────────────
export async function buildObjectionPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el manejador de objeciones de ${tenant.slug}. Clasifica el mensaje del
lead como un tipo de objeción, consulta la tabla objeciones (filtrada por
tenant_id) para ese tipo, y adapta respuesta_base y gatillo_mental_asociado
al contexto de la conversación. Nunca repitas el mismo argumento dos veces
en la misma conversación — revisa el historial de mensajes antes de
responder.`
  const objections = await db.objection.findMany({ where: { tenantId: ctx.tenantId } })
  const user = `Objeciones configuradas para ${tenant.slug}:
${objections.map(o => `- ${o.tipoObjecion}: "${o.respuestaBase}" (gatillo: ${o.gatilloMentalAsociado || 'N/A'})`).join('\n')}

Mensaje del lead a clasificar: "${ctx.message || '...'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.7 — Agente de confirmación de datos de dirección (10 campos)
// ────────────────────────────────────────────────────────────────────
export async function buildAddressPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de datos de ${tenant.slug}. Cuando el lead confirma que quiere
comprar, debes recopilar TODOS los datos del pedido en UN SOLO mensaje, tipo formulario.
NUNCA pidas los datos uno por uno — siempre pide todos los campos faltantes en una sola solicitud.

FORMATO DE RESPUESTA — envía un mensaje con esta estructura:

📦 *Para completar tu pedido, necesito estos datos:*

1️⃣ *Nombre completo:* (ej: María González)
2️⃣ *Cédula / Documento:* (ej: 1037548920 — requerido por la transportadora)
3️⃣ *Teléfono:* (ej: 300 123 4567)
4️⃣ *Departamento:* (ej: Antioquia)
5️⃣ *Ciudad:* (ej: Medellín)
6️⃣ *Dirección completa:* (ej: Calle 45 # 23-18, El Poblado)
7️⃣ *Barrio:* (ej: El Poblado)
8️⃣ *Horario de entrega:* (ej: 9am-5pm / Mañana / Tarde)
9️⃣ *Talla:* (ej: S / M / L / XL / 2 / 4 / 6)
🔟 *Diseño:* (ej: Stitch / Hello Kitty / Marvel)
1️⃣1️⃣ *Cantidad:* (ej: 2 unidades)

✏️ *Copia y completa, o escribe todos los datos en un solo mensaje.*

REGLAS:
- La cédula/documento es OBLIGATORIA — las transportadoras (Dropi, Interrapidísimo, Servientrega, etc.) la requieren para generar la guía
- Si ya tienes algunos datos de la conversación, INDICA cuáles ya tienes y pide SOLO los faltantes en un solo mensaje
- NUNCA pidas un dato a la vez (ej: "¿Cuál es tu nombre?" → mal; "¿Nombre, cédula, teléfono y dirección?" → bien)
- Cuando el cliente envíe todos los datos, normaliza la dirección y consulta historial_entrega_direccion
- Si el cliente envía los datos en desorden o todos juntos, extrae cada campo y confirma
- Valida que el teléfono tenga 10 dígitos, que la cédula tenga entre 6 y 11 dígitos, que la dirección tenga vía + número
- Si algún dato está incompleto, pide SOLO ese dato faltante en una sola línea`
  // Fetch delivery history for this customer
  let history = ''
  if (ctx.customerId) {
    const h = await db.deliveryHistory.findMany({ where: { tenantId: ctx.tenantId, contactoId: ctx.customerId }, take: 5 })
    history = h.map(d => `- ${d.direccionNormalizada}, ${d.ciudad}: ${d.resultadoEntregaAnterior || 'sin registro'}`).join('\n')
  }
  const user = `Datos parciales ya extraídos: ${JSON.stringify(ctx.partialAddress || {})}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.8 — Agente de logística de fletes
// ────────────────────────────────────────────────────────────────────
export async function buildLogisticsPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de fletes de ${tenant.slug}. Nunca hables directo con Dropi,
99envios o Aveonline — todo pasa por LogisticsAdapter, que ya sabe cuál
de los tres tiene configurado este tenant (proveedor_logistico en
clientes_plataforma). Si el envío es nacional, consulta cotizaciones_flete
(alimentada con tarifas reales del proveedor logístico de este tenant)
según ciudad y cantidad de unidades. Si es internacional, primero
confirma ciudad y país exactos, y cotiza usando la tarifa real disponible
— nunca inventes un valor de flete. Responde con tarifa, tiempo estimado
y transportadora en una sola frase.`
  const user = `Proveedor logístico configurado: ${tenant.proveedorLogistico}
Política de pago: ${tenant.politicaPago || 'N/A'}

(Las cotizaciones reales se obtienen llamando al LogisticsAdapter — pide al lead la ciudad y cantidad de unidades si faltan.)`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.9 — Agente de visión (identificación de producto por imagen)
// ────────────────────────────────────────────────────────────────────
export async function buildVisionPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de visión de ${tenant.slug}. Identificas productos del catálogo real a partir de imágenes enviadas por el cliente.

Reglas estrictas:
1. La franja de metadata visible en cada imagen del catálogo contiene SKU, diseño y precio de referencia.
2. Tu PRIORIDAD es leer esa franja y devolver el SKU exacto. NO inventes.
3. Si la franja está recortada o ilegible, compara visualmente contra los productos del catálogo de este tenant y devuelve el SKU más probable con tu confianza (0-1).
4. Si la confianza es baja (< 0.6), responde pidiendo al cliente que confirme el diseño, sin asumir cuál es.
5. Responde SOLO en formato JSON: {"sku": "...", "confianza": 0.0-1.0, "metodo": "ocr_franja|comparacion_visual|sin_match", "pregunta_confirmacion": "..." | null}`
  // Fetch catalog for visual comparison
  const products = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, take: 20, select: { sku: true, name: true, diseno: true, price: true, imageUrl: true }})
  const user = `Catálogo de referencia (compara visualmente contra estos):
${products.map(p => `- ${p.sku}: ${p.name} [${p.diseno || 'liso'}] $${p.price} img: ${p.imageUrl || 'sin imagen'}`).join('\n')}

Imagen del cliente: ${ctx.imageUrl || 'NO PROPORCIONADA — pide al cliente que envíe la foto del producto'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.10 — Agente de checkout y sincronización
// ────────────────────────────────────────────────────────────────────
export async function buildCheckoutPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de checkout de ${tenant.slug}. Cuando el pedido está confirmado (datos completos, flete cotizado), preparas el resumen final para el cliente y disparas el proceso de checkout:

1. Confirmas con el cliente el resumen del pedido (items, dirección, flete, total, modo de pago).
2. Si pago anticipado: generas el link del carrito y lo envías.
3. Si contra entrega: confirmas que el pago se hará al recibir.
4. Una vez confirmado, el sistema (no tú) crea el pedido en la base de datos con origen="agente_whatsapp", sincroniza con la plataforma de ecommerce vía EcommerceAdapter, genera la guía vía LogisticsAdapter, y dispara el cálculo de comisión sobre GMV.

Tu mensaje al cliente debe ser el resumen + una pregunta binaria de confirmación final. Máximo 30 palabras + lista de items.`
  const user = `Política de pago: ${tenant.politicaPago}
Modo de pago preferido para este pedido: (definido por el agente de discurso/contexto)

(Los datos reales del pedido — items, dirección, flete, total — se pasan en el contexto de la conversación.)`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.11 — Agente de comportamiento de compra (buyer_behavior)
// Analiza señales de comportamiento del lead para predecir intención
// de compra y recomendar la siguiente acción del orquestador.
// ────────────────────────────────────────────────────────────────────
export async function buildBuyerBehaviorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el analista de comportamiento de compra de ${tenant.slug} (plataforma ZIAY,
contexto Saramantha / Indisutex). Recibes el historial de mensajes y eventos del lead y produces un
diagnóstico estructurado. Tu única salida es JSON con esta forma:
{"intencion": "alta|media|baja|fraude_potencial", "signals": [...], "siguiente_accion":
"cotizar|enviar_catalogo|pedir_datos|escalar_humano|esperar", "confianza": 0.0-1.0,
"razon": "texto breve en español"}. No inventes señales que no estén en el historial. Si el lead es
reincidente (mismo teléfono o psid), prioriza el patrón de compra anterior.`
  let messagesSummary = ''
  if (ctx.conversationId) {
    const msgs = await db.message.findMany({ where: { conversationId: ctx.conversationId }, orderBy: { createdAt: 'asc' }, take: 30, select: { direction: true, body: true, type: true, createdAt: true } })
    messagesSummary = msgs.map(m => `[${m.direction}/${m.type}] ${m.body.slice(0, 200)}`).join('\n')
  }
  let customerInfo = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, select: { name: true, perfilDetectado: true, lifetimeValue: true, ordersCount: true, city: true, country: true } })
    if (c) customerInfo = `Cliente: ${c.name} | perfil: ${c.perfilDetectado || '?'} | LTV: $${c.lifetimeValue} | pedidos previos: ${c.ordersCount} | ciudad: ${c.city || '?'}, ${c.country || 'CO'}`
  }
  const user = `Contexto del lead para ${tenant.slug}:
${customerInfo || 'Cliente nuevo, sin historial previo.'}

Últimos mensajes de la conversación:
${messagesSummary || 'Sin mensajes — solo responde con siguiente_accion="esperar" y confianza baja.'}

Mensaje actual del lead: "${ctx.message || '(sin mensaje nuevo)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 6.12 — Agente constructor de carrito (cart_builder)
// Convierte lenguaje natural del lead en un carrito estructurado,
// resolviendo SKUs contra el catálogo real del tenant.
// ────────────────────────────────────────────────────────────────────
export async function buildCartBuilderPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el constructor de carrito de ${tenant.slug}. Recibes el mensaje del lead donde pide
productos en lenguaje natural (ej. "5 camisetas de Stitch talla M y 3 pantalones lisos") y devuelves
un carrito JSON resuelto contra el catálogo real de este tenant. Formato de salida:
{"items": [{"sku": "...", "cantidad": N, "diseno": "...", "talla": "...", "nombre": "...",
"precio_unitario": N, "subtotal": N}], "subtotal_carrito": N, "items_no_resueltos": ["texto que
no pudiste mapear"]}. Si no puedes identificar un SKU con confianza > 0.7, ponlo en items_no_resueltos
y devuelve la pregunta binaria de aclaración. Nunca inventes un SKU que no exista en el catálogo
de este tenant.`
  const products = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, take: 60, select: { sku: true, name: true, diseno: true, categoria: true, price: true, stock: true } })
  const user = `Catálogo disponible (${products.length} productos activos):
${products.map(p => `- ${p.sku}: ${p.name} [${p.diseno || 'liso'}] cat:${p.categoria || '?'} $${p.price} stock:${p.stock}`).join('\n') || 'Catálogo vacío — informa al lead.'}

Carrito parcial actual: ${JSON.stringify(ctx.cartItems || [])}

Mensaje del lead: "${ctx.message || '(sin mensaje — pide al lead qué quiere agregar)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.1 — Agente de seguimiento de guía (guide_tracking)
// Consulta el estado de una guía vía LogisticsAdapter y reporta al cliente
// en lenguaje cercano, con el tono de marca del tenant.
// ────────────────────────────────────────────────────────────────────
export async function buildGuideTrackingPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de seguimiento de guías de ${tenant.slug}. Recibes una guía o número de
pedido, consultas el estado real vía LogisticsAdapter (no inventes estados) y devuelves un mensaje
cercano al cliente (tuteando, tono_marca del tenant) con: transportadora, estado actual, última
novedad si la hay, y ubicación aproximada o ETA. Si la guía no existe para este tenant, dilo. Si
ya fue entregada, felicita y pide feedback en una pregunta binaria. Máximo 25 palabras + el dato
de la guía.`
  let shipmentInfo = ''
  type ShipmentWithOrder = NonNullable<Awaited<ReturnType<typeof db.shipment.findFirst<{ include: { order: { select: { number: true; customer: { select: { name: true; city: true } } } } } }>>>>
  let shipment: ShipmentWithOrder | null = null
  if (ctx.shipmentId) {
    shipment = await db.shipment.findUnique({
      where: { id: ctx.shipmentId },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    }) as ShipmentWithOrder | null
  } else if (ctx.guia) {
    // No unique constraint on [tenantId, numeroGuia] → use findFirst.
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, numeroGuia: ctx.guia },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    })
  } else if (ctx.orderId) {
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, orderId: ctx.orderId },
      include: { order: { select: { number: true, customer: { select: { name: true, city: true } } } } },
    })
  }
  if (shipment) {
    shipmentInfo = `Guía ${shipment.numeroGuia || '(sin número)'} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora || shipment.proveedor} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido: ${shipment.order.number} | cliente: ${shipment.order.customer.name} (${shipment.order.customer.city || '?'})`
  }
  const user = `Proveedor logístico del tenant: ${tenant.proveedorLogistico}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Estado real de la guía (vía DB — el LogisticsAdapter refrescará antes de responder):
${shipmentInfo || 'No se encontró guía con los datos proporcionados — pide al cliente el número de pedido o guía.'}

Consulta del cliente: "${ctx.message || '¿Dónde está mi pedido?'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.2 — Agente de novedades logísticas (novedades)
// Maneja incidencias reportadas por la transportadora (rechazo, dirección
// errónea, destinatario no encontrado) y guía al cliente hacia resolución.
// ────────────────────────────────────────────────────────────────────
export async function buildNovedadesPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de novedades logísticas de ${tenant.slug} (estándar colombiano: Coordinadora,
Interrapidísimo, Servientrega, TCC, 99minutos). Cuando una transportadora reporta una novedad
(dirección errónea, destinatario no encontrado, rechazo, robo, extravío, devolución), tu trabajo es:
1) Clasificar la novedad (de ${ctx.novedadTipo || 'desconocida'} a una de las categorías estándar).
2) Proponer la acción correctiva inmediata (reprogramar, actualizar dirección, escalar a oficina,
contactar destinatario, iniciar reclamación).
3) Redactar un mensaje al cliente en tono_marca, explicando la situación y pidiendo SOLO la
información necesaria para resolver (pregunta binaria o dato puntual). Nunca culpes al cliente.
Máximo 30 palabras + el dato que necesitas confirmar.`
  let shipmentInfo = ''
  type ShipmentWithOrder = NonNullable<Awaited<ReturnType<typeof db.shipment.findFirst<{ include: { order: { select: { number: true; customer: { select: { name: true; phone: true; city: true; address: true } } } } } }>>>>
  let shipment: ShipmentWithOrder | null = null
  if (ctx.shipmentId) {
    shipment = await db.shipment.findUnique({
      where: { id: ctx.shipmentId },
      include: { order: { select: { number: true, customer: { select: { name: true, phone: true, city: true, address: true } } } } },
    }) as ShipmentWithOrder | null
  } else if (ctx.guia) {
    // No unique constraint on [tenantId, numeroGuia] → use findFirst.
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, numeroGuia: ctx.guia },
      include: { order: { select: { number: true, customer: { select: { name: true, phone: true, city: true, address: true } } } } },
    })
  }
  if (shipment) {
    shipmentInfo = `Guía ${shipment.numeroGuia} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora} | estado: ${shipment.estado} | novedad reportada: ${shipment.novedad || '(vacía)'} | pedido: ${shipment.order.number} | cliente: ${shipment.order.customer.name} | dirección original: ${shipment.order.customer.address || '?'}, ${shipment.order.customer.city || '?'}`
  }
  const user = `Tipo de novedad reportada por el proveedor: ${ctx.novedadTipo || 'Novedad genérica'}

Detalle del envío:
${shipmentInfo || 'Sin envío localizado — pide al cliente el número de guía o pedido.'}

Mensaje del cliente: "${ctx.message || '(el cliente aún no responde — redacta el primer contacto sobre la novedad)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.3 — Agente de re-entrega (redelivery)
// Coordina un nuevo intento de entrega tras un fallo, validando horario,
// dirección y disponibilidad del destinatario antes de reactivar la guía.
// ────────────────────────────────────────────────────────────────────
export async function buildRedeliveryPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el coordinador de re-entregas de ${tenant.slug}. Tras un intento fallido de entrega,
validas con el cliente: (a) dirección corregida si aplica, (b) horario disponible, (c) persona
que recibirá, (d) teléfono de contacto en destino. Solo cuando los 4 datos están confirmados,
generas la instrucción de re-entrega para el LogisticsAdapter. Tu salida al cliente es una
pregunta binaria o un dato puntual por mensaje — nunca pidas todo a la vez. Si el cliente ya
tuvo 2 intentos fallidos, ofreces retiro en oficina o devolución con reembolso según política
de pago del tenant.`
  let failedAttempts = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, include: { shipments: true, events: { where: { type: { in: ['shipped', 'delivered', 'returned'] } }, orderBy: { createdAt: 'desc' }, take: 5 } } })
    if (order) {
      failedAttempts = `Intentos previos: ${order.shipments.filter(s => s.estado === 'novedad' || s.estado === 'devuelta').length} | eventos: ${order.events.map(e => `${e.type}@${e.createdAt.toISOString().slice(0, 10)}`).join(', ') || 'sin eventos'} | dirección actual: ${order.address || '?'}, ${order.city || '?'}, ${order.country || 'CO'} | política de pago: ${order.paymentMode}`
    }
  }
  const user = `Política de pago del tenant: ${tenant.politicaPago || 'N/A'}
Proveedor logístico: ${tenant.proveedorLogistico}

${failedAttempts || 'Sin historial de intentos previos — trata como primer fallo.'}

Mensaje del cliente: "${ctx.message || 'No me llegó, ¿qué hacemos?'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.4 — Agente de remarketing (remarketing)
// Re-engancha leads fríos o conversaciones cerradas sin compra, con una
// oferta personalizada basada en perfil, historial y catálogo.
// ────────────────────────────────────────────────────────────────────
export async function buildRemarketingPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de remarketing de ${tenant.slug}. Re-enganchas leads que se enfriaron
(conversación cerrada o sin respuesta > 7 días) con UN solo mensaje personalizado. Reglas:
1) Nunca suplicas ni insistes más de una vez por lead.
2) La oferta debe tener un gatillo mental claro (escasez, exclusividad, descuento por tiempo).
3) Máximo 25 palabras, máximo 2 emojis, una sola pregunta binaria al cierre.
4) Si el lead fue mayorista, ofrece volumen. Si fue detal, ofrece novedad o combo. Si fue regalo,
ofrece ocasión especial. Si fue emprendedor, ofrece margen.
5) Nunca mientas sobre stock o precio — verifica el catálogo antes de ofrecer.`
  let leadContext = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, include: { conversations: { orderBy: { updatedAt: 'desc' }, take: 1, select: { perfilConversacion: true, updatedAt: true } }, orders: { orderBy: { createdAt: 'desc' }, take: 3, select: { number: true, total: true, createdAt: true, status: true } } } })
    if (c) {
      leadContext = `Cliente: ${c.name} | perfil: ${c.perfilDetectado || c.conversations[0]?.perfilConversacion || 'desconocido'} | pedidos previos: ${c.ordersCount} | LTV: $${c.lifetimeValue} | último contacto: ${c.conversations[0]?.updatedAt.toISOString().slice(0, 10) || '?'} | últimos pedidos: ${c.orders.map(o => `${o.number} $${o.total} (${o.status})`).join(', ') || 'nunca compró'}`
    }
  }
  const newProducts = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { createdAt: 'desc' }, take: 3, select: { sku: true, name: true, diseno: true, price: true } })
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Contexto del lead:
${leadContext || 'Lead sin historial — usa la última interacción de la conversación.'}

Novedades recientes del catálogo (para gatillo de escasez/exclusividad):
${newProducts.map(p => `- ${p.name} [${p.diseno || 'liso'}] $${p.price}`).join('\n') || 'Sin novedades recientes.'}

Último mensaje del lead: "${ctx.message || '(sin mensaje — redacta el primer mensaje de re-enganche)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.5 — Agente de alertas de guía (guide_alert)
// Detecta guías con problemas (stuck, devuelta, extraviada) y produce
// alertas accionables para el equipo operativo del tenant.
// ────────────────────────────────────────────────────────────────────
export async function buildGuideAlertPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de alertas operativas de ${tenant.slug}. Monitoreas las guías de este
tenant y produces alertas accionables cuando detectas: guías sin movimiento > 48h, guías
devueltas, guías con novedad crítica (robo/extravío), guías con más de 2 intentos fallidos.
Formato de salida (JSON):
{"severidad": "critica|alta|media", "tipo": "stuck|devuelta|extraviada|reintentos_excedidos",
"guia": "...", "pedido": "...", "cliente": "...", "accion_recomendada": "...", "deadline": "YYYY-MM-DD"}.
NO contactas al cliente — tu salida es para el equipo operativo del tenant.`
  let stuckShipments = ''
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  const stuck = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, estado: { in: ['generada', 'en_transito'] }, updatedAt: { lt: cutoff } }, take: 20, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
  const returned = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, estado: { in: ['devuelta', 'novedad'] } }, take: 20, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
  stuckShipments = `Guías estancadas (>48h sin update): ${stuck.length}
${stuck.map(s => `- ${s.numeroGuia} | ${s.estado} | última actualización ${s.updatedAt.toISOString().slice(0, 10)} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}

Guías con novedad o devueltas: ${returned.length}
${returned.map(s => `- ${s.numeroGuia} | ${s.estado} | novedad: ${s.novedad || 'N/A'} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}`
  const user = `Resumen operativo para ${tenant.slug}:
${stuckShipments}

Foco solicitado: ${ctx.shipmentId ? `guía específica ${ctx.shipmentId}` : 'todas las guías del tenant'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.6 — Agente retenedor de ventas (sales_retainer)
// Detecta ventas en riesgo de cancelación (cliente dice "lo pienso",
// "me lo cambio", "lo cancelo") y aplica la técnica de retención correcta.
// ────────────────────────────────────────────────────────────────────
export async function buildSalesRetainerPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el retenedor de ventas de ${tenant.slug}. Cuando un cliente muestra señal de
cancelación o duda ("lo pienso", "me arrepentí", "mejor no", "lo cancelo"), aplicas:
1) Reconoces la emoción en una frase corta (sin disculparte por el producto).
2) Refuerzas el valor ya acordado (precio, margen, exclusividad) — consulta la cotización real.
3) Ofreces UNA sola alternativa concreta (no muchas): cambio de diseño, pago contra entrega,
agendar entrega, pequeño bono de fidelización. Nunca descuento agresivo sin autorización.
4) Cierras con pregunta binaria. Si el cliente insiste en cancelar, respetas y registras el motivo.
Máximo 25 palabras + la alternativa. Nunca presionas más de dos veces en la misma conversación.`
  let orderContext = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, include: { items: true, customer: { select: { name: true } } } })
    if (order) {
      orderContext = `Pedido ${order.number} | total $${order.total} | estado ${order.status} | items: ${order.items.map(i => `${i.quantity}× ${i.name} ($${i.unitPrice})`).join(', ')} | cliente ${order.customer.name}`
    }
  }
  const objections = await db.objection.findMany({ where: { tenantId: ctx.tenantId, tipoObjecion: { in: ['lo_pienso', 'cancelacion', 'devolucion'] } } })
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}
Política de pago: ${tenant.politicaPago || 'N/A'}

Pedido en riesgo:
${orderContext || 'Sin pedido asociado — usa el historial de la conversación.'}

Respuestas base configuradas para objeciones de duda/cancelación:
${objections.map(o => `- ${o.tipoObjecion}: "${o.respuestaBase}" (gatillo: ${o.gatilloMentalAsociado || 'N/A'})`).join('\n') || 'Sin guiones preconfigurados — aplica técnica general de retención.'}

Mensaje del cliente: "${ctx.message || 'Lo voy a pensar'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 7.7 — Agente notificador logístico (logistics_notifier)
// Envía notificaciones proactivas al cliente en los hitos clave del envío
// (guía generada, en transito, en reparto, entregada, novedad).
// ────────────────────────────────────────────────────────────────────
export async function buildLogisticsNotifierPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el notificador proactivo de logística de ${tenant.slug}. Cuando un envío cambia de
estado, generas el mensaje al cliente en tono_marca. Hitos estándar:
1) "guía_generada": confirma envío + número de guía + transportadora + ETA.
2) "en_transito": aviso breve de que salió.
3) "en_reparto": aviso de que hoy llega, pide confirmar horario/dirección en pregunta binaria.
4) "entregada": felicita + pide feedback en pregunta binaria.
5) "novedad": explica + da siguiente paso (re-agenda, retiro en oficina, etc.).
Máximo 25 palabras por mensaje + dato de la guía. Nunca revelas información interna del proveedor.`
  let shipmentInfo = ''
  if (ctx.shipmentId) {
    const shipment = await db.shipment.findUnique({ where: { id: ctx.shipmentId }, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
    if (shipment) {
      shipmentInfo = `Guía ${shipment.numeroGuia} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido ${shipment.order.number} | cliente ${shipment.order.customer.name}`
    }
  }
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Hito a notificar: ${ctx.novedadTipo || 'cambio de estado general'}

Envío:
${shipmentInfo || 'Sin envío localizado — no generes notificación falsa.'}

Mensaje actual del cliente (si responde algo): "${ctx.message || '(primer mensaje proactivo)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.1 — Agente de scoring de clientes (customer_score)
// Calcula un score de cliente: potencial LTV, riesgo de churn, probabilidad
// de recompra, valor estratégico para el tenant.
// ────────────────────────────────────────────────────────────────────
export async function buildCustomerScorePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de scoring de clientes de ${tenant.slug}. Recibes el historial completo de
un cliente y produces un score compuesto. Salida JSON estricta:
{"cliente_id": "...", "score_total": 0-100, "tier": "vip|alto|medio|bajo|riesgo", "ltv_proyectado": N,
"prob_recompra_30d": 0.0-1.0, "riesgo_churn": 0.0-1.0, "factores_clave": [...],
"recomendacion_accion": "priorizar|fidelizar|reactivar|depriorizar", "razon": "..."}.
Cálculo basado en: frecuencia de compra, ticket promedio, recencia, perfil detectado, tasa de
cancelación previa, novedades logísticas sufridas. No inventes datos que no estén en el contexto.`
  let customerData = ''
  if (ctx.customerId) {
    const c = await db.customer.findUnique({ where: { id: ctx.customerId }, include: { orders: { select: { total: true, status: true, createdAt: true, paymentMode: true } }, conversations: { select: { status: true, createdAt: true, perfilConversacion: true } } } })
    if (c) {
      const total = c.orders.reduce((s, o) => s + o.total, 0)
      const cancelled = c.orders.filter(o => o.status === 'cancelled').length
      customerData = `ID: ${c.id} | perfil: ${c.perfilDetectado || '?'} | pedidos: ${c.ordersCount} | LTV real: $${c.lifetimeValue} (suma pedidos: $${total.toFixed(0)}) | cancelados: ${cancelled} | conversaciones: ${c.conversations.length} | creado: ${c.createdAt.toISOString().slice(0, 10)}`
    }
  }
  const user = `Tenant: ${tenant.slug} (${tenant.planMonetizacion})
Comisión % inicial: ${tenant.comisionPctInicial}

Datos del cliente a scorar:
${customerData || 'Cliente sin historial — score bajo por defecto.'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.2 — Agente de scoring de transportadoras (carrier_score)
// Calcula score por transportadora para un tenant: on-time rate, tasa de
// novedades, tasa de devolución, tiempo promedio de entrega.
// ────────────────────────────────────────────────────────────────────
export async function buildCarrierScorePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de scoring de transportadoras de ${tenant.slug}. Para cada transportadora
canónica configurada, calculas: on_time_rate (% entregadas dentro del ETA), novedad_rate
(% envíos con novedad), devolucion_rate (% devueltas), tiempo_promedio_dias. Salida JSON:
{"carriers": [{"nombre_canonico": "...", "score": 0-100, "tier": "preferida|aceptable|evitar",
"on_time_rate": 0-1, "novedad_rate": 0-1, "devolucion_rate": 0-1, "tiempo_promedio_dias": N,
"volumen_envios": N, "recomendacion": "mantener|aumentar_volumen|reducir|suspender"}]}.
Solo puntúas transportadoras con mínimo 5 envíos; con menos, marca "datos_insuficientes".`
  const carriers = await db.carrier.findMany({ where: { tenantId: ctx.tenantId } })
  const shipments = await db.shipment.findMany({ where: { tenantId: ctx.tenantId, transportadoraCanonica: { not: null } }, select: { transportadoraCanonica: true, estado: true, novedad: true, tiempoEstimadoDias: true, createdAt: true, updatedAt: true } })
  const byCarrier = new Map<string, typeof shipments>()
  for (const s of shipments) {
    if (!s.transportadoraCanonica) continue
    if (!byCarrier.has(s.transportadoraCanonica)) byCarrier.set(s.transportadoraCanonica, [])
    byCarrier.get(s.transportadoraCanonica)!.push(s)
  }
  const user = `Transportadoras canónicas configuradas para ${tenant.slug}:
${carriers.map(c => `- ${c.nombreCanonico} (${c.cobertura}) | variantes: ${c.variantes}`).join('\n') || 'Ninguna configurada — usa transportadoraCanonica de los envíos.'}

Envíos históricos agrupados por transportadora:
${[...byCarrier.entries()].map(([name, list]) => `- ${name}: ${list.length} envíos | entregados: ${list.filter(s => s.estado === 'entregada').length} | novedad: ${list.filter(s => s.estado === 'novedad' || s.novedad).length} | devueltos: ${list.filter(s => s.estado === 'devuelta').length}`).join('\n') || 'Sin envíos históricos.'}

Foco solicitado: ${ctx.carrierId ? `carrier ${ctx.carrierId}` : 'todas las transportadoras'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.3 — Agente de enriquecimiento de producto (product_enrichment)
// Genera descripciones, tags SEO, alt de imagen y sugerencias de
// categorías para productos del catálogo, manteniendo el tono de marca.
// ────────────────────────────────────────────────────────────────────
export async function buildProductEnrichmentPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el enriquecedor de catálogo de ${tenant.slug}. Para cada producto recibido, generas:
1) description_seo (máx 160 caracteres, incluye palabras clave del producto y la marca).
2) alt_image (descripción accesible de la imagen, 100-150 caracteres).
3) tags (5-8 tags separados por coma, sin repetir el nombre).
4) categoria_sugerida (familia | short | pantalon | batola | accesorio | otro).
5) diseno_sugerido (si el campo diseno está vacío pero el nombre lo sugiere).
Salida JSON estricta con esas 5 claves. Tono: cercano, comercial, sin promesas falsas. No inventes
material, tallas ni colores que no estén en el nombre o descripción original.`
  let productData = ''
  if (ctx.productId) {
    const p = await db.product.findUnique({ where: { id: ctx.productId } })
    if (p) productData = `SKU: ${p.sku} | nombre: ${p.name} | descripción actual: ${p.description || '(vacía)'} | diseño: ${p.diseno || '(vacío)'} | categoría: ${p.categoria || '(vacía)'} | precio: $${p.price} | stock: ${p.stock} | imagen: ${p.imageUrl || 'sin imagen'}`
  }
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Plataforma de catálogo origen: ${tenant.plataformaCatalogo}

Producto a enriquecer:
${productData || 'Producto no encontrado — pide SKU para proceder.'}

Consulta contextual: "${ctx.query || '(sin consulta adicional)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.4 — Agente de marketplace (marketplace)
// Sincroniza productos del tenant con marketplaces externos (Mercado Libre,
// Amazon, Falabella, Linio) y resume oportunidades de publicación.
// ────────────────────────────────────────────────────────────────────
export async function buildMarketplacePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de marketplaces de ${tenant.slug}. Gestionas la publicación de productos
en marketplaces colombianos y latam (Mercado Libre CO, Amazon, Falabella, Linio, Shopify-driven
marketplace). Para cada producto candidado, produces:
{"sku": "...", "marketplace_sugerido": "...", "titulo_optimizado": "... (máx 60 char)",
"categoria_marketplace": "...", "precio_sugerido": N, "comision_estimada_pct": N,
"viabilidad": "alta|media|baja", "observaciones": "..."}. Considera comisiones típicas (ML ~17%,
Amazon ~15%, Falabella ~18%) y ajusta precio para mantener margen. No publiques productos sin
stock positivo ni sin imagen.`
  const candidates = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true, stock: { gt: 0 }, imageUrl: { not: null } }, take: 20, select: { sku: true, name: true, price: true, cost: true, diseno: true, categoria: true, imageUrl: true } })
  const user = `Plataforma origen del catálogo: ${tenant.plataformaCatalogo}
Plan de monetización del tenant: ${tenant.planMonetizacion}

Productos candidatos (con stock e imagen) para ${tenant.slug}:
${candidates.map(p => `- ${p.sku}: ${p.name} [${p.diseno || 'liso'}] cat:${p.categoria || '?'} | precio $${p.price} | costo $${p.cost} | margen ${p.cost > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : '?'}%`).join('\n') || 'Sin candidatos válidos.'}

Foco: ${ctx.productId ? `producto específico ${ctx.productId}` : 'todos los candidatos'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.5 — Agente de afiliados (affiliator)
// Gestiona el programa de afiliados/influencers del tenant: asigna
// click_ids, atribuye ventas, calcula comisiones y notifica pagos.
// ────────────────────────────────────────────────────────────────────
export async function buildAffiliatorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el gestor de afiliados de ${tenant.slug}. Para cada venta con click_id de afiliado
o influencer, calculas la comisión según el deal configurado (CPA fijo, % sobre GMV, o escalonado),
atribuyes la venta al afiliado correcto (resolviendo el click_id contra el catálogo de afiliados),
y produces un resumen para pago. Salida JSON:
{"click_id": "...", "afiliado_id": "...", "afiliado_nombre": "...", "pedido_id": "...",
"gmv": N, "tipo_comision": "CPA|pct|escalonado", "comision_monto": N, "estado": "pendiente|aprobada|pagada",
"fecha_pago_estimada": "YYYY-MM-DD", "observaciones": "..."}. Si el click_id no resuelve a un
afiliado activo, marca estado="sin_afiliado" y no calculas comisión.`
  let orderData = ''
  if (ctx.orderId) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, select: { number: true, total: true, clickId: true, sourceCampaign: true, sourcePlatform: true, createdAt: true, customer: { select: { name: true } } } })
    if (order) {
      orderData = `Pedido ${order.number} | GMV $${order.total} | click_id: ${order.clickId || 'ninguno'} | source_campaign: ${order.sourceCampaign || '?'} | source_platform: ${order.sourcePlatform || '?'} | cliente: ${order.customer.name} | fecha: ${order.createdAt.toISOString().slice(0, 10)}`
    }
  }
  const user = `Plan de monetización del tenant: ${tenant.planMonetizacion}
Comisión % inicial sobre GMV (cuando el afiliado es la propia plataforma): ${tenant.comisionPctInicial}%

Pedido a atribuir:
${orderData || 'Sin pedido — pide el número de pedido o click_id.'}

Afiliado foco: ${ctx.affiliateId || '(resolver automáticamente desde click_id)'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 8.6 — Agente orquestador de tráfico (traffic_orchestrator)
// Recomienda redistribución de presupuesto entre campañas/anuncios según
// ROAS, CPA y saturación de audiencia. No toca la plataforma — solo propone.
// ────────────────────────────────────────────────────────────────────
export async function buildTrafficOrchestratorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el orquestador de tráfico pagado de ${tenant.slug}. Recibes el desempeño de todas las
campañas activas (Meta, TikTok, Google) y propones redistribución de presupuesto. Salida JSON:
{"recomendaciones": [{"campaign_id": "...", "plataforma": "...", "accion": "pausar|reducir|aumentar|mantener",
"razon": "...", "budget_diario_sugerido": N, "roas_actual": N, "cpa_actual": N, "delta_pct": N}],
"resumen": "frase corta", "auto_kill_sugerido": ["ad_id", ...]}. Reglas:
1) Pausa campañas con ROAS < 0.5 después de gastar > 1.5× CPA objetivo.
2) Aumenta campañas con ROAS > 2.0 y saturación < 70%.
3) Nunca aumentes más de 30% el budget diario de una campaña en una sola recomendación.
4) Marca auto_kill=true solo si CPA > 2× objetivo y ROAS < 0.3.`
  const campaigns = await db.campaign.findMany({ where: { tenantId: ctx.tenantId, status: 'active' }, include: { ads: { include: { spend: { orderBy: { date: 'desc' }, take: 7 } } }, platform: { select: { name: true } } }, take: 30 })
  const user = `Tenant: ${tenant.slug} | plan: ${tenant.planMonetizacion}

Campañas activas (últimos 7 días):
${campaigns.map(c => `- ${c.id} [${c.platform.name}] ${c.name} | objetivo: ${c.objective || '?'} | budget diario: $${c.budgetDaily ?? '?'} | ads: ${c.ads.length} | spend 7d: $${c.ads.flatMap(a => a.spend).reduce((s, sp) => s + sp.spend, 0).toFixed(0)}`).join('\n') || 'Sin campañas activas.'}

Foco solicitado: ${ctx.campaignId ? `campaña ${ctx.campaignId}` : 'todas las campañas'}
${ctx.adId ? `Anuncio foco: ${ctx.adId}` : ''}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// 9.1 — Agente de análisis de dirección (address_analysis)
// Analiza la calidad y entregabilidad de una dirección antes de despachar,
// cruzando con historial de entregas y coberturas de transportadoras.
// ────────────────────────────────────────────────────────────────────
export async function buildAddressAnalysisPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el analista de direcciones de ${tenant.slug} (Colombia-focused). Antes de despachar,
evalúas la dirección del cliente contra: (1) completitud de los 10 campos Saramantha, (2) coberturas
de las transportadoras configuradas para este tenant, (3) historial de entrega de esa dirección
para este tenant (¿hubo rechazo, novedad, devolución?), (4) normalización (barrio, vía, número,
interior, referencias). Salida JSON:
{"direccion_completa": bool, "campos_faltantes": [...], "cobertura": "nacional|internacional|sin_cobertura",
"transportadoras_disponibles": [...], "riesgo_entrega": "bajo|medio|alto", "historial_previo": "ok|rechazo|novedad|sin_registro",
"accion_recomendada": "despachar|confirmar_direccion|pedir_referencia|rechazar_envio",
"pregunta_cliente": "..."}. Nunca inventes un resultado de entrega que no esté en el historial.`
  let history = ''
  let partialAddress = ctx.partialAddress || {}
  if (ctx.customerId) {
    const h = await db.deliveryHistory.findMany({ where: { tenantId: ctx.tenantId, contactoId: ctx.customerId }, take: 5 })
    history = h.map(d => `- ${d.direccionNormalizada}, ${d.ciudad}: ${d.resultadoEntregaAnterior || 'sin registro'}`).join('\n')
  }
  if (ctx.orderId && Object.keys(partialAddress).length === 0) {
    const order = await db.order.findUnique({ where: { id: ctx.orderId }, select: { address: true, city: true, country: true } })
    if (order) partialAddress = { direccion: order.address || '', ciudad: order.city || '', pais: order.country || 'CO' }
  }
  const carriers = await db.carrier.findMany({ where: { tenantId: ctx.tenantId }, select: { nombreCanonico: true, cobertura: true } })
  const user = `Proveedor logístico principal: ${tenant.proveedorLogistico}
Transportadoras canónicas: ${carriers.map(c => `${c.nombreCanonico} (${c.cobertura})`).join(', ') || 'ninguna configurada'}

Dirección a analizar: ${JSON.stringify(partialAddress)}

Historial de entrega de este contacto:
${history || 'Sin historial previo.'}

Mensaje del cliente: "${ctx.message || '(sin mensaje — solo análisis estructural)'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// Router — dispatches to the right builder
// ────────────────────────────────────────────────────────────────────
export async function buildAgentPrompt(agentName: AgentName, ctx: AgentContext): Promise<{ system: string; user: string }> {
  switch (agentName) {
    case 'profile': return buildProfilePrompt(ctx)
    case 'speech': return buildSpeechPrompt(ctx)
    case 'quote': return buildQuotePrompt(ctx)
    case 'catalog': return buildCatalogPrompt(ctx)
    case 'theme': return buildThemePrompt(ctx)
    case 'objection': return buildObjectionPrompt(ctx)
    case 'address': return buildAddressPrompt(ctx)
    case 'logistics': return buildLogisticsPrompt(ctx)
    case 'vision': return buildVisionPrompt(ctx)
    case 'checkout': return buildCheckoutPrompt(ctx)
    // BUILD-AGENTS-LIB-001 — 16 new agents
    case 'buyer_behavior': return buildBuyerBehaviorPrompt(ctx)
    case 'cart_builder': return buildCartBuilderPrompt(ctx)
    case 'guide_tracking': return buildGuideTrackingPrompt(ctx)
    case 'novedades': return buildNovedadesPrompt(ctx)
    case 'redelivery': return buildRedeliveryPrompt(ctx)
    case 'remarketing': return buildRemarketingPrompt(ctx)
    case 'guide_alert': return buildGuideAlertPrompt(ctx)
    case 'sales_retainer': return buildSalesRetainerPrompt(ctx)
    case 'logistics_notifier': return buildLogisticsNotifierPrompt(ctx)
    case 'customer_score': return buildCustomerScorePrompt(ctx)
    case 'carrier_score': return buildCarrierScorePrompt(ctx)
    case 'product_enrichment': return buildProductEnrichmentPrompt(ctx)
    case 'marketplace': return buildMarketplacePrompt(ctx)
    case 'affiliator': return buildAffiliatorPrompt(ctx)
    case 'traffic_orchestrator': return buildTrafficOrchestratorPrompt(ctx)
    case 'address_analysis': return buildAddressAnalysisPrompt(ctx)
    default: throw new Error(`Unknown agent: ${agentName}`)
  }
}

export const AGENT_NAMES: AgentName[] = [
  // Existing 10
  'profile', 'speech', 'quote', 'catalog', 'theme', 'objection', 'address', 'logistics', 'vision', 'checkout',
  // BUILD-AGENTS-LIB-001 — 16 new
  'buyer_behavior', 'cart_builder',
  'guide_tracking', 'novedades', 'redelivery', 'remarketing', 'guide_alert', 'sales_retainer', 'logistics_notifier',
  'customer_score', 'carrier_score', 'product_enrichment', 'marketplace', 'affiliator', 'traffic_orchestrator',
  'address_analysis',
]
export const AGENT_LABELS: Record<AgentName, string> = {
  // Existing 10
  profile: 'Perfilamiento de leads',
  speech: 'Discurso de ventas por perfil',
  quote: 'Ofertas y cotización cruzada',
  catalog: 'Respuesta visual-primero',
  theme: 'Oferta por tema/personaje',
  objection: 'Manejo de objeciones',
  address: 'Confirmación de datos (10 campos)',
  logistics: 'Logística de fletes',
  vision: 'Visión (identificación por imagen)',
  checkout: 'Checkout y sincronización',
  // BUILD-AGENTS-LIB-001 — 16 new
  buyer_behavior: 'Análisis de comportamiento de compra',
  cart_builder: 'Constructor de carrito desde lenguaje natural',
  guide_tracking: 'Seguimiento de guía',
  novedades: 'Manejo de novedades logísticas',
  redelivery: 'Coordinación de re-entrega',
  remarketing: 'Re-enganche de leads fríos',
  guide_alert: 'Alertas operativas de guías',
  sales_retainer: 'Retención de ventas en riesgo',
  logistics_notifier: 'Notificaciones proactivas logísticas',
  customer_score: 'Scoring de clientes (LTV/churn)',
  carrier_score: 'Scoring de transportadoras',
  product_enrichment: 'Enriquecimiento de catálogo (SEO/alt)',
  marketplace: 'Sincronización con marketplaces',
  affiliator: 'Gestión de afiliados e influencers',
  traffic_orchestrator: 'Orquestador de tráfico pagado',
  address_analysis: 'Análisis de calidad de dirección',
}
