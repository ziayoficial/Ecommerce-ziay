import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth-helpers'
import {
  INTEGRATION_REGISTRY,
  getIntegrationById,
  maskSecret,
  isIntegrationConfigured,
  type CredentialField,
  type IntegrationConfig,
} from '@/lib/adapters/credential-fields'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// ───────────────────────────────────────────────────────────────────────────
// Credential management endpoint — stores integration credentials in the
// Setting model under a tenant-scoped key prefix.
//
// V5 (AUDIT-FINAL-SEC-001): previamente las credenciales se guardaban bajo
// `cred::{integrationId}` (global) — cualquier usuario autenticado podía
// leer las credenciales (enmascaradas) y sobrescribirlas para cualquier
// integración, sin importar el tenant. Ahora la clave incluye el tenantId:
//   `cred::{tenantId}::{integrationId}`
// Así cada tenant tiene su propio namespace de credenciales. Los admins de
// plataforma (sin tenantId) usan el namespace `_global`.
//
// Security:
//   - All routes require an authenticated session (requireAuth).
//   - GET never returns raw secrets — values are masked ("••••" + last4).
//   - POST/DELETE return masked values too, so the client never sees the
//     raw secret after the request completes.
//
// Storage convention:
//   Setting.key   = `cred::{tenantId}::{integrationId}`
//   Setting.value = JSON.stringify({ [fieldKey]: rawValue, ... })
//
// SPRINT8-SERVICES-REST-001 — left inline. Every method touches only the
// `Setting` table (key/value JSON blob under a `cred::*` prefix). Per
// rule #2 (1-2 simple db calls OK to leave) and per the SPRINT7 architect's
// note ("Settings is a tiny key/value table, not worth a service on its
// own"), the masking/merge logic + the Setting upsert are best kept
// together in the route. A `setting.service.ts` would only be worth it
// if more key prefixes (`feature::*`, `policy::*`) accumulate.
// TODO: migrate to service layer when more Setting consumers land.
// ───────────────────────────────────────────────────────────────────────────

const CRED_ROOT = 'cred::'
/** Namespace for platform-admin credentials (no tenantId on session). */
const GLOBAL_NAMESPACE = '_global'

/**
 * Resolve the credential namespace for the current session.
 * - Tenant users → their tenantId.
 * - Platform admins (no tenantId) → `_global`.
 */
function resolveNamespace(tenantId: string | null): string {
  return tenantId ?? GLOBAL_NAMESPACE
}

/** Build the Setting key prefix for a namespace: `cred::{ns}::`. */
function credKeyPrefix(ns: string): string {
  return `${CRED_ROOT}${ns}::`
}

/** Build the Setting key for a namespace + integration id. */
function integrationIdToKey(ns: string, integrationId: string): string {
  return `${credKeyPrefix(ns)}${integrationId}`
}

/**
 * Strip the `cred::{ns}::` prefix to recover the integration id from a
 * Setting key. Falls back to stripping just `cred::` for legacy keys.
 */
function keyToIntegrationId(key: string, ns: string): string {
  const prefix = credKeyPrefix(ns)
  if (key.startsWith(prefix)) return key.slice(prefix.length)
  // Legacy key (pre-V5): `cred::{integrationId}` — no namespace.
  if (key.startsWith(CRED_ROOT)) return key.slice(CRED_ROOT.length)
  return key
}

/**
 * Mask every field of a credential payload. Password / text / url are all
 * masked uniformly — even URLs and consumer keys can contain secrets we
 * never want to ship back to the browser.
 */
function maskAllFields(
  integration: IntegrationConfig,
  raw: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = {}
  for (const field of integration.fields) {
    const v = raw[field.key]
    masked[field.key] = v ? maskSecret(v) : ''
  }
  // Also include any unknown keys (legacy / forward-compat) — masked too.
  for (const k of Object.keys(raw)) {
    if (masked[k] === undefined && raw[k]) {
      masked[k] = maskSecret(String(raw[k]))
    }
  }
  return masked
}

/** Safely parse the JSON value of a Setting row. Returns {} on any error. */
function parseCredValue(value: string | null | undefined): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v
        else if (v !== null && v !== undefined) out[k] = String(v)
      }
      return out
    }
  } catch {
    // fall through
  }
  return {}
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/integrations/credentials
// Returns all saved credentials for the caller's tenant, masked, grouped
// by integration id.
// ───────────────────────────────────────────────────────────────────────────
export const GET = withErrorHandling(async () => {

  const { session, error } = await requireAuth()
  if (error) return error

  const ns = resolveNamespace(session?.user?.tenantId ?? null)
  const prefix = credKeyPrefix(ns)

  // Only Setting rows whose key starts with `cred::{ns}::`
  const rows = await db.setting.findMany({
    where: { key: { startsWith: prefix } },
    select: { key: true, value: true },
  })

  const integrations: Record<
    string,
    { configured: boolean; fields: Record<string, string> }
  > = {}

  for (const row of rows) {
    const integrationId = keyToIntegrationId(row.key, ns)
    const config = getIntegrationById(integrationId)
    const raw = parseCredValue(row.value)
    if (config) {
      integrations[integrationId] = {
        configured: isIntegrationConfigured(config, raw),
        fields: maskAllFields(config, raw),
      }
    } else {
      // Unknown integration id (e.g. registry was pruned) — return masked.
      const masked: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (v) masked[k] = maskSecret(String(v))
      }
      integrations[integrationId] = {
        configured: Object.values(raw).some(Boolean),
        fields: masked,
      }
    }
  }

  return NextResponse.json({ integrations })

})

