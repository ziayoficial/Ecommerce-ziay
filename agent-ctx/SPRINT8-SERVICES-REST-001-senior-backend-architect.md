# SPRINT8-SERVICES-REST-001 — senior-backend-architect

## TL;DR
- ✅ 17 additional API routes migrated from `db.*` to `xxxService.*` (on top of the 10 from SPRINT7). Total now: **27 of 38** routes use the service layer.
- ✅ 3 new service files created (`conversions.service.ts`, `notification.service.ts`, `wallet.service.ts`) — at the cap of 3 new files.
- ✅ 22 new service methods added across existing services (ads, catalog, logistics, novedades, marketplace).
- ✅ 10 routes left inline with `// TODO: migrate to service layer` comments + documented rationale.
- ✅ `bun run lint` → exit 0
- ✅ `npx tsc --noEmit` → exit 0 (clean)
- ✅ `bunx vitest run` → 6 files, 65 tests, all passing (no regressions)

## Files created

### New service files (3 — at the cap)
1. `src/lib/services/conversions.service.ts` — wraps `ConversionEvent` + `PixelConfig` for the server-side pixel firing flow (`/api/conversions`). Methods: `getEvents`, `getActivePixels`, `createEvent`, `getEventsByIds`.
2. `src/lib/services/notification.service.ts` — wraps `CustomerNotification` + auto-generation from `GuideTracking` (`/api/notifications`). Methods: `getNotifications`, `createNotification`, `updateStatus`, `cancelPendingBefore`, `autoGenerateShippingUpdates`.
3. `src/lib/services/wallet.service.ts` — wraps the entire fintech surface (`Trafficker`, `WalletTransaction`, `WalletAccount`, `WithdrawalRequest`, `TwoFactorConfig`, `TraffickerSale`, `TraffickerCompensation`, `TraffickerCampaign`, `TraffickerTransaction`). Used by `/api/wallet` AND `/api/trafficker` (shared service, two routes). ~25 methods including atomic transactions for `processWithdrawal`, `confirmSale`, `failSale`, `requestWithdrawal`.

### Barrel export updated
- `src/lib/services/index.ts` — added exports for the 3 new services + types.

## Files modified — service methods added

- `src/lib/services/ads.service.ts` — **1 new method**: `findAdByExternalId(externalId)` for `/api/ads/import`.
- `src/lib/services/catalog.service.ts` — **3 new methods**: `getActiveProductsForEnrichment`, `getEnrichments`, `upsertEnrichment` (for `/api/product-enrichment`). ProductEnrichment is a 1:1 extension of Product — same domain.
- `src/lib/services/logistics.service.ts` — **6 new methods**: `getGuideMovements`, `createGuideMovement` (with best-effort Shipment cascade), `getOrderForShipment`, `persistShipmentGuide` (Shipment + Order + OrderEvent + AuditLog writes), `getBuyerBehaviors`, `upsertBuyerBehavior` (with conditional BehaviorAlert). GuideMovement extends GuideTracking — same domain. BuyerBehavior powers the customer-score panel — same domain.
- `src/lib/services/novedades.service.ts` — **10 new methods**: 9 redelivery methods (`getRedeliveryRequests`, `createRedeliveryRequest`, `getRedeliveryRequestForUpdate`, `confirmRedeliveryAddress`, `scheduleRedeliveryAttempt`, `assignRedeliveryHuman`, `completeRedelivery`, `cancelRedelivery`, `addRedeliveryAttempt`) + `updateCaseFields` (for PATCH `/api/novedades/[id]`). RedeliveryRequest is the natural extension of the Novedades CRM (failed shipments → re-delivery attempts).
- `src/lib/services/marketplace.service.ts` — **2 new methods**: `getTenantBrands(tenantIds)` for brand hydration, `getCurrentTenantProfile(tenantId)` for the "your brand" card.

## API routes migrated (17)

### Direct swaps (5) — existing service method matched 1:1
1. `/api/overview` GET → `overviewService.getKPIs` (deleted the entire inline `computeOverview` function).
2. `/api/monetization/generate-invoice` POST → `monetizationService.generateInvoice`.
3. `/api/catalog/send-to-chat` POST → `catalogService.sendToChat`.
4. `/api/ads/[id]` PATCH → `adsService.updateAd`.
5. `/api/novedades/[id]` GET + PATCH → `novedadesService.getCaseById` + `updateCaseFields`.

