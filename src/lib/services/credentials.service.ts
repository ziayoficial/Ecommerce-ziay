// ZIAY — Credentials service layer.
//
// Wraps ALL DB access for integration credential storage. Credentials are
// persisted as JSON blobs in the `Setting` table under tenant-scoped keys:
//   `cred::{tenantId}::{integrationId}`  — tenant-scoped (post-V5).
//   `cred::{integrationId}`              — legacy global (pre-V5).
//
// This service owns:
//   - The Setting CRUD for the `cred::*` prefix.
//   - The masking / merge / parse helpers (moved here from the route so the
//     logic is reusable by future admin tools).
//   - The namespace resolution (tenant users → their tenantId; platform
//     admins → `_global`).
//   - At-rest encryption of `Setting.value` (R-9, I2-R9R10).
//
// Security contract (preserved from the inline route + R-9 hardening):
//   - GET never returns raw secrets — values are masked.
//   - POST/DELETE return masked values too, so the client never sees the
//     raw secret after the request completes.
//   - The `cred::{ns}::` prefix encodes the namespace so a tenant user
//     cannot read another tenant's credentials by guessing the key.
//   - **R-9:** `Setting.value` for `cred::*` rows is now AES-256-GCM
//     encrypted at rest with the `enc:v1:` wire format (see
//     `src/lib/crypto/secret-encryption.ts`). Legacy plaintext rows are
//     read transparently (decryption falls through to plaintext) and are
//     re-encrypted on the next write. The `migrateLegacyCredentials()`
//     helper performs a one-shot bulk re-encryption for admin callers.
//   - **Fail-closed in production:** if `ENCRYPTION_KEY` is unset in prod,
//     every encrypt/decrypt call THROWS. No plaintext credential is ever
//     written in production.
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/integrations/credentials/route.ts`.
// SPRINT-SEC-R9-001 (I2-R9R10) — at-rest encryption layer added.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'
import {
  maskSecret,
  type IntegrationConfig,
} from '@/lib/adapters/credential-fields'
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  isLegacyPlaintextSecret,
} from '@/lib/crypto/secret-encryption'

const CRED_ROOT = 'cred::'
/** Namespace for platform-admin credentials (no tenantId on session). */
const GLOBAL_NAMESPACE = '_global'

/**
 * Resolve the credential namespace for the current session.
 * - Tenant users → their tenantId.
 * - Platform admins (no tenantId) → `_global`.
 */
export function resolveCredentialNamespace(tenantId: string | null): string {
  return tenantId ?? GLOBAL_NAMESPACE
}

/** Build the Setting key prefix for a namespace: `cred::{ns}::`. */
export function credKeyPrefix(ns: string): string {
  return `${CRED_ROOT}${ns}::`
}

/** Build the Setting key for a namespace + integration id. */
export function integrationIdToCredKey(ns: string, integrationId: string): string {
  return `${credKeyPrefix(ns)}${integrationId}`
}

/**
 * Strip the `cred::{ns}::` prefix to recover the integration id from a
 * Setting key. Falls back to stripping just `cred::` for legacy keys.
 */
export function credKeyToIntegrationId(key: string, ns: string): string {
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
export function maskAllCredentialFields(
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

/**
 * Safely parse the JSON value of a credential Setting row.
 *
 * **R-9:** handles both encrypted (`enc:v1:...`) and legacy plaintext
 * values transparently. The decrypted plaintext is parsed as JSON. Returns
 * `{}` on any error (decrypt failure, parse failure, empty input).
 */
export function parseCredValue(value: string | null | undefined): Record<string, string> {
  if (!value) return {}
  try {
    // Decrypt — for legacy plaintext this is a no-op (returns the value as-is).
    // For `enc:v1:...` ciphertexts this returns the original JSON string.
    // For `enc:v0:` dev fallback this strips the prefix and returns plaintext.
    const plaintext = decryptSecret(value)
    if (!plaintext) return {}
    const parsed = JSON.parse(plaintext)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') out[k] = v
        else if (v !== null && v !== undefined) out[k] = String(v)
      }
      return out
    }
  } catch (err) {
    // Decrypt or parse failed — log + return {} so the caller can show
    // a "configured: false" state instead of crashing the request.
    captureError(err as Error, {
      module: 'credentials',
      method: 'parseCredValue',
      reason: 'decrypt-or-parse-failed',
    })
  }
  return {}
}

// ───────────────────────────────────────────────────────────────────────────
// At-rest encryption helpers (R-9)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a JSON-serialized credential payload before writing it to
 * `Setting.value`. Wraps `encryptSecret` from the shared crypto module.
 *
 * Returns the `enc:v1:<iv>:<authTag>:<ciphertext>` string ready to persist.
 * Throws in production when `ENCRYPTION_KEY` is unset (fail-closed).
 */
function encryptCredValue(jsonString: string): string {
  return encryptSecret(jsonString)
}

export const credentialsService = {
  /**
   * List all stored credential Setting rows for a namespace. Returns the
   * raw rows (key + value) — values are STILL ENCRYPTED at this layer.
   * Callers are responsible for `parseCredValue` (which decrypts) and
   * masking the values before returning them to the client.
   */
  async listForNamespace(ns: string) {
    try {
      const prefix = credKeyPrefix(ns)
      return await db.setting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'credentials',
        method: 'listForNamespace',
        namespace: ns,
      })
      throw new Error('Failed to fetch credentials')
    }
  },

  /**
   * Read a single credential Setting row by namespace + integration id.
   * Returns null when not stored. The returned `value` is still in its
   * at-rest form (encrypted or legacy plaintext) — callers must pass it
   * through `parseCredValue` to get the decrypted JSON object.
   */
  async getForIntegration(ns: string, integrationId: string) {
    try {
      const key = integrationIdToCredKey(ns, integrationId)
      return await db.setting.findUnique({ where: { key } })
    } catch (err) {
      captureError(err as Error, {
        service: 'credentials',
        method: 'getForIntegration',
        namespace: ns,
        integrationId,
      })
      throw new Error('Failed to fetch credential')
    }
  },

  /**
   * Upsert a credential Setting row. The caller is responsible for
   * merging new fields with existing ones before calling — this method
   * writes the supplied JSON blob verbatim, **after encrypting it** (R-9).
   *
   * The `value` argument should be a plain JSON string (the merged fields
   * object). It is encrypted here, so the caller never has to think about
   * the wire format.
   */
  async upsertCredentialRow(ns: string, integrationId: string, value: string) {
    try {
      const key = integrationIdToCredKey(ns, integrationId)
      const encrypted = encryptCredValue(value)
      return await db.setting.upsert({
        where: { key },
        update: { value: encrypted },
        create: { key, value: encrypted },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'credentials',
        method: 'upsertCredentialRow',
        namespace: ns,
        integrationId,
      })
      throw new Error('Failed to upsert credential')
    }
  },

  /**
   * Update the JSON value of an existing credential Setting row. Used by
   * DELETE-field to overwrite the blob after a single key is removed.
   * The `value` argument is encrypted before writing (R-9).
   */
  async updateCredentialValue(key: string, value: string) {
    try {
      const encrypted = encryptCredValue(value)
      return await db.setting.update({
        where: { key },
        data: { value: encrypted },
      })
    } catch (err) {
      captureError(err as Error, {
        service: 'credentials',
        method: 'updateCredentialValue',
        key,
      })
      throw new Error('Failed to update credential')
    }
  },

  /**
   * Delete a credential Setting row by full key. Used by DELETE-all and
   * DELETE-field-when-last-key-removed. (R-9: no encryption concerns on
   * delete — we just drop the row.)
   */
  async deleteCredentialRow(key: string) {
    try {
      return await db.setting.delete({ where: { key } })
    } catch (err) {
      captureError(err as Error, {
        service: 'credentials',
        method: 'deleteCredentialRow',
        key,
      })
      throw new Error('Failed to delete credential')
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // R-9: legacy credential migration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * One-shot bulk re-encryption of legacy plaintext `cred::*` Setting rows.
   *
   * Scans all `Setting` rows whose key starts with `cred::` and whose value
   * does NOT start with `enc:v1:` (i.e. is either legacy plaintext or the
   * dev-only `enc:v0:` fallback). Re-encrypts each row in place with
   * `encryptSecret`, so the value becomes `enc:v1:...`.
   *
   * This is the "lazy migration" complement to the read-time fallback in
   * `parseCredValue`. Both paths converge on `enc:v1:` — read-time handles
   * stragglers one at a time, this method handles them all at once.
   *
   * Optional `tenantId` narrows the scan to a single tenant's namespace
   * (`cred::{tenantId}::*`). When omitted, ALL namespaces are scanned
   * (including `_global` and legacy `cred::{integrationId}` keys without
   * a namespace segment).
   *
   * @returns a summary of what was migrated (counts + per-row errors).
   *          The function never throws on a per-row failure — it captures
   *          the error and continues, so a single bad row doesn't block
   *          the rest of the migration.
   */
  async migrateLegacyCredentials(tenantId?: string) {
    const summary = {
      scanned: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
      errorSamples: [] as Array<{ key: string; reason: string }>,
    }

    try {
      // Build the scan filter. When a tenantId is provided, narrow to that
      // namespace; otherwise scan the entire `cred::` prefix (legacy +
      // namespaced + `_global`).
      const filter = tenantId
        ? { key: { startsWith: credKeyPrefix(tenantId) } }
        : { key: { startsWith: CRED_ROOT } }

      const rows = await db.setting.findMany({
        where: filter,
        select: { key: true, value: true },
      })
      summary.scanned = rows.length

      for (const row of rows) {
        try {
          // Skip rows that are already encrypted with the v1 scheme.
          if (isEncryptedSecret(row.value)) {
            summary.skipped++
            continue
          }

          // Decrypt — for legacy plaintext this returns the value as-is
          // (the `decryptSecret` fallthrough path). For `enc:v0:` dev
          // fallback it strips the prefix. Either way we get the original
          // JSON string.
          const plaintext = decryptSecret(row.value)

          // Sanity: if the plaintext is empty or not valid JSON, log it
          // and skip — we don't want to encrypt garbage and lose the row.
          try {
            JSON.parse(plaintext)
          } catch {
            summary.errors++
            summary.errorSamples.push({
              key: row.key,
              reason: 'plaintext is not valid JSON',
            })
            captureError(new Error('Legacy credential value is not valid JSON'), {
              module: 'credentials',
              method: 'migrateLegacyCredentials',
              key: row.key,
            })
            continue
          }

          // Re-encrypt with the v1 scheme and write back.
          const encrypted = encryptSecret(plaintext)
          await db.setting.update({
            where: { key: row.key },
            data: { value: encrypted },
          })
          summary.migrated++
        } catch (err) {
          summary.errors++
          if (summary.errorSamples.length < 10) {
            summary.errorSamples.push({
              key: row.key,
              reason: (err as Error).message,
            })
          }
          captureError(err as Error, {
            module: 'credentials',
            method: 'migrateLegacyCredentials',
            key: row.key,
          })
        }
      }
    } catch (err) {
      captureError(err as Error, {
        module: 'credentials',
        method: 'migrateLegacyCredentials',
        reason: 'scan-failed',
      })
      // Re-throw so the admin endpoint can return a 500 — a scan failure
      // means the migration didn't complete and the operator needs to know.
      throw new Error('Failed to scan credentials for migration')
    }

    return summary
  },

  /**
   * Diagnostic helper: count `cred::*` rows by encryption state. Used by
   * the admin migration endpoint to report progress without performing
   * any writes. Returns:
   *   - `total`        — all `cred::*` rows in scope
   *   - `encryptedV1`  — already `enc:v1:` (good)
   *   - `legacy`       — plaintext or `enc:v0:` dev fallback (need migration)
   */
  async auditCredentialEncryptionState(tenantId?: string) {
    const filter = tenantId
      ? { key: { startsWith: credKeyPrefix(tenantId) } }
      : { key: { startsWith: CRED_ROOT } }

    const rows = await db.setting.findMany({
      where: filter,
      select: { value: true },
    })

    return {
      total: rows.length,
      encryptedV1: rows.filter((r) => isEncryptedSecret(r.value)).length,
      legacy: rows.filter((r) => isLegacyPlaintextSecret(r.value)).length,
    }
  },
}

export type CredentialsService = typeof credentialsService
