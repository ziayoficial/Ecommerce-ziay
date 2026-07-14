// ZIAY — Channel contribution margin service.
//
// Study §14.1 — "Costo de adquisición → conversión → AOV → margen bruto →
// comisión → costo operativo → margen neto".
//
// This service is the single seam for reading + writing `ChannelCost` rows
// (study §14.1: "costo operativo del canal"). It is the financial backbone
// behind the channel-contribution dashboard and the daily cron that
// backfills cost rows from operational data.
//
// SPRINT-FINANCE-META-001
//
// NOTE on the "channel" filter: the `Order` model exposes `channelId`
// (FK to `Channel.id`); the human-readable channel type lives on
// `Channel.type` (`whatsapp` | `messenger` | `instagram` | `telegram` |
// `tiktok`). To count orders attributed to a channel TYPE, we use Prisma's
// relation filter `channel: { type }` rather than a (non-existent) scalar
// `channel` column on `Order`.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:channel-cost')

/** Channels tracked by the §14.1 cost model. */
export const TRACKED_CHANNELS = [
  'whatsapp',
  'messenger',
  'instagram',
  'tiktok',
] as const
export type TrackedChannel = (typeof TRACKED_CHANNELS)[number]

/**
 * Contribution margin rollup for a single channel over a date range.
 * All currency values are in the tenant's reporting currency (COP by default).
 */
export interface ChannelContribution {
  channel: string
  revenue: number
  messageCost: number
  aiTokenCost: number
  adSpend: number
  supportCost: number
  logisticsCost: number
  paymentFee: number
  totalCost: number
  netContribution: number
  marginPct: number
  ordersCount: number
  aov: number // average order value = revenue / ordersCount
  cac: number // customer acquisition cost = adSpend / ordersCount (proxy)
  cpl: number // cost per lead = adSpend / ordersCount (proxy — no leads table yet)
}

/** Empty contribution row, used as the seed when grouping by channel. */
function emptyContribution(channel: string): ChannelContribution {
  return {
    channel,
    revenue: 0,
    messageCost: 0,
    aiTokenCost: 0,
    adSpend: 0,
    supportCost: 0,
    logisticsCost: 0,
    paymentFee: 0,
    totalCost: 0,
    netContribution: 0,
    marginPct: 0,
    ordersCount: 0,
    aov: 0,
    cac: 0,
    cpl: 0,
  }
}

/**
 * Aggregate channel contribution margins for a tenant over a date range.
 *
 * Returns one `ChannelContribution` per channel that has at least one
 * `ChannelCost` row in the window. Channels with zero spend AND zero
 * revenue are omitted (no row to aggregate). Callers that need a stable
 * list of channels (e.g. a table UI) can `.map()` over `TRACKED_CHANNELS`
 * and merge with the returned array.
 *
 * @param tenantId  Tenant to scope the query.
 * @param startDate Inclusive lower bound (compared against `ChannelCost.date`).
 * @param endDate   Inclusive upper bound (compared against `ChannelCost.date`).
 */
