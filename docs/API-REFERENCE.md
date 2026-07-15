# Referencia API — CommerceFlow OS

Documentación completa de las **34 rutas API** de CommerceFlow OS. Todas las rutas están bajo el prefijo `/api` y son servidas por Next.js 16 (App Router) en el puerto 3000 (detrás del gateway Caddy en el puerto 81).

> 📖 Para la guía de desarrollo local ver [`DEVELOPMENT.md`](./DEVELOPMENT.md).
> 📖 Para la documentación del modelo de datos ver [`DATA-MODEL.md`](./DATA-MODEL.md).

---

## 📋 Convenciones

### Formato de respuesta

Todas las respuestas son **JSON** con `Content-Type: application/json`.

**Respuesta exitosa** (status 2xx):
```json
{ "data": "...", "meta": { "page": 1, "total": 100 } }
```

**Error** (status 4xx/5xx):
```json
{ "error": "Descripción del error en español" }
```

### Parámetros

| Origen | Notación | Ejemplo |
|--------|----------|---------|
| Query string | `camelCase` | `?tenantId=ten-saramantha` |
| Path param | `kebab-case` o `[id]` | `/api/agents/[agentName]` |
| Body | `snake_case` para inputs de adapters, `camelCase` para el resto | `{ conversationId: "...", body: "..." }` |

### Filtro multi-tenant

La mayoría de endpoints aceptan `?tenantId=ten-xxxx`. Si se omite, se retornan datos agregados de todos los tenants (solo para endpoints de overview/metrics).

### Autenticación

Actualmente las APIs no requieren autenticación (modo dev). En producción, NextAuth protegerá las rutas — ver `[Unreleased]` en [`../CHANGELOG.md`](../CHANGELOG.md).

---

## 📑 Tabla de contenidos

