// ───────────────────────────────────────────────────────────────────────────
// Safe JSON-LD serialization for SSR pages.
//
// V9 (AUDIT-FINAL-SEC-001): `JSON.stringify` does NOT escape `</script>` —
// tenant-controlled fields (marca, politicaPago, product.name) injected into
// a `<script type="application/ld+json">` block can break out of the script
// element and execute arbitrary JS. This helper escapes the delimiter
// characters that matter for HTML script context, plus the Unicode line /
// paragraph separators that break JS parsing inside `<script>` (U+2028,
// U+2029 — valid in JSON but not in JS string literals pre-ES2019).
//
// Usage:
//   <script
//     type="application/ld+json"
//     dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLdObject) }}
//   />
// ───────────────────────────────────────────────────────────────────────────

/**
 * Serialize an object to a JSON-LD string safe for inline `<script>` embedding.
 *
 * Escapes:
 *   - `<` → `\u003c`  (prevents `</script>` breakout)
 *   - `>` → `\u003e`  (defense-in-depth for `<!--` breakout)
 *   - `&` → `\u0026`  (prevents HTML entity confusion)
 *   - U+2028 → `\u2028` (Line Separator — breaks JS parsing)
 *   - U+2029 → `\u2029` (Paragraph Separator — breaks JS parsing)
 *
 * The result is still valid JSON; the escapes are JSON-compatible Unicode
 * escape sequences, so `JSON.parse` round-trips correctly.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
