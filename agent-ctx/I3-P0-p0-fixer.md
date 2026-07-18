# I3-P0 — p0-fixer (full-stack-developer)

**Task ID:** I3-P0
**Agent:** full-stack-developer (p0-fixer)
**Scope:** Fix the 2 most critical NEW issues from the Iteration 2 re-audit (`AUDITORIA-FINTECH-V2.md`).

## Issues being fixed

### N-1 (CRITICAL) — RLS missing for 4 new tables
- **File:** `prisma/sql/rls-policies.sql`
- **Problem:** `FraudBlocklistEntry` (`fraud_blocklist`), `FraudEvent` (`fraud_event`), `VelocityWindow` (`velocity_window`) were added to `schema.prisma` by I2-R3, and `Refund` (`refund`) was added by I2-R8R11R12. But the RLS SQL file (maintained by I2-R9R10) only had them as commented-out templates (Section 3, lines 340-365) or missing entirely (`refund`). In PostgreSQL production, these tables have NO row-level security → cross-tenant data leakage (fraud events with PII, refund ledgers).
- **Fix:** Add 4 ACTIVE policies using the existing strict `tenant_id = current_setting('app.tenant_id', true)` pattern. Remove the commented templates. Update the summary header to reflect 31 → 35 active policies.

### N-2 (HIGH) — Stripe webhook drops charge.refunded + charge.dispute.created
- **File:** `src/app/api/webhooks/stripe/route.ts`
- **Problem:** Webhook filters events with `type.startsWith('checkout.session.') || type.startsWith('payment_intent.')`. This DROPS:
  - `charge.refunded` → the Refund ledger sync (lines 359-399 of `payment-webhook-utils.ts`) never fires when refunds are initiated in the Stripe Dashboard directly.
  - `charge.dispute.created` → the fraud blocklist feedback loop (`fraudService.recordChargeback`) is never triggered from the Stripe webhook (only from the dedicated `/api/webhooks/chargeback` endpoint).
- **Fix:** Extend the handler to also accept `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. HMAC verification runs for ALL event types (unchanged — it happens before any type filtering).

## Context from previous agents (read from `/agent-ctx/`)
- **I2-R3** added the 3 fraud models to `schema.prisma` (with `@@map("fraud_blocklist")`, `@@map("fraud_event")`, `@@map("velocity_window")`) — all tenant-scoped (`tenantId String`, non-nullable).
- **I2-R9R10** maintained `prisma/sql/rls-policies.sql` and left the 3 fraud tables as templates in Section 3 (it explicitly noted in worklog: "The 3 fraud tables are NOT in the schema yet (parallel I2-R3 agent hasn't added them)").
- **I2-R8R11R12** added the `Refund` model (`@@map("refund")`, tenant-scoped). Did NOT touch the SQL.
- The RLS SQL uses `current_setting('app.tenant_id', true)` (NOT `app_current_tenant_id()`). I follow the existing file convention for consistency.
- `fraudService.recordChargeback(tenantId, orderId, reason)` is exported from `@/lib/services/fraud.service` and is already called from `/api/webhooks/chargeback/route.ts:249`.
- `Refund` model fields: `orderId`, `tenantId`, `amount`, `currency`, `reason`, `partial`, `status` (default 'pending'), `gatewayRef?`, `gatewayName?`, `initiatedBy`, `initiatedAt`, `processedAt?`, `failureNote?`.

## Implementation plan
1. Read all relevant files (worklog tail, audit V2, schema, RLS SQL, webhook route, fraud service, payment-webhook-utils, chargeback webhook).
2. Update `prisma/sql/rls-policies.sql` — add Section 1d with 4 active policies + remove commented templates in Section 3 + update header count.
3. Update `src/app/api/webhooks/stripe/route.ts` — add 3 new event-type branches.
4. Verify: `npx tsc --noEmit` → 0 errors; `bun run lint` → 0 errors; `grep -c "^CREATE POLICY"` → 35.
5. Append worklog entry.
