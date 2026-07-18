import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { identifyImage } from '@/lib/vision/pipeline'
import { requireTenantAccess } from '@/lib/auth-helpers'

// POST /api/vision-pipeline
// Body: { tenantId, imageUrl, customerId?, conversationId? }
// Runs the deterministic 3-step pipeline (OCR → CLIP → ask customer) and persists the result.
//
// SPRINT-FIXES-N8N-DEPLOY-001 — the legacy `visionPipeline(tenantId, imageUrl)`
// function was refactored into `identifyImage(imageUrl, tenantCtx?)` so it
// could carry richer tenant context (customerId, conversationId) for audit.
// This experimental route was never updated. We adapt the call to the new
// signature and map the result shape back to the old contract (sku, method,
// confidence, shouldAskCustomer) for backward compat with any caller still
// hitting this URL.
//
// SECURITY · IF-2 · S-4 — cross-tenant bypass closed. The `tenantId` body
// param is gated by `requireTenantAccess` BEFORE the LLM call + AuditLog
// write so an attacker can no longer burn LLM budget or inject audit rows
// on a victim tenant.
export async function POST(req: NextRequest) {
  const { tenantId, imageUrl, customerId, conversationId } = await req.json()
  if (!tenantId || !imageUrl) {
    return NextResponse.json({ error: 'tenantId and imageUrl required' }, { status: 400 })
  }

  // IF-2 · S-4 — verify the caller may access this tenant BEFORE invoking the
  // vision pipeline (closes LLM-cost abuse + audit-log injection).
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const result = await identifyImage(imageUrl, { tenantId, customerId, conversationId })

  // Persist as ImageIdentification
  const identification = await db.imageIdentification.create({
    data: {
      tenantId,
      contactoId: customerId,
      imagenUrl: imageUrl,
      skuDetectado: result.sku,
      metodo: result.metodo,
      confianza: result.confianza,
    },
  })

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId,
      action: 'vision.pipeline.executed',
      entity: 'ImageIdentification',
      entityId: identification.id,
      metadata: JSON.stringify({
        sku: result.sku,
        method: result.metodo,
        confidence: result.confianza,
        shouldAsk: result.pregunta_confirmacion !== null,
      }),
    },
  })

  return NextResponse.json({
    identification,
    sku: result.sku,
    method: result.metodo,
    confidence: result.confianza,
    shouldAskCustomer: result.pregunta_confirmacion !== null,
    confirmationQuestion: result.pregunta_confirmacion,
    conversationId,
  })
}
