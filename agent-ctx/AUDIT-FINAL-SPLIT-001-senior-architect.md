# AUDIT-FINAL-SPLIT-001 — Split last 3 files >700 lines

## Scope
ZIAY had 3 source files >700 lines:
- `src/lib/services/wallet.service.ts` — 911 lines
- `src/components/dashboard/marketplace-view.tsx` — 770 lines
- `src/components/dashboard/logistics-intelligence-view.tsx` — 749 lines

This audit split all 3 and reaches 0 ZIAY-owned source files >700 lines.
(sidebar.tsx at 726 lines is a vendored shadcn/ui primitive, out of scope.)

## Final layout

### wallet split (lib/services)
- `wallet.service.ts` (388) — wallet balance, 2FA, accounts, withdrawals,
  record-transaction
- `trafficker.service.ts` (547) — trafficker registration, campaigns, sales,
  compensation, withdrawal requests
- `index.ts` re-exports both
- API routes updated: `/api/wallet` and `/api/trafficker` now import the
  correct service for each call

### marketplace split (components/dashboard/marketplace/)
- `marketplace-shared.tsx` (148) — types, `referralStatusMeta`, `ListingCard`, `EmptyState`
- `marketplace-listings.tsx` (141) — `CatalogTab` + `ReferButton`
- `marketplace-my.tsx` (103) — `MyListingsTab` + `ToggleActiveButton`
- `marketplace-referrals.tsx` (114) — `ReferralsTab` + `ReferralColumn`
- `index.tsx` (385) — `MarketplaceView` + `KpiCard` + `PublishListingDialog`
- `marketplace-view.tsx` (7) — barrel re-export

### logistics split (components/dashboard/logistics/)
- `logistics-shared.tsx` (100) — types, `categoryMeta`, `alertSeverity`, `severityMeta`
- `logistics-scores.tsx` (258) — `CustomerScoresTab` + `CarrierScoresTab`
- `logistics-guides.tsx` (117) — `StuckGuidesTab` + `StuckGuideRow`
- `logistics-alerts.tsx` (78) — `BehaviorAlertsCard`
- `index.tsx` (311) — `LogisticsIntelligenceView` + `KpiCard` + `AgentButton`
- `logistics-intelligence-view.tsx` (7) — barrel re-export

## Verification
- `bun run lint` — clean
- `npx tsc --noEmit` — clean
- `bunx vitest run` — 65/65 tests pass
- Dev server log: only `EADDRINUSE :::3000` (system auto-restart, not a build error)
- All UI/logic preserved verbatim — only file structure changes

## Rules followed
- UI byte-for-byte identical — only file structure changes
- State stays in `index.tsx`; sub-components receive props
- Relative imports within each new directory
- `@/...` alias preserved for cross-tree imports
- Original file paths (`marketplace-view.tsx`, `logistics-intelligence-view.tsx`)
  kept as 7-line barrel re-exports so `app/page.tsx` doesn't need to change
- `walletService` API surface preserved; new `traffickerService` exported
  from same `@/lib/services` barrel

## Migration plan for consumers
Existing `import { walletService } from '@/lib/services'` imports still work
because `walletService` is still exported. But the methods that moved to
`traffickerService` are no longer on `walletService`, so any consumer that
called `walletService.confirmSale()` etc. must update to
`traffickerService.confirmSale()`. Only the 2 route files
(`/api/wallet/route.ts` and `/api/trafficker/route.ts`) called the moved
methods — both were updated in this audit.
