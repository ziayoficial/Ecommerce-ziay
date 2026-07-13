// ────────────────────────────────────────────────────────────────────
// 6.3 — Agente de ofertas y cotización cruzada
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

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
