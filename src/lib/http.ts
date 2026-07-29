// ZIAY — Shared HTTP helper with timeout + retry.
//
// Wraps the native `fetch` with:
//   1. Per-request timeout (default 10s) via AbortController.
//   2. Automatic retry with exponential backoff on:
//      - Network errors (abort / DNS / TCP reset)
//      - 5xx server errors
//      - 429 Too Many Requests
//   3. Centralised error capture via `captureError` (Sentry + pino).
//
// Use this for ALL outbound HTTP calls from the server (adapters,
// integrations, webhooks, etc.). Do NOT use the raw `fetch` directly
// anywhere else — it has no timeout, no retry, and no observability.
//
// SPRINT2-RESILIENCE-001

import { captureError } from './capture-error'

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Per-request timeout in milliseconds. Default 10 000. */
  timeoutMs?: number
  /** Max retry attempts on retryable failures. Default 3. */
  retries?: number
  /** Base delay in ms for exponential backoff (delay = retryDelayMs * 2^attempt). Default 1 000. */
  retryDelayMs?: number
}

export interface HttpResult<T> {
  ok: boolean
  status: number
  data: T | null
  error?: string
}

/**
 * `fetch` wrapper with timeout, retry, and exponential backoff.
 *
 * @example
 * ```ts
 * const { ok, status, data } = await httpFetch<WompiToken>(
 *   'https://api.wompi.co/v1/tokens/cards',
 *   { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) },
 * )
 * if (!ok) throw new Error(`Wompi token request failed (${status})`)
 * ```
 */
export async function httpFetch<T>(
  url: string,
  opts: HttpOptions = {},
): Promise<HttpResult<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 10_000,
    retries = 3,
    retryDelayMs = 1_000,
  } = opts

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      // Retry on 5xx or 429 (server-side / throttling failures).
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        const delay = retryDelayMs * Math.pow(2, attempt) // exponential backoff
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      const text = await res.text()
      let data: T | null = null
      try {
        data = text ? (JSON.parse(text) as T) : null
      } catch {
        // Response wasn't JSON — return the raw text.
        data = text as unknown as T
      }

      return { ok: res.ok, status: res.status, data }
    } catch (err) {
      clearTimeout(timeout)
      if (attempt < retries) {
        const delay = retryDelayMs * Math.pow(2, attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      captureError(err instanceof Error ? err : new Error(String(err)), {
        url,
        method,
        attempt,
      })
      return {
        ok: false,
        status: 0,
        data: null,
        error: err instanceof Error ? err.message : 'Network error',
      }
    }
  }
  return { ok: false, status: 0, data: null, error: 'Max retries exceeded' }
}
