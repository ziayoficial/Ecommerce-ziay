// ZIAY — Backward-compatibility barrel for the Integrations dashboard view.
//
// SPRINT8-VIEWS-SPLIT-001 split the original 956-line integrations-view.tsx
// into focused sub-modules under `./integrations/`. This file re-exports
// the main `IntegrationsView` component so any existing import of
// `@/components/dashboard/integrations-view` continues to resolve.

export { IntegrationsView } from './integrations/index'
