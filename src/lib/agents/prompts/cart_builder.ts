// ────────────────────────────────────────────────────────────────────
// 6.12 — Agente constructor de carrito (cart_builder)
// Convierte lenguaje natural del lead en un carrito estructurado,
// resolviendo SKUs contra el catálogo real del tenant.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

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
