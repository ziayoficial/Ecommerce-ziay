// CommerceFlow OS — Row-Level Security (RLS) helpers
//
// Multi-tenant isolation at the Prisma layer. Every query that touches
// tenant-scoped models MUST pass through `tenantWhere(tenantId)` or use
// `makeTenantPrismaExtension(tenantId)`.
//
// This mirrors the PostgreSQL RLS policies we'd enforce at the DB layer in
// production (see `RLS_SQL_POLICIES`). In dev (SQLite) we enforce in-app.
//
// BUILD-AGENTS-LIB-001

import { Prisma, PrismaClient } from '@prisma/client'

/**
 * Models that carry a `tenantId` column and therefore must be scoped.
 * Keep this list in sync with `prisma/schema.prisma`.
 */
export const TENANT_SCOPED_MODELS: Set<string> = new Set([
  'Tenant', // self-scoped by id
  'User',
  'Channel',
  'Customer',
  'Conversation',
  'Message',
  'Product',
  'Order',
  'OrderItem', // scoped via order relation — listed for completeness
  'OrderEvent',
  'VolumePrice',
  'SalesSpeech',
  'Objection',
  'ThemeDesign',
  'CategoryCombo',
  'DeliveryHistory',
  'ImageIdentification',
  'Campaign',
  'Shipment',
  'CommissionEntry',
  'Invoice',
  'Carrier',
])

/**
 * Assert that a tenantId is a non-empty string. Use this at the top of every
 * API route / server function that accepts a tenantId from the client.
 *
 * @throws Error if tenantId is missing or empty.
 */
export function assertTenantAccess(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('Tenant access required: tenantId must be a non-empty string')
  }
}

/**
 * Build a Prisma `where` clause scoped to a single tenant.
 *
 * @example
 * ```ts
 * const orders = await db.order.findMany({ where: { ...tenantWhere(tenantId), status: 'new' } })
 * ```
 */
export function tenantWhere(tenantId: string): { tenantId: string } {
  assertTenantAccess(tenantId)
  return { tenantId }
}

/**
 * Create a Prisma client extension that enforces tenant scoping on all
 * queries against tenant-scoped models. This is a defense-in-depth layer —
 * the application should still pass `tenantWhere(tenantId)` explicitly.
 *
 * @example
 * ```ts
 * const tenantDb = db.$extends(makeTenantPrismaExtension(session.tenantId))
 * const orders = await tenantDb.order.findMany() // auto-scoped
 * ```
 */
export function makeTenantPrismaExtension(tenantId: string) {
  assertTenantAccess(tenantId)
  return Prisma.defineExtension((client) => {
    return client.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Only scope reads & writes on tenant-scoped models.
            // Skip the Tenant model itself (it's the tenant root).
            if (!model || !TENANT_SCOPED_MODELS.has(model) || model === 'Tenant') {
              return query(args)
            }
            // Inject tenantId into the where clause for findMany/findFirst/findUnique/update/delete
            if (
              operation === 'findMany' ||
              operation === 'findFirst' ||
              operation === 'findUnique' ||
              operation === 'update' ||
              operation === 'updateMany' ||
              operation === 'delete' ||
              operation === 'deleteMany' ||
              operation === 'count' ||
              operation === 'aggregate' ||
              operation === 'groupBy'
            ) {
              const where = (args as { where?: Record<string, unknown> }).where ?? {}
              ;(args as { where?: Record<string, unknown> }).where = { ...where, tenantId }
            }
            // Inject tenantId into create / createMany / upsert payloads
            if (operation === 'create') {
              ;(args as { data?: Record<string, unknown> }).data = {
                ...((args as { data?: Record<string, unknown> }).data ?? {}),
                tenantId,
              }
            }
            if (operation === 'createMany') {
              const data = (args as { data?: unknown }).data
              if (Array.isArray(data)) {
                ;(args as { data?: unknown }).data = data.map((d) => ({ ...d, tenantId }))
              } else if (data && typeof data === 'object') {
                ;(args as { data?: Record<string, unknown> }).data = { ...data, tenantId }
              }
            }
            if (operation === 'upsert') {
              const where = (args as { where?: Record<string, unknown> }).where ?? {}
              ;(args as { where?: Record<string, unknown> }).where = { ...where, tenantId }
              ;(args as { create?: Record<string, unknown> }).create = {
                ...((args as { create?: Record<string, unknown> }).create ?? {}),
                tenantId,
              }
              ;(args as { update?: Record<string, unknown> }).update = {
                ...((args as { update?: Record<string, unknown> }).update ?? {}),
                // do NOT overwrite tenantId on update
              }
            }
            return query(args)
          },
        },
      },
    })
  })
}

/**
 * PostgreSQL DDL for Row-Level Security policies on the 10 most critical
 * tenant-scoped models. Apply this migration when moving from SQLite (dev)
 * to PostgreSQL (prod).
 *
 * Assumes a `current_setting('app.tenant_id')` set per-request by the API
 * layer (e.g. via `SET LOCAL app.tenant_id = '<cuid>'`).
 */
export const RLS_SQL_POLICIES = `
-- ───────────────────────────────────────────────────────────────────
-- CommerceFlow OS — Row-Level Security policies (PostgreSQL prod)
-- Apply AFTER migrating from SQLite. Requires pgcrypto for gen_random_uuid().
-- ───────────────────────────────────────────────────────────────────

-- Helper: read the per-request tenant_id from session settings.
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::text;
$$ LANGUAGE sql STABLE;

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_order ON "Order"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orderitem ON "OrderItem"
  USING (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderItem"."orderId" AND o."tenantId" = app_current_tenant_id()));

ALTER TABLE "OrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orderevent ON "OrderEvent"
  USING (EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderEvent"."orderId" AND o."tenantId" = app_current_tenant_id()));

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer ON "Customer"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_conversation ON "Conversation"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_message ON "Message"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product ON "Product"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shipment ON "Shipment"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "CommissionEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_commission ON "CommissionEntry"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign ON "Campaign"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());
`

/**
 * Convenience: get a tenant-scoped Prisma client. Use this in server code
 * that has already validated the tenantId via session.
 *
 * @example
 * ```ts
 * import { getTenantDb } from '@/lib/rls'
 * import { db } from '@/lib/db'
 *
 * async function handler(session) {
 *   const tdb = getTenantDb(db, session.tenantId)
 *   const orders = await tdb.order.findMany() // auto-scoped
 * }
 * ```
 */
export function getTenantDb(client: PrismaClient, tenantId: string) {
  return client.$extends(makeTenantPrismaExtension(tenantId))
}