### Complex migrations (12) — required new service methods
6. `/api/conversions` GET + POST → `conversionsService.getEvents` / `getActivePixels` / `createEvent` / `getEventsByIds` (4 db call sites migrated).
7. `/api/guide-movements` GET + POST → `logisticsService.getGuideMovements` / `createGuideMovement` (2 db call sites + best-effort Shipment cascade).
8. `/api/redelivery` GET + POST + PATCH (6 actions) → `novedadesService` redelivery methods (10+ db call sites migrated, 5 transactions preserved).
9. `/api/wallet` GET + POST (6 actions) → `walletService.getWalletDashboard` / `getTwoFactorConfig` / `upsertTwoFactorSetup` / `enableTwoFactor` / `registerWalletAccount` / `getWalletAccount` / `createWithdrawalRequest` / `getWithdrawalRequest` / `processWithdrawal` / `recordTransaction` (20+ db call sites migrated).
10. `/api/product-enrichment` GET + POST → `catalogService.getEnrichments` / `getActiveProductsForEnrichment` / `getProductBySku` / `upsertEnrichment` (3 db call sites migrated).
11. `/api/notifications` GET + POST (5 actions) → `notificationService.getNotifications` / `createNotification` / `updateStatus` / `cancelPendingBefore` / `autoGenerateShippingUpdates` (8+ db call sites migrated).
12. `/api/shipping/guide` POST → `logisticsService.getOrderForShipment` / `persistShipmentGuide` (6 db call sites migrated; 1 tiny `db.tenant.findUnique` left inline for `proveedorLogistico` per rule #2).
13. `/api/trafficker` GET + POST (6 actions: register, create_campaign, register_sale, confirm_sale, fail_sale, withdraw) → `walletService.getTraffickerProfile` / `getSalesStats` / `createTrafficker` / `getTraffickerByEmail` / `getTraffickerById` / `createCampaign` / `getCampaignForTrafficker` / `registerSale` / `getSaleWithCampaign` / `confirmSale` / `failSale` / `requestWithdrawal` / `getWalletAccount` (30+ db call sites migrated, 3 transactions preserved atomically).
14. `/api/marketplace` GET + POST (3 actions) → `marketplaceService.getListings` / `getMyListings` / `getLeadConfig` / `getReferrals` / `getCurrentTenantProfile` / `getTenantBrands` / `publishListing` / `upsertLeadConfig` / `createReferral` (6 db call sites in GET + 3 in POST migrated).
15. `/api/buyer-behavior` GET + POST → `logisticsService.getBuyerBehaviors` / `upsertBuyerBehavior` (3 db call sites migrated + 1 conditional alert).
16. `/api/ads/import` POST → `adsService.findAdByExternalId` + batched `adsService.importAdSpend` (per-ad `db.ad.findUnique` + `db.adSpend.upsert` loop replaced with N lookups + 1 batched `$transaction`).
17. `/api/payments/create-link` POST → `orderService.getOrderById` + `orderService.updateOrder` (with audit event — single `$transaction` instead of 3 sequential writes).

## APIs left inline (10) — each has a `// TODO: migrate to service layer` comment + rationale

| Route | Reason | Rule |
|---|---|---|
| `/api/agents` | No db calls (static AGENT_NAMES + withCache). | n/a |
| `/api/route` | No db calls (Hello world). | n/a |
| `/api/agents/[agentName]` | 2 side-effect writes after LLM (profile detection + vision JSON persist). | #2 |
| `/api/orchestrate` | 1-2 db calls per pipeline invocation (tenant lookup + profile update); flow is dominated by 9 LLM calls. | #2 |
| `/api/tenants` | 1 cached `db.tenant.findMany` — cache key encodes the only input. | #2 |
| `/api/payments/config` | Each method touches ≤ 2 unrelated tables (Channel + Setting). | #2 |
| `/api/shipping/quote` | 1 `db.auditLog.create` after adapter call. | #2 |
| `/api/integrations/credentials` | Setting table only (key/value JSON blob) — per SPRINT7 architect note "Settings is a tiny key/value table, not worth a service on its own". | #2 |
| `/api/ai-reply` | 2 db calls for LLM context loading (conversation + product); existing service methods have side-effects (clear unread) or shape mismatches (no `take` limit). | #2 |
| `/api/channels` | Each method ≤ 2 db calls (Channel write + AuditLog insert). No other caller shares the read paths. | #2 |
| `/api/catalog/sync` | 2 simple reads (tenant existence + audit log read-back) sandwiching an `enqueue('catalog-sync')` call. The actual product upsert already uses `catalogService.syncCatalog` in the queue worker. | #2 |
| `/api/remarketing` | Most handlers do 1-2 db calls. `auto_generate` is complex but route-internal (no shared caller). Excluded due to 3-new-service-file cap. | #2 + cap |

## Verification

```bash
$ bun run lint
$ # exit 0 — clean

$ npx tsc --noEmit
$ # exit 0 — no output

$ bunx vitest run --reporter=dot
  Test Files  6 passed (6)
       Tests  65 passed (65)
    Duration  1.75s
```

## Notes for future agents

- **All 17 migrated routes preserve the exact response shape** — the only thing that moved is the DB access seam. No frontend changes required.
- **All 3 atomic transactions preserved**: `walletService.processWithdrawal` (balance + txn + withdrawal + audit), `walletService.confirmSale` / `failSale` (sale status + wallet credit + transaction record + audit), `novedadesService.scheduleRedeliveryAttempt` / `completeRedelivery` / `cancelRedelivery` / `addRedeliveryAttempt` (request + latest attempt).
- **The 3-new-service-file cap was hit.** Future sprints that need a 4th service (e.g. `remarketing.service.ts`, `channel.service.ts`, `setting.service.ts`) should re-evaluate whether any of the existing services can absorb the new methods. The strongest candidates for promotion to their own service files are:
  - `remarketing.service.ts` — when the queue worker (background sender) is added, it'll be the second caller of the auto-generate logic.
  - `channel.service.ts` — when channel verification flows (WhatsApp business verification, Messenger webhook subscription) are added.
  - `setting.service.ts` — when more `Setting` key prefixes (`feature::*`, `policy::*`) accumulate beyond the existing `cred::*`.
- **`adsService.findAdByExternalId` includes `campaign.tenantId`** so the route can do the cross-tenant guard without a second lookup.
- **`logisticsService.persistShipmentGuide` does NOT use `$transaction`** by design — the carrier adapter has already pushed the guide to the carrier by the time we get here, so a rollback wouldn't un-generate the carrier-side guide. This matches the pre-migration behaviour.
- **`notificationService.autoGenerateShippingUpdates` preserves the `customerPhone: carrierName || 'unknown'` quirk** from the pre-migration route — the field was being mis-used as a carrier-name slot. Left as-is for backward compat with the UI; flagged for cleanup in a future sprint.
- **`walletService` is shared by `/api/wallet` AND `/api/trafficker`** — both routes were migrated in the same sprint to avoid a half-migration where one route still touches `db.trafficker.*` while the other uses the service. This is the strongest argument for the service layer: two HTTP entry points sharing one DB seam.
