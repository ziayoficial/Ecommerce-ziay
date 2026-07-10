# Guía de Deploy de Agentes en n8n

> **Task ID:** DOCS-003
> **Sistema:** CommerceFlow OS — 26 agentes conversacionales
> **Objetivo:** Desplegar cada uno de los 26 agentes como workflows de n8n auto- hospedados, junto con los 3 pipelines de orquestación (Pre-venta, Post-venta, Inteligencia).
> **Audiencia:** DevOps · Platform Engineers · Integradores LATAM

---

## 1. Introducción — ¿por qué n8n?

CommerceFlow OS expone **26 agentes conversacionales** como endpoints REST bajo
`POST /api/agents/{agentName}`. Cada agente recibe un `tenantId` + contexto
conversacional y devuelve una respuesta generada por LLM (z-ai-web-dev-sdk).

**n8n** es la capa de orquestación visual ideal para estos agentes por 4 razones:

1. **Visual workflow automation** — los pipelines A/B/C (Pre-venta 10 pasos,
   Post-venta 4 pasos, Inteligencia 5 pasos) se vuelven diagramas drag-and-drop.
2. **Self-hosted** — corre en tu propio VPC (Docker), sin terceros tocando PII
   de compradores colombianos/mexicanos/europeos. RGPD / LOPD friendly.
3. **Webhooks nativos** — cada workflow expone una URL `https://n8n.tu.com/webhook/...`
   que puede ser invocada desde WhatsApp Cloud API, Meta Webhooks, n8n Cloud, o
   desde el propio dashboard CommerceFlow.
4. **Encadenamiento** — el nodo `Execute Workflow` permite invocar un workflow
   desde otro, replicando exactamente el patrón del orquestador interno.

El resultado: una red de 26 workflows (uno por agente) + 3 workflows orquestador
(pipeline A/B/C) que pueden ser monitoreados, versionados y debuggeados visualmente.

---

## 2. Prerrequisitos

### 2.1 Infraestructura

| Componente | Versión mínima | Notas |
|---|---|---|
| n8n | 1.50+ | self-hosted via docker-compose |
| Docker | 24+ | docker-compose incluido en el repo |
| CommerceFlow OS | cycle 2+ | API REST corriendo en `:3000` |
| PostgreSQL | 14+ | n8n puede usar SQLite en dev, PG en prod |
| Redis | 6+ | opcional, para n8n queue mode |

### 2.2 El `docker-compose.yml` del repo ya incluye n8n

El archivo `docker-compose.yml` de CommerceFlow OS incluye n8n en el puerto
**5678**. Levantar el stack completo:

```bash
# desde la raíz del repo
cp .env.example .env
# editar .env con tus secrets (ver §2.3)

docker-compose up -d
# servicios:
#   commerceflow-web  → :3000 (Next.js dashboard + API)
#   chat-service      → :3003 (socket.io)
#   postgres          → :5432 (DB principal)
#   redis             → :6379 (cache + queue)
#   n8n               → :5678 (workflows)  ← esta guía
#   uptime-kuma       → :3001 (monitoring)
#   sentry            → opcional
```

Verificar que n8n respondió:

```bash
curl -sI http://localhost:5678 | head -3
# HTTP/1.1 200 OK
# content-type: text/html; charset=utf-8
```

### 2.3 Variables de entorno

En `.env`:

```bash
# CommerceFlow API
COMMERCEFLOW_BASE_URL=http://commerceflow-web:3000
COMMERCEFLOW_API_KEY=cf_prod_xxx     # shared secret con n8n

# n8n
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=http
WEBHOOK_URL=http://localhost:5678    # o https://n8n.tudominio.com en prod
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=cambia-esto
N8N_ENCRYPTION_KEY=base64:...        # generar con: openssl rand -base64 32

# Postgres para n8n (separado del de CommerceFlow)
POSTGRES_USER=n8n
POSTGRES_PASSWORD=n8n-pass
POSTGRES_DB=n8n
N8N_DATABASE_TYPE=postgresdb
N8N_DATABASE_POSTGRESDB_HOST=postgres
N8N_DATABASE_POSTGRESDB_PORT=5432
```

### 2.4 Health check mutuo

Antes de empezar a crear workflows, validar que n8n puede alcanzar la API de
CommerceFlow:

```bash
# desde dentro del contenedor n8n
docker-compose exec n8n sh -c '
  curl -s -H "x-api-key: $COMMERCEFLOW_API_KEY" \
       $COMMERCEFLOW_BASE_URL/api/health
'
# → {"ok":true,"service":"commerceflow","version":"..."}
```

Si ves `{"ok":true}`, la red Docker interna está OK. Si no, revisa el network
del docker-compose y que ambos servicios estén en el mismo `networks:` block.

---

## 3. Arquitectura general

```
                                ┌─────────────────────┐
                                │  WhatsApp Cloud API │
                                │  (Meta Graph)       │
                                └──────────┬──────────┘
                                           │ webhook
                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                       n8n (puerto 5678)                         │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│  │  Webhook     │──▶│  HTTP Request│──▶│  Respond to  │         │
│  │  (WA msg)    │   │  (CF API)    │   │  Webhook     │         │
│  └──────────────┘   └──────┬───────┘   └──────────────┘         │
│                            │                                     │
│                            ▼                                     │
│                   ┌────────────────┐                             │
│                   │  Execute WF    │  (pipeline chain)           │
│                   │  orchestrator  │                             │
│                   └────────┬───────┘                             │
│                            │                                     │
│              ┌─────────────┼─────────────┐                       │
│              ▼             ▼             ▼                       │
│        ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│        │ profile  │  │ speech   │  │ catalog  │  ... 26 agentes  │
│        │  (WF)    │  │  (WF)    │  │  (WF)    │                  │
│        └──────────┘  └──────────┘  └──────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP (Docker network)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              CommerceFlow OS API (puerto 3000)                  │
│                                                                  │
│  POST /api/agents/{agentName}                                   │
│  body: { tenantId, conversationId, customerId, ...ctx }         │
│  → 200 { ok:true, reply:"...", agent:"profile", meta:{...} }    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  Prisma + PG    │
                   │  (62 modelos)   │
                   └─────────────────┘
```

