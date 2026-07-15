-- CommerceFlow OS — Row-Level Security policies for PostgreSQL (Saramantha §16.2)
-- Run AFTER migrating from SQLite to PostgreSQL.
-- This file enables RLS on every multi-tenant table and creates policies that
-- enforce `tenant_id = current_setting('app.tenant_id')` on all queries.
--
-- Even if a workflow/API forgets to filter by tenantId explicitly, RLS at the
-- database level prevents any cross-tenant data leak. This is the defense-in-depth
-- the Saramantha doc mandates (§16.2).
--
-- Usage:
--   1. Migrate to Postgres: change prisma datasource provider to "postgresql"
--   2. Run: psql -f prisma/sql/rls-policies.sql
--   3. In app code, before any query, set the session variable:
--        await db.$executeRaw`SET app.tenant_id = ${tenantId}`
--      (done in a middleware or Prisma extension)

-- ────────────────────────────────────────────────────────────────────
-- 0. Helper: enable RLS + force it even for table owners
-- ────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────
-- 1. Multi-tenant tables (have tenant_id column)
-- ────────────────────────────────────────────────────────────────────

-- Users
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user ON "User"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Channel
ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Channel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_channel ON "Channel"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Customer
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_customer ON "Customer"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Conversation
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_conversation ON "Conversation"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Message
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_message ON "Message"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Product
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product ON "Product"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Order
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_order ON "Order"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- VolumePrice
ALTER TABLE "VolumePrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VolumePrice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_volumeprice ON "VolumePrice"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- SalesSpeech
ALTER TABLE "SalesSpeech" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesSpeech" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_speech ON "SalesSpeech"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Objection
ALTER TABLE "Objection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Objection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_objection ON "Objection"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ThemeDesign
ALTER TABLE "ThemeDesign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ThemeDesign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_theme ON "ThemeDesign"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- CategoryCombo
ALTER TABLE "CategoryCombo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CategoryCombo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_combo ON "CategoryCombo"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- DeliveryHistory
ALTER TABLE "DeliveryHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_delivery ON "DeliveryHistory"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ImageIdentification
ALTER TABLE "ImageIdentification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImageIdentification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_image ON "ImageIdentification"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Campaign
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign ON "Campaign"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Carrier
ALTER TABLE "Carrier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Carrier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_carrier ON "Carrier"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Shipment
ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shipment ON "Shipment"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- CommissionEntry
ALTER TABLE "CommissionEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommissionEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_commission ON "CommissionEntry"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Invoice
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoice ON "Invoice"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- AuditLog
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit ON "AuditLog"
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- ────────────────────────────────────────────────────────────────────
-- 2. Tables that don't have tenant_id (global lookups) — no RLS needed
-- ────────────────────────────────────────────────────────────────────
-- Tenant, AdPlatform, Setting, AutomationRule, OrderItem, OrderEvent,
-- Attribution, AdSpend, Ad — these are either global or accessed via
-- parent tables that already have RLS.

-- ────────────────────────────────────────────────────────────────────
-- 3. App role: grant only the necessary permissions
-- ────────────────────────────────────────────────────────────────────
-- Create a dedicated app role (not superuser) so RLS actually applies:
--   CREATE ROLE commerceflow_app LOGIN PASSWORD 'change_me';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerceflow_app;
--   GRANT USAGE ON SCHEMA public TO commerceflow_app;
-- The app connects as this role. RLS policies enforce tenant isolation.
-- (Superusers bypass RLS, so never run the app as a superuser.)

-- ────────────────────────────────────────────────────────────────────
-- 4. pgvector extension for embeddings (§3)
-- ────────────────────────────────────────────────────────────────────
-- CREATE EXTENSION IF NOT EXISTS vector;
-- After enabling, migrate Message.embedding and Product.embeddingTexto/embeddingVisual
-- from Bytes to vector(1024) and use `<=>` operator for semantic search:
--   SELECT * FROM "Message"
--   WHERE tenant_id = current_setting('app.tenant_id', true)
--   ORDER BY embedding <=> $query_embedding
--   LIMIT 10;
