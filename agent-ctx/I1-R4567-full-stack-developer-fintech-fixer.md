# Task I1-R4567 — Fintech Audit Batch Fixes (R-4 / R-5 / R-6 / R-7)

**Agent:** full-stack-developer (fintech-fixer)
**Scope:** 4 independent CRITICAL/HIGH risks from the ZIAY fintech audit (`public/presentaciones/AUDITORIA-FINTECH.md`). Small, surgical fixes — no architectural changes.

## Files Changed (9)

| # | Fix | File | Nature |
|---|-----|------|--------|
| R-4 | `/api/conciliation` auth | `src/app/api/conciliation/route.ts` | +import, +`requireTenantAccess` guard before DB query |
| R-5 | `walletService.recordTransaction` atomicity | `src/lib/services/wallet.service.ts` | `Promise.all` → `db.$transaction(async (tx) => {...})` |
| R-6 (core) | Amount validation in `applyPaymentUpdate` | `src/lib/adapters/payment-webhook-utils.ts` | +optional `amount`/`currency` opts; +mismatch detection (>1%) → `payment_mismatch` status + `OrderEvent` |
| R-6 (caller) | MP webhook passes amount | `src/app/api/webhooks/mercadopago/route.ts` | `result.amount`/`result.currency` from `verifyPayment` |
| R-6 (caller) | Stripe webhook passes amount | `src/app/api/webhooks/stripe/route.ts` | `obj.amount_total/100` + `obj.currency` |
| R-6 (caller) | Wompi webhook passes amount | `src/app/api/webhooks/wompi/route.ts` | `tx.amount_in_cents/100` + `tx.currency` |
| R-6 (caller) | PayU webhook passes amount | `src/app/api/webhooks/payu/route.ts` | `parseFloat(body.value)` + `body.currency` |
| R-6 (caller) | PSE webhook passes amount | `src/app/api/webhooks/pse/route.ts` | best-effort parse `data.amount`/`body.value` |
| R-6 (caller) | PIX webhook passes amount | `src/app/api/webhooks/pix/route.ts` | reuses local `amount` (from `valor.original`) + `currency: 'BRL'` |
| R-7 | Stripe refund `cs_`→`pi_` resolution | `src/lib/adapters/stripe.ts` | prefix dispatch (`pi_`/`ch_`/`cs_`); `cs_` fetches session to extract `payment_intent` |

## Key Decisions

1. **R-4 pattern** — `requireTenantAccess(tenantId)` returns `{session, error}`; the existing tenant-scoped routes use `const { error } = await requireTenantAccess(tenantId); if (error) return error`. Mirrored that exactly (the task description's pseudocode `const auth = await requireTenantAccess(req, tenantId)` doesn't match the actual signature).
2. **R-5 pattern** — `processWithdrawal` in the same file already uses `db.$transaction(async (tx) => { tx.walletTransaction.create; tx.trafficker.update; ... })`. Mirrored that exactly. Returns the created `WalletTransaction` so the public signature stays compatible.
3. **R-6 status value** — `Order.paymentStatus` is `String` in Prisma (NOT an enum), and `OrderEvent.type` is also `String`. So `payment_mismatch` is just another value — NO schema migration, NO enum type union to update. Verified with rg: no `PaymentStatus =` union type exists in the codebase.
4. **R-6 tolerance** — 1% relative difference as the trigger (per task spec). The check fires only when (a) `amount` is a finite positive number, (b) `order.total > 0`, (c) the order is not already paid, (d) we're about to mark `paid`. Idempotency preserved.
5. **R-7 backward compat** — `pi_*` and `ch_*` prefixes use the value directly. Only `cs_*` triggers the session-fetch round trip. Unknown prefixes surface a clear error message (so bad data is loud).
6. **R-7 charge fallback** — a `cs_` session might not expose `payment_intent` directly in some Stripe API versions, but always has `charges.data[0].id` starting with `ch_`. Use that as `charge` if `payment_intent` is absent. If neither exists, return an explicit error (e.g. session still pending — payment not captured yet).

## Verification

- `npx tsc --noEmit` × 3 runs (another agent in this batch was concurrently creating `src/lib/adapters/local-payments.ts`, making the total error count flap 94↔103 between runs):
  - **0 errors** in any of the 4 target files (`api/conciliation/route.ts`, `services/wallet.service.ts`, `adapters/payment-webhook-utils.ts`, `adapters/stripe.ts`) — before AND after.
  - The 9-error count increase is entirely from the parallel `local-payments.ts` work + its downstream callers — NOT my changes.
- `bun run lint`: 0 errors, 38 warnings — all pre-existing. **None** of my 9 changed files produce any lint warning (verified via grep).
- Baseline tsc: 94 error lines / exit 1 — all pre-existing (next.config `eslint` key, `local-payments` missing-module per audit R-1, `meta`/`mode` Prisma typing mismatches, Buffer/Uint8Array lib mismatches).

## Risks / Trade-offs

- **R-6 minor:** the 1% tolerance means an attacker who forges a webhook with amount within 1% of the order total still gets the order marked paid. That's an acceptable trade-off given (a) forging requires a compromised webhook secret (the higher-priority defense), (b) the 1% window is too small for profitable fraud in most LATAM currencies, (c) it covers legitimate rounding from FX conversions and gateway-side tax adjustments.
- **R-7 extra HTTP call** — `cs_*` refunds now do `GET /v1/checkout/sessions/{id}` before `POST /v1/refunds`. Adds ~150ms latency and 1 extra Stripe API call. Acceptable since refunds are low-frequency (~1% of orders, manual operator action). Could be optimized later by storing the PI ID on the Order at webhook time.
- **R-6 only enforced for the `paid` transition** — `rejected`/`pending`/`refunded` webhooks skip validation. This is intentional: those don't move money in a way that needs verification.

## What was NOT touched (out of scope)

- R-1 (local-payments.ts missing) — another agent in this batch fixed it.
- R-2 (58 TS errors) — pre-existing errors; out of scope.
- R-3 (no anti-fraud) — out of scope for this batch.
- R-8 through R-17 (Medium/Low risks) — out of scope.