**Flujo típico**:

1. WhatsApp Cloud API envía un mensaje a un webhook de n8n.
2. n8n recibe el mensaje, normaliza, y ejecuta el workflow `orchestrator`.
3. El workflow `orchestrator` encadena con `Execute Workflow` los 10 sub-workflows
   (agentes) del pipeline A en orden.
4. Cada sub-workflow hace un `HTTP Request` a `POST /api/agents/{agentName}` en
   CommerceFlow, que devuelve la respuesta del agente.
5. El workflow `orchestrator` consolida las respuestas y devuelve al WhatsApp via
   HTTP Request al Graph API (o al adaptador de canal).

---

## 4. Los 26 agentes — tabla maestra

| # | agentName | Pipeline | Endpoint API | Webhook n8n |
|---|---|---|---|---|
| 1 | `profile` | A | `/api/agents/profile` | `/webhook/commerceflow/profile` |
| 2 | `speech` | A | `/api/agents/speech` | `/webhook/commerceflow/speech` |
| 3 | `catalog` | A | `/api/agents/catalog` | `/webhook/commerceflow/catalog` |
| 4 | `theme` | A | `/api/agents/theme` | `/webhook/commerceflow/theme` |
| 5 | `quote` | A | `/api/agents/quote` | `/webhook/commerceflow/quote` |
| 6 | `objection` | A | `/api/agents/objection` | `/webhook/commerceflow/objection` |
| 7 | `address` | A | `/api/agents/address` | `/webhook/commerceflow/address` |
| 8 | `logistics` | A | `/api/agents/logistics` | `/webhook/commerceflow/logistics` |
| 9 | `checkout` | A | `/api/agents/checkout` | `/webhook/commerceflow/checkout` |
| 10 | `cart_builder` | A | `/api/agents/cart_builder` | `/webhook/commerceflow/cart_builder` |
| 11 | `buyer_behavior` | A | `/api/agents/buyer_behavior` | `/webhook/commerceflow/buyer_behavior` |
| 12 | `guide_tracking` | B | `/api/agents/guide_tracking` | `/webhook/commerceflow/guide_tracking` |
| 13 | `novedades` | B | `/api/agents/novedades` | `/webhook/commerceflow/novedades` |
| 14 | `redelivery` | B | `/api/agents/redelivery` | `/webhook/commerceflow/redelivery` |
| 15 | `remarketing` | B | `/api/agents/remarketing` | `/webhook/commerceflow/remarketing` |
| 16 | `customer_score` | C | `/api/agents/customer_score` | `/webhook/commerceflow/customer_score` |
| 17 | `carrier_score` | C | `/api/agents/carrier_score` | `/webhook/commerceflow/carrier_score` |
| 18 | `product_enrichment` | C | `/api/agents/product_enrichment` | `/webhook/commerceflow/product_enrichment` |
| 19 | `marketplace` | C | `/api/agents/marketplace` | `/webhook/commerceflow/marketplace` |
| 20 | `affiliator` | C | `/api/agents/affiliator` | `/webhook/commerceflow/affiliator` |
| 21 | `vision` | soporte | `/api/agents/vision` | `/webhook/commerceflow/vision` |
| 22 | `guide_alert` | soporte | `/api/agents/guide_alert` | `/webhook/commerceflow/guide_alert` |
| 23 | `address_analysis` | soporte | `/api/agents/address_analysis` | `/webhook/commerceflow/address_analysis` |
| 24 | `traffic_orchestrator` | soporte | `/api/agents/traffic_orchestrator` | `/webhook/commerceflow/traffic_orchestrator` |
| 25 | `sales_retainer` | soporte | `/api/agents/sales_retainer` | `/webhook/commerceflow/sales_retainer` |
| 26 | `logistics_notifier` | soporte | `/api/agents/logistics_notifier` | `/webhook/commerceflow/logistics_notifier` |

> Nota: el agente `orchestrate` (meta-pipeline) vive en el orquestador interno de
> CommerceFlow pero puede ser invocado desde n8n via `POST /api/agents/orchestrate`
> con el parámetro `pipeline: 'pre_sale' | 'post_sale' | 'intelligence'`.

---

## 5. Estructura de un workflow por agente

Cada uno de los 26 workflows sigue el mismo patrón de 4 nodos:

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Webhook     │──▶│  Code        │──▶│  HTTP Request│──▶│  Respond to  │
│  (trigger)   │   │  (normalize) │   │  (CF API)    │   │  Webhook     │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │  CommerceFlow│
                                   │  /api/agents/│
                                   │  {agentName} │
                                   └──────────────┘
```

### 5.1 Nodo 1 — Webhook (trigger)

- **Method:** POST
- **Path:** `/webhook/commerceflow/{agentName}`
- **Authentication:** `Header Auth` con `x-api-key: $COMMERCEFLOW_API_KEY`
- **Response mode:** `Response Node` (Respond to Webhook al final)

### 5.2 Nodo 2 — Code (normalización)

Convierte el body del webhook al formato que espera la API de CommerceFlow:

```javascript
// n8n Code node — JavaScript
const input = $input.first().json;

// Normaliza el body al AgentContext esperado
const agentContext = {
  tenantId:       input.tenantId || input.tenant_id,
  conversationId: input.conversationId,
  customerId:     input.customerId,
  perfil:         input.perfil,
  country:        input.country || 'CO',
  query:          input.query,
  message:        input.message,
  items:          input.items,
  partialAddress: input.partialAddress,
  imageUrl:       input.imageUrl,
};

// Headers obligatorios
const headers = {
  'Content-Type': 'application/json',
  'x-api-key':    $env.COMMERCEFLOW_API_KEY,
  'x-tenant-id':  agentContext.tenantId,
};