1. [Overview](#1-overview)
2. [Conversations](#2-conversations)
3. [Orders](#3-orders)
4. [Ads](#4-ads)
5. [Agents](#5-agents)
6. [Monetization](#6-monetization)
7. [Attribution](#7-attribution)
8. [Metrics](#8-metrics)
9. [Conciliation](#9-conciliation)
10. [Onboarding](#10-onboarding)
11. [Tenants](#11-tenants)
12. [Channels](#12-channels)
13. [Catalog](#13-catalog)
14. [Shipping](#14-shipping)
15. [Health](#15-health)
16. [LLM Providers](#16-llm-providers)
17. [Vision Pipeline](#17-vision-pipeline)
18. [Image Identifications](#18-image-identifications)
19. [Payments Config](#19-payments-config)
20. [Orchestrate](#20-orchestrate)
21. [Webhooks](#21-webhooks)
22. [AI Reply](#22-ai-reply-legacy)

---

## 1. Overview

### `GET /api/overview`

Devuelve KPIs agregados para el dashboard de Resumen: revenue, ROAS, CPA, ROI, AOV, CTR, series temporales (revenue vs spend), split por canal y distribución por modo de pago.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `days` | number | `14` | Ventana en días hacia atrás |
| `tenantId` | string | (todos) | Filtra por tenant |

**Response 200**

```json
{
  "kpis": {
    "revenue": 32647242,
    "revenuePaid": 12450000,
    "orders": 238,
    "conversations": 156,
    "spend": 4500000,
    "impressions": 1450000,
    "clicks": 18200,
    "ctr": 0.0126,
    "cpc": 247.25,
    "cogs": 9800000,
    "grossProfit": 2650000,
    "netProfit": -1850000,
    "roas": 2.77,
    "roi": -0.41,
    "cpa": 18907.56,
    "aov": 137173
  },
  "series": [
    { "date": "2026-01-01", "revenue": 1200000, "spend": 320000, "orders": 12 }
  ],
  "channelSplit": [
    { "id": "ch-wa-co", "name": "WhatsApp Colombia", "type": "whatsapp", "orders": 180, "revenue": 24500000, "strategy": "hybrid" }
  ],
  "paymentModeSplit": { "advance": 35, "cod": 180, "hybrid": 23 }
}
```

**Ejemplo**

```bash
curl "http://localhost:3000/api/overview?days=30&tenantId=ten-saramantha"
```

---

## 2. Conversations

### `GET /api/conversations`

Lista conversaciones para la bandeja unificada.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `status` | string | `all` | `open` \| `pending` \| `resolved` \| `closed` \| `all` |
| `channel` | string | `all` | ID del canal |
| `q` | string | — | Búsqueda léxica en nombre del customer |
| `tenantId` | string | (todos) | Filtra por tenant |

**Response 200**

```json
{
  "conversations": [
    {
      "id": "conv-001",
      "status": "open",
      "priority": "normal",
      "unreadCount": 2,
      "lastMessageAt": "2026-01-15T14:32:00.000Z",
      "utm": "utm_source=fb...",
      "sourceAdId": "ad-123",
      "sourceCampaign": "Ramificación Ene 2026",
      "customer": { "id": "cus-001", "name": "María González", "phone": "+573001234567", "country": "CO" },
      "channel": { "id": "ch-wa-co", "type": "whatsapp", "displayName": "WhatsApp Colombia", "paymentStrategy": "hybrid" },
      "assignee": { "id": "usr-001", "name": "Sara" },
      "lastMessage": { "body": "Hola, vi el anuncio del short...", "direction": "inbound", "createdAt": "2026-01-15T14:32:00.000Z" }
    }
  ]
}
```

### `POST /api/conversations`

Envía un mensaje outbound a una conversación. Genera embedding para memoria semántica (Saramantha §3).

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `conversationId` | string | ✅ | ID de la conversación |
| `body` | string | ✅ | Texto del mensaje |
| `direction` | string | ❌ | `outbound` (default) \| `inbound` |
| `tenantId` | string | ❌ | Default `ten-saramantha` |

**Response 200**

```json
{
  "message": {
    "id": "msg-001",
    "conversationId": "conv-001",
    "direction": "outbound",
    "body": "¡Hola María! ¿Para ti o para tu negocio?",
    "type": "text",
    "status": "sent",
    "aiSuggested": false,
    "createdAt": "2026-01-15T14:33:00.000Z"
  },
  "embedded": true
}
```

### `GET /api/conversations/[id]`

Devuelve el detalle de una conversación con todos sus mensajes y datos del customer.

**Path params**

| Param | Descripción |
|-------|-------------|
| `id` | ID de la conversación |

**Response 200**

```json
{
  "conversation": {
    "id": "conv-001",
    "status": "open",
    "perfilConversacion": "mayorista",
    "sourceAdId": "ad-123",
    "customer": { "id": "cus-001", "name": "María González", "phone": "+573001234567", "perfilDetectado": "mayorista" },
    "channel": { /* ... */ },
    "messages": [
      { "id": "msg-001", "direction": "inbound", "body": "...", "createdAt": "..." }
    ]
  }
}
```

### `PATCH /api/conversations/[id]`

Actualiza estado, prioridad, asignación o perfil de la conversación.

**Body** (todos opcionales)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `status` | string | `open` \| `pending` \| `resolved` \| `closed` |
| `priority` | string | `low` \| `normal` \| `high` |
| `assigneeId` | string | ID del usuario asignado |
| `perfilConversacion` | string | `mayorista` \| `emprendedor` \| `detal` \| `regalo` |

### `GET /api/conversations/search`

Búsqueda semántica sobre los embeddings de mensajes (Saramantha §3).

**Query params**

| Param | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `q` | string | ✅ | Texto de búsqueda |
| `tenantId` | string | ❌ | Filtra por tenant |
| `limit` | number | ❌ | Default `10` |

**Response 200**

```json
{
  "results": [
    {
      "messageId": "msg-001",
      "conversationId": "conv-001",
      "body": "...",
      "score": 0.30,
      "createdAt": "2026-01-15T14:32:00.000Z"
    }
  ]
}
```

---

## 3. Orders

### `GET /api/orders`

Lista pedidos para la tabla de Pedidos & Pagos.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `status` | string | `all` | Estado del pedido |
| `paymentMode` | string | `all` | `advance` \| `cod` \| `hybrid` |
| `tenantId` | string | (todos) | Filtra por tenant |
| `limit` | number | `50` | Límite de resultados |

**Response 200**

```json
{
  "orders": [
    {
      "id": "ord-001",
      "number": "CF-100239",
      "status": "datos_completados",
      "paymentMode": "cod",
      "paymentStatus": "unpaid",
      "subtotal": 137000,
      "shipping": 9500,
      "total": 146500,
      "currency": "COP",
      "country": "CO",
      "city": "Bogotá",
      "origen": "agente_whatsapp",
      "sourceAdId": "ad-123",
      "customer": { "id": "cus-001", "name": "María González" },
      "items": [
        { "sku": "PIJ-SHORT-TIRA-001", "name": "Short Tira", "quantity": 1, "unitPrice": 137000 }
      ],
      "createdAt": "2026-01-15T10:00:00.000Z"
    }
  ]
}
```

### `PATCH /api/orders/[id]`

Actualiza el estado del pedido. **Trigger de comisión**: al mover a `datos_completados` se reconoce 50% de la comisión; al mover a `despachado` se reconoce 100%.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `status` | string | ✅ | `llamar_para_confirmar` \| `intento_cancelacion` \| `datos_completados` \| `oficina` \| `programado` \| `despachado` \| `novedad` \| `devuelto` |
| `paymentStatus` | string | ❌ | `unpaid` \| `paid` \| `refunded` |

**Response 200**

```json
{
  "order": { /* ... */ },
  "commissionRecognized": { "pct": 50, "amount": 3086.25 }
}
```

---

## 4. Ads

### `GET /api/ads`

Devuelve la tabla de atribución de pauta con 19 métricas por anuncio + veredicto.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `days` | number | `14` | Ventana |
| `tenantId` | string | (todos) | Filtra por tenant |

**Response 200**

```json
{
  "ads": [
    {
      "id": "ad-123",
      "externalId": "120209800000001",
      "name": "Short Tira — Carousel Ene 2026",
      "platform": "meta",
      "spend": 1250000,
      "impressions": 245000,
      "clicks": 3200,
      "ctr": 0.0131,
      "cpc": 390.62,
      "convReported": 18,
      "orderCount": 12,
      "units": 14,
      "revenue": 1920000,
      "paidRevenue": 1640000,
      "aov": 160000,
      "cogs": 768000,
      "grossProfit": 872000,
      "netProfit": -378000,
      "cpa": 104166.67,
      "cpl": 39.06,
      "cvr": 0.00375,
      "roas": 1.31,
      "roi": -0.30,
      "verdict": "optimize",
      "autoKill": false,
      "cannibalization": false
    }
  ],
  "totals": { "spend": 4500000, "revenue": 32647242, "roas": 2.77, "roi": -0.41 }
}
```

### `PATCH /api/ads/[id]`

Kill-switch — cambia el estado del anuncio + escribe AuditLog.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `action` | string | ✅ | `kill` \| `pause` \| `watch` \| `optimize` \| `scale` \| `resume` |
| `reason` | string | ❌ | Motivo del cambio (auditado) |

**Response 200**

```json
{
  "ad": { "id": "ad-123", "status": "paused", "autoKill": true, "killReason": "ROAS 0.4 < threshold 1.0" },
  "auditLogId": "al-001"
}
```

---

## 5. Agents

### `GET /api/agents`

Lista los 10 agentes conversacionales disponibles con sus labels.

**Response 200**

```json
{
  "agents": [
    { "name": "profile", "label": "Perfilamiento de leads", "section": "§6.1" },
    { "name": "speech", "label": "Discurso de ventas por perfil", "section": "§6.2" },
    { "name": "quote", "label": "Ofertas y cotización cruzada", "section": "§6.3" },
    { "name": "catalog", "label": "Respuesta visual-primero", "section": "§6.4" },
    { "name": "theme", "label": "Oferta por tema/personaje", "section": "§6.5" },
    { "name": "objection", "label": "Manejo de objeciones", "section": "§6.6" },
    { "name": "address", "label": "Confirmación de datos (10 campos)", "section": "§6.7" },
    { "name": "logistics", "label": "Logística de fletes", "section": "§6.8" },
    { "name": "vision", "label": "Visión (identificación por imagen)", "section": "§6.9" },
    { "name": "checkout", "label": "Checkout y sincronización", "section": "§6.10" }
  ]
}
```

### `POST /api/agents/[agentName]`

Invoca un agente específico con contexto. Timeout de 20s; si expira, devuelve fallback determinístico por agente.

**Path params**

| Param | Descripción |
|-------|-------------|
| `agentName` | `profile` \| `speech` \| `quote` \| `catalog` \| `theme` \| `objection` \| `address` \| `logistics` \| `vision` \| `checkout` |

**Body** (varía por agente)

```json
{
  "tenantId": "ten-saramantha",
  "conversationId": "conv-001",
  "customerId": "cus-001",
  "perfil": "mayorista",
  "items": [{ "sku": "PIJ-SHORT-TIRA-001", "cantidad": 6 }],
  "query": "familia",
  "message": "Es muy caro",
  "partialAddress": { "ciudad": "Bogotá" },
  "imageUrl": "https://..."
}
```

**Response 200**

```json
{
  "agent": "quote",
  "reply": "6 Short Tira: pagas $196.080 → vendes $210.000 → te sobran $13.920 limpios. ¿Confirmas?",
  "sideEffects": null,
  "elapsedMs": 1820
}
```

Para el agente `checkout` con `tenantId` + `customerId` + `items`, se ejecutan 8 side-effects:

```json
{
  "agent": "checkout",
  "reply": "Resumen: 6 Short Tira, Bogotá, flete $9.500, total $205.580 COD. ¿Confirmas?",
  "sideEffects": {
    "orderId": "ord-CF-100439",
    "orderItemsCount": 6,
    "attributionId": "attr-001",
    "shipmentId": "shp-001",
    "numeroGuia": "DROPI-MRE7JO8N-9681",
    "transportadoraCanonica": "Servientrega",
    "commissionEntryId": "ce-001",
    "commissionRecognizedPct": 50
  }
}
```

Para el agente `vision` con `imageUrl`, usa `createVision` (multimodal) y persiste `ImageIdentification`.

---

## 6. Monetization

### `GET /api/monetization/gmv`

Devuelve el GMV del período, embudo §15.1 y tramos escalonados.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `tenantId` | string | ✅ | Tenant a consultar |
| `periodo` | string | mes actual | Formato `YYYY-MM` |

**Response 200**

```json
{
  "tenantId": "ten-saramantha",
  "periodo": "2026-01",
  "gmv": 32647242,
  "ordersCount": 238,
  "aov": 137173,
  "embudo": {
    "llamar_para_confirmar": 174,
    "intento_cancelacion": 21,
    "datos_completados": 15,
    "despachado": 3,
    "oficina": 8,
    "programado": 5,
    "novedad": 6,
    "devuelto": 6
  },
  "tramo": {
    "nombre": "10-40M",
    "pct": 3.0,
    "comisionTotal": 979417.26
  }
}
```

### `GET /api/monetization/commission`

Lista las comisiones por pedido con el momento de reconocimiento.

**Query params**: `tenantId` (requerido), `periodo` (opcional).

**Response 200**

```json
{
  "commissions": [
    {
      "orderId": "ord-001",
      "gmv": 146500,
      "comisionPct": 4.5,
      "comisionTotal": 6592.5,
      "reconocidaPct": 100,
      "reconocidaMonto": 6592.5,
      "etapaReconocimiento": "despachado",
      "reconocidaAt": "2026-01-12T15:00:00.000Z"
    }
  ],
  "totalReconocido": 839612.43
}
```

### `POST /api/monetization/commission`

Reconoce comisión para un pedido específico (normalmente llamado por el Kanban PATCH al mover a `datos_completados` o `despachado`).

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `orderId` | string | ✅ | ID del pedido |
| `etapa` | string | ✅ | `datos_completados` (50%) \| `despachado` (100%) |

---

## 7. Attribution

### `GET /api/attribution`

Consulta atribución multi-touch por modelo.

**Query params**

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `model` | string | `last_click` | `last_click` \| `first_click` \| `linear` \| `time_decay` |
| `days` | number | `30` | Ventana |

**Response 200**

```json
{
  "model": "time_decay",
  "ads": [
    { "adId": "ad-001", "externalId": "...", "creditedRevenue": 372000, "weight": 0.46 },
    { "adId": "ad-002", "externalId": "...", "creditedRevenue": 337000, "weight": 0.42 },
    { "adId": "ad-003", "externalId": "...", "creditedRevenue": 97000, "weight": 0.12 }
  ]
}
```

### `POST /api/attribution`

Recalcula los pesos de todos los `Attribution` para un tenant y modelo.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `model` | string | ✅ | Modelo a aplicar |

**Response 200**

```json
{ "updated": 245, "model": "time_decay" }
```

---

## 8. Metrics

### `GET /api/metrics`

Métricas de margen y conversión por tenant (Saramantha §14.3/§14.7).

**Query params**: `tenantId` (requerido), `periodo` (opcional).

**Response 200**

```json
{
  "tenantId": "ten-saramantha",
  "margen": {
    "gmv": 32647242,
    "cogs": 9800000,
    "shipping": 2200000,
    "commission": 979417,
    "feeBase": 0,
    "netMargin": 19647825,
    "netMarginPct": 60.1
  },
  "conversion": {
    "stuck": 73.1,
    "confirmed": 17.6,
    "shipped": 1.3,
    "cancelled": 8.0
  },
  "llmCalls": {
    "speech": 142,
    "quote": 87,
    "objection": 53,
    "vision": 21,
    "checkout": 18,
    "total": 321
  }
}
```

---

## 9. Conciliation

### `GET /api/conciliation`

Conciliación anti-fuga (Saramantha §17.9). Compara el GMV del agente contra el GMV externo reportado por el tenant.

**Query params**: `tenantId` (requerido), `periodo` (opcional).

**Response 200**

```json
{
  "tenantId": "ten-saramantha",
  "gmvAgente": 32647242,
  "gmvExterno": 28880129,
  "gap": 3767113,
  "gapPct": 11.6,
  "riskLevel": "medium",
  "mitigations": [
    "Activar recordatorio de sync al tenant",
    "Notificar al equipo de finanzas",
    "Revisar pedidos sin origen='agente_whatsapp'"
  ]
}
```

---

## 10. Onboarding

### `GET /api/onboarding`

Devuelve el schema de opciones del wizard de onboarding (Saramantha §13.6).

**Response 200**

```json
{
  "plataformasCatalogo": ["whatsapp_catalog", "woocommerce", "shopify", "catalogo_propio_cliente", "catalogo_nuestro"],
  "bdCatalogo": ["supabase_cliente", "supabase_nuestro", "oracle_nuestro"],
  "proveedoresIa": ["zai", "chatgpt", "xai", "ollama"],
  "proveedoresLogistico": ["dropi", "99envios", "aveonline", "otro"],
  "planesMonetizacion": ["conecta", "catalogo_incluido", "completo"]
}
```

### `POST /api/onboarding`

Crea un nuevo tenant self-service.

**Body**

```json
{
  "slug": "mi-nueva-marca",
  "nombreNegocio": "Mi Nueva Marca SAS",
  "marca": "Mi Marca",
  "plataformaCatalogo": "woocommerce",
  "bdCatalogo": "supabase_cliente",
  "proveedorIa": "zai",
  "proveedorLogistico": "dropi",
  "planMonetizacion": "conecta",
  "tonoMarca": "Cercano, profesional",
  "nombreAsesora": "Ana",
  "politicaPago": "híbrido: prepay 5% off > $250k, COD debajo",
  "preguntaPerfil": "¿Para ti o para surtir tu negocio?"
}
```

**Response 201**

```json
{
  "tenantId": "ten-xxxx",
  "nextSteps": [
    "Conectar WhatsApp Business API (registrar WABA)",
    "Configurar webhook Meta: https://commerceflow.example.com/api/webhooks/whatsapp",
    "Sincronizar catálogo: POST /api/catalog/sync",
    "Configurar politica de pago por canal: PATCH /api/payments/config"
  ]
}
```

---

## 11. Tenants

### `GET /api/tenants`

Lista los tenants activos para el switcher del topbar.

**Response 200**

```json
{
  "tenants": [
    { "id": "ten-demo", "slug": "demo", "marca": "Demo", "activo": true },
    { "id": "ten-saramantha", "slug": "saramantha", "marca": "Saramantha", "activo": true },
    { "id": "ten-majestic", "slug": "majestic", "marca": "Majestic", "activo": true },
    { "id": "ten-lovely", "slug": "lovely", "marca": "Lovely", "activo": true },
    { "id": "ten-reina", "slug": "reina", "marca": "Reina", "activo": true }
  ]
}
```

---

## 12. Channels

### `GET /api/channels`

Lista los canales de mensajería por tenant.

**Query params**: `tenantId` (opcional, filtra si se pasa).

**Response 200**

```json
{
  "channels": [
    {
      "id": "ch-wa-co",
      "tenantId": "ten-saramantha",
      "type": "whatsapp",
      "displayName": "WhatsApp Colombia",
      "verified": true,
      "active": true,
      "country": "CO",
      "paymentStrategy": "hybrid",
      "requirePrepayMin": 250000,
      "prepayDiscountPct": 5,
      "codFee": 0
    }
  ]
}
```

---

## 13. Catalog

### `GET /api/catalog/products`

Lista productos del catálogo del tenant con búsqueda.

**Query params**

| Param | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `q` | string | ❌ | Búsqueda por nombre, SKU, diseño, categoría |
| `categoria` | string | ❌ | Filtra por categoría |
| `limit` | number | ❌ | Default `50` |

**Response 200**

```json
{
  "products": [
    {
      "id": "prod-001",
      "sku": "PIJ-SHORT-TIRA-001",
      "name": "Short Tira",
      "price": 13700,
      "cost": 6800,
      "stock": 145,
      "diseno": "Stitch",
      "categoria": "short",
      "fuenteSincronizacion": "whatsapp_catalog",
      "imagenMetadataVisible": true,
      "imageUrl": "https://..."
    }
  ]
}
```

### `POST /api/catalog/sync`

Sincroniza el catálogo desde la plataforma de ecommerce del tenant vía `EcommerceAdapter`.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |

**Response 200**

```json
{
  "synced": 7,
  "adapter": "WhatsappCatalogAdapter",
  "fuenteSincronizacion": "whatsapp_catalog"
}
```

---

## 14. Shipping

### `POST /api/shipping/quote`

Cotiza flete real vía `LogisticsAdapter` del tenant.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `ciudad` | string | ✅ | Ciudad destino |
| `pais` | string | ✅ | País destino (default `CO`) |
| `cantidad_unidades` | number | ✅ | Unidades a enviar |

**Response 200**

```json
{
  "tarifa": 9500,
  "tiempoEstimadoDias": 1,
  "transportadora": "Coordinadora",
  "proveedor": "dropi",
  "moneda": "COP"
}
```

**Ejemplo**

```bash
curl -X POST http://localhost:3000/api/shipping/quote \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"ten-saramantha","ciudad":"Bogotá","pais":"CO","cantidad_unidades":1}'
```

### `POST /api/shipping/guide`

Genera una guía y persiste `Shipment` + actualiza `Order.status='shipped'` + crea `OrderEvent` + AuditLog.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `orderId` | string | ✅ | Pedido a despachar |

**Response 200**

```json
{
  "shipmentId": "shp-001",
  "numeroGuia": "DROPI-MRDW423L-8542",
  "urlSeguimiento": "https://...",
  "transportadora": "Servientrega",
  "transportadoraCanonica": "Servientrega",
  "tarifa": 24500,
  "tiempoEstimadoDias": 2,
  "orderId": "ord-001",
  "orderStatus": "shipped"
}
```

---

## 15. Health

### `GET /api/health`

Reporta el estado de 23 checks: database, tenants, 4 LLM providers, tenant config, 4 ecommerce adapters, 3 logistics adapters, 3 webhooks, RLS, pgvector, n8n, minio.

**Query params**: `tenantId` (opcional, añade checks específicos del tenant).

**Response 200**

```json
{
  "status": "warning",
  "summary": { "ok": 6, "warning": 4, "error": 0, "not_configured": 13 },
  "checks": [
    { "name": "database", "status": "ok", "detail": "Connected (SQLite dev / Postgres prod)" },
    { "name": "tenants", "status": "ok", "detail": "5 active tenants" },
    { "name": "llm_zai", "status": "ok", "detail": "Default provider (always available)" },
    { "name": "llm_chatgpt", "status": "not_configured", "detail": "Set OPENAI_API_KEY to enable" },
    { "name": "tenant_catalog_adapter", "status": "ok", "detail": "plataformaCatalogo='whatsapp_catalog', bdCatalogo='supabase_nuestro'" },
    { "name": "logistics_dropi", "status": "ok", "detail": "Configured (stub mode)" }
  ]
}
```

### `GET /api/health/uptime`

Endpoint lightweight para Uptime Kuma (Saramantha §1.13). Solo hace ping a la DB + mide latencia.

**Response 200**

```json
{
  "status": "ok",
  "dbLatencyMs": 4,
  "timestamp": "2026-01-15T14:33:00.000Z"
}
```

---

## 16. LLM Providers

### `GET /api/llm-providers`

Lista los 4 proveedores IA disponibles.

**Response 200**

```json
{
  "providers": [
    { "id": "zai", "name": "Zai (GLM)", "available": true, "vision": true, "embeddings": false },
    { "id": "chatgpt", "name": "OpenAI ChatGPT", "available": true, "vision": true, "embeddings": true },
    { "id": "xai", "name": "xAI Grok", "available": true, "vision": true, "embeddings": false },
    { "id": "ollama", "name": "Ollama (self-hosted)", "available": true, "vision": true, "embeddings": true }
  ]
}
```

### `PATCH /api/llm-providers`

Cambia el proveedor IA de un tenant.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `proveedorIa` | string | ✅ | `zai` \| `chatgpt` \| `xai` \| `ollama` |

---

## 17. Vision Pipeline

### `POST /api/vision-pipeline`

Pipeline determinístico de 3 pasos (Saramantha §4): Tesseract OCR + OpenCLIP + pregunta al cliente si confianza < 0.6.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `imageUrl` | string | ✅ | URL de la imagen a identificar |

**Response 200**

```json
{
  "skuDetectado": "PIJ-SHORT-TIRA-001",
  "confianza": 0.87,
  "metodo": "ocr_franja",
  "preguntaConfirmacion": null
}
```

Si confianza < 0.6:

```json
{
  "skuDetectado": null,
  "confianza": 0.42,
  "metodo": "sin_match",
  "preguntaConfirmacion": "No logro identificar el diseño con certeza. ¿Es Stitch o Hello Kitty?"
}
```

---

## 18. Image Identifications

### `GET /api/image-identifications`

Historial de identificaciones visuales persistentes.

**Query params**: `tenantId` (requerido), `limit` (default `20`).

**Response 200**

```json
{
  "identifications": [
    {
      "id": "ii-001",
      "tenantId": "ten-saramantha",
      "contactoId": "cus-001",
      "imagenUrl": "https://...",
      "skuDetectado": "PIJ-SHORT-TIRA-001",
      "metodo": "vlm",
      "confianza": 0.90,
      "createdAt": "2026-01-15T14:33:00.000Z"
    }
  ]
}
```

---

## 19. Payments Config

### `GET /api/payments/config`

Devuelve la configuración de pago por canal del tenant.

**Query params**: `tenantId` (requerido).

**Response 200**

```json
{
  "tenantId": "ten-saramantha",
  "channels": [
    {
      "id": "ch-wa-co",
      "paymentStrategy": "hybrid",
      "requirePrepayMin": 250000,
      "prepayDiscountPct": 5,
      "codFee": 0
    }
  ],
  "thresholds": {
    "roasKillThreshold": 1.0,
    "cpaTarget": 50000
  }
}
```

### `PATCH /api/payments/config`

Actualiza la estrategia de pago de un canal o los umbrales globales.

**Body**

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `channelId` | string | ID del canal a actualizar |
| `paymentStrategy` | string | `advance` \| `cod` \| `hybrid` |
| `requirePrepayMin` | number | Umbral para requerir prepay |
| `prepayDiscountPct` | number | % descuento por prepay |
| `codFee` | number | Costo fijo del COD |
| `thresholds` | object | `{ roasKillThreshold, cpaTarget }` |

---

## 20. Orchestrate

### `POST /api/orchestrate`

Ejecuta el orquestador de 9 pasos (Saramantha §12).

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `tenantId` | string | ✅ | Tenant |
| `scenario` | string | ✅ | `indisutex_wa_catalog` \| `client_woocommerce` \| `client_shopify` \| `client_supabase_nuestro` |
| `conversationId` | string | ❌ | Si existe conversación previa |
| `customerId` | string | ❌ | Si existe customer previo |
| `mode` | string | ❌ | `step` (un paso, default) \| `full` (los 9) |

**Response 200 (modo step)**

```json
{
  "state": {
    "tenantId": "ten-saramantha",
    "scenario": "indisutex_wa_catalog",
    "step": 2,
    "perfil": "mayorista",
    "history": [
      { "agent": "profile", "reply": "mayorista", "ts": "2026-01-15T14:33:00.000Z" }
    ],
    "done": false
  },
  "nextStep": "speech"
}
```

**Response 200 (modo full)**

```json
{
  "state": { /* ...con step=9, done=true */ },
  "history": [
    { "agent": "profile", "reply": "mayorista", "ts": "..." },
    { "agent": "speech", "reply": "¡Hola! Te cuento...", "ts": "..." },
    /* ... 7 más */
  ],
  "elapsedMs": 23450
}
```

---

## 21. Webhooks

### `GET /api/webhooks/whatsapp`

Handshake de subscripción del webhook de WhatsApp Cloud API.

**Query params**: `hub.mode`, `hub.verify_token`, `hub.challenge`.

**Response 200**: devuelve el `hub.challenge` tal cual si `hub.mode=subscribe` y el token coincide con `WA_VERIFY_TOKEN`.

### `POST /api/webhooks/whatsapp`

Recibe mensajes inbound de WhatsApp. Verifica HMAC signature con `META_APP_SECRET` si está configurada. Persiste `AuditLog` con `action='webhook.wa.inbound'`.

**Headers**: `X-Hub-Signature-256: sha256=<hmac>`.

**Response 200**: `{ "received": true }`.

### `GET /api/webhooks/meta`

Handshake para Messenger / Instagram DM. Misma mecánica que WhatsApp pero con `META_VERIFY_TOKEN`.

### `POST /api/webhooks/meta`

Recibe mensajes inbound de Messenger/Instagram. Misma verificación HMAC.

### `POST /api/webhooks/nocodb-out`

Webhook **saliente** hacia NocoDB — envía el estado del pedido cuando cambia (Saramantha §10 bidireccional).

**Body** (interno, generado por PATCH /api/orders/[id]):

```json
{
  "orderId": "ord-001",
  "number": "CF-100239",
  "status": "despachado",
  "tenantId": "ten-saramantha",
  "timestamp": "2026-01-15T14:33:00.000Z"
}
```

### `POST /api/webhooks/nocodb-in`

Webhook **entrante** desde NocoDB — recibe actualizaciones de estado hechas por operadores en NocoDB.

**Headers**: `X-NocoDB-Secret: <NOCODB_WEBHOOK_SECRET>`.

**Body**: el payload de NocoDB webhook.

**Response 200**: `{ "received": true, "applied": true }`.

---

## 22. AI Reply (legacy)

### `POST /api/ai-reply`

Endpoint legacy de AI smart reply para el messenger. Hoy en día se prefiere `POST /api/agents/[agentName]` con el agente `speech`, pero este endpoint sigue funcionando con el system prompt genérico original.

**Body**

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `conversationId` | string | ✅ | Conversación |
| `tenantId` | string | ❌ | Default `ten-saramantha` |

**Response 200**

```json
{
  "reply": "¡Hola! Te cuento que tenemos el short disponible en Stitch y Hello Kitty...",
  "model": "glm-4.6v",
  "elapsedMs": 2100
}
```

---

## Códigos de estado HTTP

| Código | Significado |
|--------|-------------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request — body inválido o faltan campos requeridos |
| 403 | Forbidden — verify token inválido, firma HMAC inválida |
| 404 | Not Found — recurso no existe |
| 405 | Method Not Allowed |
| 409 | Conflict — recurso ya existe |
| 422 | Unprocessable Entity — validación de negocio falla |
| 500 | Internal Server Error |
| 504 | Gateway Timeout — agente IA no respondió en 20s |

---

## Rate limiting

Actualmente no hay rate limiting implementado. En producción se recomienda configurar en Caddy o en un reverse proxy:

- **Endpoints de agentes IA**: 10 req/min por IP (los LLM son caros).
- **Webhooks entrantes**: 60 req/min por IP.
- **Otros endpoints**: 300 req/min por IP.

---

## Versionado

La API sigue **Semantic Versioning**:

- Cambios breaking requieren bump major (de `v1` a `v2`) y migración documentada.
- Nuevos endpoints y campos opcionales son backward-compatible (minor).
- Bug fixes y campos opcionales nuevos en responses son patch.

La versión actual es **v1**. No hay prefijo `/v1/` en las rutas — se añadirá cuando se requiera una v2.
