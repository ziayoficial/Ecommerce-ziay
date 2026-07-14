import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// Payment strategy config per channel.
//
// FIX-SECURITY-AUTH-001 (#1, #2 — P0) — previously this route returned
// `db.channel.findMany()` and `db.setting.findMany()` with NO tenant filter,
// leaking every tenant's channels + every `cred::*` credential blob to any
// authenticated user. The PATCH handler likewise updated any channel by id
// and upserted arbitrary Setting keys (including `cred::*`).
//
// Now:
//   - tenantId is read from the session (the route has no query/body param
//     for it). Platform admins with no tenantId get an empty list back —
//     they must use a tenant-scoped route.
//   - `db.channel.findMany` is scoped with `where: { tenantId }`.
//   - `db.setting.findMany` rows with `cred::` prefix are NEVER returned
//     here (they're managed by `/api/integrations/credentials` which masks
//     them). Only non-cred settings (e.g. `roas_kill_threshold`,
//     `cpa_target`) are returned as `global`.
//   - PATCH verifies the channel belongs to the caller's tenant before
//     update, and whitelists the setting keys that may be upserted.
//
// SPRINT8-SERVICES-REST-001 — left inline. Each method touches at most
// two unrelated tables (`Channel` for the strategy fields, `Setting` for
// global thresholds). Per rule #2 (1-2 simple db calls OK to leave),
// neither table warrants a dedicated service on its own — `Setting` is
// a tiny key/value table and `Channel` is a CRUD surface covered by the
// `/api/channels` route.
// TODO: migrate to service layer if more payment-strategy logic accumulates.

// Whitelist of non-credential Setting keys that may be upserted via PATCH.
// Anything else (in particular `cred::*`) is rejected with 400.
const ALLOWED_SETTING_KEYS = new Set([
  'roas_kill_threshold',
  'cpa_target',
])

// Mask any `cred::*` Setting value before it can leave the server through
// this route. Belt-and-suspenders: the GET filter already drops `cred::*`
// rows, but if a future migration adds the prefix to a new key this guard
// ensures we still never ship raw secrets here.
function maskIfCredential(key: string, value: string): string {
  if (key.startsWith('cred::')) return '***'
  return value
}

export const GET = withErrorHandling(async () => {

  const { session, error } = await requireAuth()
  if (error) return error

    // FIX-SECURITY-AUTH-001 — derive tenantId from the session, not the query.
    // Platform admins with no tenantId get an empty list — they must use a
    // tenant-scoped admin route to inspect a specific tenant.
    const tenantId = session?.user?.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json({ channels: [], global: {} })
    }

    const channels = await db.channel.findMany({
      where: { tenantId },
      orderBy: { type: 'asc' },
    })
    const settings = await db.setting.findMany()

    // Drop any `cred::*` rows — credentials are managed by
    // /api/integrations/credentials (which masks values). The payments config
    // view only needs the non-cred global thresholds (roas_kill_threshold,
    // cpa_target, etc.).
    const global: Record<string, string> = {}
    for (const s of settings) {
      if (s.key.startsWith('cred::')) continue
      global[s.key] = maskIfCredential(s.key, s.value)
    }

    return NextResponse.json({
      channels: channels.map(ch => ({
        id: ch.id,
        type: ch.type,
        name: ch.name,
        displayName: ch.displayName,
        country: ch.country,
        paymentStrategy: ch.paymentStrategy,
        requirePrepayMin: ch.requirePrepayMin,
        prepayDiscountPct: ch.prepayDiscountPct,
        codFee: ch.codFee,
      })),
      global,
    })
  

})

// Update a channel's payment strategy + a whitelist of global Setting keys.
export const PATCH = withErrorHandling(async (req: NextRequest) => {

  const { session, error } = await requireAuth()
  if (error) return error

    const tenantId = session?.user?.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: no tenant context' },
        { status: 403 },
      )
    }

    // TD-2: Zod validation on the PATCH body. `channelId` is required; the
    // strategy fields are all optional (only those present are updated).
    // `.passthrough()` preserves the existing behaviour of silently dropping
    // unknown non-credential Setting keys (see ALLOWED_SETTING_KEYS filter
    // below).
    const PaymentsConfigPatchSchema = z.object({
      channelId: z.string().min(1),
      paymentStrategy: z.string().optional(),
      requirePrepayMin: z.number().nullable().optional(),
      prepayDiscountPct: z.number().optional(),
      codFee: z.number().optional(),
      global: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()

    const raw = await req.json()
    const parseResult = PaymentsConfigPatchSchema.safeParse(raw)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validación fallida', details: parseResult.error.flatten() },
        { status: 400 },
      )
    }
    const { channelId, ...fields } = parseResult.data

    // FIX-SECURITY-AUTH-001 — fetch the channel first and verify tenant
    // ownership. Previously any authed user could PATCH any channel by id,
    // including credential mutation (`whatsappToken`, `pageAccessToken`).
    const existing = await db.channel.findUnique({ where: { id: channelId } })
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }
    if (existing.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Forbidden: tenant mismatch' },
        { status: 403 },
      )
    }

    const data: Record<string, unknown> = {}
    if (fields.paymentStrategy) data.paymentStrategy = fields.paymentStrategy
    if (fields.requirePrepayMin !== undefined) data.requirePrepayMin = fields.requirePrepayMin
    if (fields.prepayDiscountPct !== undefined) data.prepayDiscountPct = fields.prepayDiscountPct
    if (fields.codFee !== undefined) data.codFee = fields.codFee

    const updated = await db.channel.update({ where: { id: channelId }, data })

    // Persist global settings too if provided — but only allow whitelisted
    // non-credential keys. `cred::*` is rejected (managed by
    // /api/integrations/credentials) and any unknown key is silently
    // dropped (defense-in-depth against stuffing arbitrary settings).
    if (fields.global && typeof fields.global === 'object') {
      for (const [k, v] of Object.entries(fields.global as Record<string, unknown>)) {
        if (k.startsWith('cred::')) {
          return NextResponse.json(
            { error: `Setting key "${k}" is managed by /api/integrations/credentials` },
            { status: 400 },
          )
        }
        if (!ALLOWED_SETTING_KEYS.has(k)) {
          // Silently skip unknown keys — preserves API shape for valid requests.
          continue
        }
        await db.setting.upsert({
          where: { key: k },
          update: { value: String(v) },
          create: { key: k, value: String(v) },
        })
      }
    }

    return NextResponse.json({ channel: updated })
  

})
