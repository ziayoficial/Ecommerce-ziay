#!/usr/bin/env bun
/**
 * scripts/db-seed.ts — Smart Prisma database seed with auto-provider detection.
 *
 * Same problem as scripts/db-push.ts: `prisma db seed` reads schema.prisma
 * which hardcodes `provider = "sqlite"`, but CI uses PostgreSQL. This script
 * creates a temp schema with the matching provider before seeding.
 *
 * Usage:
 *   bun run scripts/db-seed.ts     # uses DATABASE_URL from env
 *   bun run db:seed                # via package.json
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'

const SCHEMA_PATH = 'prisma/schema.prisma'
const TEMP_SCHEMA_PATH = 'prisma/schema.temp.prisma'

const dbUrl = process.env.DATABASE_URL || ''

if (!dbUrl) {
  console.error('❌ DATABASE_URL is not set.')
  process.exit(1)
}

const isPostgres = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')
const isSqlite = dbUrl.startsWith('file:')
const targetProvider = isPostgres ? 'postgresql' : isSqlite ? 'sqlite' : null

if (!targetProvider) {
  console.error(`❌ Could not detect database provider from DATABASE_URL.`)
  process.exit(1)
}

const originalSchema = readFileSync(SCHEMA_PATH, 'utf8')
const providerMatch = originalSchema.match(/^\s*provider = "(sqlite|postgresql)"/m)

if (!providerMatch) {
  console.error(`❌ Could not find provider in ${SCHEMA_PATH}`)
  process.exit(1)
}

const currentProvider = providerMatch[1]

if (currentProvider === targetProvider) {
  console.log(`[db-seed] Provider: ${targetProvider} (no swap needed)`)
  try {
    execSync('./node_modules/.bin/prisma db seed', { stdio: 'inherit', env: process.env })
    console.log('[db-seed] ✅ Done')
  } catch (err) {
    console.error('[db-seed] prisma db seed failed')
    process.exit(1)
  }
} else {
  const swappedSchema = originalSchema.replace(
    /^\s*provider = "(sqlite|postgresql)"/m,
    `  provider = "${targetProvider}"`,
  )
  writeFileSync(TEMP_SCHEMA_PATH, swappedSchema)
  console.log(`[db-seed] Created temp schema with provider: ${currentProvider} → ${targetProvider}`)

  try {
    execSync(`./node_modules/.bin/prisma db seed --schema=${TEMP_SCHEMA_PATH}`, {
      stdio: 'inherit',
      env: process.env,
    })
    console.log('[db-seed] ✅ Done')
  } catch (err) {
    console.error('[db-seed] prisma db seed failed')
    if (existsSync(TEMP_SCHEMA_PATH)) {
      unlinkSync(TEMP_SCHEMA_PATH)
    }
    process.exit(1)
  }

  if (existsSync(TEMP_SCHEMA_PATH)) {
    unlinkSync(TEMP_SCHEMA_PATH)
    console.log(`[db-seed] Cleaned up ${TEMP_SCHEMA_PATH}`)
  }
}
