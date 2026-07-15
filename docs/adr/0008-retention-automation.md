# ADR-0008: Automated Data Retention (Ley 1581)

**Status:** Accepted
**Date:** 2026-07-14

## Context
Ley 1581 de 2012 Art 11 requires personal data to be deleted when no longer needed for the purpose it was collected. Manual deletion is error-prone and non-compliant.

## Decision
Implement automated retention cleanup via a daily cron endpoint (`/api/compliance/retention/cron`) that:
- Anonymizes inactive customers (no orders in 5 years)
- Deletes conversations older than 2 years
- Deletes messages older than 2 years
- Deletes audit logs older than 7 years (legal requirement)
- Deletes revoked consent records older than 5 years
- Deletes decision logs older than 3 years

Each phase wrapped in try/catch for failure isolation. Anonymization preserves referential integrity (keeps id/tenantId, nulls PII).

## Consequences
- **Positive:** Continuous compliance without manual intervention
- **Positive:** Failure isolation — one phase failing doesn't block others
- **Negative:** Cron endpoint must be secured (CRON_SECRET)
- **Negative:** Anonymized customers lose purchase history context
- **Mitigation:** 5-year retention for customers is generous; audit logs kept 7 years for dispute resolution