return [{
  json: {
    url: `${$env.COMMERCEFLOW_BASE_URL}/api/agents/${input.agentName}`,
    headers,
    body: agentContext,
  }
}];
```

### 5.3 Nodo 3 — HTTP Request

- **Method:** POST
- **URL:** `={{ $json.url }}`
- **Headers:** `={{ $json.headers }}`
- **Body:** `={{ JSON.stringify($json.body) }}`
- **Timeout:** 30000 ms (los agentes LLM pueden tardar 2–8s)
- **Retry on fail:** 3 intentos con backoff exponencial (500ms × 2)

### 5.4 Nodo 4 — Respond to Webhook

Devuelve la respuesta de CommerceFlow al caller original (WhatsApp, dashboard,
otro workflow):

```javascript
// Respond to Webhook — body
const cfResponse = $input.first().json;
return {
  statusCode: 200,
  body: JSON.stringify({
    ok: cfResponse.ok ?? true,
    agent: cfResponse.agent,
    reply: cfResponse.reply,
    meta: cfResponse.meta || {},
  }),
  headers: { 'Content-Type': 'application/json' }
};
```

---

## 6. Ejemplo completo — workflow JSON del agente `speech`

El siguiente JSON puede importarse directamente en n8n (Copy → Paste → Import).

```json
{
  "name": "CF · Agent · speech",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "commerceflow/speech",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "webhook-trigger",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [240, 300],
      "webhookId": "cf-speech-001"
    },
    {
      "parameters": {
        "jsCode": "const input = $input.first().json;\nconst agentContext = {\n  tenantId: input.tenantId,\n  conversationId: input.conversationId,\n  customerId: input.customerId,\n  perfil: input.perfil || 'detal',\n  country: input.country || 'CO',\n};\nreturn [{\n  json: {\n    url: `${$env.COMMERCEFLOW_BASE_URL}/api/agents/speech`,\n    headers: {\n      'Content-Type': 'application/json',\n      'x-api-key': $env.COMMERCEFLOW_API_KEY,\n      'x-tenant-id': agentContext.tenantId,\n    },\n    body: agentContext,\n  }\n}];"
      },
      "id": "code-normalize",
      "name": "Normalize",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [460, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ $json.url }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Content-Type", "value": "application/json" },
            { "name": "x-api-key", "value": "={{ $json.headers['x-api-key'] }}" },
            { "name": "x-tenant-id", "value": "={{ $json.headers['x-tenant-id'] }}" }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.body) }}",
        "timeout": 30000,
        "retryOnFail": true,
        "maxTries": 3,
        "waitBetweenTries": 500
      },
      "id": "http-cf-api",
      "name": "CF API",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [680, 300]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ ok: true, agent: 'speech', reply: $json.reply, meta: $json.meta || {} }) }}",
        "options": {
          "responseCode": 200,
          "responseHeaders": {
            "entries": [
              { "name": "Content-Type", "value": "application/json" }
            ]
          }
        }
      },
      "id": "respond-webhook",
      "name": "Respond",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [900, 300]
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Normalize", "type": "main", "index": 0 }]] },
    "Normalize": { "main": [[{ "node": "CF API", "type": "main", "index": 0 }]] },
    "CF API": { "main": [[{ "node": "Respond", "type": "main", "index": 0 }]] }
  },
  "settings": {
    "executionOrder": "v1",
    "saveExecutionProgress": true,
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner"
  },
  "staticData": null,
  "tags": [
    { "name": "commerceflow" },
    { "name": "agent" },
    { "name": "pipeline-A" }
  ]
}
```

### 6.1 Test del workflow

Una vez importado y activado en n8n:

```bash
curl -X POST http://localhost:5678/webhook/commerceflow/speech \
  -H "Content-Type: application/json" \
  -H "x-api-key: $COMMERCEFLOW_API_KEY" \
  -d '{
    "tenantId": "ten-saramantha",
    "conversationId": "conv-001",
    "customerId": "cus-001",
    "perfil": "mayorista"
  }'
```

Respuesta esperada:

```json
{
  "ok": true,
  "agent": "speech",
  "reply": "¡Hola Marcela! 🎯 Soy Ana de Saramantha. Tengo 6 referencias de familia con precio mayorista. ¿Qué categorías te interesan?",
  "meta": {
    "perfil": "mayorista",
    "tono_marca": "Cercano, profesional",
    "nombre_asesora": "Ana"
  }
}
```

---

## 7. Los 26 workflows — plantilla genérica

Como los 26 agentes comparten estructura idéntica (solo cambia `agentName` y a
veces un campo extra del contexto), se puede generar los 26 JSON con un script.
A continuación, la plantilla genérica en JavaScript para Node:

```javascript
// scripts/generate-n8n-workflows.js
const fs = require('fs');
const path = require('path');

const AGENTS = [
  // Pipeline A (11)
  'buyer_behavior', 'profile', 'speech', 'catalog', 'theme',
  'cart_builder', 'quote', 'objection', 'address', 'logistics', 'checkout',
  // Pipeline B (4)
  'guide_tracking', 'novedades', 'redelivery', 'remarketing',
  // Pipeline C (5)
  'customer_score', 'carrier_score', 'product_enrichment', 'marketplace', 'affiliator',
  // Soporte (6)
  'vision', 'guide_alert', 'address_analysis', 'traffic_orchestrator',
  'sales_retainer', 'logistics_notifier',
];

const PIPELINE_BY_AGENT = {
  buyer_behavior: 'A', profile: 'A', speech: 'A', catalog: 'A', theme: 'A',
  cart_builder: 'A', quote: 'A', objection: 'A', address: 'A', logistics: 'A', checkout: 'A',
  guide_tracking: 'B', novedades: 'B', redelivery: 'B', remarketing: 'B',
  customer_score: 'C', carrier_score: 'C', product_enrichment: 'C', marketplace: 'C', affiliator: 'C',
  vision: 'support', guide_alert: 'support', address_analysis: 'support',
  traffic_orchestrator: 'support', sales_retainer: 'support', logistics_notifier: 'support',
};

