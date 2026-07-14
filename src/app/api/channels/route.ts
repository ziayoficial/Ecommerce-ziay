import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireTenantAccess } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

// TD-2: Zod schemas for POST + PATCH. Both use `.passthrough()` so unknown
// keys are preserved on `parseResult.data` (matches the previous behaviour
// where `body.accountId`, `body.country`, etc. were read individually).
const ChannelTypeSchema = z.enum(['whatsapp', 'messenger', 'instagram', 'telegram'])

const CreateChannelSchema = z.object({
  tenantId: z.string().min(1),
  type: ChannelTypeSchema,
  name: z.string().min(1),
  displayName: z.string().min(1),
  accountId: z.string().optional(),
  verified: z.boolean().optional(),
  active: z.boolean().optional(),
  country: z.string().optional(),
  paymentStrategy: z.string().optional(),
  requirePrepayMin: z.number().nullable().optional(),
  prepayDiscountPct: z.number().optional(),
  codFee: z.number().optional(),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  whatsappToken: z.string().optional(),
  pageId: z.string().optional(),
  pageAccessToken: z.string().optional(),
  igAccountId: z.string().optional(),
  verifyToken: z.string().optional(),
  appSecret: z.string().optional(),
}).passthrough()

const UpdateChannelSchema = z.object({
  channelId: z.string().min(1),
}).passthrough()

