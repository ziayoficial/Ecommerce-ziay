# ADR-0013: Local Payment Methods (PSE/PIX/OXXO/SPEI)

**Status:** Accepted
**Date:** 2026-07-15

## Context
Card-only payments (Stripe/MP/Wompi/PayU) exclude unbanked customers + miss preferred local methods. Colombia prefers PSE (bank transfer), Brasil prefers PIX (instant), México prefers OXXO (cash) + SPEI (bank transfer).

## Decision
Implement 4 local payment adapters in `src/lib/adapters/local-payments.ts`:
- **PSEAdapter** — Colombian bank transfer via ACH Colombia
- **PIXAdapter** — Brazilian instant payment with QR code
- **OXXOAdapter** — Mexican cash payment at convenience stores
- **SPEIAdapter** — Mexican bank transfer

Each adapter implements `createPayment()` + `verifyPayment()`. Webhook receivers at `/api/webhooks/{pse,pix}`. Country-based availability via `getAvailableLocalPayments(countryCode)`.

## Consequences
- **Positive:** Serves unbanked customers + matches local preferences
- **Positive:** PIX + OXXO have lower fees than card payments
- **Negative:** Each method has country-specific integration complexity
- **Negative:** Cash payments (OXXO) have expiration windows (3 days)
- **Mitigation:** Test mode (no real API) for development; webhook idempotency prevents double-processing
