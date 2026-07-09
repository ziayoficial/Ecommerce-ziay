// CommerceFlow OS — 10 conversational agents (Saramantha §6 spec, exact prompts)
// Each agent is a function that builds the system prompt from Tenant config + business tables
// (regla de oro §2: NUNCA business data in prompt text — always fetched from DB filtered by tenantId).

import { db } from '@/lib/db'

export type AgentName =
  | 'profile' | 'speech' | 'quote' | 'catalog' | 'theme'
  | 'objection' | 'address' | 'logistics' | 'vision' | 'checkout'

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
comprar, extrae de la conversación: nombre, apellido, teléfono,
departamento, ciudad, dirección, horario, talla, diseño y cantidad.
Pregunta solo los campos que falten, uno a la vez si es necesario. Al
completar los 10 campos, normaliza la dirección y consulta
historial_entrega_direccion (filtrado por tenant_id) antes de confirmar
el pedido.`
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
    default: throw new Error(`Unknown agent: ${agentName}`)
  }
}

export const AGENT_NAMES: AgentName[] = ['profile', 'speech', 'quote', 'catalog', 'theme', 'objection', 'address', 'logistics', 'vision', 'checkout']
export const AGENT_LABELS: Record<AgentName, string> = {
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
}
