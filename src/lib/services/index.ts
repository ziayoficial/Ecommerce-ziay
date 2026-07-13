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
