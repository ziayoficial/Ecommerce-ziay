// ────────────────────────────────────────────────────────────────────
// 6.9 — Agente de visión (identificación de producto por imagen)
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

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
