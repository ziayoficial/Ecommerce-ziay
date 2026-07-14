import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { db } from '@/lib/db'
import {
  reconstructAuditLogVC,
  signAuditLog,
} from '@/lib/crypto/audit-signing'

// GET /api/audit/[id]/verifiable
// Devuelve la fila AuditLog como W3C Verifiable Credential.
// Documento §11: "Registro auditable compatible con Verifiable Intent".
//
// Flujo:
//   1. requireAuth (NextAuth session).
//   2. Carga la fila AuditLog.
//   3. Tenant guard (la sesión debe coincidir con el tenantId de la fila,
//      salvo platform-admin).
//   4. Si la fila NO ha sido firmada → la firma on-the-fly (persiste el proof
//      para futuras llamadas) y luego reconstruye el VC.
//   5. Devuelve el VC completo con `proof`.
//
// SPRINT-PROTOCOLS-TRINITY-001.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { error } = await requireAuth()
  if (error) return error

  try {
    const log = await db.auditLog.findUnique({ where: { id } })
    if (!log) {
      return NextResponse.json(
        { error: 'Registro de auditoría no encontrado' },
        { status: 404 },
      )
    }

    // Tenant guard: si la fila tiene tenantId, la sesión debe coincidir
    // (salvo platform-admin = session.user.tenantId === null).
    const { session, error: tErr } = await requireAuth()
    if (tErr) return tErr
    const sessionTenantId = session?.user?.tenantId ?? null
    if (log.tenantId && sessionTenantId && log.tenantId !== sessionTenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    // Si la fila no ha sido firmada, firmarla on-the-fly (idempotente).
    if (!log.proofSignature && log.tenantId) {
      await signAuditLog(id)
    }

    // Reconstruir el VC desde los campos persistidos.
    const vc = await reconstructAuditLogVC(id)
    if (!vc) {
      return NextResponse.json(
        {
          error:
            'El registro no se puede emitir como VC (sin tenantId o sin keypair configurada)',
        },
        { status: 422 },
      )
    }

    return NextResponse.json(
      { verifiableCredential: vc },
      {
        headers: {
          'Content-Type': 'application/ld+json',
          'Cache-Control': 'no-store',
        },
      },
    )
  } catch (err) {
    captureError(err as Error, {
      path: '/api/audit/[id]/verifiable',
      method: 'GET',
    })
    return NextResponse.json(
      { error: 'No se pudo emitir el verifiable credential' },
      { status: 500 },
    )
  }
}
