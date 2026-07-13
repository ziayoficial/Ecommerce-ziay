# STUBS-REAL-001 — Senior Fullstack Developer

## Scope
Replaced 7 adapter stubs with real HTTP implementations while preserving the
`EcommerceAdapter` and `LogisticsAdapter` interfaces verbatim.

## Files owned & modified
- `src/lib/adapters/woocommerce.ts`
- `src/lib/adapters/shopify.ts`
- `src/lib/adapters/supabase-catalog.ts`
- `src/lib/adapters/dropi.ts`
- `src/lib/adapters/99envios.ts`
- `src/lib/adapters/aveonline.ts`
- `src/lib/adapters/whatsapp-catalog.ts`

## Design decisions (apply uniformly to all 7)
1. **Constructor signature preserved.** Each constructor still accepts the same
   args as before; if args are empty strings, it reads from `process.env.*`.
   This keeps `registry.ts` (which passes empty strings) untouched and means
   production can configure via env without code changes.
2. **`hasCreds()` gate.** Every public method short-circuits to a private
   `local*` fallback when creds are missing.
3. **HTTP via `fetch` + `AbortController` 10s timeout.** One `private async
   http<T>(method, path, body)` helper per adapter. Non-2xx responses and
   network/abort errors are logged via `logger.warn(...)` and the helper
   returns `null` — callers then fall back to the local implementation.
4. **Graceful fallback when HTTP fails (not just when creds missing).** Each
   method tries HTTP, and on `null` result transparently falls back to the
   original stub behavior (local DB / hardcoded rate table). The agent never
   sees an error.
5. **Original TODO comments updated to "IMPLEMENTED"** with the real endpoint
   listed for each method.

## Per-adapter notes
- **WooCommerce**: Basic Auth (`consumerKey:consumerSecret`), `?sku=` lookup for
  `obtenerProducto` and `actualizarInventario` (PUT on product ID). Estado WC
  mapped to internal (pending→pending_payment, processing→paid, completed→
  delivered, etc.). Order created in WC also persisted as mirror in our
  `Order` table with `number = WC-{wcId}` so `obtenerEstadoPedido` can map
  internal ID → WC ID.
- **Shopify**: `X-Shopify-Access-Token` header, Admin REST API 2024-10.
  `line_items` use `title`+`price`+`quantity` (custom line items) because we
  don't store Shopify `variant_id` in our `Product` mirror. Inventory adjust
  uses `/inventory_levels/adjust.json` with delta; falls back to local DB if
  no `inventory_item_id` or `location_id`.
- **Supabase**: PostgREST with `apikey` + `Authorization: Bearer` headers.
  `?or=(name.ilike.*q*,nombre.ilike.*q*,sku.ilike.*q*)` for robust search.
  In `modo='cliente'` (read-only), `crearPedido`/`actualizarInventario` only
  touch the local núcleo (preserves Saramantha §8.4 contract).
- **Dropi / 99envios / Aveonline**: Each reads its API key from env. On HTTP
  success, normalizes the carrier name via existing `normalizeCarrierName()`
  helper. On HTTP failure or missing key, falls back to the original hardcoded
  rate table (kept verbatim, including city maps and carrier heuristics).
  `reportarNovedad` always persists to `Shipment` table (catches errors
  silently with `.catch(() => {})`) regardless of whether the API call
  succeeded.
- **WhatsApp Catalog**: Meta Graph API v18.0. `crearPedido` is local-only
  (WA Catalog has no orders endpoint) — same behavior as the original stub,
  with the order persisted in our núcleo. `actualizarInventario` POSTs to
  `/{catalogId}/products` with `retailer_id` + `inventory` (requires
  `WHATSAPP_CATALOG_ID` env var; otherwise falls back to local DB).
  `obtenerEstadoPedido` returns the local núcleo order state (interface
  doesn't allow `null`, so returning local state is the safe choice — agent
  gets real info even though WA Catalog itself has no concept of orders).

## Quality gates
- `npx tsc --noEmit` → **0 errors** ✅
- `bun run lint` (eslint .) → **0 errors, 0 warnings** ✅
- `bunx vitest run` → **6 test files, 65 tests passed, 0 failed** ✅
- Dev server still running on port 3000 (Ready in 92ms).

## Notes for future agents
- The `EcommerceAdapter` and `LogisticsAdapter` interfaces in
  `ecommerce-adapter.ts` / `logistics-adapter.ts` were **NOT** modified.
- `registry.ts` was NOT modified — it still passes empty strings to the
  adapter constructors; the adapters now self-resolve creds from env.
- Each adapter file now contains a `private async http<T>(...)` helper. If
  you add a new method that needs HTTP, use that helper — it already handles
  timeout, error logging, and graceful null-on-failure.
- The `buildItemsData` and `itemsNonEmpty` helpers are duplicated in each
  ecommerce adapter (woocommerce/shopify/supabase-catalog) rather than
  extracted to a shared module — this was intentional to keep each adapter
  file self-contained per the task's "FILE SCOPE — You own ONLY these 7
  files" rule. If a shared helper module is desired later, refactor to
  `src/lib/adapters/_shared.ts` (out of scope here).
- All HTTP error logging is `logger.warn` (not `logger.error`) — failures are
  expected in production (tenants without creds configured) and the fallback
  handles them gracefully, so they don't warrant error-level alerting.
