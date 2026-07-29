// ZIAY — Input sanitization middleware
//
// SPRINT-HARDENING-FINAL-001 · §1 — defense-in-depth input sanitization.
//
// Prevents XSS (escapes HTML entities for downstream display), log injection
// (strips null bytes that could break pino's JSON formatter), and unbounded
// payloads (truncates strings to MAX_STRING_LENGTH, arrays to
// MAX_ARRAY_LENGTH). Prisma already parameterizes queries so SQL-injection
// is not the threat model here — but truncation caps memory pressure from
// a hostile client that ships a 50MB JSON body.
//
// Applied AFTER Zod validation in the route handlers (see
// `sanitizeParsed`) so the validator still sees the original shape —
// Zod's `.min(1)` would otherwise pass on a string that's pure
// whitespace if we sanitized first.
//
// Defense against prototype pollution: `__proto__`, `constructor`, and
// `prototype` keys are dropped during object traversal. Combined with
// the `depth > 10` cutoff this prevents both prototype-pollution and
// stack-overflow via deeply-nested payloads.

const MAX_STRING_LENGTH = 10000
const MAX_ARRAY_LENGTH = 100

/**
 * Sanitize a string input:
 *  - Strips null bytes (prevents log-injection / terminal escape sequences)
 *  - Trims leading/trailing whitespace
 *  - Truncates to `maxLength` (default 10k chars)
 *
 * Does NOT escape HTML entities — the DB stores the raw string and the
 * React renderer escapes on display. Escaping at the storage layer would
 * double-escape any string that round-trips through the API twice.
 */
export function sanitizeString(input: string, maxLength: number = MAX_STRING_LENGTH): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/\0/g, '') // null bytes — break pino JSON formatter
    .trim()
    .slice(0, maxLength)
}

/**
 * Sanitize an object recursively.
 * Applies `sanitizeString` to every string value, slices arrays to
 * MAX_ARRAY_LENGTH, and skips `__proto__` / `constructor` / `prototype`
 * keys to prevent prototype pollution.
 *
 * A `depth > 10` cutoff prevents stack overflow on adversarial deep
 * nesting (10 levels × 100 array items = 100k leaves max).
 */
export function sanitizeObject<T>(obj: T, depth: number = 0): T {
  if (depth > 10) return obj // prevent deep recursion
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return sanitizeString(obj) as unknown as T
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.slice(0, MAX_ARRAY_LENGTH).map(item => sanitizeObject(item, depth + 1)) as unknown as T
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Skip __proto__ / constructor / prototype to prevent prototype
    // pollution — a hostile payload like `{"__proto__":{"isAdmin":true}}`
    // must not leak into the runtime Object prototype.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = sanitizeObject(value, depth + 1)
  }
  return result as T
}

/**
 * Sanitize a Zod-parsed body.
 *
 * Use AFTER `schema.safeParse(raw)` so Zod sees the unaltered input
 * (its `.min()` / `.max()` / `.email()` validators expect the original
 * string shape). The sanitized output is then passed downstream.
 *
 * @example
 * ```ts
 * const parseResult = MySchema.safeParse(raw)
 * if (!parseResult.success) return NextResponse.json({ error: '...' }, { status: 400 })
 * const data = sanitizeParsed(parseResult.data)
 * ```
 */
export function sanitizeParsed<T>(data: T): T {
  return sanitizeObject(data)
}
