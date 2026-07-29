# ZIAY API Cookbook

Practical examples for common integration scenarios.

## Authentication

All API requests require a NextAuth session cookie. Get it by logging in:

```bash
# Login as admin
curl -c cookies.txt -X POST http://localhost:3000/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=...&email=valentina@saramantha.co&password=demo123"
```

## Create an AP2 Intent Mandate

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/ap2/mandates \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten-saramantha",
    "userId": "user-valentina-sara",
    "maxAmount": 500000,
    "currency": "COP",
    "categoryLimits": { "moda": 300000 },
    "purpose": "comprar pijamas"
  }'
```

## Create a UCP Checkout Session

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/ucp/v1/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten-saramantha",
    "items": [{ "sku": "PIJ-SHORT-TIRA-001", "quantity": 5 }],
    "intentMandateId": "mandate-id-from-previous-step"
  }'
```

## Query Orders with Pagination

```bash
# First page
curl -b cookies.txt "http://localhost:3000/api/orders?tenantId=ten-saramantha&status=all&cursor="

# Next page (use nextCursor from previous response)
curl -b cookies.txt "http://localhost:3000/api/orders?tenantId=ten-saramantha&status=all&cursor=eyJpZCI6Im9yZGVyLTEifQ=="
```

## Send a WhatsApp Message

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten-saramantha",
    "conversationId": "conv-1",
    "content": "¡Hola! Tu pedido está en camino"
  }'
```

## Process a Retracto (Ley 1480)

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/compliance/retracto \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order-123",
    "tenantId": "ten-saramantha",
    "reason": "Cliente cambió de opinión"
  }'
```

## Generate DIAN Invoice

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/compliance/dian-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order-123",
    "tenantId": "ten-saramantha"
  }'
```

## MCP Tool Call (for Claude/ChatGPT)

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "ziay_search_catalog",
      "arguments": {
        "tenantId": "ten-saramantha",
        "query": "short de pijama"
      }
    }
  }'
```

## Check LLM Costs

```bash
curl -b cookies.txt "http://localhost:3000/api/llm/costs?tenantId=ten-saramantha&days=30"
```

## Set LLM Budget

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/llm/budget \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten-saramantha",
    "budgetUsd": 15,
    "monthlyBudgetUsd": 300
  }'
```

## Issue a Refund (v0.4.0)

Admin or operator can issue a refund against an order; the refund is recorded
in the `Refund` ledger with audit trail, and (if a gateway transaction is
referenced) a fire-and-forget gateway refund is dispatched.

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/orders/order-123/refund \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ten-saramantha",
    "amount": 50000,
    "currency": "COP",
    "reason": "post-retracto Ley 1480 Art 47",
    "gatewayRef": "pi_3OxyzStripePaymentIntent"
  }'
```

## List Refunds for an Order (v0.4.0)

```bash
curl -b cookies.txt "http://localhost:3000/api/orders/order-123/refunds?tenantId=ten-saramantha"
```

## Retry a Failed DIAN Submission (v0.4.0)

If an invoice's DIAN submission ended up in `pending` or `error` state, an
admin can re-trigger submission via Alegra:

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/compliance/dian-retry \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "inv-abc123",
    "tenantId": "ten-saramantha"
  }'
```

## Migrate Gateway Credentials to AES-256-GCM (v0.4.0)

One-shot admin tool to migrate existing plaintext gateway credentials in the
DB to encrypted (AES-256-GCM) form. Idempotent — already-encrypted rows are
skipped. Requires `ENCRYPTION_KEY` to be set.

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/migrate-credentials \
  -H "Content-Type: application/json" \
  -d '{ "dryRun": false }'
```

## Fetch Dynamic OG Image (v0.4.0)

The `/og` route returns a 1200×630 PNG (Edge runtime, ISR 1h) suitable for
social-media sharing. Override the default title/subtitle via query params:

```bash
curl -o og.png "http://localhost:3000/og?title=Mi%20Pedido&subtitle=Saramantha"
# → 200 OK, Content-Type: image/png, ~135 KB
```
