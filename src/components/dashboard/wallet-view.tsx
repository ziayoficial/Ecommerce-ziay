// ZIAY — Backward-compatibility barrel for the Wallet dashboard view.
//
// SPRINT8-VIEWS-SPLIT-001 split the original 1100-line wallet-view.tsx
// into focused sub-modules under `./wallet/`. This file re-exports the
// main `WalletView` component so any existing import of
// `@/components/dashboard/wallet-view` continues to resolve.

export { WalletView } from './wallet/index'