// Channel CRUD — list / create / update / deactivate.
//
// SPRINT8-SERVICES-REST-001 — left inline. Each method does at most 2 db
// calls (one Channel write + one AuditLog insert). Per rule #2 (1-2
// simple db calls OK to leave), a `channel.service.ts` would just be a
// thin pass-through — the value of a service layer shows up when callers
// share read paths or transactions, and the only other caller touching
// `Channel` is `/api/payments/config` (which writes a single field).
// TODO: migrate to service layer when channel verification flows land.
//
// FIX-SECURITY-AUTH-001 (#12) — every entry point now enforces tenant
// access. Previously `requireAuth()` only, allowing cross-tenant channel
// CRUD including credential mutation (`whatsappToken`, `pageAccessToken`,
// `appSecret`).
//
// SPRINT-ADOPT-ERRORHANDLER-001 — every handler wrapped with
// `withErrorHandling`. The previous manual `try/catch` boilerplate
// (captureError + NextResponse.json 500) is now the wrapper's
// responsibility.
/**
 * GET /api/channels
 *
 * List channels for a tenant. Tokens are masked (hasToken flags only).
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns Channel list with masked credentials
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  const channels = await db.channel.findMany({
    where: { tenantId },
    orderBy: { type: 'asc' },
  })
  // Mask tokens — return hasToken flags instead of actual values
  const result = channels.map((c) => ({
    id: c.id, tenantId: c.tenantId, type: c.type, name: c.name, displayName: c.displayName,
    accountId: c.accountId, verified: c.verified, active: c.active, country: c.country,
    paymentStrategy: c.paymentStrategy, requirePrepayMin: c.requirePrepayMin,
    prepayDiscountPct: c.prepayDiscountPct, codFee: c.codFee,
    wabaId: c.wabaId, phoneNumberId: c.phoneNumberId, pageId: c.pageId, igAccountId: c.igAccountId,
    verifyToken: c.verifyToken, appSecret: c.appSecret ? '***' : null,
    hasWhatsappToken: !!c.whatsappToken,
    hasPageAccessToken: !!c.pageAccessToken,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  }))
  return NextResponse.json({ channels: result })
})

// POST /api/channels — create a new channel (e.g., add a new WhatsApp line)
/**
 * POST /api/channels
 *
 * Create a new channel (e.g., add a WhatsApp line). Validates required fields per channel type.
 *
 * @security Requires authentication + tenant access (requireTenantAccess)
 * @returns Created channel id + type + name
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const raw = await req.json()
  const parseResult = CreateChannelSchema.safeParse(raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validación fallida', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const body = parseResult.data
  const { tenantId, type, name, displayName } = body

  // FIX-SECURITY-AUTH-001 (#12) — tenant gate before the channel create.
  const { error } = await requireTenantAccess(tenantId)
  if (error) return error

  // Validate required fields by type
  if (type === 'whatsapp' && !body.wabaId) {
    return NextResponse.json({ error: 'WhatsApp channels require wabaId' }, { status: 400 })
  }
  if (type === 'messenger' && !body.pageId) {
    return NextResponse.json({ error: 'Messenger channels require pageId' }, { status: 400 })
  }
  if (type === 'instagram' && !body.igAccountId) {
    return NextResponse.json({ error: 'Instagram channels require igAccountId' }, { status: 400 })
  }

  const channel = await db.channel.create({
    data: {
      tenantId, type, name, displayName,
      accountId: body.accountId || null,
      verified: body.verified || false,
      active: body.active !== false,
      country: body.country || null,
      paymentStrategy: body.paymentStrategy || 'hybrid',
      requirePrepayMin: body.requirePrepayMin || null,
      prepayDiscountPct: body.prepayDiscountPct || 0,
      codFee: body.codFee || 0,
      // Credentials by type
      wabaId: body.wabaId || null,
      phoneNumberId: body.phoneNumberId || null,
      whatsappToken: body.whatsappToken || null,
      pageId: body.pageId || null,
      pageAccessToken: body.pageAccessToken || null,
      igAccountId: body.igAccountId || null,
      verifyToken: body.verifyToken || null,
      appSecret: body.appSecret || null,
    },
  })

  await db.auditLog.create({
    data: { tenantId, action: 'channel.created', entity: 'Channel', entityId: channel.id,  metadata: JSON.stringify({ type, name }) }
  })

  return NextResponse.json({ channel: { id: channel.id, type: channel.type, name: channel.name } })
})

// PATCH /api/channels — update a channel (e.g., update credentials)
/**
 * PATCH /api/channels
 *
 * Update a channel (e.g., rotate credentials). Tenant ownership verified before update.
 *
 * @security Requires authentication + tenant ownership check
 * @returns Updated channel + changed fields
 */
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const { session, error: authErr } = await requireAuth()
  if (authErr) return authErr

  const body_raw = await req.json()
  const parseResult = UpdateChannelSchema.safeParse(body_raw)
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validación fallida', details: parseResult.error.flatten() },
      { status: 400 },
    )
  }
  const { channelId, ...fields } = parseResult.data as Record<string, unknown> & { channelId: string }

  // FIX-SECURITY-AUTH-001 (#12) — fetch the channel, verify tenant
  // ownership before update. Any authed user used to be able to mutate
  // any channel's credentials by id.
  const existing = await db.channel.findUnique({ where: { id: channelId } })
  if (!existing) {
    return NextResponse.json({ error: 'channel not found' }, { status: 404 })
  }
  const userTenantId = session?.user?.tenantId ?? null
  if (userTenantId && userTenantId !== existing.tenantId) {
    return NextResponse.json(
      { error: 'Forbidden: tenant mismatch' },
      { status: 403 },
    )
  }

  // Build update data — only update provided fields
  const updateData: Record<string, unknown> = {}
  const allowedFields = [
    'name', 'displayName', 'accountId', 'verified', 'active', 'country',
    'paymentStrategy', 'requirePrepayMin', 'prepayDiscountPct', 'codFee',
    'wabaId', 'phoneNumberId', 'whatsappToken', 'pageId', 'pageAccessToken',
    'igAccountId', 'verifyToken', 'appSecret'
  ]
  for (const f of allowedFields) {
    if (fields[f] !== undefined) updateData[f] = fields[f]
  }

  const channel = await db.channel.update({ where: { id: channelId }, data: updateData })

  await db.auditLog.create({
    data: { tenantId: channel.tenantId, action: 'channel.updated', entity: 'Channel', entityId: channelId, metadata: JSON.stringify(Object.keys(updateData)) }
  })

  return NextResponse.json({ channel: { id: channel.id, name: channel.name, updated: Object.keys(updateData) } })
})

// DELETE /api/channels — delete (deactivate) a channel
/**
 * DELETE /api/channels
 *
 * Soft-delete (deactivate) a channel. Preserves conversation history.
 *
 * @security Requires authentication + tenant ownership check
 * @returns Deactivated channel id
 */
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const { session, error: authErr } = await requireAuth()
  if (authErr) return authErr

  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })

  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) return NextResponse.json({ error: 'channel not found' }, { status: 404 })

  // FIX-SECURITY-AUTH-001 (#12) — tenant ownership check before delete.
  const userTenantId = session?.user?.tenantId ?? null
  if (userTenantId && userTenantId !== channel.tenantId) {
    return NextResponse.json(
      { error: 'Forbidden: tenant mismatch' },
      { status: 403 },
    )
  }

  // Soft delete — deactivate instead of hard delete to preserve conversation history
  await db.channel.update({ where: { id: channelId }, data: { active: false } })

  await db.auditLog.create({
    data: { tenantId: channel.tenantId, action: 'channel.deactivated', entity: 'Channel', entityId: channelId, metadata: JSON.stringify({ name: channel.name }) }
  })

  return NextResponse.json({ ok: true, deactivated: channelId })
})
