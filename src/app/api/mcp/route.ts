import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireAuth } from '@/lib/auth-helpers'
import { captureError } from '@/lib/capture-error'
import { getLogger } from '@/lib/logger'
import { db } from '@/lib/db'

const log = getLogger('api/mcp')

// POST /api/mcp
// MCP (Model Context Protocol) transport — Documento §10.1.
// Expone las 4 capabilities UCP como tools invocables por LLMs
// (Claude, ChatGPT) vía JSON-RPC 2.0.
//
// Auth: el middleware deja pasar `/api/mcp` (PUBLIC_PATTERNS); esta ruta
// valida internamente la sesión NextAuth (`requireAuth`) + tenant scoping
// (el `tenantId` pasado en cada tool call debe coincidir con el de la sesión,
// salvo platform-admin que puede pasar cualquier tenantId).
//
// Métodos JSON-RPC soportados:
//   - initialize        → handshake, protocolVersion, capabilities, serverInfo
//   - tools/list        → lista las 4 tools con inputSchema JSON Schema
//   - tools/call        → ejecuta una tool por nombre
//
// Las 4 tools (matching UCP capabilities):
//   1. ziay_search_catalog       — search products by query
//   2. ziay_create_checkout      — start a UCP checkout session
//   3. ziay_get_order_status     — check order status
//   4. ziay_list_payment_methods — list available payment methods

// ───────────────────────────────────────────────────────────────────────────
// JSON-RPC types
// ───────────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown> | unknown[]
}

interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function rpcError(
  id: string | number | null | undefined,
  error: JsonRpcError,
  status = 200,
) {
  // JSON-RPC errors are normally returned with HTTP 200 (per spec) — but we
  // surface auth errors with 401 to help MCP clients retry with credentials.
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error },
    { status },
  )
}

const PARSE_ERROR: JsonRpcError = { code: -32700, message: 'Parse error' }
const INVALID_REQUEST: JsonRpcError = {
  code: -32600,
  message: 'Invalid Request',
}
const METHOD_NOT_FOUND: JsonRpcError = {
  code: -32601,
  message: 'Method not found',
}
const INVALID_PARAMS = (msg: string): JsonRpcError => ({
  code: -32602,
  message: `Invalid params: ${msg}`,
})
const INTERNAL_ERROR: JsonRpcError = {
  code: -32603,
  message: 'Internal error',
}

// ───────────────────────────────────────────────────────────────────────────
// Tool input schemas (Zod) — used by `tools/call` to validate `arguments`.
// ───────────────────────────────────────────────────────────────────────────

const SearchCatalogArgsSchema = z.object({
  query: z.string().min(1),
  tenantId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(10),
})

const CreateCheckoutItemSchema = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
})

const CreateCheckoutArgsSchema = z.object({
  tenantId: z.string().min(1),
  items: z.array(CreateCheckoutItemSchema).min(1),
  intentMandateId: z.string().min(1),
})

const GetOrderStatusArgsSchema = z.object({
  orderId: z.string().min(1),
  tenantId: z.string().min(1),
})

const ListPaymentMethodsArgsSchema = z.object({
  tenantId: z.string().min(1),
})

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions for `tools/list`
// ───────────────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'ziay_search_catalog',
    description:
      'Search ZIAY product catalog by query. Returns products with price, stock, and SKU.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term (name, SKU, or category)',
        },
        tenantId: { type: 'string', description: 'Tenant ID' },
        limit: {
          type: 'number',
          description: 'Max results (default 10)',
        },
      },
      required: ['query', 'tenantId'],
    },
  },
  {
    name: 'ziay_create_checkout',
    description:
      'Create a checkout session for a list of products. Returns a checkout URL.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'number' },
            },
            required: ['sku', 'quantity'],
          },
        },
        intentMandateId: {
          type: 'string',
          description: 'AP2 Intent Mandate ID',
        },
      },
      required: ['tenantId', 'items', 'intentMandateId'],
    },
  },
  {
    name: 'ziay_get_order_status',
    description: 'Get the status of an order by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        tenantId: { type: 'string' },
      },
      required: ['orderId', 'tenantId'],
    },
  },
  {
    name: 'ziay_list_payment_methods',
    description: 'List available payment methods for a tenant.',
    inputSchema: {
      type: 'object',
      properties: { tenantId: { type: 'string' } },
      required: ['tenantId'],
    },
  },
]

