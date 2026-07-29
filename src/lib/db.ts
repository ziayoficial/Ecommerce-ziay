import { PrismaClient } from '@prisma/client'

// ───────────────────────────────────────────────────────────────────────────
// Prisma client singleton — works for both SQLite (dev) and PostgreSQL (prod).
// SPRINT7-POSTGRES-SERVICES-001
// ───────────────────────────────────────────────────────────────────────────
// In production with PostgreSQL, Prisma uses connection pooling via the
// `DATABASE_URL` connection string — NO code changes are required here.
//
// Example prod URL with pooling params:
//   postgresql://user:pass@host:5432/ziay?schema=public&connection_limit=20&pool_timeout=10
//
// For serverless / PgBouncer setups, append `&pgbouncer=true` so Prisma uses
// the PgBouncer transaction-mode pool. Full recommended prod URL:
//   postgresql://user:pass@host:5432/ziay?schema=public&connection_limit=10&pool_timeout=10&pgbouncer=true
//
// In dev (SQLite) the pooling params are ignored — SQLite is single-connection
// and `file:./db/custom.db` is all that's needed.
// ───────────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
