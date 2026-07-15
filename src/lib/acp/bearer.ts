// ───────────────────────────────────────────────────────────────────────────
// ACP bearer token verification.
//
// V4 (AUDIT-FINAL-SEC-001): previously the ACP routes (checkout, orders,
// refunds) accepted the raw AP2 Intent Mandate ID (a CUID) as the Bearer
// token. If the CUID leaked (logs, referrer header, shared link), an
// attacker could checkout / query / refund anything until the mandate
// expired.
//
// The new format is a **signed bearer**: `{mandateId}.{ed25519(mandateId)}`
// where the signature is produced with the tenant's ed25519 private key
// (reuses `getOrCreateTenantKeypair` from `@/lib/crypto/signing`). The ACP
// route verifies the signature against the tenant's public key BEFORE
// honouring the mandate ID. A leaked mandate ID alone is now useless — the
// attacker also needs the tenant's private key.
//
// The mandate creation endpoint (`/api/ap2/mandates`) is responsible for
// minting this signed bearer and returning it to the caller. The `mint`
// helper below is exported so that endpoint (and tests) can produce
// well-formed tokens.
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { getOrCreateTenantKeypair } from '@/lib/crypto/signing'

export interface AcpBearerPayload {
  mandateId: string
  tenantId: string
  /** The full mandate row (for limit / status checks in the route). */
  mandate: {
    id: string
    tenantId: string
    type: string
    status: string
    userId: string | null
    expiresAt: Date | null
    maxAmount: number | null
    currency: string | null
    categoryLimits: string | null
  }
}

/**
 * Verify an ACP bearer token.
 *
 * Token format: `{mandateId}.{base64url(ed25519(mandateId))}`
 *
 * Returns the mandate payload iff:
 *   - the token is well-formed (two dot-separated parts),
 *   - the mandate exists in the DB,
 *   - the mandate status is `active`,
 *   - the mandate has not expired,
 *   - the signature verifies against the tenant's public key.
 *
 * Returns `null` otherwise — the caller should respond 401.
 */
export async function verifyAcpBearer(
  token: string,
): Promise<AcpBearerPayload | null> {
  // 1) Parse — must be exactly `{mandateId}.{signature}`.
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const mandateId = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!mandateId || !signature) return null

  // 2) Fetch the mandate — must be an active intent mandate.
  const mandate = await db.aP2Mandate.findFirst({
    where: { id: mandateId, type: 'intent', status: 'active' },
  })
  if (!mandate) return null

  // 3) Expiry check.
  if (mandate.expiresAt && mandate.expiresAt < new Date()) return null

  // 4) Signature verification — ed25519 over the raw mandateId bytes.
  try {
    const { publicKey } = await getOrCreateTenantKeypair(mandate.tenantId)
    const pub = crypto.createPublicKey(publicKey)
    const data = Buffer.from(mandateId, 'utf8')
    const sig = Buffer.from(signature, 'base64url')
    // ed25519 ignores the algorithm parameter — pass `null`.
    const ok = crypto.verify(null, data, pub, sig)
    if (!ok) return null
  } catch {
    return null
  }

  return {
    mandateId,
    tenantId: mandate.tenantId,
    mandate: {
      id: mandate.id,
      tenantId: mandate.tenantId,
      type: mandate.type,
      status: mandate.status,
      userId: mandate.userId,
      expiresAt: mandate.expiresAt,
      maxAmount: mandate.maxAmount,
      currency: mandate.currency,
      categoryLimits: mandate.categoryLimits,
    },
  }
}

/**
 * Mint a signed ACP bearer token for a mandate.
 *
 * Called by the mandate creation endpoint (`/api/ap2/mandates`) to produce
 * the `user_auth_token` that the agent later presents to the ACP routes.
 *
 * Token format: `{mandateId}.{base64url(ed25519(mandateId))}`
 */
export async function mintAcpBearer(
  mandateId: string,
  tenantId: string,
): Promise<string> {
  const { privateKey } = await getOrCreateTenantKeypair(tenantId)
  const priv = crypto.createPrivateKey(privateKey)
  const data = Buffer.from(mandateId, 'utf8')
  const signature = crypto.sign(null, data, priv)
  return `${mandateId}.${signature.toString('base64url')}`
}
