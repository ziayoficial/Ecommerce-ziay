# ADR-0015: CORS + CSRF Hardening

**Status:** Accepted
**Date:** 2026-07-15

## Context
The dashboard makes cross-origin requests (CDN, analytics). Need to allow legitimate cross-origin traffic while blocking CSRF attacks on mutations.

## Decision
- **CORS:** Allow-list based (`CORS_ALLOWED_ORIGINS` env var), defaults to localhost. `Access-Control-Allow-Credentials: true` for session cookies. Preflight cached 24h.
- **CSRF:** Origin/Host header check on all mutations (POST/PATCH/PUT/DELETE). Same-origin requests pass. Server-to-server (no Origin header) allowed. Defense-in-depth on top of NextAuth's SameSite=Lax cookie.
- **Auth rate limit:** 5 req/min/IP on login/signup (vs 60/min global).

## Consequences
- **Positive:** Blocks CSRF attacks from malicious origins
- **Positive:** Allows legitimate cross-origin (CDN, analytics)
- **Negative:** CORS config must be updated when adding new origins
- **Negative:** Server-to-server clients without Origin header bypass CSRF check (acceptable — they use API keys or session cookies)
