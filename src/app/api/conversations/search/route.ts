import { NextRequest, NextResponse } from 'next/server'
import { semanticMemorySearch } from '@/lib/embeddings/service'

// GET /api/conversations/search?tenantId=...&conversationId=...&q=...
// Semantic search over message history (Saramantha §3)
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const conversationId = req.nextUrl.searchParams.get('conversationId') || undefined
  const customerId = req.nextUrl.searchParams.get('customerId') || undefined
  const q = req.nextUrl.searchParams.get('q')
  const limit = Number(req.nextUrl.searchParams.get('limit') || '10')
  const threshold = Number(req.nextUrl.searchParams.get('threshold') || '0.3')

  if (!tenantId || !q) {
    return NextResponse.json({ error: 'tenantId and q required' }, { status: 400 })
  }

  const results = await semanticMemorySearch({
    tenantId, conversationId, customerId, query: q, limit, threshold,
  })

  return NextResponse.json({
    query: q,
    results: results.map(r => ({
      messageId: r.messageId,
      body: r.body,
      direction: r.direction,
      createdAt: r.createdAt,
      score: Number(r.score.toFixed(4)),
    })),
    count: results.length,
  })
}
