import { NextResponse } from 'next/server'
import { checkETag } from '@/lib/middleware/etag'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

// UCP manifest — `/.well-known/ucp`
// Documento §10.1: el comercio publica un JSON público (sin auth) declarando
// versión del protocolo, capacidades soportadas y manejadores de pago.
//
// Esta ruta es `force-static` — el manifiesto NO depende del tenant ni de la
// sesión; se sirve idéntico a todos los agentes. Los 4 transportes (REST /
// MCP / A2A / embedded) se pueden añadir después sin romper este contrato.
//
// SPRINT-AGENTIC-PROTOCOLS-001 — resuelve gap #1 del AUDIT-AGENTIC-PROTOCOLS-001.
//
// SPRINT-PERFORMANCE-FINAL-001 — added ETag (conditional GET → 304) +
// `public-long` CDN cache header via `setCacheHeaders`. Agents that poll
// discovery on every conversation (ChatGPT, Copilot) now get a 304 with no
// body once they've seen the manifest once, served from the CDN edge.
export const dynamic = 'force-static'

export async function GET(req: Request) {
  const manifest = {
    ucp: {
      version: '2026-04-08',
      services: {
        'dev.ucp.shopping': [
          {
            transport: 'rest',
            endpoint: '/api/ucp/v1',
            schema:
              'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
          },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
        'dev.ucp.common.identity_linking': [{ version: '2026-04-08' }],
        'dev.ucp.shopping.order': [{ version: '2026-04-08' }],
        'dev.ucp.shopping.payment_token_exchange': [{ version: '2026-04-08' }],
      },
      payment_handlers: {
        'com.mercadopago': [
          { config: { allowed_card_networks: ['VISA', 'MASTERCARD', 'AMEX'] } },
        ],
        'com.wompi': [
          { config: { allowed_card_networks: ['VISA', 'MASTERCARD', 'DINERS'] } },
        ],
        'com.stripe': [
          {
            config: {
              allowed_card_networks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
            },
          },
        ],
        'com.payu': [
          {
            config: {
              allowed_card_networks: ['VISA', 'MASTERCARD', 'DINERS', 'AMEX'],
            },
          },
        ],
      },
    },
  }

  // SPRINT-PERFORMANCE-FINAL-001 · §3 — conditional GET via ETag. If the
  // agent already has this manifest (sent the matching `If-None-Match`),
  // return 304 with no body — the CDN serves the 304 from the edge.
  const { match, etag } = checkETag(req, manifest)
  if (match) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  const response = NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
  response.headers.set('ETag', etag)
  // public-long: 1h CDN cache, 5min browser SWR. Manifest changes only on
  // protocol-version bumps (rare).
  return setCacheHeaders(response, 'public-long')
}
