import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'
import { credentialsService } from '@/lib/services'

const log = getLogger('api:admin:migrate-credentials')

// ───────────────────────────────────────────────────────────────────────────
// /api/admin/migrate-credentials
//
// SPRINT-SEC-R9-001 (I2-R9R10) — admin-only bulk migration of legacy
// plaintext `cred::*` Setting rows into AES-256-GCM `enc:v1:` ciphertexts.
//
// Background:
//   R-9 closed the "plaintext credentials at rest" gap for NEW writes —
//   `credentialsService.upsertCredentialRow` / `updateCredentialValue`
//   encrypt on every write, and `parseCredValue` transparently decrypts
//   on every read (with a fallthrough for legacy plaintext). But existing
//   rows written before R-9 are still plaintext. The lazy migration
//   (read-time fallthrough + re-encrypt-on-next-write) handles them
//   eventually, but an operator may want to force a one-shot bulk
//   re-encryption — e.g. before rotating `ENCRYPTION_KEY`, or to satisfy
//   an auditor's "no plaintext credentials in the DB" check.
//
//   This endpoint does that.
//
// Auth model:
//   - `requireRole(['admin'])` — only tenant admins can trigger a migration.
//     Tenant admins are scoped to their own tenantId (the service's
//     `tenantId` arg narrows the scan to `cred::{tenantId}::*`). Platform
//     admins (no tenantId) trigger a global migration across ALL namespaces
//     (including `_global` and legacy `cred::{integrationId}` keys without
//     a namespace segment).
//
// Methods:
//   - POST → run the migration. Body is optional: `{ tenantId?: string }`.
//            When `tenantId` is omitted, the caller's session tenantId is
//            used (or `undefined` for platform admins → global scan).
//   - GET  → dry-run / audit. Returns the encryption-state counts
//            (`total`, `encryptedV1`, `legacy`) without writing anything.
//            Same body semantics as POST (query params for GET).
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/migrate-credentials
 *
 * Body (optional): `{ tenantId?: string }`
 *   - When omitted: a tenant admin migrates their own tenant's credentials;
 *     a platform admin migrates ALL credentials (global scan).
 *   - When provided: must match the caller's tenantId (tenant admins).
 *     Platform admins can pass any tenantId to scope the migration to that
 *     tenant.
 *
 * @security admin role required (tenant or platform admin)
 * @returns {
 *   ok: true,
 *   scope: 'tenant' | 'global',
 *   tenantId: string | null,
 *   summary: { scanned, migrated, skipped, errors, errorSamples }
 * }
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const { session, error } = await requireRole(['admin'])
  if (error) return error

  // Parse the optional body. Empty body is fine — fall back to the caller's
  // own tenantId (or `undefined` for platform admins → global).
  let body: unknown = {}
  try {
    const text = await req.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { tenantId: tenantIdParam } = (body ?? {}) as { tenantId?: unknown }

  const sessionTenantId = session?.user?.tenantId ?? null

  // Resolve the effective scope.
  let scope: 'tenant' | 'global'
  let effectiveTenantId: string | undefined

  if (typeof tenantIdParam === 'string' && tenantIdParam) {
    // Caller passed an explicit tenantId. Platform admins can scope to any
    // tenant; tenant admins can only scope to their own.
    if (sessionTenantId && sessionTenantId !== tenantIdParam) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch (cannot migrate another tenant)' },
        { status: 403 },
      )
    }
    effectiveTenantId = tenantIdParam
    scope = 'tenant'
  } else if (sessionTenantId) {
    // No explicit param — scope to the caller's own tenant.
    effectiveTenantId = sessionTenantId
    scope = 'tenant'
  } else {
    // Platform admin, no param — global scan.
    effectiveTenantId = undefined
    scope = 'global'
  }

  log.info(
    {
      triggeredBy: session?.user?.email,
      scope,
      tenantId: effectiveTenantId ?? null,
    },
    'Starting credential migration',
  )

  try {
    const summary = await credentialsService.migrateLegacyCredentials(effectiveTenantId)

    log.info(
      {
        triggeredBy: session?.user?.email,
        scope,
        tenantId: effectiveTenantId ?? null,
        summary,
      },
      'Credential migration complete',
    )

    return NextResponse.json({
      ok: true,
      scope,
      tenantId: effectiveTenantId ?? null,
      summary,
    })
  } catch (err) {
    // `migrateLegacyCredentials` only throws on a scan failure (per-row
    // failures are captured into `summary.errors` and don't throw). Surface
    // it as a 500 so the operator knows the migration didn't complete.
    log.error(
      {
        err,
        triggeredBy: session?.user?.email,
        scope,
        tenantId: effectiveTenantId ?? null,
      },
      'Credential migration failed',
    )
    return NextResponse.json(
      {
        error: 'Migration failed — see server logs for details',
        scope,
        tenantId: effectiveTenantId ?? null,
      },
      { status: 500 },
    )
  }
})

/**
 * GET /api/admin/migrate-credentials
 *
 * Dry-run audit — returns the encryption-state counts without writing.
 * Same scoping rules as POST (query param `?tenantId=...` or the caller's
 * session tenantId, with platform admins defaulting to global).
 *
 * @security admin role required
 * @returns {
 *   ok: true,
 *   scope: 'tenant' | 'global',
 *   tenantId: string | null,
 *   state: { total, encryptedV1, legacy }
 * }
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const { session, error } = await requireRole(['admin'])
  if (error) return error

  const url = new URL(req.url)
  const tenantIdParam = url.searchParams.get('tenantId')

  const sessionTenantId = session?.user?.tenantId ?? null

  let scope: 'tenant' | 'global'
  let effectiveTenantId: string | undefined

  if (tenantIdParam) {
    if (sessionTenantId && sessionTenantId !== tenantIdParam) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }
    effectiveTenantId = tenantIdParam
    scope = 'tenant'
  } else if (sessionTenantId) {
    effectiveTenantId = sessionTenantId
    scope = 'tenant'
  } else {
    effectiveTenantId = undefined
    scope = 'global'
  }

  const state = await credentialsService.auditCredentialEncryptionState(
    effectiveTenantId,
  )

  return NextResponse.json({
    ok: true,
    scope,
    tenantId: effectiveTenantId ?? null,
    state,
  })
})
