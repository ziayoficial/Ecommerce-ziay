import { NextResponse } from 'next/server'
import { checkETag } from '@/lib/middleware/etag'
import { setCacheHeaders } from '@/lib/middleware/cache-headers'

// ACP merchant manifest — `/.well-known/acp`
// Documento §9.1: ACP (Agentic Commerce Protocol) — OpenAI/Stripe.
// OpenAI des-priorizó el checkout in-chat en Mar 2026, pero el protocolo
// sobrevive como estándar abierto. Publicamos el manifiesto ACP para que
// agentes externos (ChatGPT, Copilot) puedan descubrir a ZIAY como merchant
// compatible y ejecutar checkout / order_status / refunds.
//
// SPRINT-PROTOCOLS-TRINITY-001 — completa la trinidad de protocolos
// agénticos (AP2 + UCP ✅ + ACP + MCP + A2A).
//
// La ruta es `force-static` — el manifiesto no depende del tenant ni de la
// sesión; se sirve idéntico a todos los agentes ACP. Las credenciales reales
// (Bearer = AP2 Intent Mandate ID) se validan dentro de cada ruta /api/acp/v1/*.
//
// SPRINT-PERFORMANCE-FINAL-001 — added ETag (conditional GET → 304) +
// `public-long` CDN cache header. See `/.well-known/ucp` for the same
// treatment + rationale.
export const dynamic = 'force-static'

export async function GET(req: Request) {
  const manifest = {
    acp: {
      version: '2026-03-01',
      merchant: {
        id: 'ziay',
        name: 'ZIAY Commerce',
        domains: [process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'],
      },
      capabilities: {
        checkout: {
          endpoint: '/api/acp/v1/checkout',
          methods: ['POST'],
          auth: 'bearer',
        },
        order_status: {
          endpoint: '/api/acp/v1/orders/{id}',
          methods: ['GET'],
          auth: 'bearer',
        },
        refunds: {
          endpoint: '/api/acp/v1/refunds',
          methods: ['POST'],
          auth: 'bearer',
        },
      },
      payment_methods: ['card', 'mercadopago', 'wompi'],
      supported_currencies: ['COP', 'MXN', 'USD'],
    },
  }

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
  return setCacheHeaders(response, 'public-long')
}
