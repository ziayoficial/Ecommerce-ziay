# CREDENTIALS-001 — Credential management system

**Task ID**: CREDENTIALS-001
**Agent**: senior-fullstack-developer
**Date**: 2026-01-13
**Status**: ✅ Complete

## Scope

Built a complete credential management system for the 21 ZIAY adapters (catalog, logistics, payments, ads, channels, AI). Before this work, adapters read credentials from `process.env` but there was no UI panel where users could enter them. Now credentials live in the `Setting` model under the `cred::` prefix and are managed via a masked REST API + a category-grouped collapsible panel inside `IntegrationsView`.

## Files

| File | Action | Purpose |
|---|---|---|
| `src/lib/adapters/credential-fields.ts` | NEW | Single source of truth for the 20-integration registry (`IntegrationConfig[]`), category metadata, and helpers `maskSecret`, `isIntegrationConfigured`, `getIntegrationsByCategory`, `getIntegrationById`. |
| `src/app/api/integrations/credentials/route.ts` | NEW | `GET / POST / DELETE` endpoint. All routes call `requireAuth()`. Stores values in `Setting` rows with key `cred::{integrationId}` and JSON-stringified field map. GET masks every value (`••••` + last4). POST whitelists field keys against the registry and merges with existing values (so callers can PATCH a single field). DELETE supports both whole-integration and single-field removal. |
| `src/components/dashboard/integrations-view.tsx` | MODIFIED | Added `CredentialPanel` + `CredentialCard` components below the existing `/api/health` table. Fetches state on mount, groups integrations by category (Catálogo / Logística / Pagos / Pauta / Canales / IA), each card is a `Collapsible` with show/hide password toggles, Guardar (POST) + Eliminar (DELETE) buttons, and masked re-display after save. |
| `.env.example` | NEW | Reference of every env var the system uses (DB, Auth, LLM, Catalog, Logistics, Payments, Ads, Channels, Webhooks, Monitoring, Chat). Documents that runtime credentials should live in the DB panel, with env vars as dev defaults only. |

## Key design decisions

1. **Mask-before-return** — every value returned by the API is masked with `maskSecret()` (`'••••' + last4`). The browser never sees raw secrets after a save; the only way to update a secret is to re-type it.
2. **Draft-state footgun avoided** — when a card expands, the input is seeded with the masked server value. On save, `buildSavePayload()` strips fields whose draft still equals the masked server value, so the user doesn't accidentally overwrite the stored secret with the literal string `"••••abcd"`.
3. **Whitelist on POST** — the API only accepts field keys declared in the registry for that integration, preventing callers from stuffing arbitrary keys into the Setting JSON.
4. **Merge semantics on POST** — POST merges with existing stored values (PATCH-style), so users can update a single field without resending the whole payload. Empty string clears a field.
5. **Category-aware UI** — `CATEGORY_ORDER` (catalog → logistics → payments → ads → channels → ai) drives the rendering order; each category header shows a `configured/total` badge.
6. **Auth everywhere** — `requireAuth()` is the first call in all 4 handlers (`GET / POST / DELETE / PUT`).

## Integrations covered (21 total)

- **Catalog (4)**: woocommerce, shopify, supabase, oracle
- **Logistics (3)**: dropi, 99envios, aveonline
- **Payments (4)**: mercadopago, wompi, stripe, payu
- **Ads (3)**: google_ads, tiktok_ads, meta_ads
- **Channels (3)**: whatsapp, messenger, instagram
- **AI (3)**: openai, xai, ollama

## Quality gates

- `npx tsc --noEmit` → **0 errors** ✅
- `bun run lint` → **0 errors** ✅
- Dev log inspected — only pre-existing next-auth JWT decryption noise (unrelated to this scope).

## Notes for future agents

- The API also exposes a `PUT` handler that returns the full registry (`INTEGRATION_REGISTRY`) for diagnostic purposes. The UI imports the registry directly (no need to call PUT), but the endpoint is there if a future admin tool wants it.
- The `Setting` model is tenant-agnostic. If per-tenant credentials are needed later, migrate the schema to add a `tenantId` column to `Setting` and update the `where` clause in all 4 handlers — the rest of the code is tenant-agnostic.
- The masking helper handles short values gracefully: `value.length <= 4` returns `'••••'` so we don't accidentally leak the full value when the secret is shorter than 4 chars.
