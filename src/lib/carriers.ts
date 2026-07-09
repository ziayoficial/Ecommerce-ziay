// CommerceFlow OS — Carrier name normalization
// Saramantha §15.2 + §8.6 — el mismo transportador puede llegar escrito de
// 6 formas distintas ("Interrapidísimo", "Interrapidisimo", "interrapidisimo",
// "Interrapidicimo", "Inter Rapidísimo", "INTERRAPIDISIMO") según de dónde
// venga el dato (Dropi, 99envios, Aveonline, manual del agente, CRM del cliente).
//
// `Carrier` (tabla) define el nombre canónico por tenant + la lista de
// variantes aceptadas. Esta función normaliza cualquier string contra esa
// tabla antes de escribirlo en `Shipment.transportadoraCanonica`.
//
// Si no encuentra match, devuelve el rawName tal cual y deja un TODO para que
// el equipo de onboarding lo agregue al catálogo canónico del tenant.

import { db } from '@/lib/db'

/**
 * Normaliza el nombre de una transportadora contra la tabla `Carrier` del tenant.
 *
 * Estrategia de match (en orden, primer match gana):
 *   1. Exacto (case-insensitive, trimmed) sobre `nombreCanonico`.
 *   2. Exacto sobre alguna de las variantes (split por coma, case-insensitive).
 *   3. Normalización de acentos + ASCII fold, comparando contra canonico + variantes.
 *
 * @returns nombre canónico si encuentra match; rawName sin cambios si no.
 */
export async function normalizeCarrierName(
  tenantId: string,
  rawName: string,
): Promise<string> {
  if (!rawName) return rawName

  const trimmed = rawName.trim()
  const folded = foldAccents(trimmed).toLowerCase()

  const carriers = await db.carrier.findMany({ where: { tenantId } })

  for (const c of carriers) {
    // 1. Match exacto contra nombreCanonico.
    if (trimmed.toLowerCase() === c.nombreCanonico.toLowerCase()) {
      return c.nombreCanonico
    }
    // 2. Match exacto contra variantes.
    const variantes = (c.variantes ?? '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
    for (const v of variantes) {
      if (trimmed.toLowerCase() === v.toLowerCase()) {
        return c.nombreCanonico
      }
    }
    // 3. ASCII fold + lowercase en ambos lados.
    if (folded === foldAccents(c.nombreCanonico).toLowerCase()) {
      return c.nombreCanonico
    }
    for (const v of variantes) {
      if (folded === foldAccents(v).toLowerCase()) {
        return c.nombreCanonico
      }
    }
  }

  // TODO(onboarding): el carrier `rawName` no está en el catálogo canónico del
  // tenant `tenantId`. Agregarlo manualmente a la tabla `Carrier` (con su
  // `nombreCanonico` y la lista de variantes) para que futuras llamadas lo
  // normalicen correctamente. Por ahora devolvemos el raw sin romper el flujo.
  return trimmed
}

/**
 * Quita acentos/diacríticos y normaliza espacios. Suficiente para comparar
 * "Interrapidísimo" contra "Interrapidisimo" sin depender de collation de DB
 * (SQLite no hace fold automático).
 */
function foldAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
