// ZIAY — Backward-compatibility barrel for the Novedades dashboard view.
//
// SPRINT3-REFACTOR-001 split the original 1296-line novedades-view.tsx
// into focused sub-modules under `./novedades/`. This file re-exports the
// main `NovedadesView` component so any existing import of
// `@/components/dashboard/novedades-view` continues to resolve.

export { NovedadesView } from './novedades/index'