// ───────────────────────────────────────────────────────────────────────────
// POST handler
// ───────────────────────────────────────────────────────────────────────────

/**
 * MCP (Model Context Protocol) JSON-RPC 2.0 transport handler.
 *
 * Expone las 4 capabilities UCP como tools invocables por LLMs (Claude,
 * ChatGPT) vía JSON-RPC 2.0 (Documento §10.1).
 *
 * Métodos JSON-RPC soportados:
 *   - `initialize`         → handshake, protocolVersion, capabilities, serverInfo
 *   - `tools/list`         → lista las 4 tools con `inputSchema` (JSON Schema)
 *   - `tools/call`         → ejecuta una tool por nombre (valida sesión + tenant)
 *
 * Las 4 tools (matching UCP capabilities):
 *   1. `ziay_search_catalog`       — busca productos por query
 *   2. `ziay_create_checkout`      — inicia una UCP checkout session
 *   3. `ziay_get_order_status`     — consulta el estado de un pedido
 *   4. `ziay_list_payment_methods` — lista los métodos de pago disponibles
 *
 * Auth: el middleware deja pasar `/api/mcp` (PUBLIC_PATTERNS); esta ruta
 * valida internamente la sesión NextAuth (`requireAuth`) + tenant scoping
 * (el `tenantId` pasado en cada tool call debe coincidir con el de la
 * sesión, salvo platform-admin que puede pasar cualquier tenantId).
 *
 * Errores JSON-RPC estándar:
 *   - `-32700` Parse error (JSON inválido)
 *   - `-32600` Invalid Request (jsonrpc/method/id mal formados)
 *   - `-32601` Method not found
 *   - `-32602` Invalid params (Zod falla en los args de la tool)
 *   - `-32603` Internal error
 *   - `-32001` Unauthorized (no hay sesión NextAuth)
 *   - `-32002` Forbidden: tenant mismatch
 *
 * @see docs/openapi.yaml `/api/mcp`
 * @see https://modelcontextprotocol.io/specification
 * @security Sesión NextAuth (`requireAuth`) validada DENTRO del route
 *           handler (no en el middleware). Tenant scoping: el `tenantId`
 *           del body debe coincidir con el de la sesión salvo platform-admin.
 * @returns 200 siempre (JSON-RPC usa HTTP 200 incluso para errores
 *          aplicativos); auth errors usan 401 / 403 / 400 / 500 para
 *          ayudar al cliente MCP a distinguirlos.
 */
export async function POST(req: NextRequest) {
  let body: JsonRpcRequest
  try {
    body = (await req.json()) as JsonRpcRequest
  } catch {
    return rpcError(null, PARSE_ERROR, 400)
  }

  if (
    body.jsonrpc !== '2.0' ||
    typeof body.method !== 'string' ||
    (body.id !== undefined &&
      body.id !== null &&
      typeof body.id !== 'string' &&
      typeof body.id !== 'number')
  ) {
    return rpcError(body?.id, INVALID_REQUEST, 400)
  }

  const { id, method } = body

  // ── initialize ──────────────────────────────────────────────────────
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ziay-mcp', version: '1.0.0' },
    })
  }

  // ── tools/list ──────────────────────────────────────────────────────
  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOL_DEFINITIONS })
  }

  // ── tools/call ──────────────────────────────────────────────────────
  if (method === 'tools/call') {
    return handleToolCall(body, id)
  }

  return rpcError(id, METHOD_NOT_FOUND)
}

// ───────────────────────────────────────────────────────────────────────────
// tools/call dispatcher
// ───────────────────────────────────────────────────────────────────────────

