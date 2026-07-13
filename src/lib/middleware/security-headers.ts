// ZIAY — Security headers middleware
//
// Saramantha §13 — hardening HTTP. Aplica headers de seguridad estándar a
// cualquier NextResponse:
//   - X-Frame-Options: DENY           (clickjacking)
//   - X-Content-Type-Options: nosniff (MIME sniffing)
//   - Strict-Transport-Security       (HTTPS forzado, 1 año + subdominios)
//   - Referrer-Policy                 (referrer estricto cross-origin)
//   - Permissions-Policy              (sin cámara/micrófono/geolocalización)
//   - Content-Security-Policy: default-src 'none'  (solo para respuestas JSON)
//
// Uso en una API route:
//   import { addSecurityHeaders } from '@/lib/middleware/security-headers'
//   return addSecurityHeaders(NextResponse.json({ ok: true }))
//
// O en un middleware global (src/middleware.ts):
//   const res = NextResponse.next()
//   return addSecurityHeaders(res)

import { NextResponse } from 'next/server'

export function addSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  )
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  )
  if (response.headers.get('content-type')?.includes('application/json')) {
    response.headers.set('Content-Security-Policy', "default-src 'none'")
  }
  return response
}
