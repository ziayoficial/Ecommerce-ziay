# ADR-0021: Escrow for Marketplace Transactions

**Status:** Proposed
**Date:** 2026-07-22

## Context

ZIAY's marketplace feature (`src/lib/services/marketplace.service.ts`,
`src/components/dashboard/marketplace/`) lets a trafficker list a
seller's product; when a buyer pays, the seller earns the sale price
minus the platform commission. Today the buyer's payment is captured
directly by the seller's connected gateway account (or routed through
the platform's gateway account with a split). The seller is paid out
immediately (next payout cycle) regardless of whether the buyer ever
receives the goods.

AUDIT-FINTECH R-18 flagged this as a gap: there is **no escrow**
(custodia) mechanism. Marketplace transactions in LATAM routinely
need escrow to:

1. **Protect the buyer** — hold funds until delivery is confirmed (or
   the auto-release window elapses). If the seller never ships, the
   funds are refunded to the buyer without the seller being able to
   spend them first.
2. **Protect the platform** — avoid being the unwilling guarantor when
   a buyer disputes a non-delivery. With escrow the platform can point
   to the `EscrowHolding` row showing funds were held + the release
   condition (delivery confirmation) wasn't met.
3. **Comply with consumer-protection law** — Ley 1480 de 2011 Art 54
   (Colombia), CPF BACEN Resolução 4.658/2018 (Brazil), and PROFECO
   (México) all require that funds for undelivered goods be returned
   to the consumer. Escrow makes this mechanically enforceable rather
   than a manual ops process.

Without escrow, the platform today has only two refund paths:
- **Admin-initiated refund** (`POST /api/orders/[id]/refund`) — calls
  `adapter.refund()` against the original capture. This works only if
  the gateway hasn't already settled the funds to the seller's bank
  account (typically T+1 to T+2 for LATAM gateways). After settlement
  the platform eats the refund cost.
- **Retracto refund** (`processRetracto()`) — fires automatically
  within the 5-day window. Same settlement-window constraint.

Both paths fail when the seller has already withdrawn the funds. The
result is a manual dispute-resolution process with no mechanical
guarantee of recovery — a fintech auditor's red flag.

## Decision (Proposed)

Introduce an `EscrowHolding` model + a release/refund workflow that
holds buyer funds in a virtual escrow account until delivery is
confirmed (or a 7-day auto-release timer elapses without dispute).
**This ADR documents the design only — implementation is deferred to
a follow-up sprint.**

### Data model

```prisma
model EscrowHolding {
  id              String   @id @default(cuid())
  orderId         String   @unique
  tenantId        String
  traffickerId    String?  // seller — nullable for tenant-direct sales
  buyerCustomerId String
  amount          Float    // amount held, in major currency unit
  currency        String   // ISO 4217
  commissionAmount Float   // platform commission (released to platform wallet)
  sellerAmount    Float    // amount released to seller (amount - commission)
  // 'holding'   — funds captured, waiting for release/refund
  // 'released'  — delivery confirmed (or auto-release timer elapsed),
  //                seller wallet credited
  // 'refunded'  — delivery failed / dispute resolved in buyer's favor,
  //                buyer refunded via gateway
  // 'disputed'  — buyer opened a dispute; held for manual review
  status          String   @default("holding")
  heldAt          DateTime @default(now())
  releasedAt      DateTime?
  refundedAt      DateTime?
  disputeOpenedAt DateTime?
  // ISO 8601 timestamp — funds auto-release to seller at this point
  // unless the buyer has opened a dispute. Default 7 days from `heldAt`.
  autoReleaseAt   DateTime
  // JSON: { deliveryConfirmedBy, deliveryConfirmedAt, proofUrl, ... }
  releaseConditions String?
  // JSON: { disputeReason, disputeOpenedBy, resolution, ... }
  disputeMetadata   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  order           Order      @relation(fields: [orderId], references: [id])
  tenant          Tenant     @relation(fields: [tenantId], references: [id])
  trafficker      Trafficker? @relation(fields: [traffickerId], references: [id])

  @@index([tenantId, status])
  @@index([traffickerId])
  @@index([autoReleaseAt])
  @@index([status])
}
```

