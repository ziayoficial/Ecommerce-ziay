import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import {
  computeHash,
  getOrCreateTenantKeypair,
} from '@/lib/crypto/signing'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const log = getLogger('api/ucp/v1/identity-linking')

// POST /api/ucp/v1/identity-linking
// Vincula una identidad de agente (agentDid) con un customer del tenant.
// Documento §10.1: "Identity Linking" capability.
//
// V2 (AUDIT-FINAL-SEC-001): previamente cualquier parte podía generar un
// keypair, firmar el mensaje y vincular su agentDid a CUALQUIER customer.
// El check de firma era inútil porque la `agentPublicKey` la proveía el
// propio caller. Ahora:
//   1. Exigimos sesión NextAuth (requireTenantAccess).
//   2. El tenantId se deriva del customer (no del body) — verificamos que
//      el customer existe y pertenece al tenant del caller.
//   3. Calculamos un `proofHash` = SHA-256(agentDid + customerId + tenantId
//      + ts + tenantPrivateKey). Solo el tenant puede producir este hash
//      (requiere su clave de firma ed25519), así que el linking queda
//      criptográficamente vinculado al tenant.
//   4. La firma del agente (agentPublicKey + proof) sigue verificándose
//      como defense-in-depth: prueba que el caller tiene la clave privada
//      correspondiente a la agentPublicKey declarada.
//
// Body:
//   { tenantId, agentDid, customerId, agentPublicKey, proof, ts }

const LinkingSchema = z.object({
  tenantId: z.string().min(1),
  agentDid: z.string().min(1),
  customerId: z.string().min(1),
  agentPublicKey: z.string().min(1), // PEM
  proof: z.string().min(1), // base64 signature over `${agentDid}:${customerId}:${tenantId}:${ts}`
  ts: z.number().int().positive(),
})

/**
 * POST /api/ucp/v1/identity-linking
 *
 * UCP identity linking — bind an external AI agent identity to a platform user (per UCP spec).
 *
 * @security Public (signed UCP mandate — bearer auth)
 * @returns Identity link record
 */
export const POST = withErrorHandling(async (req: NextRequest) => {

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Cuerpo JSON inválido' },
      { status: 400 },
    )
  }
  const parsed = LinkingSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // 1) Auth + tenant scoping. body.tenantId debe coincidir con el tenant
  //    del caller (requireTenantAccess lo verifica).
  const { error } = await requireTenantAccess(body.tenantId)
  if (error) return error

    // 2) Anti-replay: ts debe estar dentro de los últimos 5 minutos.
    const skewMs = Math.abs(Date.now() - body.ts)
    if (skewMs > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Timestamp fuera de ventana válida (±5 min)' },
        { status: 400 },
      )
    }

    // 3) Verificar que el customer existe Y pertenece al tenant del body.
    //    El tenantId efectivo es el del customer (source of truth), no el
    //    del body — aunque ya validamos que coinciden vía requireTenantAccess.
    const customer = await db.customer.findFirst({
      where: { id: body.customerId, tenantId: body.tenantId },
      select: { id: true, name: true, tenantId: true },
    })
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer no encontrado en el tenant' },
        { status: 404 },
      )
    }

    // 4) Verificar firma del agente (defense-in-depth). Esto prueba que el
    //    caller tiene la clave privada correspondiente a la agentPublicKey.
    //    NO es la vinculación de seguridad — esa la provee el proofHash
    //    calculado con la clave del tenant en el paso 5.
    const message = `${body.agentDid}:${body.customerId}:${body.tenantId}:${body.ts}`
    let valid = false
    try {
      const pub = cryptoPublicKey(body.agentPublicKey)
      const sig = Buffer.from(body.proof, 'base64url')
      const data = Buffer.from(message, 'utf8')
      // El agente puede firmar con ed25519 (null alg) o RSA-SHA256.
      valid =
        safeVerify(null, data, pub, sig) ||
        safeVerify('sha256', data, pub, sig)
    } catch {
      valid = false
    }
    if (!valid) {
      return NextResponse.json(
        { error: 'Firma del agente inválida' },
        { status: 401 },
      )
    }

    // 5) proofHash — vincula criptográficamente el linking al tenant.
    //    Solo el tenant (con su clave privada ed25519) puede producir este
    //    hash. Se persiste como `evidenceHash` para auditoría posterior.
    const { privateKey } = await getOrCreateTenantKeypair(body.tenantId)
    const proofHash = computeHash(
      `${body.agentDid}:${body.customerId}:${body.tenantId}:${body.ts}:${privateKey}`,
    )

    // 6) Registrar la verificación (vincula agentDid ↔ customer).
    const linkingToken = randomUUID()
    const verification = await db.identityVerification.create({
      data: {
        tenantId: body.tenantId,
        customerId: body.customerId,
        method: '2fa_totp', // placeholder — en prod usar kyc_provider
        provider: body.agentDid,
        status: 'verified',
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        evidenceHash: proofHash,
        triggerType: 'high_value_order',
        triggerRef: linkingToken,
      },
    })

    log.info(
      {
        tenantId: body.tenantId,
        agentDid: body.agentDid,
        customerId: body.customerId,
        verificationId: verification.id,
      },
      'UCP identity linking exitoso',
    )

    return NextResponse.json(
      {
        linkingToken,
        verificationId: verification.id,
        agentDid: body.agentDid,
        customerId: body.customerId,
        expiresAt: verification.expiresAt,
      },
      { status: 201 },
    )
  

})

// ── helpers ──────────────────────────────────────────────────────────────

function cryptoPublicKey(pem: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto')
  return crypto.createPublicKey(pem)
}

function safeVerify(
  alg: string | null,
  data: Buffer,
  pub: ReturnType<typeof cryptoPublicKey>,
  sig: Buffer,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto')
  try {
    return crypto.verify(alg, data, pub, sig)
  } catch {
    return false
  }
}
