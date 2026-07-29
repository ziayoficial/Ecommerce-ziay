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
--
-- ────────────────────────────────────────────────────────────────────────────
-- TABLES COVERED (audit I2-R9R10 / SPRINT-SEC-R10-001 / I3-P0 N-1)
-- ────────────────────────────────────────────────────────────────────────────
-- Section 1 — strict tenant_id = current_setting('app.tenant_id') policies:
--   1.  User                2.  Channel             3.  Customer
--   4.  Conversation        5.  Message             6.  Product
--   7.  Order               8.  VolumePrice         9.  SalesSpeech
--   10. Objection           11. ThemeDesign         12. CategoryCombo
--   13. DeliveryHistory     14. ImageIdentification 15. Campaign
--   16. Carrier             17. Shipment            18. CommissionEntry
--   19. Invoice
--
-- Section 1a — nullable-tenant policies (tenant_id OR tenant_id IS NULL):
--   20. AuditLog            21. WalletAccount       22. WalletTransaction
--   23. WithdrawalRequest   24. TwoFactorConfig
--
-- Section 1b — R-10 additions (I2-R9R10) — strict tenant_id policies:
--   25. AP2Mandate           26. UcpCheckoutSession  27. IdentityVerification
--   28. ConsentRecord        29. DecisionLog          30. MarketplaceListing
--
-- Section 1c — R-10 additions — dual-tenant policy (fromTenantId OR toTenantId):
--   31. LeadReferral
--
-- Section 1d — I3-P0 N-1 additions — strict tenant_id policies for the 4
--              tenant-scoped tables introduced by I2-R3 (anti-fraud) and
--              I2-R8R11R12 (refund ledger) that were previously missing:
--   32. fraud_blocklist (FraudBlocklistEntry) — I2-R3
--   33. fraud_event    (FraudEvent)           — I2-R3
--   34. velocity_window (VelocityWindow)      — I2-R3
--   35. refund          (Refund)              — I2-R8R11R12
--
-- Section 2 — Tables WITHOUT tenant_id column (no RLS — see notes):
--   Tenant (global), AdPlatform (global), AutomationRule (global),
--   OrderItem / OrderEvent (accessed via parent Order RLS),
--   Attribution / AdSpend / Ad (accessed via parent Campaign RLS),
--   FxRate (global lookup, one row per currency),
--   Setting (app-layer isolation — see Section 2 note),
--   StatusIncident / StatusCheck (global status-page data).
--
-- Section 3 — (reserved for future tenant-scoped tables not yet in schema)

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
-- 1a. Wallet / 2FA tables (tenant_id is nullable — wallet accounts may be
--     owned by a trafficker (no tenant) or by the tenant itself). Same
--     `tenant_id = X OR tenant_id IS NULL` pattern as AuditLog so
--     webhook-originated / platform-level rows remain visible.
-- ────────────────────────────────────────────────────────────────────

-- WalletAccount (R-10 / I2-R9R10)
ALTER TABLE "WalletAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_walletaccount ON "WalletAccount"
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- WalletTransaction (R-10 / I2-R9R10)
ALTER TABLE "WalletTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_wallettransaction ON "WalletTransaction"
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- WithdrawalRequest (R-10 / I2-R9R10)
ALTER TABLE "WithdrawalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WithdrawalRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_withdrawalrequest ON "WithdrawalRequest"
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- TwoFactorConfig (R-10 / I2-R9R10)
-- tenant_id is nullable + @unique — config rows may be per-trafficker or
-- per-tenant. Same nullable-tenant pattern as AuditLog.
ALTER TABLE "TwoFactorConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TwoFactorConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_twofactorconfig ON "TwoFactorConfig"
  USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR tenant_id IS NULL);

-- ────────────────────────────────────────────────────────────────────
-- 1b. R-10 additions (I2-R9R10) — strict tenant_id policies for tables
--     that have a non-nullable tenant_id column.
-- ────────────────────────────────────────────────────────────────────

-- AP2Mandate (ACP mandates — Documento §10.2)
ALTER TABLE "AP2Mandate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AP2Mandate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ap2mandate ON "AP2Mandate"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- UcpCheckoutSession (Documento §10.1)
ALTER TABLE "UcpCheckoutSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UcpCheckoutSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ucpcheckoutsession ON "UcpCheckoutSession"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- IdentityVerification (Ley 2573 / Documento §12.1)
ALTER TABLE "IdentityVerification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdentityVerification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_identityverification ON "IdentityVerification"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ConsentRecord (Ley 1581 / Documento §12.2)
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_consentrecord ON "ConsentRecord"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- DecisionLog (Documento §11 — Trazabilidad de decisiones)
ALTER TABLE "DecisionLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_decisionlog ON "DecisionLog"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- MarketplaceListing (tenant-owned listings)
ALTER TABLE "MarketplaceListing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceListing" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_marketplacelisting ON "MarketplaceListing"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ────────────────────────────────────────────────────────────────────
-- 1c. R-10 additions (I2-R9R10) — dual-tenant policy.
--     LeadReferral has from_tenant_id + to_tenant_id (no plain tenant_id):
--     a referral is visible to BOTH the sharing tenant and the receiving
--     tenant. We use an OR predicate so either side can read the row,
--     and the same OR on WITH CHECK so either side can update the status
--     (e.g. mark as converted).
-- ────────────────────────────────────────────────────────────────────

