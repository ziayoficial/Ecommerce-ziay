// Unit tests for src/lib/middleware/etag.ts
// SPRINT-TESTS-MIDDLEWARE-001 · §3a — ETag middleware.
//
// Coverage:
//   - generateETag: deterministic for same input, differs for different
//     input, wraps hash in double quotes, handles string + object bodies.
//   - checkETag: matches If-None-Match → 304 candidate, wildcard `*`
//     always matches, missing header → no match, non-matching → no match.
//
// The ETag is a strong validator (md5 over the body, wrapped in quotes).
// md5 is used because the manifests are static build-time literals —
// byte-stable across restarts — so the hash is a stable identifier, not
// a cryptographic guarantee.

import { describe, it, expect } from 'vitest'
import { generateETag, checkETag } from '@/lib/middleware/etag'

describe('ETag middleware — generateETag', () => {
  it('generates consistent ETag for same content (object)', () => {
    const etag1 = generateETag({ test: 'data' })
    const etag2 = generateETag({ test: 'data' })
    expect(etag1).toBe(etag2)
  })

  it('generates consistent ETag for same content (string)', () => {
    const etag1 = generateETag('hello world')
    const etag2 = generateETag('hello world')
    expect(etag1).toBe(etag2)
  })

  it('generates different ETag for different content', () => {
    const etag1 = generateETag({ test: 'data1' })
    const etag2 = generateETag({ test: 'data2' })
    expect(etag1).not.toBe(etag2)
  })

  it('wraps ETag in double quotes', () => {
    const etag = generateETag('test')
    expect(etag.startsWith('"')).toBe(true)
    expect(etag.endsWith('"')).toBe(true)
  })

  it('produces a quoted md5 hex string for string input', () => {
    const etag = generateETag('hello world')
    expect(etag).toMatch(/^"[0-9a-f]+"$/)
  })

  it('produces a quoted md5 hex string for object input', () => {
    const etag = generateETag({ key: 'value' })
    expect(etag).toMatch(/^"[0-9a-f]+"$/)
  })

  it('treats equivalent object + JSON-string as same ETag', () => {
    // generateETag does JSON.stringify on objects — so an object and
    // its canonical JSON string produce the same hash. This is the
    // invariant the .well-known manifests rely on: both sides (the
    // server setting the ETag + the server checking If-None-Match)
    // call generateETag on the same object literal.
    const obj = { foo: 'bar', n: 42 }
    const fromObj = generateETag(obj)
    const fromStr = generateETag(JSON.stringify(obj))
    expect(fromObj).toBe(fromStr)
  })

  it('handles empty string input', () => {
    const etag = generateETag('')
    expect(etag).toMatch(/^"[0-9a-f]+"$/)
    // md5 of empty string is d41d8cd98f00b204e9800998ecf8427e
    expect(etag).toBe('"d41d8cd98f00b204e9800998ecf8427e"')
  })

  it('handles empty object input', () => {
    const etag = generateETag({})
    expect(etag).toMatch(/^"[0-9a-f]+"$/)
    // generateETag does JSON.stringify on objects, so {} → "{}" — the
    // object form and the stringified form must produce the same hash.
    expect(generateETag({})).toBe(generateETag('{}'))
  })

  it('produces a 32-char hex hash (md5 digest length)', () => {
    const etag = generateETag('test')
    const hex = etag.slice(1, -1) // strip quotes
    expect(hex.length).toBe(32)
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })
})

describe('ETag middleware — checkETag', () => {
  it('detects matching If-None-Match', () => {
    const body = { test: 'data' }
    const etag = generateETag(body)
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': etag },
    })
    const { match, etag: returnedEtag } = checkETag(req, body)
    expect(match).toBe(true)
    expect(returnedEtag).toBe(etag)
  })

  it('detects non-matching If-None-Match', () => {
    const body = { test: 'data' }
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': '"different-etag"' },
    })
    const { match } = checkETag(req, body)
    expect(match).toBe(false)
  })

  it('handles wildcard If-None-Match (always match)', () => {
    const body = { test: 'data' }
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': '*' },
    })
    const { match } = checkETag(req, body)
    expect(match).toBe(true)
  })

  it('handles missing If-None-Match header', () => {
    const body = { test: 'data' }
    const req = new Request('http://localhost:3000/api/test')
    const { match } = checkETag(req, body)
    expect(match).toBe(false)
  })

  it('returns the generated ETag regardless of match status', () => {
    const body = { foo: 1 }
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': '"nope"' },
    })
    const { match, etag } = checkETag(req, body)
    expect(match).toBe(false)
    expect(etag).toBe(generateETag(body))
  })

  it('matches ETag for string body', () => {
    const body = 'plain-text-body'
    const etag = generateETag(body)
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': etag },
    })
    const { match } = checkETag(req, body)
    expect(match).toBe(true)
  })

  it('is case-sensitive on If-None-Match value (per RFC 7232)', () => {
    const body = 'test'
    const etag = generateETag(body)
    // HTTP header names are case-insensitive but header values are not.
    // The etag value is a quoted hex string — uppercase hex wouldn't
    // match the lowercase md5 we generate.
    const req = new Request('http://localhost:3000/api/test', {
      headers: { 'if-none-match': etag.toUpperCase() },
    })
    const { match } = checkETag(req, body)
    expect(match).toBe(false)
  })
})
