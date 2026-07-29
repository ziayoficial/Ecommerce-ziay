# ADR-0003: SQLite for Dev, PostgreSQL for Prod

**Status:** Accepted
**Date:** 2026-06-15

## Context
Need a database that's easy for local development but production-grade. SQLite is zero-config but lacks row-level security, concurrent writes, and full-text search. PostgreSQL has all these but requires a server.

## Decision
Use SQLite for development (via `file:./db/custom.db`) and PostgreSQL 16 for production. The Prisma schema is provider-agnostic. The `migration_lock.toml` is set to `postgresql` for prod migrations.

## Consequences
- **Positive:** Zero-friction local development (no Docker needed)
- **Positive:** Prisma abstracts most SQL differences
- **Negative:** Some SQLite/PG semantic differences (e.g., `LIKE` case sensitivity, JSON functions)
- **Negative:** CI must run both SQLite (unit tests) and PostgreSQL (integration tests)
- **Mitigation:** CI uses PostgreSQL service container since Sprint 5C
