-- ─────────────────────────────────────────────────────────────────────────────
-- ZIAY — PostgreSQL-specific supplementary migration
-- Task: SPRINT7-POSTGRES-SERVICES-001
-- ─────────────────────────────────────────────────────────────────────────────
-- PURPOSE
--   `0_init/migration.sql` is provider-flavored (dev = SQLite). When you flip
--   the datasource in `prisma/schema.prisma` to `postgresql` and run
--   `bun run db:migrate`, Prisma emits a fresh PostgreSQL dialect of `0_init`.
--   This file is the follow-on migration that lands the production-only
--   optimizations that Prisma doesn't generate for you:
--     1. Idempotent re-statement of every @@index / @@unique from the schema
--        (using `IF NOT EXISTS` so re-running is safe; useful as a forcing
--        function if any index was dropped during a partial restore).
--     2. Row-Level Security policies on the 10 most critical tenant-scoped
--        tables (extracted verbatim from `src/lib/rls.ts` → RLS_SQL_POLICIES).
--     3. pgvector extension bootstrap (commented out — uncomment when adding
--        semantic-search columns like `embedding vector(1536)`).
--
-- APPLY ORDER (PostgreSQL deploy)
--   1. `prisma/schema.prisma` → provider = "postgresql"
--   2. `bun run db:migrate`          (applies 0_init + this file)
--   3. `bunx prisma db seed`
--   4. Verify: `psql -d ziay -c "SELECT COUNT(*) FROM \"Tenant\";"`
--
-- DEV SAFETY
--   This migration is a no-op on SQLite — `IF NOT EXISTS` + `ENABLE ROW LEVEL
--   SECURITY` are PostgreSQL syntax. Prisma skips it automatically when the
--   provider is `sqlite`. DO NOT run this against SQLite manually.
-- ─────────────────────────────────────────────────────────────────────────────

