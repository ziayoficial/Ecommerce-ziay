# ADR-0020: DIAN Electronic Invoicing via Alegra

**Status:** Accepted
**Date:** 2026-07-15

## Context
Colombia mandates electronic invoicing (factura electrónica) via DIAN since 2019 (Decreto 745/2014). Direct DIAN API integration requires complex XML signing + digital certificates. Alegra is a DIAN-authorized billing platform that handles the DIAN submission automatically.

## Decision
Integrate with Alegra as the DIAN provider:
- `AlegraDianAdapter` in `src/lib/adapters/dian-alegra.ts`
- `createInvoice()` sends order data to Alegra → Alegra submits to DIAN → returns CUFE
- `checkStatus()` polls DIAN validation status
- `sendByEmail()` sends the PDF to the customer
- `submitToDian()` in `dian-invoicing.ts` orchestrates the flow
- Credentials via `ALEGRA_TOKEN` + `ALEGRA_USERNAME` env vars
- Falls back to local CUFE generation if Alegra not configured

## Consequences
- **Positive:** Full DIAN compliance without complex XML/certificate handling
- **Positive:** Alegra handles DIAN API changes + validation rules
- **Negative:** Dependency on Alegra (third-party SaaS)
- **Negative:** Alegra charges per invoice (pricing tier)
- **Mitigation:** Adapter pattern allows swapping to Bsale/Siigo without code changes