async function handleToolCall(
  body: JsonRpcRequest,
  id: string | number | null | undefined,
) {
  const params = (body.params ?? {}) as {
    name?: string
    arguments?: Record<string, unknown>
  }
  const toolName = params.name
  const args = params.arguments ?? {}

  if (!toolName || typeof toolName !== 'string') {
    return rpcError(id, INVALID_PARAMS('falta `name`'), 400)
  }

  // Auth: MCP requireAuth — el middleware deja pasar la ruta; aquí dentro
  // validamos la sesión NextAuth (cookie). El tenantId de los args debe
  // coincidir con el de la sesión salvo platform-admin.
  const { session, error } = await requireAuth()
  if (error) return rpcError(id, { code: -32001, message: 'Unauthorized' }, 401)

  const sessionTenantId = session?.user?.tenantId ?? null

  const sessionUserId = session?.user?.id ?? 'unknown'

  try {
    switch (toolName) {
      case 'ziay_search_catalog':
        return await toolSearchCatalog(args, id, sessionTenantId)
      case 'ziay_create_checkout':
        return await toolCreateCheckout(args, id, sessionTenantId, sessionUserId)
      case 'ziay_get_order_status':
        return await toolGetOrderStatus(args, id, sessionTenantId)
      case 'ziay_list_payment_methods':
        return await toolListPaymentMethods(args, id, sessionTenantId)
      default:
        return rpcError(id, METHOD_NOT_FOUND)
    }
  } catch (err) {
    captureError(err as Error, {
      path: '/api/mcp',
      method: 'tools/call',
      tool: toolName,
    })
    return rpcError(id, INTERNAL_ERROR, 500)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Tools
// ───────────────────────────────────────────────────────────────────────────

function ensureTenantAccess(
  argsTenantId: string,
  sessionTenantId: string | null,
): JsonRpcError | null {
  // Platform admin (sessionTenantId === null) can read any tenant.
  if (sessionTenantId === null) return null
  if (argsTenantId !== sessionTenantId) {
    return {
      code: -32002,
      message: 'Forbidden: tenant mismatch',
    }
  }
  return null
}

async function toolSearchCatalog(
  args: Record<string, unknown>,
  id: string | number | null | undefined,
  sessionTenantId: string | null,
) {
  const parsed = SearchCatalogArgsSchema.safeParse(args)
  if (!parsed.success) {
    return rpcError(id, INVALID_PARAMS(parsed.error.message), 400)
  }
  const { query, tenantId, limit } = parsed.data

  const err = ensureTenantAccess(tenantId, sessionTenantId)
  if (err) return rpcError(id, err, 403)

  const products = await db.product.findMany({
    where: {
      tenantId,
      OR: [
        { name: { contains: query } },
        { sku: { contains: query } },
        { categoria: { contains: query } },
      ],
    },
    take: limit,
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      stock: true,
      categoria: true,
      imageUrl: true,
    },
  })

  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(products, null, 2) }],
  })
}

