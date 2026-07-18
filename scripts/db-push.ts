#!/usr/bin/env bun
/**
 * scripts/db-push.ts — Smart Prisma database push with auto-provider detection.
 *
 * Problem:
 *   Prisma's `schema.prisma` hardcodes `provider = "sqlite"` for dev, but CI
 *   and production use PostgreSQL. Prisma validates that the `DATABASE_URL`
 *   protocol matches the `provider` — a PostgreSQL URL with `provider = "sqlite"`
 *   fails with: "the URL must start with the protocol `file:`".
 *
 * Solution:
 *   This script reads `DATABASE_URL`, detects the protocol, and creates a
 *   TEMPORARY copy of `schema.prisma` with the matching `provider` before
 *   running `prisma db push --schema=<temp>`. The original `schema.prisma`
 *   is NEVER modified (avoids conflicts with file watchers / dev server).
 *
 * Usage:
 *   bun run scripts/db-push.ts     # uses DATABASE_URL from env
 *   bun run db:push                # via package.json
 *
 * Provider detection:
 *   file:*                → sqlite    (dev)
 *   postgresql://*        → postgresql (CI + prod)
 *   postgres://*          → postgresql (CI + prod)
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'

const SCHEMA_PATH = 'prisma/schema.prisma'
const TEMP_SCHEMA_PATH = 'prisma/schema.temp.prisma'

const dbUrl = process.env.DATABASE_URL || ''

if (!dbUrl) {
  console.error('❌ DATABASE_URL is not set. Set it in .env or environment.')
  process.exit(1)
}

// Detect provider from DATABASE_URL protocol
const isPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')
const isSqlite = dbUrl.startsWith('file:')
const targetProvider = isPostgres ? 'postgresql' : isSqlite ? 'sqlite' : null

if (!targetProvider) {
  console.error(
    `❌ Could not detect database provider from DATABASE_URL.\n` +
      `   Expected: file:* (SQLite) or postgresql://* (PostgreSQL)\n` +
      `   Got: ${dbUrl.slice(0, 50)}...`,
  )
  process.exit(1)
}

// Read original schema
const originalSchema = readFileSync(SCHEMA_PATH, 'utf8')

// Find current provider — use multiline ^ to avoid matching `provider = "sqlite"`
// inside comments (e.g. `// dev : provider = "sqlite"` at line 12).
// The `m` flag makes `^` match at the start of each line. Comment lines start
// with `//` so `^\s*provider` only matches the real datasource provider.
const providerMatch = originalSchema.match(/^\s*provider = "(sqlite|postgresql)"/m)
if (!providerMatch) {
  console.error(`❌ Could not find provider in ${SCHEMA_PATH}`)
  process.exit(1)
}

const currentProvider = providerMatch[1]

if (currentProvider === targetProvider) {
  // No swap needed — run prisma db push directly against the original schema
  console.log(`[db-push] Provider: ${targetProvider} (no swap needed)`)
  try {
    execSync('./node_modules/.bin/prisma db push', { stdio: 'inherit', env: process.env })
    console.log('[db-push] ✅ Done')
  } catch (err) {
    console.error('[db-push] prisma db push failed')
    process.exit(1)
  }
} else {
  // Create a TEMPORARY schema with the swapped provider
  const swappedSchema = originalSchema.replace(
    /^\s*provider = "(sqlite|postgresql)"/m,
    `  provider = "${targetProvider}"`,
  )
  writeFileSync(TEMP_SCHEMA_PATH, swappedSchema)
  console.log(
    `[db-push] Created temp schema with provider: ${currentProvider} → ${targetProvider} ` +
      `(based on DATABASE_URL: ${dbUrl.slice(0, 30)}...)`,
  )

  // Run prisma db push against the TEMP schema
  try {
    execSync(`./node_modules/.bin/prisma db push --schema=${TEMP_SCHEMA_PATH}`, {
      stdio: 'inherit',
      env: process.env,
    })
    console.log('[db-push] ✅ Done')
  } catch (err) {
    console.error('[db-push] prisma db push failed')
    // Clean up temp file BEFORE exiting (process.exit doesn't wait for finally)
    if (existsSync(TEMP_SCHEMA_PATH)) {
      unlinkSync(TEMP_SCHEMA_PATH)
      console.log(`[db-push] Cleaned up ${TEMP_SCHEMA_PATH}`)
    }
    process.exit(1)
  }

  // Clean up temp file on success
  if (existsSync(TEMP_SCHEMA_PATH)) {
    unlinkSync(TEMP_SCHEMA_PATH)
    console.log(`[db-push] Cleaned up ${TEMP_SCHEMA_PATH}`)
  }
}
