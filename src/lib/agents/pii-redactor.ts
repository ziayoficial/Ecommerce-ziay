// ZIAY — PII Redactor for agent outputs (IA-6A · Gap 3)
//
// The Governor (IA-1) checks for PII in CUSTOMER INPUT before the LLM
// call — it blocks prompts that leak credit cards / CPF / SSN / etc.
// But there was no symmetric check on AGENT OUTPUTS: if an agent
// hallucinated another customer's PII into its reply (e.g. the quote
// agent pulling the wrong row from CustomerMemory and surfacing a
// different customer's phone number), it would reach the customer
// unfiltered.
//
// This module applies PII redaction to EVERY agent output before it's
// returned to the customer. It:
//   - Detects 8 PII types: credit_card, cpf, cnpj, nit, phone_br,
//     phone_co, email, ssn.
//   - Replaces each match with a placeholder (e.g. `[CARD]`, `[EMAIL]`).
//   - Whitelists the CURRENT customer's own data — if the customer
//     gave us their email and the agent echoes it back, that's not a
//     leak (the customer already knows their own email). The whitelist
//     is passed in by the caller (the API route has the customer record).
//   - Logs every redaction for audit (DecisionLog + pino) so we can
//     spot "this agent tried to leak PII N times today" trends.
//   - Returns the redacted text + a structured report of what was found
//     so the caller can attach it to the tracing span + DecisionLog.
//
// ─── Design notes ──────────────────────────────────────────────────────
//   - Patterns are intentionally NARROW (anchored with \b, digit counts
//     exact). A looser pattern would false-positive on order numbers,
//     SKUs, prices, etc. and over-redact legitimate content.
//   - The redactor is APPLIED LAST (after QA review, after tool loop
//     strip) — it sees the final reply the customer will receive.
//   - It NEVER blocks a reply — only redacts. If an agent includes PII,
//     the customer sees `[CARD]` instead of the digits. The agent's
//     confidence is preserved; the redaction is logged for follow-up.
//   - For the LLM-call sites in the 3 API routes, the redactor is
//     applied to the final reply string right before returning the
//     NextResponse.
//
// IA-6A (Gap 3)

import { getLogger } from '@/lib/logger'

const log = getLogger('agent:pii-redactor')

// ───────────────────────────────────────────────────────────────────────────
// PII patterns
// ───────────────────────────────────────────────────────────────────────────

/**
 * A single PII detection rule. The `regex` is global (matches all
 * occurrences in the text); the `replacement` is the placeholder
 * substituted for each match.
 *
 * Patterns cover LATAM (Brazil, Colombia) + US (SSN) PII types since
 * ZIAY's customer base spans those markets (see `public/presentaciones/
 * INVESTIGACION-MERCADO.md`).
 */
export interface PIIPattern {
  /** Identifier for the PII type — surfaced in logs + the RedactionResult. */
  name: string
  /** Global regex (must have the `g` flag — applied repeatedly). */
  regex: RegExp
  /** Placeholder substituted for each match. */
  replacement: string
}

/**
 * The 8 PII patterns. Ordered by specificity (most specific first) so
 * overlapping patterns don't double-count.
 *
 *   - credit_card : 16 digits with optional spaces/dashes between groups.
 *   - cpf         : Brazilian individual tax ID (###.###.###-##).
 *   - cnpj        : Brazilian company tax ID (##.###.###/####-##).
 *   - nit         : Colombian tax ID (########-#).
 *   - phone_br    : Brazilian phone with country code (+55 ## #####-####).
 *   - phone_co    : Colombian phone with country code (+57 ### ### ####).
 *   - email       : Standard email format.
 *   - ssn         : US Social Security Number (###-##-####).
 *
 * Each regex is anchored with `\b` to avoid partial matches inside
 * longer digit strings (e.g. a 20-digit order number shouldn't trigger
 * credit_card on the middle 16 digits).
 */
export const PII_PATTERNS: PIIPattern[] = [
  {
    name: 'credit_card',
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[CARD]',
  },
  {
    name: 'cpf',
    regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
    replacement: '[CPF]',
  },
  {
    name: 'cnpj',
    regex: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    replacement: '[CNPJ]',
  },
  {
    name: 'nit',
    regex: /\b\d{8}-\d\b/g,
    replacement: '[NIT]',
  },
  {
    name: 'phone_br',
    regex: /\b\+55\s?\d{2}\s?\d{4,5}-\d{4}\b/g,
    replacement: '[PHONE]',
  },
  {
    name: 'phone_co',
    regex: /\b\+57\s?\d{3}\s?\d{3}\s?\d{4}\b/g,
    replacement: '[PHONE]',
  },
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]',
  },
]

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-PII-type summary of what was redacted in a single call.
 */
export interface RedactionFinding {
  /** PII pattern name (e.g. 'credit_card', 'email'). */
  type: string
  /** Number of matches redacted for this type. */
  count: number
}

/**
 * Result of `redactPII` — the redacted text + a structured report of
 * what was found. The report is attached to the tracing span +
 * DecisionLog by the caller so the redaction is auditable.
 */
export interface RedactionResult {
  /** The text with all PII replaced by placeholders. */
  redacted: string
  /** Per-PII-type findings. Empty array when no PII was found. */
  found: RedactionFinding[]
  /** True when at least one PII match was redacted. */
  hadRedactions: boolean
  /** Total count of redacted matches (sum of `found[].count`). */
  totalRedacted: number
}