// ───────────────────────────────────────────────────────────────────────────
// POST /api/integrations/credentials
// Body: { integration: string, fields: Record<string, string> }
//   - `integration` MUST exist in INTEGRATION_REGISTRY
//   - `fields` keys MUST match declared field keys (others are silently
//     dropped to prevent stuffing arbitrary data)
//   - Empty-string field values are stored (so users can clear a field)
//   - Returns masked values for the saved integration
// ───────────────────────────────────────────────────────────────────────────
export const POST = withErrorHandling(async (req: NextRequest) => {

  const { session, error } = await requireAuth()
  if (error) return error

  const ns = resolveNamespace(session?.user?.tenantId ?? null)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { integration, fields } = (body ?? {}) as {
    integration?: unknown
    fields?: unknown
  }

  if (typeof integration !== 'string' || !integration) {
    return NextResponse.json({ error: '`integration` (string) is required' }, { status: 400 })
  }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return NextResponse.json({ error: '`fields` (object) is required' }, { status: 400 })
  }

  const config = getIntegrationById(integration)
  if (!config) {
    return NextResponse.json(
      { error: `Unknown integration: ${integration}` },
      { status: 400 },
    )
  }

  // Whitelist field keys against the registry — drop unknown keys.
  const allowedKeys = new Set(config.fields.map((f: CredentialField) => f.key))
  const sanitized: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!allowedKeys.has(k)) continue
    if (v === null || v === undefined) {
      sanitized[k] = ''
    } else if (typeof v === 'string') {
      sanitized[k] = v
    } else {
      sanitized[k] = String(v)
    }
  }

  // Merge with existing stored values so callers can PATCH a single field
  // without resending the whole payload. (A caller that wants to truly
  // clear a field sends an empty string for that key, which overwrites.)
  const settingKey = integrationIdToKey(ns, integration)
  const existing = await db.setting.findUnique({ where: { key: settingKey } })
  const existingFields = existing ? parseCredValue(existing.value) : {}
  const merged: Record<string, string> = { ...existingFields }
  for (const [k, v] of Object.entries(sanitized)) {
    merged[k] = v
  }

  await db.setting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(merged) },
    create: { key: settingKey, value: JSON.stringify(merged) },
  })

  return NextResponse.json({
    integration,
    configured: isIntegrationConfigured(config, merged),
    fields: maskAllFields(config, merged),
  })

})

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/integrations/credentials
// Body:
//   { integration: "mercadopago" }                       → remove whole integration
//   { integration: "mercadopago", field: "accessToken" } → remove a single field
// ───────────────────────────────────────────────────────────────────────────
export const DELETE = withErrorHandling(async (req: NextRequest) => {

  const { session, error } = await requireAuth()
  if (error) return error

  const ns = resolveNamespace(session?.user?.tenantId ?? null)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { integration, field } = (body ?? {}) as {
    integration?: unknown
    field?: unknown
  }

  if (typeof integration !== 'string' || !integration) {
    return NextResponse.json({ error: '`integration` (string) is required' }, { status: 400 })
  }

  const settingKey = integrationIdToKey(ns, integration)
  const existing = await db.setting.findUnique({ where: { key: settingKey } })
  if (!existing) {
    return NextResponse.json(
      { error: 'No credentials stored for this integration' },
      { status: 404 },
    )
  }

  const config = getIntegrationById(integration)

  // Case A: delete a single field
  if (typeof field === 'string' && field) {
    const raw = parseCredValue(existing.value)
    delete raw[field]
    if (Object.keys(raw).length === 0) {
      await db.setting.delete({ where: { key: settingKey } })
      return NextResponse.json({
        integration,
        configured: false,
        fields: {},
        deleted: 'all',
      })
    }
    await db.setting.update({
      where: { key: settingKey },
      data: { value: JSON.stringify(raw) },
    })
    return NextResponse.json({
      integration,
      configured: config ? isIntegrationConfigured(config, raw) : Object.values(raw).some(Boolean),
      fields: config ? maskAllFields(config, raw) : Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, v ? maskSecret(String(v)) : '']),
      ),
      deleted: 'field',
    })
  }

  // Case B: delete the whole integration
  await db.setting.delete({ where: { key: settingKey } })
  return NextResponse.json({
    integration,
    configured: false,
    fields: {},
    deleted: 'all',
  })

})

// ───────────────────────────────────────────────────────────────────────────
// Optional route — expose the registry to the client so the UI can render
// without hardcoding the field metadata. The same module is imported
// directly by the client component (`@/lib/adapters/credential-fields`),
// but this endpoint is handy for diagnostics / future admin tools.
// ───────────────────────────────────────────────────────────────────────────
export const PUT = withErrorHandling(async () => {

  const { error } = await requireAuth()
  if (error) return error
  return NextResponse.json({ registry: INTEGRATION_REGISTRY })

})
