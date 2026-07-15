# ADR-0001: Multi-tenant RBAC with NextAuth JWT

**Status:** Accepted
**Date:** 2026-06-15

## Context
ZIAY serves 4 brands (Saramantha, Majestic, Lovely, Reina) as separate tenants. Each tenant has users with different roles (admin, agent, trafficker, finance, support, viewer). Need strict tenant isolation + role-based access control.

## Decision
Use NextAuth.js v4 with JWT strategy + role/tenantId encoded in the JWT payload. Implement `requireTenantAccess(tenantId)` helper that verifies the session user's tenantId matches the requested tenantId. Platform admins (no tenantId) can access any tenant.

## Consequences
- **Positive:** Simple, stateless, no session DB lookups per request
- **Positive:** Tenant isolation enforced at the middleware layer
- **Negative:** JWT can't be revoked instantly (must wait for expiry)
- **Negative:** Platform admin role is powerful (can access any tenant)
- **Mitigation:** Short JWT expiry (24h) + audit log for all cross-tenant access