async function toolCreateCheckout(
  args: Record<string, unknown>,
  id: string | number | null | undefined,
  sessionTenantId: string | null,
  sessionUserId: string,
) {
  const parsed = CreateCheckoutArgsSchema.safeParse(args)
  if (!parsed.success) {
    return rpcError(id, INVALID_PARAMS(parsed.error.message), 400)
  }
  const { tenantId, items, intentMandateId } = parsed.data

  const err = ensureTenantAccess(tenantId, sessionTenantId)
  if (err) return rpcError(id, err, 403)

  // Verificar el Intent Mandate.
  const intent = await db.aP2Mandate.findFirst({
    where: { id: intentMandateId, type: 'intent', status: 'active' },
  })
  if (!intent) {
    return rpcError(id, {
      code: -32602,
      message: 'Invalid or expired Intent Mandate',
    })
  }
  if (intent.tenantId !== tenantId) {
    return rpcError(id, {
      code: -32602,
      message: 'Intent Mandate does not belong to this tenant',
    })
  }

  // Resolver productos por SKU.
  const skus = items.map(i => i.sku)
  const products = await db.product.findMany({
    where: { tenantId, sku: { in: skus } },
  })
  const missing = skus.filter(s => !products.some(p => p.sku === s))
  if (missing.length > 0) {
    return rpcError(id, {
      code: -32602,
      message: `SKUs no encontrados: ${missing.join(', ')}`,
    })
  }

  // Construir carrito.
  const cart = items.map(i => {
    const p = products.find(pp => pp.sku === i.sku)!
    return {
      sku: i.sku,
      name: p.name,
      price: p.price,
      quantity: i.quantity,
      total: p.price * i.quantity,
    }
  })
  const total = cart.reduce((sum, c) => sum + c.total, 0)

  // Verificar tope del Intent (defense-in-depth — el endpoint UCP original
  // también lo valida; aquí lo replicamos para fallar temprano).
  if (intent.maxAmount !== null && total > intent.maxAmount) {
    return rpcError(id, {
      code: -32602,
      message: `Total (${total}) excede el tope del Intent Mandate (${intent.maxAmount})`,
    })
  }

  // Crear UcpCheckoutSession.
  const session = await db.ucpCheckoutSession.create({
    data: {
      tenantId,
      sessionId: randomUUID(),
      agentDid: `did:mcp:${sessionUserId}`,
      intentMandateId,
      state: 'incomplete',
      cart: JSON.stringify({ items: cart, total }),
      paymentHandler: 'com.mercadopago',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  })

  log.info(
    { sessionId: session.sessionId, tenantId, tool: 'ziay_create_checkout' },
    'MCP checkout session creada',
  )

  return rpcResult(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            checkout_id: session.sessionId,
            checkout_url: `/api/ucp/v1/checkout/${session.sessionId}`,
            total,
            currency: 'COP',
            expires_at: session.expiresAt,
          },
          null,
          2,
        ),
      },
    ],
  })
}

async function toolGetOrderStatus(
  args: Record<string, unknown>,
  id: string | number | null | undefined,
  sessionTenantId: string | null,
) {
  const parsed = GetOrderStatusArgsSchema.safeParse(args)
  if (!parsed.success) {
    return rpcError(id, INVALID_PARAMS(parsed.error.message), 400)
  }
  const { orderId, tenantId } = parsed.data

  const err = ensureTenantAccess(tenantId, sessionTenantId)
  if (err) return rpcError(id, err, 403)

  const order = await db.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true, shipments: true },
  })
  if (!order) {
    return rpcError(id, { code: -32602, message: 'Order not found' }, 404)
  }

  return rpcResult(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            id: order.id,
            number: order.number,
            status: order.status,
            paymentStatus: order.paymentStatus,
            total: order.total,
            currency: order.currency,
            items: order.items.map(i => ({
              sku: i.productId,
              name: i.name,
              quantity: i.quantity,
            })),
            trackingNumber: order.shipments.find(s => s.numeroGuia)?.numeroGuia ?? null,
            trackingUrl:
              order.shipments.find(s => s.urlSeguimiento)?.urlSeguimiento ?? null,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
          },
          null,
          2,
        ),
      },
    ],
  })
}

async function toolListPaymentMethods(
  args: Record<string, unknown>,
  id: string | number | null | undefined,
  sessionTenantId: string | null,
) {
  const parsed = ListPaymentMethodsArgsSchema.safeParse(args)
  if (!parsed.success) {
    return rpcError(id, INVALID_PARAMS(parsed.error.message), 400)
  }
  const { tenantId } = parsed.data

  const err = ensureTenantAccess(tenantId, sessionTenantId)
  if (err) return rpcError(id, err, 403)

  const channels = await db.channel.findMany({
    where: { tenantId, active: true },
    select: { type: true, paymentStrategy: true },
  })
  const methods = channels.map(c => c.type)
  const strategies = channels.map(c => c.paymentStrategy)

  return rpcResult(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            methods,
            strategies: Array.from(new Set(strategies)),
            // Payment handlers declarados en /.well-known/ucp.
            paymentHandlers: [
              'com.mercadopago',
              'com.wompi',
              'com.stripe',
              'com.payu',
            ],
          },
          null,
          2,
        ),
      },
    ],
  })
}