/**
 * Options for `redactPII`. The `whitelist` lets the caller exempt the
 * current customer's own PII from redaction — e.g. if the customer
 * gave us their email and the agent echoes it back, that's not a leak
 * (the customer already knows their own email).
 */
export interface RedactPIIOptions {
  /**
   * Strings to exempt from redaction. When a PII match equals one of
   * these strings (case-insensitive), it's left in place. Typically
   * populated with the current customer's email, phone, CPF, etc.
   */
  whitelist?: string[]
}

// ───────────────────────────────────────────────────────────────────────────
// redactPII — the public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Redact PII from a text. Walks each pattern in `PII_PATTERNS`,
 * replaces matches with the pattern's placeholder, and records what
 * was redacted.
 *
 * Whitelisting: when a match equals one of `options.whitelist` entries
 * (case-insensitive, trimmed), it's left in place and NOT counted
 * toward `found[].count`. This handles the common case of the agent
 * echoing the customer's own PII back to them — which is fine (the
 * customer already knows their own email/phone).
 *
 * @example
 * ```ts
 * const result = redactPII(
 *   'Te envío a juan@example.com. ¿Tu CPF 123.456.789-00 sigue siendo válido?',
 *   { whitelist: ['123.456.789-00'] }
 * )
 * // result.redacted === 'Te envío a [EMAIL]. ¿Tu CPF 123.456.789-00 sigue siendo válido?'
 * // result.found === [{ type: 'email', count: 1 }]
 * ```
 */
export function redactPII(text: string, options?: RedactPIIOptions): RedactionResult {
  if (!text || typeof text !== 'string') {
    return { redacted: text ?? '', found: [], hadRedactions: false, totalRedacted: 0 }
  }

  // Normalise the whitelist once: trim + lowercase for case-insensitive
  // comparison. Empty strings are filtered out (they'd match every
  // empty match in the text).
  const whitelistSet = new Set(
    (options?.whitelist ?? [])
      .map((s) => s?.trim().toLowerCase())
      .filter((s): s is string => typeof s === 'string' && s.length > 0),
  )

  let redacted = text
  const findings: RedactionFinding[] = []
  let totalRedacted = 0

  for (const pattern of PII_PATTERNS) {
    // Reset lastIndex because the regex is global (and the same regex
    // object is reused across calls — lastIndex persists otherwise).
    pattern.regex.lastIndex = 0
    // Collect all matches for this pattern, partitioned by whitelist.
    const matches: string[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.regex.exec(redacted)) !== null) {
      // Guard against zero-length matches (would loop infinitely).
      if (m[0].length === 0) {
        pattern.regex.lastIndex++
        continue
      }
      matches.push(m[0])
    }
    if (matches.length === 0) continue

    // Partition: whitelist-exempt vs redact.
    const toRedact = matches.filter((s) => !whitelistSet.has(s.toLowerCase()))
    const whitelistedCount = matches.length - toRedact.length
    if (toRedact.length === 0) {
      // All matches were whitelisted — no redaction needed for this
      // pattern. Still log for audit (the agent DID include this PII
      // type, just the customer's own).
      if (whitelistedCount > 0) {
        log.debug(
          { type: pattern.name, count: whitelistedCount, replacement: pattern.replacement },
          'PII match exempt (whitelisted as current customer data)',
        )
      }
      continue
    }

    // Replace each non-whitelisted match with the placeholder. We use
    // a per-match replace (not a single regex replace) so we can skip
    // whitelisted occurrences. The `String.prototype.replace` with a
    // global regex would replace ALL matches — we need finer control.
    for (const match of toRedact) {
      // Escape regex metacharacters in the match so we can use a
      // literal search (some PII contains `.`, `-`, `+`, etc.).
      const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      redacted = redacted.replace(new RegExp(escaped, 'g'), pattern.replacement)
    }

    findings.push({ type: pattern.name, count: toRedact.length })
    totalRedacted += toRedact.length
  }

  const result: RedactionResult = {
    redacted,
    found: findings,
    hadRedactions: totalRedacted > 0,
    totalRedacted,
  }

  if (result.hadRedactions) {
    // Audit log — surfaces "this agent tried to leak PII" for
    // monitoring. The DecisionLog persistence is the caller's
    // responsibility (the API route attaches `result` to its existing
    // persistDecisionLog call).
    log.warn(
      {
        types: findings.map((f) => `${f.type}:${f.count}`).join(','),
        total: totalRedacted,
      },
      'PII redacted from agent output',
    )
  }

  return result
}

/**
 * Convenience: build a whitelist from a customer record. Extracts the
 * common PII fields (email, phone, tax IDs) so the caller doesn't have
 * to enumerate them manually.
 *
 * The customer shape is intentionally permissive (all fields optional)
 * — the caller passes whatever fields it has, this function picks out
 * the non-empty ones.
 */
export function buildCustomerWhitelist(customer: {
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  cpf?: string | null
  cnpj?: string | null
  nit?: string | null
  documentNumber?: string | null
}): string[] {
  const whitelist: string[] = []
  const fields = [
    customer.email,
    customer.phone,
    customer.whatsapp,
    customer.cpf,
    customer.cnpj,
    customer.nit,
    customer.documentNumber,
  ]
  for (const f of fields) {
    if (typeof f === 'string' && f.trim().length > 0) {
      whitelist.push(f.trim())
    }
  }
  return whitelist
}
