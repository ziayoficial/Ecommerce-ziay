// SPRINT-MONITORING-FINAL-001 — status page incident history API.
//
//   GET    /api/status/incidents             → public list (active + last 30d)
//   POST   /api/status/incidents             → admin-only create
//   PATCH  /api/status/incidents?id=INC_ID   → admin-only status update
//
// The GET endpoint is PUBLIC (no auth) so it can back the `/status` page
// for unauthenticated visitors + crawlers. The path is whitelisted in
// `PUBLIC_PATTERNS` in `src/middleware.ts` (SPRINT-MONITORING-FINAL-001).
// POST + PATCH are admin-only — they run `requireRole(['admin'])` inside
// the handler so the middleware's auth bypass doesn't expose them.
//
// Incident lifecycle (matches `StatusIncident` in `prisma/schema.prisma`):
//   status:     "investigating" → "identified" → "monitoring" → "resolved"
//   severity:   "minor" | "major" | "critical" | "maintenance"
//
// `updates` is a JSON-encoded array of `{ time, message, status }` — each
// PATCH appends a new entry so the timeline is preserved. Stored as String
// (SQLite has no native JSON column; PostgreSQL gets the same string).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth-helpers'
import { withErrorHandling } from '@/lib/middleware/api-error-handler'

const SEVERITIES = ['minor', 'major', 'critical', 'maintenance'] as const
const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const

const CreateIncidentSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    severity: z.enum(SEVERITIES),
    status: z.enum(STATUSES).default('investigating'),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().nullable().optional(),
    updates: z
      .array(
        z.object({
          time: z.string().datetime(),
          message: z.string().min(1),
          status: z.enum(STATUSES),
        }),
      )
      .optional(),
  })
  .strict()

const UpdateIncidentSchema = z
  .object({
    status: z.enum(STATUSES),
    message: z.string().min(1).max(2000).optional(),
    endTime: z.string().datetime().nullable().optional(),
  })
  .strict()

// ───────────────────────────────────────────────────────────────────────────
// GET — public list of incidents (active + resolved within last 30 days)
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/status/incidents
 *
 * Public list of status page incidents — active (any status != resolved) +
 * those resolved within the last 30 days. Newest first, capped at 20.
 * Backs the `/status` page's "Incidentes recientes" section.
 *
 * @security Public — no auth required (path is in PUBLIC_PATTERNS).
 * @returns Incident list
 */
export const GET = withErrorHandling(async (_req: NextRequest) => {
  const incidents = await db.statusIncident.findMany({
    where: {
      OR: [
        { status: { not: 'resolved' } },
        { endTime: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    },
    orderBy: { startTime: 'desc' },
    take: 20,
  })

  return NextResponse.json({ incidents })
})

// ───────────────────────────────────────────────────────────────────────────
// POST — admin-only create
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /api/status/incidents
 *
 * Create a new status page incident. Admin-only (SRE / on-call) — used to
 * announce outages, planned maintenance, or postmortem-worthy events.
 *
 * @security Requires authenticated admin session.
 * @returns Created incident
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const { error: roleError } = await requireRole(['admin'])
  if (roleError) return roleError

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateIncidentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // `startTime` defaults to now if not provided (the common case — the admin
  // is reporting a just-detected incident). `endTime` is null until the
  // incident is resolved.
  const startTime = body.startTime ? new Date(body.startTime) : new Date()
  const endTime = body.endTime ? new Date(body.endTime) : null
  const updates = body.updates ? JSON.stringify(body.updates) : null

  const incident = await db.statusIncident.create({
    data: {
      title: body.title,
      description: body.description,
      severity: body.severity,
      status: body.status,
      startTime,
      endTime,
      updates,
    },
  })

  return NextResponse.json({ incident }, { status: 201 })
})

// ───────────────────────────────────────────────────────────────────────────
// PATCH — admin-only status update (with timeline entry)
// ───────────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/status/incidents?id=INC_ID
 *
 * Update an incident's status (investigating → identified → monitoring →
 * resolved). Optionally provide a `message` (added to the timeline) and an
 * `endTime` (auto-stamped when status becomes `resolved` if not supplied).
 *
 * @security Requires authenticated admin session.
 * @returns Updated incident
 */
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const { error: roleError } = await requireRole(['admin'])
  if (roleError) return roleError

  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'Missing id query parameter' }, { status: 400 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateIncidentSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.success ? parsed.data : null
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const existing = await db.statusIncident.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
  }

  // Append a timeline entry for this transition. The `updates` field is a
  // JSON-encoded array of `{ time, message, status }` entries — we read the
  // existing array (if any), append the new entry, and write it back.
  type TimelineEntry = { time: string; message: string; status: string }
  let timeline: TimelineEntry[] = []
  if (existing.updates) {
    try {
      const parsedUpdates = JSON.parse(existing.updates)
      if (Array.isArray(parsedUpdates)) {
        timeline = parsedUpdates as TimelineEntry[]
      }
    } catch {
      // Malformed `updates` JSON — start a fresh timeline rather than crash.
      timeline = []
    }
  }
  timeline.push({
    time: new Date().toISOString(),
    message: body.message ?? `Estado actualizado a: ${body.status}`,
    status: body.status,
  })

  // Auto-stamp `endTime` when transitioning to `resolved` (unless the caller
  // explicitly provided one).
  const endTime =
    body.endTime !== undefined
      ? body.endTime
        ? new Date(body.endTime)
        : null
      : body.status === 'resolved' && !existing.endTime
        ? new Date()
        : existing.endTime

  const updated = await db.statusIncident.update({
    where: { id },
    data: {
      status: body.status,
      endTime,
      updates: JSON.stringify(timeline),
    },
  })

  return NextResponse.json({ incident: updated })
})
