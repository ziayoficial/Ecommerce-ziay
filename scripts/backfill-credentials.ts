#!/usr/bin/env bun
/**
 * scripts/backfill-credentials.ts — copy legacy plaintext credential columns
 * to credentialsService (Setting `cred::*` + AES-256-GCM encryption).
 *
 * AUTOFIX-AUDITORIA-001 — closes the C-4/C-6 gaps left open by round 1+2:
 *   - Channel.whatsappToken   → cred::{tenantId}::whatsapp       { apiToken }
 *   - Channel.pageAccessToken → cred::{tenantId}::messenger      { pageToken }
 *   - PixelConfig.apiToken    → cred::{tenantId}::pixel_{platform}_{pixelId}
 *                                { apiToken }
 *
 * The migration is IDEMPOTENT — running it twice produces the same state:
 *   - If a Setting row already exists with an `apiToken`/`pageToken` field,
 *     the script skips the column value (leaves the credentialsService
 *     value authoritative).
 *   - Otherwise the column value is encrypted with `encryptSecret` and
 *     written to `Setting.value` (JSON-wrapped).
 *
 * The legacy columns are NOT removed by this script (kept as fallback until
 * the post-migration cleanup is run — see the audit doc). After confirming
 * every tenant has been migrated, a follow-up schema migration can drop
 * `Channel.whatsappToken`, `Channel.pageAccessToken`, and
 * `PixelConfig.apiToken`.
 *
 * Usage:
 *   bun run scripts/backfill-credentials.ts                  # all tenants
 *   bun run scripts/backfill-credentials.ts --tenant=ten-123  # one tenant
 *   DRY_RUN=1 bun run scripts/backfill-credentials.ts         # report only
 *
 * Exit codes:
 *   0 — success (or dry-run complete)
 *   1 — fatal error (DB connection, encrypt failure, …)
 */

import { PrismaClient } from '@prisma/client'
import {
  encryptSecret,
  isEncryptedSecret,
} from '../src/lib/crypto/secret-encryption'

const db = new PrismaClient()

interface Summary {
  scanned: number
  migrated: number
  skippedAlreadyEncrypted: number
  skippedEmptyColumn: number
  errors: number
  errorSamples: Array<{ source: string; reason: string }>
}

const argv = process.argv.slice(2)
const tenantFilter = argv.find((a) => a.startsWith('--tenant='))?.split('=')[1]
const isDryRun = process.env.DRY_RUN === '1'

function makeSummary(): Summary {
  return {
    scanned: 0,
    migrated: 0,
    skippedAlreadyEncrypted: 0,
    skippedEmptyColumn: 0,
    errors: 0,
    errorSamples: [],
  }
}

async function upsertCred(
  summary: Summary,
  settingKey: string,
  plaintext: string,
  source: string,
): Promise<void> {
  if (!plaintext) {
    summary.skippedEmptyColumn++
    return
  }
  // Build the JSON shape the corresponding reader expects.
  // For whatsapp integration:  { apiToken: "<value>" }
  // For messenger integration: { pageToken: "<value>" }
  // For pixel_* integration:   { apiToken: "<value>" }
  // ( Caller — channels.service / capi-auto-fire / conversions.service —
  //   reads parseCredValue(row.value) and pulls the specific field. )
  try {
    const existing = await db.setting.findUnique({
      where: { key: settingKey },
      select: { value: true },
    })
    if (existing && isEncryptedSecret(existing.value)) {
      // Already encrypted — skip (the credentialsService is authoritative).
      summary.skippedAlreadyEncrypted++
      return
    }
    // Preserve any existing fields by parsing the legacy value, then merge.
    let existingFields: Record<string, string> = {}
    if (existing?.value) {
      try {
        const parsed = JSON.parse(existing.value)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') existingFields[k] = v
          }
        }
      } catch {
        // legacy plaintext (non-JSON) — overwrite
      }
    }
    const fieldKey = source === 'messenger' ? 'pageToken' : 'apiToken'
    const merged = { ...existingFields, [fieldKey]: plaintext }
    const jsonStr = JSON.stringify(merged)
    const encrypted = encryptSecret(jsonStr)
    if (isDryRun) {
      console.log(`[DRY RUN] would write ${settingKey} (${encrypted.length}B)`)
      summary.migrated++
      return
    }
    await db.setting.upsert({
      where: { key: settingKey },
      update: { value: encrypted },
      create: { key: settingKey, value: encrypted },
    })
    summary.migrated++
  } catch (err) {
    summary.errors++
    if (summary.errorSamples.length < 10) {
      summary.errorSamples.push({
        source,
        reason: (err as Error).message,
      })
    }
    console.error(`✗ ${source}: ${(err as Error).message}`)
  }
}

async function migrateChannels(summary: Summary): Promise<void> {
  const where = tenantFilter
    ? { tenantId: tenantFilter }
    : undefined
  const channels = await db.channel.findMany({ where })
  summary.scanned += channels.length
  for (const c of channels) {
    if (c.whatsappToken) {
      await upsertCred(
        summary,
        `cred::${c.tenantId}::whatsapp`,
        c.whatsappToken,
        `channel:${c.id}:whatsappToken`,
      )
    } else {
      summary.skippedEmptyColumn++
    }
    if (c.pageAccessToken) {
      await upsertCred(
        summary,
        `cred::${c.tenantId}::messenger`,
        c.pageAccessToken,
        `channel:${c.id}:pageAccessToken`,
      )
    } else {
      summary.skippedEmptyColumn++
    }
  }
}

async function migratePixels(summary: Summary): Promise<void> {
  const where = tenantFilter
    ? { tenantId: tenantFilter }
    : undefined
  const pixels = await db.pixelConfig.findMany({ where })
  summary.scanned += pixels.length
  for (const p of pixels) {
    if (!p.apiToken) {
      summary.skippedEmptyColumn++
      continue
    }
    await upsertCred(
      summary,
      `cred::${p.tenantId}::pixel_${p.platform}_${p.pixelId}`,
      p.apiToken,
      `pixel:${p.id}:apiToken`,
    )
  }
}

async function main() {
  console.log(
    isDryRun
      ? '🔍 Backfill credentials — DRY RUN (no writes)'
      : '🔑 Backfill credentials — copying columns to credentialsService',
  )
  if (tenantFilter) {
    console.log(`  scoped to tenant: ${tenantFilter}`)
  }
  const summary = makeSummary()
  try {
    await migrateChannels(summary)
    await migratePixels(summary)
  } catch (err) {
    console.error('Fatal:', (err as Error).message)
    await db.$disconnect()
    process.exit(1)
  }
  console.log('\n── Summary ────────────────────────────')
  console.log(`  scanned                  : ${summary.scanned}`)
  console.log(`  migrated                 : ${summary.migrated}`)
  console.log(`  skipped (already enc)    : ${summary.skippedAlreadyEncrypted}`)
  console.log(`  skipped (empty column)   : ${summary.skippedEmptyColumn}`)
  console.log(`  errors                   : ${summary.errors}`)
  if (summary.errorSamples.length > 0) {
    console.log('  error samples:')
    for (const e of summary.errorSamples) {
      console.log(`    - ${e.source}: ${e.reason}`)
    }
  }
  if (isDryRun) {
    console.log('\n(DRY RUN — re-run without DRY_RUN=1 to apply)')
  }
  await db.$disconnect()
  process.exit(summary.errors > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Unexpected:', err)
  process.exit(1)
})
