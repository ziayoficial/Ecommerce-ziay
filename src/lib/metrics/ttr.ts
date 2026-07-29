// ─────────────────────────────────────────────────────────────────────────────
// First Response Time (TTR) — study §14.4:
//   "conversion drops >50% if no reply in 15–30 min"
//
// Records the timestamp of the first outbound agent reply on a
// `Conversation` and computes aggregate TTR stats for the overview /
// SLA dashboards. The pilot doc sets a `<5s` agent reply target; this
// module measures reality against that target.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('metrics:ttr')

/** SLA target: an agent reply within this window counts as "within target". */
const TARGET_TTR_MINUTES = 5

/**
 * Stamp `firstReplyAt` on the conversation the first time an agent sends an
 * outbound message. Idempotent — once set, subsequent outbound messages
 * do NOT overwrite it (the first reply is the only one that matters for
 * TTR).
 *
 * Called from `conversationService.sendMessage` (and the `/api/conversations`
 * POST route) after the outbound message is persisted. Best-effort: errors
 * are logged and swallowed so a metrics failure never blocks message
 * delivery.
 */
export async function recordFirstReply(conversationId: string): Promise<void> {
  try {
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, firstReplyAt: true },
    })
    if (!conv || conv.firstReplyAt) return // already recorded

    await db.conversation.update({
      where: { id: conversationId },
      data: { firstReplyAt: new Date() },
    })
    log.info({ conversationId }, 'TTR: firstReplyAt recorded')
  } catch (err) {
    captureError(err as Error, {
      action: 'ttr:recordFirstReply',
      conversationId,
    })
    log.warn(
      { conversationId, err: err instanceof Error ? err.message : String(err) },
      'TTR: failed to record firstReplyAt (non-blocking)',
    )
  }
}

/**
 * Compute TTR (in minutes) for a single conversation. Returns `null` when
 * the conversation has no first reply yet (still pending) so callers can
 * distinguish "no reply yet" from "replied in 0 minutes".
 */
export function calculateTtrMinutes(
  createdAt: Date,
  firstReplyAt: Date | null,
): number | null {
  if (!firstReplyAt) return null
  const diffMs = firstReplyAt.getTime() - createdAt.getTime()
  if (diffMs < 0) return 0 // clock skew — clamp to 0
  return Math.round(diffMs / 60000)
}

export interface TtrStats {
  /** Average TTR across conversations that have a first reply. */
  avgTtrMinutes: number | null
  /** Median TTR — less sensitive to outliers than the average. */
  medianTtrMinutes: number | null
  /** % of replied conversations that were replied within `TARGET_TTR_MINUTES`. */
  withinTargetPct: number | null
  /** Total conversations in the window (replied + pending). */
  totalConversations: number
  /** Conversations that have a first reply (subset of `totalConversations`). */
  repliedConversations: number
}

/**
 * Aggregate TTR stats for a tenant over the last `days` days (default 14).
 * Used by the overview / SLA dashboard.
 *
 * Returns `null` stats when the tenant has zero conversations in the
 * window — callers should render "—" instead of `0` to avoid implying
 * "all conversations answered instantly".
 */
export async function getTtrStats(
  tenantId: string,
  days = 14,
): Promise<TtrStats> {
  const since = new Date(Date.now() - days * 86_400_000)
  try {
    const conversations = await db.conversation.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true, firstReplyAt: true },
    })

    if (conversations.length === 0) {
      return {
        avgTtrMinutes: null,
        medianTtrMinutes: null,
        withinTargetPct: null,
        totalConversations: 0,
        repliedConversations: 0,
      }
    }

    const ttrs = conversations
      .filter((c) => c.firstReplyAt)
      .map((c) => calculateTtrMinutes(c.createdAt, c.firstReplyAt) as number)
      .filter((t): t is number => typeof t === 'number')

    if (ttrs.length === 0) {
      // Conversations exist but none have a first reply yet.
      return {
        avgTtrMinutes: null,
        medianTtrMinutes: null,
        withinTargetPct: null,
        totalConversations: conversations.length,
        repliedConversations: 0,
      }
    }

    const avg = ttrs.reduce((a, b) => a + b, 0) / ttrs.length
    const sorted = [...ttrs].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const withinTarget = ttrs.filter((t) => t <= TARGET_TTR_MINUTES).length

    return {
      avgTtrMinutes: Math.round(avg * 10) / 10,
      medianTtrMinutes: Math.round(median * 10) / 10,
      withinTargetPct: Math.round((withinTarget / ttrs.length) * 100),
      totalConversations: conversations.length,
      repliedConversations: ttrs.length,
    }
  } catch (err) {
    captureError(err as Error, { action: 'ttr:getTtrStats', tenantId, days })
    log.error(
      { tenantId, days, err: err instanceof Error ? err.message : String(err) },
      'TTR: failed to compute stats',
    )
    return {
      avgTtrMinutes: null,
      medianTtrMinutes: null,
      withinTargetPct: null,
      totalConversations: 0,
      repliedConversations: 0,
    }
  }
}