### Release workflow (delivery confirmed → release to seller)

```
Order.paymentStatus = 'paid'
  → EscrowHolding created with status='holding', autoReleaseAt = now + 7d
  → funds captured by gateway but NOT settled to seller wallet

Order.status = 'delivered' (set by logistics webhook or operator)
  → releaseEscrow(orderId) called
  → status='released', releasedAt=now
  → WalletTransaction created: inbound 'escrow_release' for seller
     (amount = sellerAmount = order.total - commissionAmount)
  → WalletTransaction created: inbound 'commission' for platform
     (amount = commissionAmount)
  → Order.paymentStatus stays 'paid' (escrow is internal ledger state)
  → OrderEvent created: 'escrow_released'
```

### Refund workflow (delivery failed → refund to buyer)

```
Order.status = 'returned' OR buyer opens dispute + admin resolves in buyer favor
  → refundEscrow(orderId) called
  → status='refunded', refundedAt=now
  → adapter.refund(order.paymentRef, amount) called against original capture
  → On success: Order.paymentStatus = 'refunded'
  → OrderEvent created: 'escrow_refunded'
  → Seller wallet is NOT credited (funds never left escrow)
```

### Dispute workflow (manual review)

```
Buyer opens dispute within 7-day auto-release window
  → status='disputed', disputeOpenedAt=now
  → autoReleaseAt extended by 14 days (dispute resolution window)
  → Admin reviews evidence (tracking, photos, messages)
  → Admin calls either releaseEscrow() or refundEscrow()
```

### Auto-release cron (7-day timer)

```
Daily cron (BullMQ — see ADR-0009):
  SELECT * FROM EscrowHolding
   WHERE status = 'holding' AND autoReleaseAt < now()
  → for each: releaseEscrow(orderId)
  → OrderEvent: 'escrow_auto_released' (no delivery confirmation received)
```

### Integration points with existing models

- **`Order`** — `EscrowHolding.orderId @unique` (1:1). The order's
  `paymentStatus` stays `paid` while in escrow; the escrow status is
  the authoritative "where are the funds" state. When the escrow is
  refunded, the order's `paymentStatus` flips to `refunded` (existing
  status — no new value needed).
- **`Refund`** — When `refundEscrow()` is called, a `Refund` row is
  created (same model + endpoint as admin-initiated refunds) so the
  existing refund ledger + reconciliation covers escrow refunds. The
  `Refund.reason` is `'product_issue'` or `'fraud'` (existing enum
  values). No new `Refund` field needed.
- **`WalletTransaction`** — When `releaseEscrow()` runs, two
  `WalletTransaction` rows are created: `inbound 'escrow_release'`
  for the seller (trafficker) wallet + `inbound 'commission'` for the
  platform wallet. The existing `walletService.recordTransaction`
  (atomic per ADR-0019 / R-5) handles both writes. No new
  `WalletTransaction` field needed.
- **`Trafficker`** — `Trafficker.walletBalance` is the running
  balance. Escrow release increments it; escrow refund does NOT
  decrement it (funds were never credited in the first place).

### API surface (proposed, not yet implemented)

```
POST /api/escrow/hold          — create EscrowHolding (called by
                                 payment-success webhook when order
                                 has a traffickerId + marketplace
                                 flag)
POST /api/escrow/release       — release to seller (called by
                                 delivery webhook OR admin endpoint)
POST /api/escrow/refund        — refund to buyer (called by admin
                                 OR dispute-resolution endpoint)
POST /api/escrow/dispute       — open dispute (called by buyer OR
                                 operator)
GET  /api/escrow/[orderId]     — fetch escrow state
GET  /api/escrow?status=holding — list (admin/operator)
```

### Why virtual escrow (not a separate bank account)

