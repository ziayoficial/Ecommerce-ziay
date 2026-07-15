import { NextRequest, NextResponse } from 'next/server'
import { searchSimilar } from '@/lib/embeddings/service'

// GET /api/conversations/search?tenantId=...&conversationId=...&q=...
// Semantic search over message history (Saramantha §3).
//
// SPRINT-FIXES-N8N-DEPLOY-001 — the legacy `semanticMemorySearch` export was
// renamed to `searchSimilar` when the embeddings module was refactored to
// support both `message` and `product` kinds. This route was never updated
// because it's an experimental route not part of the main dashboard. We map
// the old request shape (conversationId, customerId, query, limit, threshold)
// onto the new `searchSimilar` signature (tenantId, kind='message',
// conversationId, topK, minScore) and adapt the result shape back to the
// old contract for backward compat with any callers still hitting this URL.
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const conversationId = req.nextUrl.searchParams.get('conversationId') || undefined
  const _customerId = req.nextUrl.searchParams.get('customerId') || undefined
  const q = req.nextUrl.searchParams.get('q')
  const limit = Number(req.nextUrl.searchParams.get('limit') || '10')
  const threshold = Number(req.nextUrl.searchParams.get('threshold') || '0.3')

  if (!tenantId || !q) {
    return NextResponse.json({ error: 'tenantId and q required' }, { status: 400 })
  }

  const results = await searchSimilar(q, {
    tenantId,
    kind: 'message',
    ...(conversationId ? { conversationId } : {}),
    topK: limit,
    minScore: threshold,
  })

  return NextResponse.json({
    query: q,
    results: results.map(r => ({
      messageId: r.id,
      body: r.snippet ?? '',
      direction: (r.meta?.direction as string) ?? 'unknown',
      createdAt: (r.meta?.createdAt as string) ?? null,
      score: Number(r.score.toFixed(4)),
    })),
    count: results.length,
  })
}
