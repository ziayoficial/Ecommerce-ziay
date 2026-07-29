import crypto from 'crypto'

/**
 * ETag helpers for conditional GETs.
 *
 * SPRINT-PERFORMANCE-FINAL-001 · §3 — enable `If-None-Match` / `304 Not
 * Modified` on the `.well-known/*` manifest endpoints.
 *
 * The well-known manifests (`/ucp`, `/acp`, `/agent-card`) are `force-static`
 * JSON blobs that change only when we ship a new protocol version. Today
 * every agent discovery request still pulls the full body over the wire
 * (≈1–2 KB per manifest, hundreds of requests per hour from ChatGPT /
 * Copilot / Claude crawling the storefront). With ETags in place, a client
 * that already has the manifest gets a 304 with no body — the CDN serves
 * the 304 from the edge and the origin never sees the request again.
 *
 * Why md5 over the body instead of `Weak-ETag` / version-field comparison:
 *   - The manifests are generated at build time from literals in the route
 *     file, so the body is byte-stable across restarts (no per-request
 *     timestamp). md5 over the JSON string gives a stable strong validator.
 *   - We hash the *body object*, not the serialized response, so the ETag
 *     is independent of `NextResponse.json`'s whitespace/encoding choices.
 *     Both sides (server setting the ETag + server checking If-None-Match)
 *     call the same helper on the same object, so they always agree.
 *
 * Usage in a route:
 *   ```ts
 *   const { match, etag } = checkETag(req, manifest)
 *   if (match) return new NextResponse(null, { status: 304, headers: { ETag: etag } })
 *   const res = NextResponse.json(manifest)
 *   res.headers.set('ETag', etag)
 *   return res
 *   ```
 */

/**
 * Generate ETag for a response body.
 * Enables conditional requests (304 Not Modified).
 */
export function generateETag(body: string | object): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body)
  const hash = crypto.createHash('md5').update(content).digest('hex')
  return `"${hash}"`
}

/**
 * Check if the client's If-None-Match matches our ETag.
 * If so, return 304 Not Modified.
 */
export function checkETag(
  request: Request,
  body: string | object
): { match: boolean; etag: string } {
  const etag = generateETag(body)
  const ifNoneMatch = request.headers.get('if-none-match')
  return {
    match: ifNoneMatch === etag || ifNoneMatch === '*',
    etag,
  }
}
