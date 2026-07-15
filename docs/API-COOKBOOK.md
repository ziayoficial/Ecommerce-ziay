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
