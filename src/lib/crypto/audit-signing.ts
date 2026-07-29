import { db } from '@/lib/db'
import {
  getOrCreateTenantKeypair,
  signVC,
  computeHash,
  type W3CVerifiableCredential,
} from '@/lib/crypto/signing'

// AuditLog signing service — Verifiable Intent compatibility.
// Documento §11: "Registro auditable compatible con Verifiable Intent".
//
// Cada fila de AuditLog puede ser firmada como un W3C Verifiable Credential
// con la keypair del tenant. El proof resultante (proofHash + proofSignature)
// se persiste en la fila para:
//   - verificación offline posterior (sin necesidad de recalcular la firma)
//   - evidencia criptográfica no-repudiable (cumple Ley 1581 §11 + Ley 2573)
//   - exportación como VC para inspectores externos (Superintendencia, etc.)
//
// SPRINT-PROTOCOLS-TRINITY-001 — reutiliza el servicio de firma de AP2
// (`@/lib/crypto/signing`) construido en SPRINT-AGENTIC-PROTOCOLS-001.

// URI canónica del schema VC para entradas de AuditLog.
export const AUDIT_LOG_VC_SCHEMA = 'https://ziay.co/schemas/audit-log-v1.json'

/**
 * Construye el credentialSubject de un AuditLog a partir de la fila.
 * El orden de campos es determinista para que el hash sea reproducible.
 *
 * El credentialSubject siempre emite el campo como `meta` para preservar
 * compatibilidad con el schema VC `audit-log-v1.json` ya firmado.
 */
export function buildAuditLogCredentialSubject(log: {
  action: string
  entity: string
  entityId: string | null
  userId: string | null
  tenantId: string | null
  createdAt: Date
  metadata: string | null
}): Record<string, unknown> {
  const rawMeta = log.metadata
  return {
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    userId: log.userId,
    tenantId: log.tenantId,
    createdAt: log.createdAt.toISOString(),
    meta: rawMeta ? safeJsonParse(rawMeta) : null,
  }
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * Construye un VC sin firma a partir de una fila de AuditLog.
 */
export function buildAuditLogVC(
  log: {
    id: string
    action: string
    entity: string
    entityId: string | null
    userId: string | null
    tenantId: string | null
    createdAt: Date
    metadata: string | null
  },
  issuerDid: string,
): W3CVerifiableCredential {
  const subject = buildAuditLogCredentialSubject(log)
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'AuditLogEntry'],
    issuer: { id: issuerDid },
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: `urn:ziay:audit:${log.id}`,
      ...subject,
    },
    credentialSchema: {
      id: AUDIT_LOG_VC_SCHEMA,
      type: 'JsonSchemaValidator2018',
    },
  }
}

/**
 * Firma una fila de AuditLog como W3C VC y persiste proofHash + proofSignature
 * + credentialSchema en la misma fila.
 *
 * Idempotente: si la fila ya tiene `proofSignature`, NO re-firma (devuelve
 * sin cambios). Esto evita que un re-llamado cambie el proof original.
 *
 * @param auditLogId ID de la fila AuditLog
 */
export async function signAuditLog(auditLogId: string): Promise<void> {
  const log = await db.auditLog.findUnique({ where: { id: auditLogId } })
  if (!log) return
  // Idempotencia: no re-firmar filas ya firmadas.
  if (log.proofSignature) return

  // AuditLog sin tenantId no se puede firmar (no hay keypair asociada).
  if (!log.tenantId) return

  const { privateKey, did } = await getOrCreateTenantKeypair(log.tenantId)

  const vc = buildAuditLogVC(log, did)
  const signedVc = signVC(vc, privateKey)
  const proofHash = computeHash(JSON.stringify(signedVc.credentialSubject))

  await db.auditLog.update({
    where: { id: auditLogId },
    data: {
      proofHash,
      proofSignature: signedVc.proof?.proofValue ?? null,
      credentialSchema: AUDIT_LOG_VC_SCHEMA,
    },
  })
}

/**
 * Reconstruye el VC completo (con proof) a partir de una fila AuditLog ya
 * firmada. Devuelve `null` si la fila no ha sido firmada (proofSignature
 * ausente) o si no tiene tenantId (no hay keypair).
 *
 * Usado por GET /api/audit/[id]/verifiable para servir el VC almacenado.
 */
export async function reconstructAuditLogVC(
  auditLogId: string,
): Promise<W3CVerifiableCredential | null> {
  const log = await db.auditLog.findUnique({ where: { id: auditLogId } })
  if (!log || !log.proofSignature || !log.tenantId) return null

  const did = `did:ziay:${log.tenantId}`
  const vc = buildAuditLogVC(log, did)
  // Adjuntar el proof persistido (no recalculamos la firma — usamos el
  // proofValue original para preservar no-repudiabilidad).
  return {
    ...vc,
    proof: {
      type: 'Ed25519Signature2020',
      created: log.createdAt.toISOString(),
      verificationMethod: `${did}#keys-1`,
      proofValue: log.proofSignature,
      proofPurpose: 'assertionMethod',
    },
  }
}
