import { PrismaClient } from '@prisma/client'

// ───────────────────────────────────────────────────────────────────────────
// Production PostgreSQL connection pooling (SPRINT4-INFRA-001)
// ───────────────────────────────────────────────────────────────────────────
// In production with PostgreSQL, enable connection pooling via DATABASE_URL.
// Prisma automatically uses connection pooling through the connection string —
// no code changes are needed here.
//
// Example URL with pooling params:
//   postgresql://user:pass@host:5432/db?schema=public&connection_limit=20&pool_timeout=10
//
// For serverless / PgBouncer setups, append `&pgbouncer=true` so Prisma uses
// the PgBouncer transaction-mode pool. The full recommended prod URL:
//   postgresql://user:pass@host:5432/db?schema=public&connection_limit=20&pool_timeout=10&pgbouncer=true
//
// In dev (SQLite) this entire block is a no-op — SQLite is single-connection.
// ───────────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db