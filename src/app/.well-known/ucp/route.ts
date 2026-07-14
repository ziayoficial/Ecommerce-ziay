import { NextResponse } from 'next/server'

// UCP manifest — `/.well-known/ucp`
// Documento §10.1: el comercio publica un JSON público (sin auth) declarando
// versión del protocolo, capacidades soportadas y manejadores de pago.
//
// Esta ruta es `force-static` — el manifiesto NO depende del tenant ni de la
// sesión; se sirve idéntico a todos los agentes. Los 4 transportes (REST /
// MCP / A2A / embedded) se pueden añadir después sin romper este contrato.
//
// SPRINT-AGENTIC-PROTOCOLS-001 — resuelve gap #1 del AUDIT-AGENTIC-PROTOCOLS-001.
export const dynamic = 'force-static'

export async function GET() {
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
  return NextResponse.json(manifest, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