function buildWorkflow(agentName) {
  const pipeline = PIPELINE_BY_AGENT[agentName];
  return {
    name: `CF · Agent · ${agentName}`,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: `commerceflow/${agentName}`,
          responseMode: 'responseNode',
        },
        id: `webhook-${agentName}`,
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [240, 300],
        webhookId: `cf-${agentName}-001`,
      },
      {
        parameters: {
          jsCode: `const input = $input.first().json;
const ctx = {
  tenantId: input.tenantId,
  conversationId: input.conversationId,
  customerId: input.customerId,
  perfil: input.perfil,
  country: input.country || 'CO',
  query: input.query,
  message: input.message,
  items: input.items,
  partialAddress: input.partialAddress,
  imageUrl: input.imageUrl,
};
return [{
  json: {
    url: \`\${$env.COMMERCEFLOW_BASE_URL}/api/agents/${agentName}\`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': $env.COMMERCEFLOW_API_KEY,
      'x-tenant-id': ctx.tenantId,
    },
    body: ctx,
  }
}];`
        },
        id: `code-${agentName}`,
        name: 'Normalize',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [460, 300],
      },
      {
        parameters: {
          method: 'POST',
          url: '={{ $json.url }}',
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
              { name: 'x-api-key', value: '={{ $json.headers[\'x-api-key\'] }}' },
              { name: 'x-tenant-id', value: '={{ $json.headers[\'x-tenant-id\'] }}' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.body) }}',
          timeout: 30000,
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 500,
        },
        id: `http-${agentName}`,
        name: 'CF API',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [680, 300],
      },
      {
        parameters: {
          respondWith: 'json',
          responseBody: `={{ JSON.stringify({ ok: true, agent: '${agentName}', reply: $json.reply, meta: $json.meta || {} }) }}`,
          options: {
            responseCode: 200,
            responseHeaders: {
              entries: [{ name: 'Content-Type', value: 'application/json' }],
            },
          },
        },
        id: `respond-${agentName}`,
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [900, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
      Normalize: { main: [[{ node: 'CF API', type: 'main', index: 0 }]] },
      'CF API': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: {
      executionOrder: 'v1',
      saveExecutionProgress: true,
      callerPolicy: 'workflowsFromSameOwner',
    },
    tags: [
      { name: 'commerceflow' },
      { name: 'agent' },
      { name: `pipeline-${pipeline}` },
    ],
  };
}

// Generar los 26 archivos JSON
const outDir = path.resolve('./n8n-workflows/agents');
fs.mkdirSync(outDir, { recursive: true });
AGENTS.forEach(agent => {
  const wf = buildWorkflow(agent);
  fs.writeFileSync(
    path.join(outDir, `agent-${agent}.json`),
    JSON.stringify(wf, null, 2)
  );
  console.log(`✓ generated ${agent}`);
});
console.log(`\nTotal: ${AGENTS.length} workflows en ${outDir}`);
```

Ejecutar:

```bash
node scripts/generate-n8n-workflows.js
# ✓ generated buyer_behavior
# ✓ generated profile
# ...
# ✓ generated logistics_notifier
# Total: 26 workflows en ./n8n-workflows/agents
```

---

## 8. Importar los 26 workflows en bulk

n8n permite importar workflows desde la UI (Copy → Paste → Import) o via API
REST. Para 26 workflows, la API es más práctica.

### 8.1 Import via API REST

```bash
# script bash — bulk import
N8N_URL="http://localhost:5678"
N8N_USER="admin"
N8N_PASS="cambia-esto"

# Login y obtener cookie JWT
COOKIE=$(curl -s -c - \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$N8N_USER\",\"password\":\"$N8N_PASS\"}" \
  "$N8N_URL/rest/login" \
  | grep -F 'Token' | awk '{print $NF}')