-- Optional: pgvector extension for semantic search / RAG embeddings.
-- Uncomment when the schema gains `Bytes?` / `Unsupported("vector")` columns.
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. IDEMPOTENT INDEX RE-STATEMENT (every @@index / @@unique in schema.prisma)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_number_key" ON "Order"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "VolumePrice_tenantId_productId_tipoCliente_cantidadMinima_key" ON "VolumePrice"("tenantId", "productId", "tipoCliente", "cantidadMinima");
CREATE UNIQUE INDEX IF NOT EXISTS "SalesSpeech_tenantId_perfil_key" ON "SalesSpeech"("tenantId", "perfil");
CREATE UNIQUE INDEX IF NOT EXISTS "Objection_tenantId_tipoObjecion_key" ON "Objection"("tenantId", "tipoObjecion");
CREATE UNIQUE INDEX IF NOT EXISTS "ThemeDesign_tenantId_tema_key" ON "ThemeDesign"("tenantId", "tema");
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryCombo_tenantId_categoria_key" ON "CategoryCombo"("tenantId", "categoria");
CREATE UNIQUE INDEX IF NOT EXISTS "AdPlatform_name_key" ON "AdPlatform"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Ad_externalId_key" ON "Ad"("externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "AdSpend_adId_date_key" ON "AdSpend"("adId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "Carrier_tenantId_nombreCanonico_key" ON "Carrier"("tenantId", "nombreCanonico");
CREATE UNIQUE INDEX IF NOT EXISTS "Setting_key_key" ON "Setting"("key");
CREATE INDEX IF NOT EXISTS "CustomerScore_tenantId_idx" ON "CustomerScore"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerScore_tenantId_phone_key" ON "CustomerScore"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "CarrierScore_tenantId_idx" ON "CarrierScore"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "CarrierScore_tenantId_carrierName_key" ON "CarrierScore"("tenantId", "carrierName");
CREATE INDEX IF NOT EXISTS "GuideTracking_tenantId_idx" ON "GuideTracking"("tenantId");
CREATE INDEX IF NOT EXISTS "GuideTracking_tenantId_guideNumber_idx" ON "GuideTracking"("tenantId", "guideNumber");
CREATE INDEX IF NOT EXISTS "GuideMovement_tenantId_guideNumber_idx" ON "GuideMovement"("tenantId", "guideNumber");
CREATE INDEX IF NOT EXISTS "GuideMovement_tenantId_idx" ON "GuideMovement"("tenantId");
CREATE INDEX IF NOT EXISTS "BuyerBehavior_tenantId_idx" ON "BuyerBehavior"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "BuyerBehavior_tenantId_phone_key" ON "BuyerBehavior"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "BehaviorAlert_tenantId_idx" ON "BehaviorAlert"("tenantId");
CREATE INDEX IF NOT EXISTS "ConversationalCart_tenantId_idx" ON "ConversationalCart"("tenantId");
CREATE INDEX IF NOT EXISTS "ConversationalCart_conversationId_idx" ON "ConversationalCart"("conversationId");
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem"("cartId");
CREATE UNIQUE INDEX IF NOT EXISTS "NovedadCase_caseNumber_key" ON "NovedadCase"("caseNumber");
CREATE INDEX IF NOT EXISTS "NovedadCase_tenantId_idx" ON "NovedadCase"("tenantId");
CREATE INDEX IF NOT EXISTS "NovedadCase_tenantId_status_idx" ON "NovedadCase"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "NovedadEvidence_caseId_idx" ON "NovedadEvidence"("caseId");
CREATE INDEX IF NOT EXISTS "NovedadMessage_caseId_idx" ON "NovedadMessage"("caseId");
CREATE INDEX IF NOT EXISTS "RedeliveryRequest_tenantId_idx" ON "RedeliveryRequest"("tenantId");
CREATE INDEX IF NOT EXISTS "RedeliveryRequest_tenantId_status_idx" ON "RedeliveryRequest"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "RedeliveryAttempt_redeliveryId_idx" ON "RedeliveryAttempt"("redeliveryId");
CREATE INDEX IF NOT EXISTS "ProductEnrichment_tenantId_idx" ON "ProductEnrichment"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductEnrichment_tenantId_sku_key" ON "ProductEnrichment"("tenantId", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "Trafficker_email_key" ON "Trafficker"("email");
CREATE INDEX IF NOT EXISTS "Trafficker_email_idx" ON "Trafficker"("email");
CREATE INDEX IF NOT EXISTS "TraffickerCampaign_traffickerId_idx" ON "TraffickerCampaign"("traffickerId");
CREATE INDEX IF NOT EXISTS "TraffickerCampaign_tenantId_idx" ON "TraffickerCampaign"("tenantId");
CREATE INDEX IF NOT EXISTS "TraffickerSale_traffickerId_idx" ON "TraffickerSale"("traffickerId");
CREATE INDEX IF NOT EXISTS "TraffickerSale_tenantId_idx" ON "TraffickerSale"("tenantId");
CREATE INDEX IF NOT EXISTS "TraffickerTransaction_traffickerId_createdAt_idx" ON "TraffickerTransaction"("traffickerId", "createdAt");
CREATE INDEX IF NOT EXISTS "TraffickerCompensation_tenantId_idx" ON "TraffickerCompensation"("tenantId");
CREATE INDEX IF NOT EXISTS "WalletTransaction_traffickerId_createdAt_idx" ON "WalletTransaction"("traffickerId", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletTransaction_tenantId_createdAt_idx" ON "WalletTransaction"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "WithdrawalRequest_traffickerId_idx" ON "WithdrawalRequest"("traffickerId");
CREATE INDEX IF NOT EXISTS "WithdrawalRequest_tenantId_idx" ON "WithdrawalRequest"("tenantId");
CREATE INDEX IF NOT EXISTS "WithdrawalRequest_status_idx" ON "WithdrawalRequest"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "TwoFactorConfig_traffickerId_key" ON "TwoFactorConfig"("traffickerId");
CREATE UNIQUE INDEX IF NOT EXISTS "TwoFactorConfig_tenantId_key" ON "TwoFactorConfig"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceListing_tenantId_idx" ON "MarketplaceListing"("tenantId");
CREATE INDEX IF NOT EXISTS "MarketplaceListing_active_idx" ON "MarketplaceListing"("active");
CREATE UNIQUE INDEX IF NOT EXISTS "LeadShareConfig_tenantId_key" ON "LeadShareConfig"("tenantId");
CREATE INDEX IF NOT EXISTS "LeadReferral_fromTenantId_idx" ON "LeadReferral"("fromTenantId");
CREATE INDEX IF NOT EXISTS "LeadReferral_toTenantId_idx" ON "LeadReferral"("toTenantId");
CREATE INDEX IF NOT EXISTS "PixelConfig_tenantId_idx" ON "PixelConfig"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "PixelConfig_tenantId_platform_key" ON "PixelConfig"("tenantId", "platform");
CREATE INDEX IF NOT EXISTS "ConversionEvent_tenantId_eventType_createdAt_idx" ON "ConversionEvent"("tenantId", "eventType", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversionEvent_pixelConfigId_idx" ON "ConversionEvent"("pixelConfigId");
CREATE INDEX IF NOT EXISTS "SEOConfig_tenantId_idx" ON "SEOConfig"("tenantId");
CREATE INDEX IF NOT EXISTS "GeoTarget_tenantId_idx" ON "GeoTarget"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "GeoTarget_tenantId_country_region_city_key" ON "GeoTarget"("tenantId", "country", "region", "city");
CREATE INDEX IF NOT EXISTS "RemarketingCampaign_tenantId_idx" ON "RemarketingCampaign"("tenantId");
CREATE INDEX IF NOT EXISTS "RemarketingMessage_tenantId_status_scheduledAt_idx" ON "RemarketingMessage"("tenantId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "CustomerNotification_tenantId_status_idx" ON "CustomerNotification"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "CustomerNotification_tenantId_scheduledAt_idx" ON "CustomerNotification"("tenantId", "scheduledAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROW-LEVEL SECURITY POLICIES
--    (extracted verbatim from src/lib/rls.ts → RLS_SQL_POLICIES)
--    Assumes `SET LOCAL app.tenant_id = '<cuid>'` is issued per request.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pgvector (optional — uncomment when adding embedding columns)
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE EXTENSION IF NOT EXISTS vector;
-- Example future column: ALTER TABLE "Product" ADD COLUMN "embedding" vector(1536);
-- Example future index : CREATE INDEX ON "Product" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