A real-money escrow account (separate bank account holding buyer
funds) is operationally heavy: requires a banking license in most
LATAM jurisdictions, regulatory reporting, and reconciliation
overhead. The virtual escrow approach uses the gateway's existing
capture-but-delay-settlement feature (Stripe Connect `manual` payout
schedule, MercadoPago Marketplaces `paused` status, PayU
`settlement_delay`) to keep the funds at the gateway level. The
`EscrowHolding` row is the internal ledger that tracks which orders
are "in escrow" and drives the release/refund decisions.

Trade-off: if the gateway doesn't support settlement delays (some
LATAM gateways don't), the funds settle to the seller's bank account
immediately — virtual escrow becomes a "trust me" ledger with no
mechanical enforcement. For those gateways we fall back to the
existing immediate-settle behavior + the admin-initiated refund path
(which works pre-settlement). The ADR for the per-gateway settlement
matrix is a follow-up.

## Consequences

- **Positive:** Buyer funds are mechanically protected for the 7-day
  delivery window — no seller can withdraw funds before delivery is
  confirmed (or the window elapses).
- **Positive:** Dispute resolution has a clear state machine
  (`holding` → `released` | `refunded` | `disputed` → `released` |
  `refunded`) that ops can follow.
- **Positive:** Existing `Refund` + `WalletTransaction` + `OrderEvent`
  models are reused — no parallel ledger.
- **Negative:** Adds a new model + 4 API endpoints + a daily cron
  (BullMQ). Estimated implementation: 2-3 days.
- **Negative:** Virtual escrow only works if the gateway supports
  settlement delays. For gateways that don't, escrow is a "best
  effort" ledger — the audit should note this in the per-gateway
  capability matrix.
- **Negative:** The 7-day auto-release is a default; some verticals
  (high-value goods, custom manufacturing) need longer windows. The
  `autoReleaseAt` field is per-escrow so this is configurable, but
  the admin UI to set it is a follow-up.
- **Mitigation:** The proposed model is additive — no existing
  payment/refund flow changes. The escrow is created only for orders
  with a `traffickerId` (marketplace orders); tenant-direct sales
  keep the existing immediate-capture behavior. Rollout is per-tenant
  opt-in.

## Open questions (deferred to implementation sprint)

1. **Which gateways support settlement delays today?** Need a
   capability matrix: Stripe Connect (yes, `manual`), MercadoPago
   Marketplaces (yes, `paused`), Wompi (TBD), PayU (TBD), local
   payment methods (PSE/PIX/OXXO/SPEI — likely no, they settle
   immediately).
2. **Interest on held funds?** LATAM consumer-protection law is
   silent on this; the platform keeps any float interest. Document
   in the Terms of Service.
3. **Tax treatment of escrow?** In Colombia, IVA is triggered on
   delivery, not on capture. Escrow release should stamp the
   `Invoice.issuedAt` at release time, not capture time. Coordinate
   with the DIAN invoicing flow (ADR-0020).
4. **KYC for sellers before release?** BACEN Resolução 4.658/2018
   requires KYC for marketplace sellers in Brazil. Tie escrow
   release to `Trafficker.status = 'active'` (KYC verified).
5. **Refund-from-escrow when gateway has settled?** If the gateway
   settles despite our `manual` setting (misconfiguration, gateway
   bug), the refund fails. Fall back to a platform-funded refund +
   debt collection from the seller's future earnings. This is a
   `Refund.status = 'failed'` + a `SellerDebt` row (new model —
   follow-up ADR).

## References

- AUDIT-FINTECH V2 §5 — R-18 "Sin implementación de escrow" (Pending)
- ADR-0009 — BullMQ vs. cron (for the auto-release cron)
- ADR-0019 — Automated refund post-retracto (refund path reuse)
- ADR-0020 — DIAN electronic invoicing (tax treatment at release)
- Ley 1480 de 2011 Art 54 (Colombia) — consumer protection
- BACEN Resolução 4.658/2018 (Brazil) — marketplace seller KYC
- PROFECO (México) — consumer protection
