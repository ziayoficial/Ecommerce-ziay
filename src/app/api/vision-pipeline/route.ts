import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { visionPipeline } from '@/lib/vision/pipeline'

// POST /api/vision-pipeline
// Body: { tenantId, imageUrl, customerId?, conversationId? }
// Runs the deterministic 3-step pipeline (OCR → CLIP → ask customer) and persists the result.
export async function POST(req: NextRequest) {
  const { tenantId, imageUrl, customerId, conversationId } = await req.json()
  if (!tenantId || !imageUrl) {
    return NextResponse.json({ error: 'tenantId and imageUrl required' }, { status: 400 })
  }

  const result = await visionPipeline(tenantId, imageUrl)

  // Persist as ImageIdentification
  const identification = await db.imageIdentification.create({
    data: {
      tenantId,
      contactoId: customerId,
      imagenUrl: imageUrl,
      skuDetectado: result.sku,
      metodo: result.method,
      confianza: result.confidence,
    },
  })

  // Audit log
  await db.auditLog.create({
    data: {
      tenantId,
      action: 'vision.pipeline.executed',
      entity: 'ImageIdentification',
      entityId: identification.id,
      meta: JSON.stringify({ sku: result.sku, method: result.method, confidence: result.confidence, shouldAsk: result.shouldAskCustomer }),
    },
  })

  return NextResponse.json({
    identification,
    ...result,
    conversationId,
  })
}
