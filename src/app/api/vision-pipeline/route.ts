import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { identifyImage } from '@/lib/vision/pipeline'

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
export async function POST(req: NextRequest) {
  const { tenantId, imageUrl, customerId, conversationId } = await req.json()
  if (!tenantId || !imageUrl) {
    return NextResponse.json({ error: 'tenantId and imageUrl required' }, { status: 400 })
  }

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
      meta: JSON.stringify({
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
