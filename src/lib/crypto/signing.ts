/**
 * AP2 mandate signing service.
 *
 * Signs W3C Verifiable Credential payloads using ed25519 (via Node crypto).
 * Documento §10.2: los mandatos deben estar "firmados criptográficamente"
 * como W3C Verifiable Credentials.
 *
 * SPRINT-AGENTIC-PROTOCOLS-001 — primitive shared by:
 *   - AP2 Intent / Cart / Payment mandate endpoints
 *   - (future) AuditLog → Verifiable Intent upgrade
 *   - UCP identity-linking signature verification
 *
 * Key management:
 *   - Dev: per-tenant ed25519 keypairs stored in `Setting`
 *     (keys: `cred::signing::{tenantId}::private|public`).
 *   - Prod: replace `getOrCreateTenantKeypair` with a KMS call
 *     (AWS KMS / Google KMS / HashiCorp Vault) — never store raw PEMs
 *     in the DB in production. The interface stays the same.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface W3CVerifiableCredential {
  '@context': string[]
  type: string[]
  issuer: { id: string } // DID
  issuanceDate: string // ISO 8601
  credentialSubject: Record<string, unknown>
  proof?: {
    type: 'Ed25519Signature2020'
    created: string
    verificationMethod: string
    proofValue: string // base64url ed25519 signature
    proofPurpose: 'assertionMethod'
  }
}

export interface TenantKeypair {
  publicKey: string // PEM (SPKI)
  privateKey: string // PEM (PKCS8)
  did: string // did:ziay:{tenantId}
}

// ───────────────────────────────────────────────────────────────────────────
// Key management
// ───────────────────────────────────────────────────────────────────────────

/**
 * Dev key management: per-tenant ed25519 keypair stored in `Setting`.
 * Idempotent — if the key already exists for the tenant, returns it.
 * Production deployments should replace this with a KMS-backed resolver.
 */
export async function getOrCreateTenantKeypair(
  tenantId: string,
): Promise<TenantKeypair> {
  const privKey = `cred::signing::${tenantId}::private`
  const pubKey = `cred::signing::${tenantId}::public`

  const existingPriv = await db.setting.findFirst({ where: { key: privKey } })
  if (existingPriv?.value) {
    const existingPub = await db.setting.findFirst({ where: { key: pubKey } })
    return {
      publicKey: existingPub?.value ?? '',
      privateKey: existingPriv.value,
      did: `did:ziay:${tenantId}`,
    }
  }

  // Generate new ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  // Store in Setting (upsert on key — Setting.key is @unique)
  await db.setting.upsert({
    where: { key: privKey },
    update: {},
    create: { key: privKey, value: privPem },
  })
  await db.setting.upsert({
    where: { key: pubKey },
    update: {},
    create: { key: pubKey, value: pubPem },
  })

  return { publicKey: pubPem, privateKey: privPem, did: `did:ziay:${tenantId}` }
}

/**
 * Fetch the tenant's public key without creating one. Returns null when the
 * tenant has no signing key yet (used by verify-only callers).
 */
export async function getTenantPublicKey(tenantId: string): Promise<string | null> {
  const row = await db.setting.findFirst({
    where: { key: `cred::signing::${tenantId}::public` },
  })
  return row?.value ?? null
}

// ───────────────────────────────────────────────────────────────────────────
// W3C VC construction + signing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Construct an unsigned W3C Verifiable Credential. The caller typically
 * adds `credentialSubject` fields specific to the mandate type:
 *   - Intent: { purpose, maxAmount, currency, categoryLimits, expiresAt }
 *   - Cart:   { intentMandateId, items, totals, shipping, totalHash }
 *   - Payment:{ cartMandateId, amount, fundingInstrument, intentCartHash }
 */
export function createW3CVC(
  issuerDid: string,
  credentialType: string[],
  subject: Record<string, unknown>,
): W3CVerifiableCredential {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', ...credentialType],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: subject,
  }
}

/**
 * Sign a W3C VC with the issuer's ed25519 private key.
 * The proof is detached — signed over the VC payload WITHOUT the `proof`
 * field (canonical JSON serialization).
 *
 * Returns a new VC object with the `proof` block attached.
 */
export function signVC(
  vc: W3CVerifiableCredential,
  privateKeyPem: string,
): W3CVerifiableCredential {
  const privateKey = crypto.createPrivateKey(privateKeyPem)
  // Strip any pre-existing proof, sign the canonical payload.
  const { proof: _omit, ...payload } = vc
  void _omit
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  // ed25519 ignores the algorithm parameter — pass `null`.
  const signature = crypto.sign(null, data, privateKey)
  const proofValue = signature.toString('base64url')
  return {
    ...vc,
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: `${vc.issuer.id}#keys-1`,
      proofValue,
      proofPurpose: 'assertionMethod',
    },
  }
}

/**
 * Verify a signed W3C VC against the issuer's public key.
 * Returns true iff the signature is valid AND the proof block is present.
 */
export function verifyVC(
  vc: W3CVerifiableCredential,
  publicKeyPem: string,
): boolean {
  if (!vc.proof) return false
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem)
    const { proof, ...payload } = vc
    void proof
    const data = Buffer.from(JSON.stringify(payload), 'utf8')
    const signature = Buffer.from(vc.proof.proofValue, 'base64url')
    return crypto.verify(null, data, publicKey, signature)
  } catch {
    return false
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Hashing helpers
// ───────────────────────────────────────────────────────────────────────────

/** SHA-256 hex digest. Used for evidence hashes + intent↔cart linking. */
export function computeHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Build a deterministic hash linking Intent + Cart (used by the Payment
 * Mandate's `intentCartHash` field — §10.2: "un hash que vincula el Intent
 * y el Cart ya verificados").
 */
export function computeIntentCartHash(
  intentMandateId: string,
  cartMandateId: string,
): string {
  // Deterministic order: lexicographic smaller ID first.
  const [a, b] = [intentMandateId, cartMandateId].sort()
  return computeHash(`${a}:${b}`)
}
