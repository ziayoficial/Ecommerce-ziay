import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireTenantAccess } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'
import { computeHash } from '@/lib/crypto/signing'

const log = getLogger('api/ucp/v1/identity-linking')

// POST /api/ucp/v1/identity-linking
// Vincula una identidad de agente (agentDid) con un customer del tenant.
// Documento §10.1: "Identity Linking" capability.
//
// Flujo (estilo OAuth):
//   1. El agente llega con `agentDid`, `customerId`, `proof` (firma del
//      agente sobre el payload `{ agentDid, customerId, tenantId, ts }`).
//   2. Verificamos la firma usando la `agentPublicKey` (PEM) proporcionada.
//   3. Si OK, creamos un `IdentityVerification` con status='verified' y
//      method='2fa_totp' (placeholder) que vincula agentDid → customer.
//   4. Devolvemos un `linkingToken` que el agente usa en futuras llamadas.
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

export async function POST(req: NextRequest) {
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

  const { error } = await requireTenantAccess(body.tenantId)
  if (error) return error

  try {
    // Anti-replay: ts debe estar dentro de los últimos 5 minutos.
    const skewMs = Math.abs(Date.now() - body.ts)
    if (skewMs > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Timestamp fuera de ventana válida (±5 min)' },
        { status: 400 },
      )
    }

    // Verificar firma del agente.
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

    // Verificar que el customer existe en el tenant.
    const customer = await db.customer.findFirst({
      where: { id: body.customerId, tenantId: body.tenantId },
      select: { id: true, name: true },
    })
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer no encontrado en el tenant' },
        { status: 404 },
      )
    }

    // Registrar la verificación (vincula agentDid ↔ customer).
    const linkingToken = randomUUID()
    const evidenceHash = computeHash(
      JSON.stringify({ agentDid: body.agentDid, customerId: body.customerId, ts: body.ts }),
    )
    const verification = await db.identityVerification.create({
      data: {
        tenantId: body.tenantId,
        customerId: body.customerId,
        method: '2fa_totp', // placeholder — en prod usar kyc_provider
        provider: body.agentDid,
        status: 'verified',
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        evidenceHash,
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
  } catch (err) {
    captureError(err as Error, {
      path: '/api/ucp/v1/identity-linking',
      method: 'POST',
    })
    return NextResponse.json(
      { error: 'No se pudo vincular la identidad' },
      { status: 500 },
    )
  }
}

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
