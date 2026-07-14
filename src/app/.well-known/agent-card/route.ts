import { NextResponse } from 'next/server'

// A2A agent-card — `/.well-known/agent-card.json`
// Documento §10.1: A2A (Agent-to-Agent) — permite que otros agentes
// descubran las capacidades del agente de ZIAY.
//
// SPRINT-PROTOCOLS-TRINITY-001 — completa la trinidad de protocolos
// agénticos (AP2 + UCP ✅ + ACP + MCP + A2A).
//
// `force-static` — el card no depende del tenant ni de la sesión; se sirve
// idéntico a cualquier agente que lo solicite. Los endpoints referenciados
// (`/api/ucp/v1/*`, `/api/ap2/mandates`) aplican su propia auth (Bearer o
// sesión NextAuth).
export const dynamic = 'force-static'

export async function GET() {
  const card = {
    name: 'ZIAY Commerce Agent',
    description:
      'Agentic commerce platform for LATAM. Discovers products, builds carts, processes payments with AP2/UCP compliance.',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    version: '1.0.0',
    capabilities: {
      catalog: {
        endpoint: '/api/ucp/v1/catalog',
        transports: ['rest', 'mcp', 'a2a'],
      },
      checkout: {
        endpoint: '/api/ucp/v1/checkout',
        transports: ['rest', 'mcp', 'a2a'],
      },
      payment: {
        endpoint: '/api/ap2/mandates',
        transports: ['rest'],
        protocols: ['ap2'],
      },
      order: {
        endpoint: '/api/ucp/v1/order',
        transports: ['rest', 'mcp', 'a2a'],
      },
    },
    authentication: {
      type: 'bearer',
      description: 'AP2 Intent Mandate ID as Bearer token',
    },
    protocols: ['ucp', 'ap2', 'acp', 'mcp', 'a2a'],
    paymentHandlers: ['com.mercadopago', 'com.wompi', 'com.stripe', 'com.payu'],
    supportedCurrencies: ['COP', 'MXN', 'USD'],
    locales: ['es-CO', 'es-MX', 'en-US'],
    compliance: {
      ley2573_2026: true,
      ley1581_2012: true,
    },
    // Discovery hints para agentes externos.
    wellKnown: {
      ucp: '/.well-known/ucp',
      acp: '/.well-known/acp',
      agentCard: '/.well-known/agent-card',
    },
    mcp: {
      endpoint: '/api/mcp',
      protocolVersion: '2024-11-05',
      transport: 'http-jsonrpc',
    },
  }
  return NextResponse.json(card, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
