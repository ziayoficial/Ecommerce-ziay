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
//
// Security contract (preserved from the inline route):
//   - GET never returns raw secrets — values are masked.
//   - POST/DELETE return masked values too, so the client never sees the
//     raw secret after the request completes.
//   - The `cred::{ns}::` prefix encodes the namespace so a tenant user
//     cannot read another tenant's credentials by guessing the key.
//
// SPRINT-BACKEND-FINAL-001 — service layer. Extracted from
// `/api/integrations/credentials/route.ts`.

import { db } from '@/lib/db'
import { captureError } from '@/lib/capture-error'
import {
  maskSecret,
  type IntegrationConfig,
} from '@/lib/adapters/credential-fields'

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

/** Safely parse the JSON value of a Setting row. Returns {} on any error. */
export function parseCredValue(value: string | null | undefined): Record<string, string> {
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

export const credentialsService = {
  /**
   * List all stored credential Setting rows for a namespace. Returns the
   * raw rows (key + value) — callers are responsible for masking the
   * values before returning them to the client.
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
   * Returns null when not stored.
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
   * writes the supplied JSON blob verbatim.
   */
  async upsertCredentialRow(ns: string, integrationId: string, value: string) {
    try {
      const key = integrationIdToCredKey(ns, integrationId)
      return await db.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
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
   */
  async updateCredentialValue(key: string, value: string) {
    try {
      return await db.setting.update({
        where: { key },
        data: { value },
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
   * DELETE-field-when-last-key-removed.
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
}

export type CredentialsService = typeof credentialsService
