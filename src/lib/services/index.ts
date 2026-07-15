// ZIAY — Service layer barrel export.
//
// All API routes should import services from here:
//
//   import { orderService, conversationService } from '@/lib/services'
//
// The service layer is the SINGLE seam between HTTP routes and Prisma.
// Routes own: auth, request parsing, response shaping. Services own:
// DB access, transactions, error capture, logging.
//
// SPRINT6-ARCH-001 — service layer foundation.
// Future sprints will migrate the 52 API routes from `db.*` → `xxxService.*`.

export { orderService } from './order.service'
export type { OrderService, OrderFilters } from './order.service'

export { conversationService } from './conversation.service'
export type {
  ConversationService,
  ConversationFilters,
  SendMessageInput,
} from './conversation.service'

export { catalogService } from './catalog.service'
export type { CatalogService, ProductUpsertInput } from './catalog.service'

export { novedadesService } from './novedades.service'
export type {
  NovedadesService,
  NovedadCaseFilters,
  CreateCaseInput,
} from './novedades.service'

export { adsService } from './ads.service'
export type { AdsService, AdPerformanceFilters } from './ads.service'

export { monetizationService, getTramo } from './monetization.service'
export type { MonetizationService } from './monetization.service'

export { logisticsService } from './logistics.service'
export type { LogisticsService } from './logistics.service'

export { marketplaceService } from './marketplace.service'
export type {
  MarketplaceService,
  PublishListingInput,
  CreateReferralInput,
} from './marketplace.service'

export { overviewService } from './overview.service'
export type { OverviewService } from './overview.service'

// SPRINT8-SERVICES-REST-001 — three new service files for the remaining
// domains that the 42 unmigrated API routes touch. Each owns a single
// bounded context: server-side pixel events, customer notifications, and
// the trafficker-wallet fintech layer.
export { conversionsService } from './conversions.service'
export type { ConversionsService } from './conversions.service'

export { notificationService } from './notification.service'
export type {
  NotificationService,
  CreateNotificationInput,
} from './notification.service'

export { walletService } from './wallet.service'
export type { WalletService } from './wallet.service'

// AUDIT-FINAL-SPLIT-001 — Trafficker operations (registration, campaigns,
// sales, compensation, withdrawal requests) split out of `wallet.service.ts`
// so both files stay under 700 lines. Wallet owns balance / 2FA / accounts /
// withdrawals / record-transaction; Trafficker owns the rest.
export { traffickerService } from './trafficker.service'
export type { TraffickerService } from './trafficker.service'

// SPRINT-BACKEND-FINAL-001 — additional service files migrated from inline
// route handlers. Each owns a single bounded context that was previously
// touched directly by `db.*` calls in the corresponding route.
export { remarketingService } from './remarketing.service'
export type { RemarketingService, CustomerPhoneLookup } from './remarketing.service'

export {
  credentialsService,
  resolveCredentialNamespace,
  credKeyPrefix,
  integrationIdToCredKey,
  credKeyToIntegrationId,
  maskAllCredentialFields,
  parseCredValue,
} from './credentials.service'
export type { CredentialsService } from './credentials.service'

export { agentsService } from './agents.service'
export type { AgentsService } from './agents.service'

export { channelsService, CHANNEL_UPDATABLE_FIELDS } from './channels.service'
export type { ChannelsService, CreateChannelInput } from './channels.service'

export { orchestrateService } from './orchestrate.service'
export type { OrchestrateService } from './orchestrate.service'

export { tenantsService } from './tenants.service'
export type { TenantsService } from './tenants.service'

export {
  paymentsConfigService,
  ALLOWED_PAYMENTS_SETTING_KEYS,
} from './payments-config.service'
export type { PaymentsConfigService } from './payments-config.service'