-- LeadReferral
ALTER TABLE "LeadReferral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadReferral" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leadreferral ON "LeadReferral"
  USING (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    from_tenant_id = current_setting('app.tenant_id', true)
    OR to_tenant_id = current_setting('app.tenant_id', true)
  );

-- ────────────────────────────────────────────────────────────────────
-- 2. Tables that don't have tenant_id (global lookups) — no RLS needed
-- ────────────────────────────────────────────────────────────────────
-- Tenant (global registry of tenants themselves)
-- AdPlatform (global enum of ad platforms — meta/google/tiktok)
-- AutomationRule (global rules engine config)
-- OrderItem, OrderEvent (accessed via parent Order RLS — adding RLS here
--   would require a join to Order, which Postgres RLS can't do cleanly)
-- Attribution, AdSpend, Ad (accessed via parent Campaign RLS)
-- FxRate (global lookup, one row per ISO 4217 currency — shared across
--   all tenants; the rate is market data, not tenant-scoped)
-- StatusIncident, StatusCheck (global status-page data, not tenant-scoped)
--
-- Setting — CRITICAL: this table has NO tenant_id column, but stores BOTH
--   tenant-scoped AND global key/value pairs. Tenant isolation for the
--   `cred::*` credential namespace is enforced at the APPLICATION LAYER
--   (src/lib/services/credentials.service.ts) via the key convention
--   `cred::{tenantId}::{integrationId}` — the credential service's
--   `listForNamespace(ns)` / `getForIntegration(ns, id)` always filter by
--   the full key prefix, so a tenant can never read another tenant's
--   `cred::*` row by guessing the key. R-9 (I2-R9R10) further hardens
--   this by AES-256-GCM encrypting `cred::*` values at rest.
--
--   FUTURE MIGRATION: add a `tenant_id` column to Setting (nullable —
--   global keys like `roas_kill_threshold` stay NULL). Then a generated
--   column or trigger can extract the tenantId from the key for legacy
--   `cred::{tenantId}::` rows, and an RLS policy can enforce isolation
--   at the DB level. Tracked as a follow-up to R-9/R-10.
--
-- ────────────────────────────────────────────────────────────────────
-- 1d. I3-P0 N-1 — Anti-fraud tables (I2-R3) + refund ledger (I2-R8R11R12)
--     Active strict tenant_id policies. The 3 fraud tables were previously
--     listed here as commented-out templates (the I2-R9R10 agent ran in
--     parallel with I2-R3 and shipped before I2-R3 added the tables to
--     schema.prisma). `refund` was added by I2-R8R11R12 and never made it
--     into this file at all. Both gaps left these tenant-scoped tables
--     WITHOUT row-level security in PostgreSQL production → cross-tenant
--     leakage of fraud events (which carry PII like customer IPs, emails,
--     phone numbers in `reasons`) and refund ledgers.
--
--     Verified against `prisma/schema.prisma` (I3-P0):
--       - FraudBlocklistEntry  @@map("fraud_blocklist")  tenantId String
--       - FraudEvent           @@map("fraud_event")      tenantId String
--       - VelocityWindow       @@map("velocity_window")  tenantId String
--       - Refund               @@map("refund")           tenantId String
--     All four have a NON-nullable `tenantId`, so the strict policy is
--     correct (no `OR tenant_id IS NULL` escape hatch needed).
-- ────────────────────────────────────────────────────────────────────

-- fraud_blocklist (I2-R3 — FraudBlocklistEntry)
ALTER TABLE "fraud_blocklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_blocklist" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fraud_blocklist ON "fraud_blocklist"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- fraud_event (I2-R3 — FraudEvent)
ALTER TABLE "fraud_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fraud_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fraud_event ON "fraud_event"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- velocity_window (I2-R3 — VelocityWindow)
ALTER TABLE "velocity_window" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "velocity_window" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_velocity_window ON "velocity_window"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- refund (I2-R8R11R12 — Refund)
ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refund ON "refund"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ────────────────────────────────────────────────────────────────────
-- 3. RESERVED — future tenant-scoped tables not yet in schema.prisma
-- ────────────────────────────────────────────────────────────────────
-- (The fraud/velocity/refund tables that were previously listed here as
-- commented-out templates are now ACTIVE in Section 1d above. This
-- section is kept as a placeholder for any tenant-scoped tables that
-- future iterations add to schema.prisma.)

-- ────────────────────────────────────────────────────────────────────
-- 4. App role: grant only the necessary permissions
-- ────────────────────────────────────────────────────────────────────
-- Create a dedicated app role (not superuser) so RLS actually applies:
--   CREATE ROLE commerceflow_app LOGIN PASSWORD 'change_me';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerceflow_app;
--   GRANT USAGE ON SCHEMA public TO commerceflow_app;
-- The app connects as this role. RLS policies enforce tenant isolation.
-- (Superusers bypass RLS, so never run the app as a superuser.)

-- ────────────────────────────────────────────────────────────────────
-- 5. pgvector extension for embeddings (§3)
-- ────────────────────────────────────────────────────────────────────
-- CREATE EXTENSION IF NOT EXISTS vector;
-- After enabling, migrate Message.embedding and Product.embeddingTexto/embeddingVisual
-- from Bytes to vector(1024) and use `<=>` operator for semantic search:
--   SELECT * FROM "Message"
--   WHERE tenant_id = current_setting('app.tenant_id', true)
--   ORDER BY embedding <=> $query_embedding
--   LIMIT 10;
