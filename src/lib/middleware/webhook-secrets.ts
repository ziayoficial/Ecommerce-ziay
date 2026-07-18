// ZIAY — Fail-closed env-var resolution for webhook secrets.
//
// All webhook shared-secrets (`NOCODB_WEBHOOK_SECRET`, `WA_VERIFY_TOKEN`,
// `META_VERIFY_TOKEN`, `META_APP_SECRET`, …) used to ship with hardcoded
// public fallbacks (`'commerceflow_nocodb'`, `'commerceflow_verify'`, …).
// Anyone who read the source could call those webhooks in production if the
// operator forgot to set the env var.
//
// IF-2 · S-11/S-12 — pattern switched to fail-closed:
//   - In production (`NODE_ENV === 'production'`): if the env var is missing
//     the request handler must return 500 (webhook receivers) or boot must
//     throw (TOTP `ENCRYPTION_KEY`). We never accept a request when the
//     secret is missing in prod.
//   - In dev: we allow an insecure-but-deterministic default so a fresh
//     checkout can run `bun run dev` without first generating secrets, but
//     we `console.warn` loudly so the operator knows.
//
// Usage:
//   import { resolveNocodbSecret, resolveWaVerifyToken, resolveMetaVerifyToken } from '@/lib/middleware/webhook-secrets'
//   const secret = resolveNocodbSecret() // returns the secret OR throws in prod
//
// The functions return `null` only when running in production AND the env
// var is missing — handlers should treat `null` as "reject the request".

const DEV_DEFAULTS = {
  NOCODB_WEBHOOK_SECRET: 'dev-nocodb-secret-change-me',
  WA_VERIFY_TOKEN: 'dev-wa-verify-token-change-me',
  META_VERIFY_TOKEN: 'dev-meta-verify-token-change-me',
} as const

type SecretName = keyof typeof DEV_DEFAULTS

function resolveSecret(envName: SecretName, envValue: string | undefined): string | null {
  if (envValue) return envValue
  if (process.env.NODE_ENV === 'production') {
    // Production without an explicit secret — DO NOT fall back. The caller
    // is responsible for rejecting the request (webhooks) or throwing at
    // boot (TOTP).
    return null
  }
  // Dev mode: warn loudly + use a deterministic insecure default.
  console.warn(
    `⚠️  ${envName} not set — using insecure dev default. Set this env var before deploying to production.`,
  )
  return DEV_DEFAULTS[envName]
}

export function resolveNocodbSecret(): string | null {
  return resolveSecret('NOCODB_WEBHOOK_SECRET', process.env.NOCODB_WEBHOOK_SECRET)
}

export function resolveWaVerifyToken(): string | null {
  return resolveSecret('WA_VERIFY_TOKEN', process.env.WA_VERIFY_TOKEN)
}

export function resolveMetaVerifyToken(): string | null {
  return resolveSecret('META_VERIFY_TOKEN', process.env.META_VERIFY_TOKEN)
}
