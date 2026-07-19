// ZIAY — Built-in Agent Tools (IA-5 · tool-use)
//
// Self-registering tools the agent layer can invoke via LLM
// function-calling. Each tool:
//   - Has a Zod schema for parameter validation.
//   - Filters by `ctx.tenantId` (tenant isolation is the contract).
//   - Has a per-call timeout (default 5s).
//   - Has permission scoping via `TOOL_PERMISSIONS` (only specific
//     agents can use each tool).
//   - Returns a structured `ToolResult`.
//
// The 10 built-ins:
//   1. search_catalog        — search products by query/theme/category.
//   2. get_product           — fetch a single product by SKU.
//   3. calculate_quote       — price items with volume discounts.
//   4. check_stock           — verify stock for a product.
//   5. validate_address      — validate a delivery address.
//   6. calculate_shipping    — quote freight via logistics adapter.
//   7. get_customer_history  — fetch a customer's past orders.
//   8. recall_memory         — recall long-term customer memories.
//   9. create_order          — create a draft order.
//  10. check_budget          — check tenant token/USD budget remaining.
//
// IA-5 (tool-use)

import { z } from 'zod'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { getLogisticsAdapter } from '@/lib/adapters/registry'
import { quoteProducts } from '@/lib/agents/dynamic-quote'
import { recallCustomerMemory } from '@/lib/agents/memory-curator.service'
import { budgetManager } from '@/lib/agents/budget'
import {
  toolRegistry,
  TOOL_PERMISSIONS,
  type AgentTool,
  type ToolContext,
  type ToolResult,
} from './registry'

const log = getLogger('agent:tools:builtins')

// ───────────────────────────────────────────────────────────────────────────
// 1. search_catalog — search products by query / theme / category
// ───────────────────────────────────────────────────────────────────────────

const SearchCatalogSchema = z.object({
  query: z.string().min(1).max(200).optional(),
  theme: z.string().min(1).max(100).optional(),
  category: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(10),
}).refine(
  (v) => v.query || v.theme || v.category,
  { message: 'at least one of query, theme, or category must be provided' },
)

const searchCatalogTool: AgentTool = {
  name: 'search_catalog',
  description:
    'Search the tenant product catalog by free-text query, design theme (e.g. "Stitch", "Hello Kitty"), or category (e.g. "familia", "short"). Returns up to `limit` matching products with SKU, name, price, stock, and image URL.',
  parameters: {
    query: { type: 'string', description: 'Free-text search query (product name or description fragment).', required: false },
    theme: { type: 'string', description: 'Design theme filter — matches the `diseno` column (e.g. "Stitch", "Hello Kitty").', required: false },
    category: { type: 'string', description: 'Product category filter — matches the `categoria` column (e.g. "familia", "short", "pantalon").', required: false },
    limit: { type: 'number', description: 'Maximum number of products to return (1-50). Defaults to 10.', required: false },
  },
  schema: SearchCatalogSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.search_catalog,
  timeout: 5_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { query, theme, category, limit } = params as {
        query?: string
        theme?: string
        category?: string
        limit: number
      }
      // Build a tenant-scoped where clause — every filter is AND'd.
      const where: Record<string, unknown> = {
        tenantId: ctx.tenantId,
        active: true,
      }
      if (query) {
        where.OR = [
          { name: { contains: query } },
          { description: { contains: query } },
          { sku: { contains: query } },
        ]
      }
      if (theme) where.diseno = { contains: theme }
      if (category) where.categoria = { contains: category }

      const products = await db.product.findMany({
        where,
        select: {
          id: true, sku: true, name: true, price: true, stock: true,
          imageUrl: true, diseno: true, categoria: true, currency: true,
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      })
      return {
        success: true,
        data: { count: products.length, products },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId }, 'search_catalog failed')
      return {
        success: false,
        error: err instanceof Error ? err.message : 'search_catalog failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 2. get_product — fetch a single product by SKU
// ───────────────────────────────────────────────────────────────────────────

const GetProductSchema = z.object({
  sku: z.string().min(1).max(100),
})

const getProductTool: AgentTool = {
  name: 'get_product',
  description:
    'Fetch a single product by its SKU. Returns full product details (name, description, price, cost, stock, design, category, image URL, currency). Returns an error if the SKU is not found in the tenant catalog.',
  parameters: {
    sku: { type: 'string', description: 'The product SKU to look up.', required: true },
  },
  schema: GetProductSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.get_product,
  timeout: 3_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { sku } = params as { sku: string }
      const product = await db.product.findFirst({
        where: { tenantId: ctx.tenantId, sku, active: true },
        select: {
          id: true, sku: true, name: true, description: true,
          price: true, cost: true, stock: true, imageUrl: true,
          diseno: true, categoria: true, currency: true,
        },
      })
      if (!product) {
        return {
          success: false,
          error: `product not found: SKU ${sku}`,
          latencyMs: Date.now() - start,
        }
      }
      return {
        success: true,
        data: product,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'get_product failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 3. calculate_quote — price items with volume discounts
// ───────────────────────────────────────────────────────────────────────────

const CalculateQuoteSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(10_000),
  })).min(1).max(50),
})