export async function getChannelContributions(
  tenantId: string,
  startDate: Date,
  endDate: Date,
): Promise<ChannelContribution[]> {
  try {
    const costs = await db.channelCost.findMany({
      where: {
        tenantId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { channel: 'asc' },
    })

    // Group + sum by channel. One pass over the rows.
    const byChannel: Record<string, ChannelContribution> = {}
    for (const c of costs) {
      if (!byChannel[c.channel]) {
        byChannel[c.channel] = emptyContribution(c.channel)
      }
      const ch = byChannel[c.channel]
      ch.revenue += c.revenue
      ch.messageCost += c.messageCost
      ch.aiTokenCost += c.aiTokenCost
      ch.adSpend += c.adSpend
      ch.supportCost += c.supportCost
      ch.logisticsCost += c.logisticsCost
      ch.paymentFee += c.paymentFee
      ch.ordersCount += c.ordersCount
    }

    return Object.values(byChannel).map((ch) => {
      ch.totalCost =
        ch.messageCost +
        ch.aiTokenCost +
        ch.adSpend +
        ch.supportCost +
        ch.logisticsCost +
        ch.paymentFee
      ch.netContribution = ch.revenue - ch.totalCost
      ch.marginPct = ch.revenue > 0 ? (ch.netContribution / ch.revenue) * 100 : 0
      ch.aov = ch.ordersCount > 0 ? ch.revenue / ch.ordersCount : 0
      // CAC + CPL proxied on `ordersCount` until a dedicated `Lead` table
      // exists. Both metrics converge when every order came from a paid lead.
      ch.cac = ch.ordersCount > 0 ? ch.adSpend / ch.ordersCount : 0
      ch.cpl = ch.ordersCount > 0 ? ch.adSpend / ch.ordersCount : 0
      // Round to 2 decimals so the dashboard doesn't render 17.000000001.
      ch.revenue = round2(ch.revenue)
      ch.messageCost = round2(ch.messageCost)
      ch.aiTokenCost = round2(ch.aiTokenCost)
      ch.adSpend = round2(ch.adSpend)
      ch.supportCost = round2(ch.supportCost)
      ch.logisticsCost = round2(ch.logisticsCost)
      ch.paymentFee = round2(ch.paymentFee)
      ch.totalCost = round2(ch.totalCost)
      ch.netContribution = round2(ch.netContribution)
      ch.marginPct = round2(ch.marginPct)
      ch.aov = round2(ch.aov)
      ch.cac = round2(ch.cac)
      ch.cpl = round2(ch.cpl)
      return ch
    })
  } catch (err) {
    captureError(err as Error, {
      service: 'channel-cost',
      method: 'getChannelContributions',
      tenantId,
    })
    throw new Error('No se pudo obtener el margen de contribución por canal')
  }
}

/**
 * Auto-record channel costs for a single day from operational data.
 *
 * Intended to be called by a daily cron job (or the manual
 * `/api/finance/channel-cost/sync` endpoint). For each tracked channel:
 *   1. Count orders whose `Channel.type === channel` and `createdAt` falls
 *      inside the supplied `date`'s calendar day.
 *   2. Sum their `total` as gross revenue.
 *   3. Estimate the cost components from operational heuristics (in
 *      production these come from the Meta API, LLM usage logs, etc.).
 *   4. Upsert a single `ChannelCost` row keyed by (tenantId, channel, date).
 *
 * The supplied `date` is normalized to 00:00:00.000 local time before
 * storage so the row's day bucket is unambiguous. The `createdAt` window
 * used to query `Order` is `[startOfDay, startOfNextDay)` to avoid
 * off-by-one bugs at 23:59:59.999.
 *
 * Idempotent: re-running for the same day overwrites the previous row
 * (the unique constraint on `(tenantId, channel, date)` guarantees it).
 */
export async function recordDailyChannelCosts(
  tenantId: string,
  date: Date,
): Promise<void> {
  // Normalize to the start of the day for storage. We DO NOT mutate the
  // caller's `date` — copy first.
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const startOfNextDay = new Date(startOfDay)
  startOfNextDay.setDate(startOfNextDay.getDate() + 1)

  for (const channel of TRACKED_CHANNELS) {
    try {
      // The `Order` model exposes only `channelId` (String? FK to Channel.id)
      // — there is NO Prisma relation from Order back to Channel. So we
      // resolve the channel IDs of this TYPE first, then filter orders by
      // `channelId IN (...)`. A tenant may have multiple WhatsApp numbers
      // (e.g. one per country) so this returns a list.
      const channels = await db.channel.findMany({
        where: { tenantId, type: channel },
        select: { id: true },
      })
      const channelIds = channels.map((c) => c.id)

      // No channels of this type registered → nothing to attribute.
      // Still upsert a zero row so the dashboard shows the channel as
      // "tracked but idle" rather than missing.
      const orders =
        channelIds.length === 0
          ? []
          : await db.order.findMany({
              where: {
                tenantId,
                channelId: { in: channelIds },
                createdAt: { gte: startOfDay, lt: startOfNextDay },
              },
              select: { total: true },
            })

      const revenue = orders.reduce((sum, o) => sum + o.total, 0)
      const ordersCount = orders.length

      // ── Cost estimates (study §14.1) ────────────────────────────────
      // These are placeholders until the corresponding adapters log actuals:
      //   - messageCost:  Meta WA Cloud API ~$0.0085/message (1 message/order)
      //   - aiTokenCost:  LLM cost per order (~$0.02 — replace with real usage)
      //   - logisticsCost: ~$2.50/order average shipping
      //   - paymentFee:   2.9% + $0.30 (Stripe-style — replace with gateway)
      //   - adSpend + supportCost are left at 0 here: they're stamped by the
      //     ad-attribution + agent-time loggers respectively (TODO).
      const messageCost = ordersCount * 0.0085
      const aiTokenCost = ordersCount * 0.02
      const logisticsCost = ordersCount * 2.5
      const paymentFee = revenue * 0.029 + 0.3

      const netContribution =
        revenue - messageCost - aiTokenCost - logisticsCost - paymentFee
      const marginPct =
        revenue > 0 ? (netContribution / revenue) * 100 : 0

      await db.channelCost.upsert({
        where: {
          tenantId_channel_date: {
            tenantId,
            channel,
            date: startOfDay,
          },
        },
        update: {
          revenue,
          ordersCount,
          messageCost,
          aiTokenCost,
          logisticsCost,
          paymentFee,
          netContribution,
          marginPct,
        },
        create: {
          tenantId,
          channel,
          date: startOfDay,
          revenue,
          ordersCount,
          messageCost,
          aiTokenCost,
          logisticsCost,
          paymentFee,
          netContribution,
          marginPct,
        },
      })

      log.info(
        { tenantId, channel, date: startOfDay, ordersCount, revenue, marginPct: round2(marginPct) },
        'ChannelCost upserted for day',
      )
    } catch (err) {
      // Capture + continue — a failure on one channel shouldn't abort
      // the others. The cron caller can observe the capture in Sentry.
      captureError(err as Error, {
        service: 'channel-cost',
        method: 'recordDailyChannelCosts',
        tenantId,
        channel,
        date: startOfDay.toISOString(),
      })
      log.error(
        {
          tenantId,
          channel,
          date: startOfDay.toISOString(),
          err: err instanceof Error ? err.message : String(err),
        },
        'Failed to record daily channel cost (continuing to next channel)',
      )
    }
  }
}

/** Round to 2 decimals — used to keep dashboard numbers tidy. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
