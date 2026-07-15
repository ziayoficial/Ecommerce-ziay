import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import {
  INTEGRATION_REGISTRY,
  getIntegrationById,
  maskSecret,
  isIntegrationConfigured,
  type CredentialField,
} from '@/lib/adapters/credential-fields'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import {
  credentialsService,
  resolveCredentialNamespace,
  integrationIdToCredKey,
  credKeyToIntegrationId,
  maskAllCredentialFields,
  parseCredValue,
} from '@/lib/services'

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
// SPRINT-BACKEND-FINAL-001 — DB access + key/mask helpers migrated to
// `credentialsService`. The route owns: request parsing, registry lookup,
// response shaping. The masking + namespace-resolution helpers live in
// the service so future admin tools can reuse them.
// ───────────────────────────────────────────────────────────────────────────

/** Mask every value in a raw credential payload (used when the integration
 *  id is unknown — registry was pruned or it's a legacy row). */
function maskAllFieldsUnknown(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v ? maskSecret(String(v)) : ''
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/integrations/credentials
// Returns all saved credentials for the caller's tenant, masked, grouped
// by integration id.
// ───────────────────────────────────────────────────────────────────────────
export const GET = withErrorHandling(async () => {

  const { session, error } = await requireAuth()
  if (error) return error

  const ns = resolveCredentialNamespace(session?.user?.tenantId ?? null)

  // Only Setting rows whose key starts with `cred::{ns}::`
  const rows = await credentialsService.listForNamespace(ns)

  const integrations: Record<
    string,
    { configured: boolean; fields: Record<string, string> }
  > = {}

  for (const row of rows) {
    const integrationId = credKeyToIntegrationId(row.key, ns)
    const config = getIntegrationById(integrationId)
    const raw = parseCredValue(row.value)
    if (config) {
      integrations[integrationId] = {
        configured: isIntegrationConfigured(config, raw),
        fields: maskAllCredentialFields(config, raw),
      }
    } else {
      // Unknown integration id (e.g. registry was pruned) — return masked.
      integrations[integrationId] = {
        configured: Object.values(raw).some(Boolean),
        fields: maskAllFieldsUnknown(raw),
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

  const ns = resolveCredentialNamespace(session?.user?.tenantId ?? null)

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
  const existing = await credentialsService.getForIntegration(ns, integration)
  const existingFields = existing ? parseCredValue(existing.value) : {}
  const merged: Record<string, string> = { ...existingFields }
  for (const [k, v] of Object.entries(sanitized)) {
    merged[k] = v
  }

  await credentialsService.upsertCredentialRow(
    ns,
    integration,
    JSON.stringify(merged),
  )

  return NextResponse.json({
    integration,
    configured: isIntegrationConfigured(config, merged),
    fields: maskAllCredentialFields(config, merged),
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

  const ns = resolveCredentialNamespace(session?.user?.tenantId ?? null)

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

  const settingKey = integrationIdToCredKey(ns, integration)
  const existing = await credentialsService.getForIntegration(ns, integration)
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
      await credentialsService.deleteCredentialRow(settingKey)
      return NextResponse.json({
        integration,
        configured: false,
        fields: {},
        deleted: 'all',
      })
    }
    await credentialsService.updateCredentialValue(settingKey, JSON.stringify(raw))
    return NextResponse.json({
      integration,
      configured: config ? isIntegrationConfigured(config, raw) : Object.values(raw).some(Boolean),
      fields: config ? maskAllCredentialFields(config, raw) : maskAllFieldsUnknown(raw),
      deleted: 'field',
    })
  }

  // Case B: delete the whole integration
  await credentialsService.deleteCredentialRow(settingKey)
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