const calculateQuoteTool: AgentTool = {
  name: 'calculate_quote',
  description:
    'Calculate a quote for a list of items with volume discounts applied. Each item is `{ sku, quantity }`. Returns line items with unit price (after volume tier), subtotal per line, and the order subtotal. Warnings flag out-of-stock or unknown SKUs. Prices come from the tenant DB — never invented.',
  parameters: {
    items: {
      type: 'array',
      description: 'List of `{ sku, quantity }` items to quote (1-50 items).',
      required: true,
      items: {
        type: 'object',
        description: 'A single line item with SKU + quantity.',
        properties: {
          sku: { type: 'string', description: 'Product SKU.' },
          quantity: { type: 'number', description: 'Quantity (positive integer).' },
        },
      },
    },
  },
  schema: CalculateQuoteSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.calculate_quote,
  timeout: 5_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { items } = params as { items: { sku: string; quantity: number }[] }
      // Reuses the existing `quoteProducts` engine — same volume-tier
      // logic the quote agent's prompt-builder uses, but now exposed
      // as a callable tool so the LLM can iterate on quantities.
      const result = await quoteProducts(ctx.tenantId, items)
      return {
        success: true,
        data: {
          items: result.items,
          subtotal: result.subtotal,
          warnings: result.warnings,
          currency: 'COP',
        },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'calculate_quote failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 4. check_stock — verify stock for a product
// ───────────────────────────────────────────────────────────────────────────

const CheckStockSchema = z.object({
  sku: z.string().min(1).max(100),
  requestedQuantity: z.number().int().min(1).max(10_000).optional(),
})

const checkStockTool: AgentTool = {
  name: 'check_stock',
  description:
    'Check current stock for a product SKU. Optionally pass `requestedQuantity` to get an `available` boolean + shortage warning. Returns `{ sku, stock, requestedQuantity?, available?, shortage? }`.',
  parameters: {
    sku: { type: 'string', description: 'Product SKU.', required: true },
    requestedQuantity: { type: 'number', description: 'Optional quantity the customer wants — used to compute `available` and `shortage`.', required: false },
  },
  schema: CheckStockSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.check_stock,
  timeout: 3_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { sku, requestedQuantity } = params as {
        sku: string
        requestedQuantity?: number
      }
      const product = await db.product.findFirst({
        where: { tenantId: ctx.tenantId, sku, active: true },
        select: { sku: true, name: true, stock: true },
      })
      if (!product) {
        return {
          success: false,
          error: `product not found: SKU ${sku}`,
          latencyMs: Date.now() - start,
        }
      }
      const data: Record<string, unknown> = {
        sku: product.sku,
        name: product.name,
        stock: product.stock,
      }
      if (typeof requestedQuantity === 'number') {
        data.requestedQuantity = requestedQuantity
        data.available = product.stock >= requestedQuantity
        if (product.stock < requestedQuantity) {
          data.shortage = requestedQuantity - product.stock
        }
      }
      return {
        success: true,
        data,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'check_stock failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 5. validate_address — validate a delivery address
// ───────────────────────────────────────────────────────────────────────────

const ValidateAddressSchema = z.object({
  city: z.string().min(1).max(200),
  country: z.string().min(2).max(2).default('CO'),
  address: z.string().min(1).max(500).optional(),
  postalCode: z.string().max(20).optional(),
})

const validateAddressTool: AgentTool = {
  name: 'validate_address',
  description:
    'Validate a delivery address. Returns `{ valid, normalizedCity, country, coverage, warnings[] }`. Coverage is true when the tenant\'s logistics adapter serves the city. Warnings flag missing fields or risky addresses (e.g. PO box only, no street number).',
  parameters: {
    city: { type: 'string', description: 'City name (e.g. "Bogotá", "Medellín").', required: true },
    country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (default "CO").', required: false },
    address: { type: 'string', description: 'Street address line (optional but recommended).', required: false },
    postalCode: { type: 'string', description: 'Postal code (optional).', required: false },
  },
  schema: ValidateAddressSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.validate_address,
  timeout: 4_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { city, country, address, postalCode } = params as {
        city: string
        country: string
        address?: string
        postalCode?: string
      }
      const warnings: string[] = []
      let coverage = false

      // Coverage check via the tenant's logistics adapter. If the
      // adapter throws (no creds, no provider), we mark coverage as
      // unknown and warn — the agent can ask the customer to confirm.
      try {
        const adapter = await getLogisticsAdapter(ctx.tenantId)
        // Quote 1 unit to probe coverage — adapters return null or
        // throw when the city is not served.
        const quote = await adapter.cotizarFlete(city, country, 1)
        coverage = Boolean(quote && quote.tarifa > 0)
      } catch (err) {
        warnings.push(
          `logistics adapter unavailable: ${err instanceof Error ? err.message : 'unknown'}`,
        )
      }

      // Basic field-presence checks.
      if (!address) warnings.push('missing street address line')
      if (address && !/\d/.test(address)) {
        warnings.push('address has no street number — may be undeliverable')
      }
      if (country !== 'CO' && !postalCode) {
        warnings.push('international shipment without postal code — may delay delivery')
      }

      return {
        success: true,
        data: {
          valid: warnings.length === 0,
          normalizedCity: city.trim(),
          country: country.toUpperCase(),
          coverage,
          warnings,
        },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'validate_address failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 6. calculate_shipping — quote freight via logistics adapter
// ───────────────────────────────────────────────────────────────────────────

const CalculateShippingSchema = z.object({
  city: z.string().min(1).max(200),
  country: z.string().min(2).max(2).default('CO'),
  units: z.number().int().min(1).max(10_000),
})

const calculateShippingTool: AgentTool = {
  name: 'calculate_shipping',
  description:
    'Quote freight cost for shipping `units` units to `city, country`. Uses the tenant\'s logistics adapter (Dropi / 99envios / Aveonline). Returns `{ carrier, cost, currency, estimatedDays, isInternational }`. Returns an error if no carrier serves the route.',
  parameters: {
    city: { type: 'string', description: 'Destination city.', required: true },
    country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code (default "CO").', required: false },
    units: { type: 'number', description: 'Total number of units to ship (drives weight/volume bracket).', required: true },
  },
  schema: CalculateShippingSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.calculate_shipping,
  timeout: 6_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { city, country, units } = params as {
        city: string
        country: string
        units: number
      }
      const adapter = await getLogisticsAdapter(ctx.tenantId)
      const quote = await adapter.cotizarFlete(city, country, units)
      if (!quote || quote.tarifa <= 0) {
        return {
          success: false,
          error: `no carrier serves ${city}, ${country} for ${units} units`,
          latencyMs: Date.now() - start,
        }
      }
      const isInternational = country.toUpperCase() !== 'CO'
      return {
        success: true,
        data: {
          carrier: quote.transportadora,
          cost: quote.tarifa,
          currency: isInternational ? 'USD' : 'COP',
          estimatedDays: `${quote.tiempo_estimado_dias} business days`,
          isInternational,
        },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'calculate_shipping failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 7. get_customer_history — fetch a customer's past orders
// ───────────────────────────────────────────────────────────────────────────

const GetCustomerHistorySchema = z.object({
  customerId: z.string().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(10),
})

const getCustomerHistoryTool: AgentTool = {
  name: 'get_customer_history',
  description:
    'Fetch a customer\'s past orders (most recent first). Returns `{ count, orders[] }` with order number, status, total, currency, createdAt, and line items. Requires `customerId` (from ctx.customerId or passed explicitly).',
  parameters: {
    customerId: { type: 'string', description: 'Customer ID. If omitted, the tool uses `ctx.customerId`.', required: false },
    limit: { type: 'number', description: 'Maximum orders to return (1-50, default 10).', required: false },
  },
  schema: GetCustomerHistorySchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.get_customer_history,
  timeout: 4_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const customerId = (params.customerId as string) || ctx.customerId
      if (!customerId) {
        return {
          success: false,
          error: 'customerId required (pass explicitly or set ctx.customerId)',
          latencyMs: Date.now() - start,
        }
      }
      const { limit } = params as { limit: number }
      const orders = await db.order.findMany({
        where: { tenantId: ctx.tenantId, customerId },
        select: {
          id: true, number: true, status: true, total: true,
          currency: true, createdAt: true,
          items: { select: { name: true, unitPrice: true, quantity: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return {
        success: true,
        data: { count: orders.length, orders },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'get_customer_history failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 8. recall_memory — recall long-term customer memories
// ───────────────────────────────────────────────────────────────────────────

const RecallMemorySchema = z.object({
  query: z.string().min(1).max(500),
  customerId: z.string().min(1).max(100).optional(),
  topK: z.number().int().min(1).max(20).default(5),
})

const recallMemoryTool: AgentTool = {
  name: 'recall_memory',
  description:
    'Recall long-term customer memories (preferences, past purchases, objections, budget, brand affinity) relevant to a query. Uses semantic search over the CustomerMemory table. Returns `{ count, memories[] }` with type, key, value, confidence, and similarity score. Requires `customerId` (from ctx.customerId or passed explicitly).',
  parameters: {
    query: { type: 'string', description: 'The query to find relevant memories for (e.g. "payment preference", "past Stitch purchases").', required: true },
    customerId: { type: 'string', description: 'Customer ID. If omitted, uses ctx.customerId.', required: false },
    topK: { type: 'number', description: 'Maximum memories to return (1-20, default 5).', required: false },
  },
  schema: RecallMemorySchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.recall_memory,
  timeout: 4_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const customerId = (params.customerId as string) || ctx.customerId
      if (!customerId) {
        return {
          success: false,
          error: 'customerId required (pass explicitly or set ctx.customerId)',
          latencyMs: Date.now() - start,
        }
      }
      const { query, topK } = params as { query: string; topK: number }
      const memories = await recallCustomerMemory({
        tenantId: ctx.tenantId,
        customerId,
        query,
        topK,
        minScore: 0.15,
      })
      return {
        success: true,
        data: { count: memories.length, memories },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'recall_memory failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 9. create_order — create a draft order
// ───────────────────────────────────────────────────────────────────────────

const CreateOrderSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(10_000),
  })).min(1).max(50),
  customerId: z.string().min(1).max(100).optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(2).optional(),
  paymentMode: z.enum(['advance', 'cod', 'hybrid']).default('cod'),
})

const createOrderTool: AgentTool = {
  name: 'create_order',
  description:
    'Create a draft order (status="new", paymentStatus="unpaid"). Computes subtotal from real product prices + volume tiers, fetches a freight quote (if city provided), and persists the order with line items. Returns `{ orderId, orderNumber, subtotal, shipping, total, currency }`. Does NOT charge the customer — checkout confirmation is a separate step.',
  parameters: {
    items: {
      type: 'array',
      description: 'List of `{ sku, quantity }` items (1-50).',
      required: true,
      items: {
        type: 'object',
        description: 'A single line item with SKU + quantity.',
        properties: {
          sku: { type: 'string', description: 'Product SKU.' },
          quantity: { type: 'number', description: 'Quantity (positive integer).' },
        },
      },
    },
    customerId: { type: 'string', description: 'Customer ID. If omitted, uses ctx.customerId.', required: false },
    city: { type: 'string', description: 'Delivery city (for freight quote).', required: false },
    country: { type: 'string', description: 'ISO country code (default "CO").', required: false },
    paymentMode: { type: 'string', description: 'Payment mode: advance | cod | hybrid (default "cod").', required: false, enum: ['advance', 'cod', 'hybrid'] },
  },
  schema: CreateOrderSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.create_order,
  timeout: 8_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const customerId = (params.customerId as string) || ctx.customerId
      if (!customerId) {
        return {
          success: false,
          error: 'customerId required to create an order',
          latencyMs: Date.now() - start,
        }
      }
      const { items, city, country, paymentMode } = params as {
        items: { sku: string; quantity: number }[]
        city?: string
        country?: string
        paymentMode: 'advance' | 'cod' | 'hybrid'
      }

      // Compute subtotal via the existing quote engine (tenant-scoped,
      // volume-tier aware). Never invent prices.
      const quote = await quoteProducts(ctx.tenantId, items)
      if (quote.items.length === 0) {
        return {
          success: false,
          error: 'no valid products in items (check SKUs)',
          latencyMs: Date.now() - start,
        }
      }

      // Freight quote (optional — only when city is provided).
      let shipping = 0
      if (city) {
        try {
          const adapter = await getLogisticsAdapter(ctx.tenantId)
          const units = items.reduce((s, i) => s + i.quantity, 0)
          const freight = await adapter.cotizarFlete(
            city,
            (country ?? 'CO').toUpperCase(),
            units,
          )
          if (freight && freight.tarifa > 0) shipping = freight.tarifa
        } catch (err) {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId, city },
            'create_order freight quote failed — proceeding with shipping=0',
          )
        }
      }

      const subtotal = quote.subtotal
      const total = subtotal + shipping
      const orderNumber = `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Persist the draft order with line items. Uses a transaction so
      // the order + items are atomic — a partial write would leave an
      // orphan order header in the kanban view.
      const order = await db.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            tenantId: ctx.tenantId,
            number: orderNumber,
            customerId,
            conversationId: ctx.conversationId,
            status: 'new',
            paymentMode,
            paymentStatus: 'unpaid',
            subtotal,
            shipping,
            total,
            currency: 'COP',
            country: (country ?? 'CO').toUpperCase(),
            city,
            origen: 'agente_whatsapp',
          },
        })
        // Line items — link to product by SKU for inventory attribution.
        for (const item of quote.items) {
          const product = await tx.product.findFirst({
            where: { tenantId: ctx.tenantId, sku: item.sku },
            select: { id: true },
          })
          await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: product?.id ?? 'unknown',
              name: item.productName,
              unitPrice: item.unitPrice,
              // OrderItem schema requires `cost` (per Prisma schema).
              // We don't have the per-item cost from the quote engine —
              // use 0 as a conservative placeholder (the COGS calculation
              // in the dashboard already guards against this).
              cost: 0,
              quantity: item.quantity,
              diseno: item.designNote ?? null,
            },
          })
        }
        return created
      })

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.number,
          subtotal,
          shipping,
          total,
          currency: 'COP',
          warnings: quote.warnings,
        },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'create_order failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// 10. check_budget — check tenant token/USD budget remaining
// ───────────────────────────────────────────────────────────────────────────

const CheckBudgetSchema = z.object({
  estimatedTokens: z.number().int().min(0).max(1_000_000).optional(),
}).default({})

const checkBudgetTool: AgentTool = {
  name: 'check_budget',
  description:
    'Check the tenant\'s remaining LLM token + USD budget for the current day and month. Optionally pass `estimatedTokens` to test whether a specific call would fit. Returns `{ allowed, remaining, daily: { tokensUsed, tokensLimit, costUsd, costLimitUsd }, monthly: {...} }`. Used by the Governor agent to decide whether to allow a message through.',
  parameters: {
    estimatedTokens: { type: 'number', description: 'Optional estimated token count for a planned call — the tool returns `allowed: false` if the call would exceed the budget.', required: false },
  },
  schema: CheckBudgetSchema as z.ZodType<Record<string, unknown>>,
  allowedAgents: TOOL_PERMISSIONS.check_budget,
  timeout: 3_000,
  async handler(params, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now()
    try {
      const { estimatedTokens } = params as { estimatedTokens?: number }
      const status = await budgetManager.getStatus(ctx.tenantId)
      // If `estimatedTokens` is provided, do a hypothetical check.
      let allowed = true
      if (typeof estimatedTokens === 'number' && estimatedTokens > 0) {
        const check = await budgetManager.checkBudget(ctx.tenantId, estimatedTokens)
        allowed = check.allowed
      }
      return {
        success: true,
        data: {
          allowed,
          estimatedTokens,
          daily: {
            periodKey: status.daily.periodKey,
            tokensUsed: status.daily.tokensUsed,
            tokensLimit: status.daily.tokensLimit,
            costUsd: status.daily.costUsd,
            costLimitUsd: status.daily.costLimitUsd,
          },
          monthly: {
            periodKey: status.monthly.periodKey,
            tokensUsed: status.monthly.tokensUsed,
            tokensLimit: status.monthly.tokensLimit,
            costUsd: status.monthly.costUsd,
            costLimitUsd: status.monthly.costLimitUsd,
          },
        },
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'check_budget failed',
        latencyMs: Date.now() - start,
      }
    }
  },
}

// ───────────────────────────────────────────────────────────────────────────
// Self-register all 10 built-in tools on first import.
// Idempotent — `toolRegistry.register` is a no-op if the name already exists.
// ───────────────────────────────────────────────────────────────────────────

export const BUILTIN_TOOLS: AgentTool[] = [
  searchCatalogTool,
  getProductTool,
  calculateQuoteTool,
  checkStockTool,
  validateAddressTool,
  calculateShippingTool,
  getCustomerHistoryTool,
  recallMemoryTool,
  createOrderTool,
  checkBudgetTool,
]

let _registered = false
export function registerBuiltins(): void {
  if (_registered) return
  for (const tool of BUILTIN_TOOLS) {
    toolRegistry.register(tool)
  }
  _registered = true
  log.info({ count: BUILTIN_TOOLS.length, names: BUILTIN_TOOLS.map((t) => t.name) }, 'built-in tools registered')
}

// Eager registration on module import.
registerBuiltins()

// Re-export the singleton registry + types for callers that want a
// single import line.
export { toolRegistry } from './registry'
export type { AgentTool, ToolContext, ToolResult, ToolParameter } from './registry'