# Importar cada workflow
for wf in n8n-workflows/agents/*.json; do
  echo "→ importing $wf"
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $COOKIE" \
    -d @"$wf" \
    "$N8N_URL/rest/workflows"
done

echo "✓ 26 workflows importados"
```

### 8.2 Activar todos los workflows en bulk

Tras importar, los workflows están en estado `inactive`. Activarlos:

```bash
# obtener lista de IDs
WORKFLOW_IDS=$(curl -s \
  -H "Authorization: Bearer $COOKIE" \
  "$N8N_URL/rest/workflows" \
  | jq -r '.data[].id')

for id in $WORKFLOW_IDS; do
  echo "→ activating $id"
  curl -s -X PATCH \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $COOKIE" \
    -d '{"active": true}' \
    "$N8N_URL/rest/workflows/$id"
done
echo "✓ todos activos"
```

### 8.3 Validación post-import

```bash
# smoke test: llamar a cada webhook y verificar 200
for agent in profile speech catalog quote objection address logistics checkout \
  buyer_behavior guide_tracking novedades redelivery remarketing \
  customer_score carrier_score product_enrichment marketplace affiliator \
  vision guide_alert address_analysis traffic_orchestrator sales_retainer \
  logistics_notifier theme cart_builder; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://localhost:5678/webhook/commerceflow/$agent \
    -H "Content-Type: application/json" \
    -H "x-api-key: $COMMERCEFLOW_API_KEY" \
    -d "{\"tenantId\":\"ten-saramantha\"}")
  echo "$agent: $code"
done
# → todos 200 ✅
```

---

## 9. Pipelines de orquestación en n8n

Más allá de los 26 workflows individuales, creamos **3 workflows orquestador**
que encadenan los agentes en el orden definido en `src/lib/orchestrator/constants.ts`.

### 9.1 Pipeline A — Pre-venta (10 agentes)

```
Webhook → Code (init state) → Execute WF buyer_behavior
       → Execute WF profile
       → Execute WF speech
       → Execute WF catalog
       → Execute WF cart_builder
       → Execute WF quote
       → Execute WF objection
       → Execute WF address
       → Execute WF logistics
       → Execute WF checkout
       → Code (consolidate) → Respond
```

Cada nodo `Execute Workflow` recibe el output del anterior y lo enriquece:

```json
{
  "parameters": {
    "workflowId": "={{ $workflow.id }}",
    "executeTrigger": false,
    "itemsInBody": "auto"
  },
  "id": "exec-buyer_behavior",
  "name": "WF · buyer_behavior",
  "type": "n8n-nodes-base.executeWorkflow",
  "typeVersion": 1,
  "position": [460, 300]
}
```

El body que se pasa de un Execute al siguiente va acumulando estado:

```javascript
// Code node "init state" — antes del primer Execute
const input = $input.first().json;
return [{
  json: {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    pipeline: 'pre_sale',
    currentStep: 0,
    totalSteps: 10,
    context: {
      message: input.message || 'Hola',
      perfil: null,
      cart: [],
      quote: null,
      address: null,
      shipping: null,
    },
    history: [],  // append tras cada agente
  }
}];
```

### 9.2 Pipeline B — Post-venta (4 agentes)

```
Webhook → Code (load order) → Execute WF guide_tracking
       → IF (stuck?) → Execute WF novedades
                    → IF (devolucion?) → Execute WF redelivery
       → IF (no response 7d) → Execute WF remarketing
       → Code (consolidate) → Respond
```

Pipeline B usa nodos `IF` para ramificar según el estado de la orden y del
envío. El árbol de decisión replica la lógica del cron `detectStuckGuides`
descrito en el journey 3.

### 9.3 Pipeline C — Inteligencia (5 agentes)

```
Cron (diario 03:00) → Execute WF customer_score
                    → Execute WF carrier_score
                    → Execute WF product_enrichment
                    → Execute WF marketplace (cross-brand refresh)
                    → Execute WF affiliator (recommendations)
                    → Code (publish metrics to Grafana)
```

Pipeline C corre en background (sin webhook). Usa un nodo `Schedule Trigger`
con cron `0 3 * * *` (3 AM UTC, 10 PM hora Colombia).

---

## 10. Ejemplo completo — workflow orquestador del Pipeline A

El siguiente JSON es el workflow `CF · Orchestrate · Pre-sale` que encadena los
10 agentes en orden. Importable directamente en n8n.

```json
{
  "name": "CF · Orchestrate · Pre-sale",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "commerceflow/orchestrate/pre_sale",
        "responseMode": "responseNode"
      },
      "id": "wh-orch",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [180, 300],
      "webhookId": "cf-orch-presale-001"
    },
    {
      "parameters": {
        "jsCode": "const input = $input.first().json;\nreturn [{\n  json: {\n    tenantId: input.tenantId,\n    conversationId: input.conversationId || `conv-${Date.now()}`,\n    customerId: input.customerId,\n    pipeline: 'pre_sale',\n    currentStep: 0,\n    context: { message: input.message || 'Hola', perfil: null, cart: [], quote: null, address: null, shipping: null },\n    history: []\n  }\n}];"
      },
      "id": "code-init",
      "name": "Init state",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [400, 300]
    },
    {
      "parameters": { "workflowId": "buyer_behavior-wf-id", "mode": "each" },
      "id": "exec-1",
      "name": "1. buyer_behavior",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [620, 300]
    },
    {
      "parameters": { "workflowId": "profile-wf-id", "mode": "each" },
      "id": "exec-2",
      "name": "2. profile",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [840, 300]
    },
    {
      "parameters": { "workflowId": "speech-wf-id", "mode": "each" },
      "id": "exec-3",
      "name": "3. speech",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1060, 300]
    },
    {
      "parameters": { "workflowId": "catalog-wf-id", "mode": "each" },
      "id": "exec-4",
      "name": "4. catalog",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1280, 300]
    },
    {
      "parameters": { "workflowId": "cart_builder-wf-id", "mode": "each" },
      "id": "exec-5",
      "name": "5. cart_builder",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1500, 300]
    },
    {
      "parameters": { "workflowId": "quote-wf-id", "mode": "each" },
      "id": "exec-6",
      "name": "6. quote",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1720, 300]
    },
    {
      "parameters": { "workflowId": "objection-wf-id", "mode": "each" },
      "id": "exec-7",
      "name": "7. objection",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [1940, 300]
    },
    {
      "parameters": { "workflowId": "address-wf-id", "mode": "each" },
      "id": "exec-8",
      "name": "8. address",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [2160, 300]
    },
    {
      "parameters": { "workflowId": "logistics-wf-id", "mode": "each" },
      "id": "exec-9",
      "name": "9. logistics",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [2380, 300]
    },
    {
      "parameters": { "workflowId": "checkout-wf-id", "mode": "each" },
      "id": "exec-10",
      "name": "10. checkout",
      "type": "n8n-nodes-base.executeWorkflow",
      "typeVersion": 1,
      "position": [2600, 300]
    },
    {
      "parameters": {
        "jsCode": "const final = $input.first().json;\nreturn [{\n  json: {\n    ok: true,\n    pipeline: 'pre_sale',\n    steps: 10,\n    history: final.history || [],\n    outcome: {\n      orderId: final.context.orderId,\n      paymentLink: final.context.paymentLink,\n      total: final.context.total\n    }\n  }\n}];"
      },
      "id": "code-final",
      "name": "Consolidate",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [2820, 300]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify($json) }}",
        "options": { "responseCode": 200 }
      },
      "id": "respond-orch",
      "name": "Respond",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1,
      "position": [3040, 300]
    }
  ],
  "connections": {
    "Webhook":   { "main": [[{ "node": "Init state", "type": "main", "index": 0 }]] },
    "Init state":{ "main": [[{ "node": "1. buyer_behavior", "type": "main", "index": 0 }]] },
    "1. buyer_behavior": { "main": [[{ "node": "2. profile", "type": "main", "index": 0 }]] },
    "2. profile":        { "main": [[{ "node": "3. speech", "type": "main", "index": 0 }]] },
    "3. speech":         { "main": [[{ "node": "4. catalog", "type": "main", "index": 0 }]] },
    "4. catalog":        { "main": [[{ "node": "5. cart_builder", "type": "main", "index": 0 }]] },
    "5. cart_builder":   { "main": [[{ "node": "6. quote", "type": "main", "index": 0 }]] },
    "6. quote":          { "main": [[{ "node": "7. objection", "type": "main", "index": 0 }]] },
    "7. objection":      { "main": [[{ "node": "8. address", "type": "main", "index": 0 }]] },
    "8. address":        { "main": [[{ "node": "9. logistics", "type": "main", "index": 0 }]] },
    "9. logistics":      { "main": [[{ "node": "10. checkout", "type": "main", "index": 0 }]] },
    "10. checkout":      { "main": [[{ "node": "Consolidate", "type": "main", "index": 0 }]] },
    "Consolidate":       { "main": [[{ "node": "Respond", "type": "main", "index": 0 }]] }
  },
  "settings": {
    "executionOrder": "v1",
    "saveExecutionProgress": true,
    "saveManualExecutions": true,
    "callerPolicy": "workflowsFromSameOwner",
    "maxExecutionDuration": 120000
  },
  "tags": [
    { "name": "commerceflow" },
    { "name": "orchestrator" },
    { "name": "pipeline-A" }
  ]
}
```

> **Nota sobre `workflowId`**: reemplazar `buyer_behavior-wf-id`, `profile-wf-id`,
> etc., por los IDs reales que n8n asigna al importar cada workflow individual.
> Para automatizar esto, ejecutar el script `scripts/link-orchestrator.js` después
> del bulk import del §8.

---

## 11. Autenticación de webhooks — shared secret

Cada webhook n8n expone debe estar protegido. Usamos **header-based shared
secret** (`x-api-key`) en lugar de JWT porque:

- Es simple de configurar en webhooks de Meta/WA/MercadoPago.
- Permite rotación rápida sin invalidar sesiones.
- Es compatible con el `tenantGuard` de CommerceFlow.

### 11.1 Configurar Header Auth en n8n

1. En n8n UI: **Credentials → New → Header Auth**
2. Name: `CommerceFlow API Key`
3. Name: `x-api-key` · Value: `{{ $env.COMMERCEFLOW_API_KEY }}`
4. Guardar y asignar a cada nodo Webhook en "Authentication".

### 11.2 Validación server-side

El webhook valida el header antes de procesar:

```javascript
// n8n Code node — primer nodo tras Webhook
const headers = $input.first().json.headers || {};
const apiKey = headers['x-api-key'] || headers['X-Api-Key'];

if (apiKey !== $env.COMMERCEFLOW_API_KEY) {
  // devolver 401 al caller
  throw new Error('UNAUTHORIZED: invalid x-api-key');
}

// si OK, continuar al siguiente nodo
return $input.all();
```

### 11.3 Rotación

Para rotar el secret sin downtime:

1. Generar nueva key: `openssl rand -hex 32`.
2. Agregar `COMMERCEFLOW_API_KEY_NEW=...` al `.env`.
3. Actualizar todos los webhooks para aceptar AMBAS keys (transitional).
4. Tras 24h, remover la key vieja y dejar solo `_NEW`.
5. Renombrar `_NEW` → `COMMERCEFLOW_API_KEY` y redeploy.

---

## 12. Error handling — fallbacks y reintentos

### 12.1 Retry a nivel de HTTP Request

Cada nodo HTTP Request hacia CommerceFlow tiene:

- `retryOnFail: true`
- `maxTries: 3`
- `waitBetweenTries: 500` (ms, con backoff exponencial interno)
- `timeout: 30000`

### 12.2 Nodo de Error Trigger

Cada workflow tiene un nodo `Error Trigger` conectado a un canal de Slack:

```
[Error Trigger] → [HTTP Request to Slack webhook] → [Set workflow inactive]
```

Si un agente falla 3 veces seguidas, se desactiva automáticamente y se notifica
al equipo. El orquestador salta al siguiente agente con un warning.

### 12.3 Fallback en el orquestador

En el workflow orquestador, cada `Execute Workflow` está envuelto en un nodo
`IF`:

```
[Execute WF agent X] ── success ──▶ [next agent]
                  │
                  └─ error ──▶ [Code: log + skip] ──▶ [next agent]
```

```javascript
// Code node "fallback handler"
const error = $input.first().json.error;
const agentName = $input.first().json.agentName;

// Log al Slack
await helpers.httpRequest({
  method: 'POST',
  url: $env.SLACK_WEBHOOK_URL,
  body: {
    text: `⚠️ Agent ${agentName} failed in pipeline A. Skipping to next step.`,
    attachments: [{ color: 'warning', text: JSON.stringify(error) }]
  }
});

// Marca en el history y continúa
return [{
  json: {
    ...$input.first().json,
    history: [...($input.first().json.history || []), {
      agent: agentName,
      status: 'failed',
      error: error.message
    }]
  }
}];
```

### 12.4 Dead letter queue

Si un workflow falla repetidamente (más de 10 veces en 1h), n8n lo marca como
`errored` y el mensaje cae a una cola DLQ (Postgres table `n8n_dlq`). Un cron
intenta re-procesarlos cada noche.

---

## 13. Monitoring — Uptime Kuma + execution logs

### 13.1 Uptime Kuma pings

Para cada uno de los 26 webhooks + 3 orquestadores, crear un monitor en
**Uptime Kuma** (incluido en el docker-compose, puerto 3001):

```
Tipo: HTTP(s) - Keyword
URL:  http://n8n:5678/webhook/commerceflow/{agent}
Keyword: "ok"
Método: POST
Body: {"tenantId":"ten-saramantha","message":"ping"}
Headers: x-api-key: $COMMERCEFLOW_API_KEY
Interval: 60s
```

Si un webhook no responde `ok` en 60s, Kuma dispara alerta a Slack + email.

### 13.2 n8n execution logs

n8n guarda cada ejecución en su Postgres. Consultar executions fallidas:

```sql
-- n8n database
SELECT
  w.name AS workflow,
  e.status,
  e."startedAt",
  e."stoppedAt",
  e."executionData"->>'error' AS error
FROM execution_entity e
JOIN workflow_entity w ON w.id = e."workflowId"
WHERE e.status = 'error'
  AND e."startedAt" > NOW() - INTERVAL '24 hours'
ORDER BY e."startedAt" DESC
LIMIT 100;
```

### 13.3 Métricas a Grafana

n8n expone métricas Prometheus en `/metrics` (habilitar con
`N8N_METRICS=true`). Dashboard recomendado:

- **Throughput por agente** — ejecuciones/min (rate)
- **Latencia p50/p95/p99** — por agente y por pipeline
- **Error rate** — % de executions en status `error`
- **Active workflows** — count de workflows en estado `active`
- **Webhook response time** — latencia HTTP de cada webhook

---

## 14. Integración con CommerceFlow OS

### 14.1 Flujo bidireccional

```
WhatsApp Cloud API
       │
       ▼ (1) POST message
n8n webhook /webhook/whatsapp-incoming
       │
       ▼ (2) Execute WF orchestrator (Pipeline A)
       │
       ▼ (3) Para cada agente: HTTP Request → CommerceFlow /api/agents/{agent}
       │
       ▼ (4) CommerceFlow responde con { reply, meta }
       │
       ▼ (5) n8n consolida + envía reply
       │
       ▼ (6) HTTP Request → Meta Graph API → WhatsApp Cloud
       │
       ▼ (7) Cliente recibe el reply en su WhatsApp
```

### 14.2 Ejemplo — invocar desde dashboard CommerceFlow

El dashboard de CommerceFlow puede invocar n8n directamente (en lugar del
orquestador interno) para aprovechar la visualización de n8n:

```typescript
// src/components/dashboard/orchestrator-view.tsx
async function runPipelineViaN8n(pipeline: 'pre_sale' | 'post_sale' | 'intelligence') {
  const res = await fetch(`${process.env.N8N_URL}/webhook/commerceflow/orchestrate/${pipeline}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.COMMERCEFLOW_API_KEY!,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({
      tenantId,
      conversationId,
      customerId,
      message: seedMessage,
    }),
  });
  return res.json();
}
```

### 14.3 Variable de entorno en CommerceFlow para usar n8n

En `.env` de CommerceFlow:

```bash
# si se quiere usar n8n como orquestador externo
USE_N8N_ORCHESTRATOR=true
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=cambia-esto
```

El orquestador interno respeta este flag y delega a n8n si está activo.

---

## 15. Troubleshooting

### 15.1 Webhook timeout (504)

**Síntoma**: n8n devuelve 504 después de 30s.

**Causa probable**: el agente LLM tardó más del timeout.

**Solución**:
- Subir `timeout` del HTTP Request a 60s.
- Si persiste, el modelo LLM puede estar saturado. Revisar z-ai-web-dev-sdk logs.
- Para pipelines largos (Pipeline A completo), usar `responseMode: 'lastNode'`
  y devolver 200 inmediatamente + enviar el resultado por webhook a Meta cuando
  termine.

### 15.2 Error de autenticación (401)

**Síntoma**: webhook devuelve 401.

**Causa probable**: header `x-api-key` mal configurado o desactualizado.

**Solución**:
```bash
# verificar env en el contenedor n8n
docker-compose exec n8n printenv | grep COMMERCEFLOW_API_KEY
# comparar con .env
grep COMMERCEFLOW_API_KEY .env
# si difieren, redeploy:
docker-compose up -d n8n
```

### 15.3 CORS errors

**Síntoma**: el navegador bloquea llamadas desde el dashboard a n8n.

**Causa**: n8n no permite el origin del dashboard.

**Solución**: agregar env en n8n:
```bash
N8N_ALLOWED_ORIGINS=https://dashboard.tudominio.com,http://localhost:3000
```

### 15.4 Webhook URL no resuelve

**Síntoma**: `https://n8n.tudominio.com/webhook/...` devuelve 404.

**Causa**: `WEBHOOK_URL` no está bien configurado o no hay reverse proxy.

**Solución**:
- Verificar `WEBHOOK_URL=https://n8n.tudominio.com` en `.env`.
- Configurar nginx/caddy reverse proxy para pasar `/webhook/*` al contenedor n8n.
- En n8n UI: Settings → Webhooks → confirmar que el path registrado coincide.

### 15.5 Workflow se queda "running" indefinidamente

**Síntoma**: execution status `running` por más de 5 min.

**Causa**: deadlock en `Execute Workflow` (ciclo) o LLM colgado.

**Solución**:
- Configurar `maxExecutionDuration: 120000` (2 min) en settings del workflow.
- Si persiste, forzar kill: `docker-compose exec n8n n8n execution:cancel <id>`.
- Revisar si hay `Execute Workflow` recursivos.

### 15.6 Datos PII en logs

**Síntoma**: n8n logs o Sentry contienen teléfono/dirección del cliente.

**Causa**: `saveExecutionProgress: true` guarda el body completo.

**Solución**:
- En n8n Settings → Frontend → desactivar "Save execution progress".
- Para nodos Code, sanitizar antes de log:
  ```javascript
  const sanitized = { ...$json };
  delete sanitized.body.phone;
  delete sanitized.body.address;
  console.log(JSON.stringify(sanitized));
  ```

---

## 16. Best practices

### 16.1 Versioning

- Cada workflow exportado debe vivir en `n8n-workflows/agents/agent-{name}.json` en git.
- Antes de cualquier cambio, exportar la versión actual: `n8n export:workflow --all --out=./n8n-workflows/snapshots/$(date +%Y%m%d)/`.
- Tag git por release: `git tag n8n-v1.2.0`.

### 16.2 Testing

- **Staging**: réplica del stack en `staging.tudominio.com` con su propio n8n.
- **Smoke tests**: script `scripts/n8n-smoke.sh` que llama a los 26 webhooks + 3 orquestadores y verifica 200.
- **Integration tests**: 4 escenarios sembrados (`mayorista_familia`, `detal_stitch`, `regalo_hello_kitty`, `cancelacion_inventario`) corren contra staging cada noche.

### 16.3 Staging vs producción

| Aspecto | Staging | Producción |
|---|---|---|
| n8n URL | `n8n-staging.tudominio.com` | `n8n.tudominio.com` |
| ComerceFlow | `staging.tudominio.com` | `commerceflow.tudominio.com` |
| API key | `cf_staging_xxx` | `cf_prod_xxx` (rotada mensual) |
| Tenants seed | `ten-saramantha-staging` | `ten-saramantha` + tenants reales |
| Webhook Meta | URL staging en Meta app | URL prod en Meta app |
| Logs | n8n execution DB local | n8n + Sentry + Grafana |

### 16.4 Backup

- **DB n8n**: backup diario del Postgres de n8n (`pg_dump n8n > backup-$(date).sql`).
- **Workflows JSON**: snapshot semanal en S3.
- **Credentials**: export encriptado con `n8n export:credentials --all --encrypted`.

### 16.5 Performance tuning

- Activar `N8N_CONCURRENCY_PRODUCTION_LIMIT=50` para evitar saturar el LLM.
- Si un agente recibe > 100 req/min, escalar horizontalmente con n8n queue mode (Redis + workers).
- Cache: para agentes idempotentes (`product_enrichment`, `carrier_score`), agregar un nodo Redis Cache antes del HTTP Request.

### 16.6 Naming conventions

- Workflows: `CF · Agent · {agentName}` o `CF · Orchestrate · {pipeline}`.
- Webhooks: `/webhook/commerceflow/{agentName}` o `/webhook/commerceflow/orchestrate/{pipeline}`.
- Tags: `commerceflow`, `agent`, `orchestrator`, `pipeline-{A|B|C|support}`.

---

## 17. Checklist de deploy final

```markdown
### Staging
- [ ] docker-compose up -d levanta n8n en :5678 sin errores
- [ ] Health check mutuo OK (n8n → CF API → n8n)
- [ ] 26 workflows importados via API bulk import
- [ ] 26 workflows en estado active
- [ ] 3 workflows orquestador importados y linkeados (workflowId reales)
- [ ] Smoke test: 26 webhooks devuelven 200
- [ ] Smoke test: 3 orquestadores completan pipeline A/B/C
- [ ] Uptime Kuma monitores creados (29 monitores)
- [ ] Slack alertas configuradas
- [ ] Cron Pipeline C corriendo a las 3 AM UTC

### Producción
- [ ] Staging aprobado por QA (ver PRESENTACION-E2E-TESTS.html)
- [ ] Backup del n8n DB tomado
- [ ] DNS + reverse proxy (Caddy/Nginx) configurado
- [ ] TLS cert instalado (Let's Encrypt)
- [ ] Variables de entorno prod seteadas (sin secrets en git)
- [ ] Webhook URLs actualizadas en Meta/WA/MercadoPago/Wompi/Stripe/PayU
- [ ] 2FA TOTP activado para todos los traffickers (verifica J7)
- [ ] AuditLog de deploy registrado
- [ ] On-call rotation informada
- [ ] Rollback plan documentado
```

---

## 18. Referencias

- **Código fuente**: `src/lib/agents/prompts.ts` (1333 líneas, 26 agentes)
- **Orquestador**: `src/lib/orchestrator/constants.ts` (3 pipelines, 19 steps)
- **API routes**: `src/app/api/agents/[agentName]/route.ts`
- **Auditoría**: `AUDIT-REPORT.md` (1202 líneas)
- **Worklog**: `worklog.md` (cycle 1 completo)
- **n8n docs**: https://docs.n8n.io
- **Docker compose reference**: `docker-compose.yml` (11 servicios)

---

## 19. Apéndice — Agentes ordenados por pipeline

### Pipeline A — Pre-venta (11 agentes)

```text
1.  buyer_behavior  — filtro inicial, ¿es devolvedor?
2.  profile         — mayorista / emprendedor / detal / regalo
3.  speech          — apertura + prueba social por perfil
4.  catalog         — visual-primero con imágenes reales
5.  theme           — Stitch / Hello Kitty / etc
6.  cart_builder    — construye carrito conversacional
7.  quote           — precios por volumen + cross-sell
8.  objection       — clasifica + aplica gatillo mental
9.  address         — 10 campos + validación
10. logistics       — cotiza flete con 3 carriers
11. checkout        — resumen + payment link + guía + comisión
```

### Pipeline B — Post-venta (4 agentes)

```text
1. guide_tracking — seguimiento + alerta si estancada
2. novedades      — crea caso, pide evidencia, escala
3. redelivery     — reintento con nueva dirección
4. remarketing    — recupera ventas perdidas
```

### Pipeline C — Inteligencia (5 agentes)

```text
1. customer_score      — score + malos hábitos
2. carrier_score       — efectividad por carrier + ciudad
3. product_enrichment  — tags + keywords + BI
4. marketplace         — cross-brand leads
5. affiliator          — recomendaciones para traffickers
```

### Soporte (6 agentes)

```text
1. vision              — VLM análisis de imágenes
2. guide_alert         — dispara alertas de guía estancada
3. address_analysis    — validación de calidad de dirección
4. traffic_orchestrator — coordina campañas de pauta
5. sales_retainer      — retención de clientes VIP
6. logistics_notifier  — notificaciones proactivas de envío
```

---

**Fin del documento.**

> Para preguntas sobre esta guía, contactar al equipo de Platform Engineering.
> Para bugs en los workflows, abrir issue en el repo con tag `n8n`.
> Para updates del código de los agentes, referir a `src/lib/agents/prompts.ts` —
> esta guía se mantiene sincronizada con la estructura de agentes definida allí.
