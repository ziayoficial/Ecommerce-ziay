# Task I2-R8R11R12 — full-stack-developer (dian+refund)

## Task
R-8 (DIAN NIT fix + retry job + retracto notice) + R-11 (admin refund endpoint) + R-12 (Refund model).

## What this agent did

### R-8 — DIAN invoicing fixes
1. **Schema additions** (`prisma/schema.prisma`):
   - `Tenant.nit String?` — tenant tax ID (NIT/CPF-CNPJ/RFC). Required in prod; optional in dev.
   - `Customer.documentNumber String?` — customer tax ID (NIT/cédula/CPF/RFC).
   - `Invoice.dianRetryCount Int @default(0)` + `Invoice.dianLastError String?` — retry tracking.
   - `Refund` model (R-12) added at end of schema.
   - `Order.refunds Refund[]` relation added.
2. **`generateDianInvoice` NIT resolution fix** (`src/lib/compliance/dian-invoicing.ts`):
   - `emitterNit` now reads `order.tenant?.nit`. In prod, throws if missing. In dev, falls back to `'000000000'` placeholder + warns.
   - `receiverNit` now reads `order.customer?.documentNumber`. Falls back to `'222222222'` (DIAN consumidor final placeholder) — NEVER the email.
3. **`submitToDian` enhanced**:
   - Returns new `submitted?: boolean` flag.
   - Persists `dianLastError` on every `submitted: false` branch.
   - Clears `dianLastError` on success.
4. **`retryPendingDianInvoices(tenantId?)`** function added:
   - Queries `pending_submission` invoices older than 5 min, limit 50/run.
   - On `submitted: true` → reset retry count.
   - On `submitted: false` → increment retry count. After 5 retries: mark `dianStatus='failed'` + create AuditLog entry for manual review (atomic `$transaction`).
   - Returns `{ processed, submitted, failed, permanentlyFailed, skipped }`.
5. **`POST /api/compliance/dian-retry` endpoint** (`src/app/api/compliance/dian-retry/route.ts`):
   - `requireRole(['admin'])` + tenant access.
   - Optional body `{ tenantId?: string }`.
   - TODO comment for BullMQ cron wiring.
6. **Retracto notice OrderEvent** (`src/app/api/payments/create-link/route.ts`):
   - After payment link is created, writes `OrderEvent type='retracto_notice'` with note about Ley 1480 Art 47.
   - Best-effort — wrapped in try/catch so it doesn't block the payment-link flow.

### R-11 — Admin/operator refund endpoint
- Created `POST /api/orders/[id]/refund` (`src/app/api/orders/[id]/refund/route.ts`):
  - `requireRole(['admin', 'operator'])` + `requireTenantAccess(order.tenantId)`.
  - Body: `{ amount?: number, reason: 'retracto'|'customer_request'|'fraud'|'duplicate'|'product_issue'|'other', note?: string }`.
  - Validates: order exists, `paymentStatus in ['paid','partial_refunded']`, amount > 0 and <= remaining.
  - Creates `Refund` row `status='pending'` BEFORE gateway call.
  - Calls `adapter.refund(order.paymentRef, amount)`.
  - On success: `$transaction` flips Refund to `'processed'`, sets `gatewayRef`/`processedAt`, creates `OrderEvent type='refunded'` with structured JSON note, and flips `order.paymentStatus='refunded'` if full refund.
  - On failure: `$transaction` flips Refund to `'failed'` + `failureNote`, creates `OrderEvent type='refund_failed'`. Returns 502.

### R-12 — Refund model + GET endpoint + webhook sync
- Added `Refund` model to schema.
- Created `GET /api/orders/[id]/refunds` (`src/app/api/orders/[id]/refunds/route.ts`):
  - `requireRole(['admin', 'operator', 'finance'])` (finance can read, not initiate — separation of duties).
  - Returns `{ refunds, total, currency, refundedAmount, remaining }` where `refundedAmount = sum of processed refunds`.
- Updated `applyPaymentUpdate` (`src/lib/adapters/payment-webhook-utils.ts`):
  - When `newStatus === 'refunded'`, looks up a matching `Refund` by `gatewayRef` or (fallback) `orderId + status='pending'`.
  - If found + pending → flips to `'processed'`, sets `gatewayRef`, `processedAt`.
  - Best-effort — separate try/catch so it doesn't roll back the order update.

## Verification
- `npx tsc --noEmit`: 0 errors (exit 0).
- `bun run lint`: 0 errors, 37 pre-existing warnings — ZERO new warnings on any of the 6 changed/created files.
- `bun run db:push`: schema applied cleanly, Prisma Client + ER diagram regenerated.
- Dev server: clean boot, no compile errors in dev.log.

## Files modified (5)
1. `prisma/schema.prisma`
2. `src/lib/compliance/dian-invoicing.ts`
3. `src/app/api/payments/create-link/route.ts`
4. `src/lib/adapters/payment-webhook-utils.ts`
5. (no other modifications — the 3 new files are listed below)

## Files created (3)
1. `src/app/api/compliance/dian-retry/route.ts` (POST /api/compliance/dian-retry)
2. `src/app/api/orders/[id]/refund/route.ts` (POST /api/orders/[id]/refund)
3. `src/app/api/orders/[id]/refunds/route.ts` (GET /api/orders/[id]/refunds)

## New Prisma models
- `Refund` (id, orderId, tenantId, amount, currency, reason, partial, status, gatewayRef, gatewayName, initiatedBy, initiatedAt, processedAt, failureNote; `@@map("refund")`; indexes on `[tenantId, initiatedAt]`, `[orderId]`, `[gatewayRef]`).

## New Prisma fields
- `Tenant.nit String?`
- `Customer.documentNumber String?`
- `Invoice.dianRetryCount Int @default(0)`
- `Invoice.dianLastError String?`
- `Order.refunds Refund[]` (relation)

## New endpoints
- `POST /api/compliance/dian-retry` — admin-only manual trigger for the DIAN retry batch.
- `POST /api/orders/[id]/refund` — admin/operator refund initiation.
- `GET /api/orders/[id]/refunds` — admin/operator/finance refund list per order.

## Notes for next agents
- The DIAN retry is manual-only today. The TODO in `dian-retry/route.ts` mentions wiring to BullMQ cron (`dian-retry` queue, `*/10 * * * *`) — ADR-0014 covers the queue backlog decision.
- The `submitToDian` return type now includes an optional `submitted` flag. The existing `/api/compliance/dian-invoice/[invoiceId]/submit` route spreads `...result` so the new flag is transparently passed through to the response body without breaking the existing API contract.
- The Stripe adapter `refund()` already handles `cs_`/`pi_`/`ch_` prefix resolution (R-7 fix from I1-R4567) — the new `/api/orders/[id]/refund` endpoint depends on this for Stripe orders.
- The Refund webhook sync in `applyPaymentUpdate` falls back to `orderId + status='pending'` because some gateways (notably MercadoPago) send the original payment ID in the refund webhook instead of the refund ID. This is safe because the `/refund` POST endpoint serializes via the `remaining` budget check (at most one pending refund per order at a time).
