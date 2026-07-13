-- ─────────────────────────────────────────────────────────────────────────────
-- ZIAY — PostgreSQL supplementary migration: core commerce indexes
-- Task: FIX-1-DB-001
-- ─────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   `0_init/migration.sql` is provider-flavored (dev = SQLite). When you flip
--   the datasource in `prisma/schema.prisma` to `postgresql` and run
--   `bun run db:migrate`, Prisma emits a fresh PostgreSQL dialect of `0_init`
--   and `1_postgres_indexes` lands the production-only optimizations for the
--   intelligence/fintech/marketplace tables. This file is the follow-on that
--   closes the index gap on the 10 CORE COMMERCE models flagged by
--   AUDIT-GAP-4-DB (Conversation, Message, Order, OrderItem, OrderEvent,
--   AuditLog, Shipment, CommissionEntry, Invoice, WalletAccount) plus the
--   3 missing @@unique candidates (Attribution, CommissionEntry.orderId,
--   WalletAccount.traffickerId+accountNumber).
--
--   Without this migration the 10 core tables full-scan on every tenant-
--   scoped query in PostgreSQL production — the 1_postgres_indexes migration
--   only re-states indexes for the newer models.
--
-- IDEMPOTENT
--   Every statement uses `IF NOT EXISTS` so re-running is safe (useful as a
--   forcing function if any index was dropped during a partial restore).
--
-- APPLY ORDER (PostgreSQL deploy)
--   1. `prisma/schema.prisma` → provider = "postgresql"
--   2. `bun run db:migrate`          (applies 0_init → 1_postgres_indexes → this)
--   3. `bunx prisma db seed`
--   4. Verify: `psql -d ziay -c "\di Conversation*"`
--
-- DEV SAFETY
--   This migration is a no-op on SQLite — Prisma skips migration files when
--   the provider is `sqlite` (we use `bun run db:push` for dev instead, which
--   applies the same indexes via the Prisma schema). DO NOT run this against
--   SQLite manually: the index names collide with Prisma's auto-generated
--   SQLite names.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONVERSATION — messenger inbox, agent assignment dashboard
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_idx" ON "Conversation"("tenantId");
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_status_idx" ON "Conversation"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_lastMessageAt_idx" ON "Conversation"("tenantId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_assigneeId_idx" ON "Conversation"("assigneeId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MESSAGE — timeline + tenant isolation + sender-role analytics
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_tenantId_idx" ON "Message"("tenantId");
CREATE INDEX IF NOT EXISTS "Message_direction_idx" ON "Message"("direction");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ORDER — KPIs, kanban, attribution, payment webhooks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Order_tenantId_idx" ON "Order"("tenantId");
CREATE INDEX IF NOT EXISTS "Order_tenantId_status_idx" ON "Order"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ORDERITEM — every order detail + COGS calc
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ORDEREVENT — order audit timeline
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_idx" ON "OrderEvent"("orderId");
CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderEvent_type_idx" ON "OrderEvent"("type");

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. AUDITLOG — append-only, grows fastest (every channel/ad/order write)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SHIPMENT — guide tracking queries
--    (Schema field mapping: estado = status, transportadoraCanonica = carrierId,
--     numeroGuia = guideNumber per audit's Saramantha naming convention.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Shipment_tenantId_idx" ON "Shipment"("tenantId");
CREATE INDEX IF NOT EXISTS "Shipment_orderId_idx" ON "Shipment"("orderId");
CREATE INDEX IF NOT EXISTS "Shipment_estado_idx" ON "Shipment"("estado");
CREATE INDEX IF NOT EXISTS "Shipment_transportadoraCanonica_idx" ON "Shipment"("transportadoraCanonica");
CREATE INDEX IF NOT EXISTS "Shipment_numeroGuia_idx" ON "Shipment"("numeroGuia");

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. COMMISSIONENTRY — GMV aggregation joins
--    `orderId @unique` closes the findFirst+update/create race in
--    /api/monetization/commission POST (two concurrent requests could both
--    pass findFirst==null and both create, leaving duplicate entries per order).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionEntry_orderId_key" ON "CommissionEntry"("orderId");
CREATE INDEX IF NOT EXISTS "CommissionEntry_tenantId_idx" ON "CommissionEntry"("tenantId");
CREATE INDEX IF NOT EXISTS "CommissionEntry_etapaReconocimiento_idx" ON "CommissionEntry"("etapaReconocimiento");

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. INVOICE — billing/invoicing queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_idx" ON "Invoice"("tenantId");
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_periodo_idx" ON "Invoice"("tenantId", "periodo");
CREATE INDEX IF NOT EXISTS "Invoice_estado_idx" ON "Invoice"("estado");
CREATE INDEX IF NOT EXISTS "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. WALLETACCOUNT — wallet account lookups
--     `@@unique([traffickerId, accountNumber])` prevents duplicate accounts
--     per trafficker (NULL traffickerId is treated as distinct by PG/SQLite —
--     tenant-level wallets remain unconstrained).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "WalletAccount_traffickerId_accountNumber_key" ON "WalletAccount"("traffickerId", "accountNumber");
CREATE INDEX IF NOT EXISTS "WalletAccount_tenantId_idx" ON "WalletAccount"("tenantId");
CREATE INDEX IF NOT EXISTS "WalletAccount_traffickerId_idx" ON "WalletAccount"("traffickerId");
CREATE INDEX IF NOT EXISTS "WalletAccount_userId_idx" ON "WalletAccount"("userId");
CREATE INDEX IF NOT EXISTS "WalletAccount_verified_idx" ON "WalletAccount"("verified");

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. ATTRIBUTION — closes race that allowed duplicate attribution rows per
--     (order, ad, model). Adds the missing composite unique + adId FK index.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "Attribution_orderId_adId_model_key" ON "Attribution"("orderId", "adId", "model");
CREATE INDEX IF NOT EXISTS "Attribution_adId_idx" ON "Attribution"("adId");
