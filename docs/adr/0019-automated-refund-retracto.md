# ADR-0019: Automated Refund Post-Retracto

**Status:** Accepted
**Date:** 2026-07-15

## Context
Ley 1480 Art 47 grants consumers a 5-day retracto window for online purchases. When retracto is exercised, the merchant must refund within 30 days. Manual refund processing is error-prone and can miss the 30-day deadline.

## Decision
Automate refund processing in `processRetracto()`:
1. After cancelling the order (in a `$transaction`), check if the order was `paid` with a `paymentRef` + `paymentGateway`
2. If so, call `getPaymentAdapter(gateway).refund(paymentRef, total)`
3. On success: update order to `refunded` + create OrderEvent
4. On failure: create OrderEvent with error + manual processing deadline
5. The refund is fire-and-forget (non-blocking) — order cancellation is the source of truth

## Consequences
- **Positive:** Refunds processed immediately, well within the 30-day legal deadline
- **Positive:** Failed refunds are logged with the deadline for manual follow-up
- **Negative:** Refund API call adds latency to the retracto endpoint (~2-5s)
- **Negative:** Different gateways have different refund APIs (4 adapters)
- **Mitigation:** Fire-and-forget pattern — the user gets immediate confirmation, refund processes in background
