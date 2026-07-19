# Guía de importación de workflows n8n (Saramantha §1.2, §11.2)

Esta carpeta contiene **26 workflows n8n** listos para importar en tu instancia de n8n autoalojada (incluida en `docker-compose.yml`).

> **SPRINT-FIXES-N8N-DEPLOY-001** — la carpeta se expandió de 12 workflows (los 10 agentes originales + el orquestador + el legacy) a **26 workflows**: los 12 originales renombrados (`CommerceFlow` → `ZIAY`) + **16 nuevos** para los agentes adicionales agregados en `BUILD-AGENTS-LIB-001` (24 agentes en total).

## Archivos

### Orquestador + legacy

| Archivo | Descripción |
|---|---|
| `master-orchestrator.json` | **Orquestador canónico** — pipeline de **9 pasos** (§12). Llama a `POST /api/orchestrate` con `action=full`. |
| `10-agentes-conversacionales.json` | Workflow **legacy** — encadena los 10 agentes originales como referencia histórica. **No usar en producción** — usar `master-orchestrator.json` en su lugar. |

### 10 agentes originales (Saramantha §6)

| Archivo | Agente | Endpoint |
|---|---|---|
| `agent-profile.json`    | 6.1 Perfilamiento de leads        | `POST /api/agents/profile` |
| `agent-speech.json`     | 6.2 Discurso de ventas por perfil | `POST /api/agents/speech` |
| `agent-quote.json`      | 6.3 Cotización cruzada            | `POST /api/agents/quote` |
| `agent-catalog.json`    | 6.4 Catálogo visual-primero       | `POST /api/agents/catalog` |
| `agent-theme.json`      | 6.5 Búsqueda por tema/personaje   | `POST /api/agents/theme` |
| `agent-objection.json`  | 6.6 Manejo de objeciones          | `POST /api/agents/objection` |
| `agent-address.json`    | 6.7 Confirmación de datos (10 campos) | `POST /api/agents/address` |
| `agent-logistics.json`  | 6.8 Logística de fletes           | `POST /api/agents/logistics` |
| `agent-vision.json`     | 6.9 Visión (identificación por imagen) | `POST /api/agents/vision` |
| `agent-checkout.json`   | 6.10 Checkout y sincronización    | `POST /api/agents/checkout` |

### 16 agentes adicionales (BUILD-AGENTS-LIB-001)

| Archivo | Agente | Endpoint |
|---|---|---|
| `agent-buyer_behavior.json`     | Análisis de comportamiento de compra    | `POST /api/agents/buyer_behavior` |
| `agent-cart_builder.json`       | Constructor de carrito NL               | `POST /api/agents/cart_builder` |
| `agent-guide_tracking.json`     | Seguimiento de guía                     | `POST /api/agents/guide_tracking` |
| `agent-novedades.json`          | Manejo de novedades logísticas          | `POST /api/agents/novedades` |
| `agent-redelivery.json`         | Coordinación de re-entrega              | `POST /api/agents/redelivery` |
| `agent-remarketing.json`        | Re-enganche de leads fríos              | `POST /api/agents/remarketing` |
| `agent-guide_alert.json`        | Alertas operativas de guías             | `POST /api/agents/guide_alert` |
| `agent-sales_retainer.json`     | Retención de ventas en riesgo           | `POST /api/agents/sales_retainer` |
| `agent-logistics_notifier.json` | Notificaciones proactivas logísticas    | `POST /api/agents/logistics_notifier` |
| `agent-customer_score.json`     | Scoring de clientes (LTV/churn)         | `POST /api/agents/customer_score` |
| `agent-carrier_score.json`      | Scoring de transportadoras              | `POST /api/agents/carrier_score` |
| `agent-product_enrichment.json` | Enriquecimiento de catálogo (SEO/alt)   | `POST /api/agents/product_enrichment` |
| `agent-marketplace.json`        | Sincronización con marketplaces         | `POST /api/agents/marketplace` |
| `agent-affiliator.json`         | Gestión de afiliados e influencers      | `POST /api/agents/affiliator` |
| `agent-traffic_orchestrator.json` | Orquestador de tráfico pagado         | `POST /api/agents/traffic_orchestrator` |
| `agent-address_analysis.json`   | Análisis de calidad de dirección        | `POST /api/agents/address_analysis` |

## Cómo importar

### Opción A — Desde la UI de n8n
1. Levanta el stack: `docker compose up -d`
2. Abre n8n: `http://localhost:5678` (o `https://tu-dominio.com/n8n/` en prod)
3. Completa el setup inicial (crear cuenta owner)
4. Ve a **Workflows** → **Import from File**
5. Importa los 28 archivos JSON uno por uno (o usa la Opción C para bulk)
6. Activa cada workflow con el toggle (top-right)

### Opción B — Vía CLI (bulk import)
```bash
# After docker compose up -d, exec into n8n container:
docker compose exec n8n n8n import:input --input=/import-workflows/agent-profile.json
docker compose exec n8n n8n import:input --input=/import-workflows/agent-speech.json
# ... (repeat for all 28)
```

### Opción C — Script automático (recomendado)
```bash
for f in n8n-workflows/*.json; do
  echo "Importing $f..."
  docker compose exec -T n8n n8n import:input --input=/import-workflows/$(basename $f)
done
```

## Configuración de credenciales

Después de importar, configura las credenciales en n8n (Settings → Credentials):

| Credencial | Usada por | Cómo obtenerla |
|---|---|---|
| PostgreSQL | Todos los workflows | Ya configurada vía `DB_POSTGRESDB_*` en docker-compose |
| HTTP Header Auth (app) | Todos los workflows | No requerida (app interna) |
| WhatsApp Cloud API | Webhooks entrantes | Meta Business → WhatsApp → API Setup |
| OpenAI API | Agentes (si tenant usa chatgpt) | platform.openai.com → API Keys |
| xAI API | Agentes (si tenant usa xai) | console.x.ai → API Keys |
| ZAI API | Agentes (default provider) | Consola ZAI → API Keys |

## Webhooks entrantes

Una vez activados los workflows, n8n expone estos webhooks:

| Webhook | URL | Body |
|---|---|---|
| **Orquestador (canónico)** | `POST /webhook/orchestrate` | `{tenantId, scenarioId, customerId?, conversationId?}` |
| Perfilamiento        | `POST /webhook/agent-profile`            | `{tenantId, message}` |
| Discurso             | `POST /webhook/agent-speech`             | `{tenantId, perfil}` |
| Cotización           | `POST /webhook/agent-quote`              | `{tenantId, items, perfil}` |
| Catálogo             | `POST /webhook/agent-catalog`            | `{tenantId, query}` |
| Tema                 | `POST /webhook/agent-theme`              | `{tenantId, tema}` |
| Objeciones           | `POST /webhook/agent-objection`          | `{tenantId, message}` |
| Dirección            | `POST /webhook/agent-address`            | `{tenantId, partialAddress}` |
| Logística            | `POST /webhook/agent-logistics`          | `{tenantId, ciudad, unidades}` |
| Visión               | `POST /webhook/agent-vision`             | `{tenantId, imageUrl}` |
| Checkout             | `POST /webhook/agent-checkout`           | `{tenantId, customerId, items}` |
| Buyer Behavior       | `POST /webhook/agent-buyer_behavior`     | `{tenantId, customerId}` |
| Cart Builder         | `POST /webhook/agent-cart_builder`       | `{tenantId, message, customerId?}` |
| Guide Tracking       | `POST /webhook/agent-guide_tracking`     | `{tenantId, guideNumber}` |
| Novedades            | `POST /webhook/agent-novedades`          | `{tenantId, guideNumber, novedad}` |
| Redelivery           | `POST /webhook/agent-redelivery`         | `{tenantId, guideNumber, slot}` |
| Remarketing          | `POST /webhook/agent-remarketing`        | `{tenantId, customerId}` |
| Guide Alert          | `POST /webhook/agent-guide_alert`        | `{tenantId, guideNumber, alertType}` |
| Sales Retainer       | `POST /webhook/agent-sales_retainer`     | `{tenantId, orderId, reason}` |
| Logistics Notifier   | `POST /webhook/agent-logistics_notifier` | `{tenantId, guideNumber, milestone}` |
| Customer Score       | `POST /webhook/agent-customer_score`     | `{tenantId, customerId}` |
| Carrier Score        | `POST /webhook/agent-carrier_score`      | `{tenantId, carrierId}` |
| Product Enrichment   | `POST /webhook/agent-product_enrichment` | `{tenantId, productId}` |
| Marketplace          | `POST /webhook/agent-marketplace`        | `{tenantId, productId, marketplace}` |
| Affiliator           | `POST /webhook/agent-affiliator`         | `{tenantId, affiliateCode}` |
| Traffic Orchestrator | `POST /webhook/agent-traffic_orchestrator` | `{tenantId, campaignId}` |
| Address Analysis     | `POST /webhook/agent-address_analysis`   | `{tenantId, address}` |

## WhatsApp Cloud API → n8n

Para conectar WhatsApp entrante a n8n:

1. En Meta Business → WhatsApp → Webhooks, configura la URL:
   ```
   https://tu-dominio.com/n8n/webhook/whatsapp-inbound
   ```
2. Verify token: el valor de `WA_VERIFY_TOKEN` en `.env`
3. Suscríbete al evento `messages`

El workflow `master-orchestrator.json` recibe el webhook, resuelve el `tenantId` desde el WABA que recibió el mensaje, y ejecuta el escenario completo de 9 pasos.

## Validación

Después de importar y activar, prueba:

```bash
# Test agent-profile (original)
curl -X POST http://localhost:5678/webhook/agent-profile \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","message":"para surtir mi tienda"}'

# Test a new agent (e.g. guide_tracking)
curl -X POST http://localhost:5678/webhook/agent-guide_tracking \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","guideNumber":"TRACK-12345"}'

# Test master orchestrator — 9-step pipeline, scenario = mayorista_familia
curl -X POST http://localhost:5678/webhook/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","scenarioId":"mayorista_familia"}'
```

## Escenarios disponibles (ORCHESTRATOR_SCENARIOS)

El `master-orchestrator.json` acepta estos `scenarioId`:

| scenarioId | Descripción |
|---|---|
| `mayorista_familia`       | Lead mayorista pide "familia" |
| `detal_stitch`            | Cliente final pregunta por Stitch |
| `regalo_hello_kitty`      | Regalo, sensibilidad a precio |
| `cancelacion_inventario`  | Cliente quiere cancelar |

## Notas

- Los workflows llaman a `http://app:3000/api/agents/[name]` (el ZIAY Next.js app).
- Si n8n no puede resolver `app`, usa `http://host.docker.internal:3000` en su lugar.
- Los 24 agentes también funcionan sin n8n (vía la UI del Orquestador en el dashboard), pero n8n permite que un equipo no-técnico edite los flujos visualmente.
- El pipeline canónico de 9 pasos está definido en `src/lib/orchestrator/constants.ts` (`ORCHESTRATOR_STEPS`). El `master-orchestrator.json` solo ejecuta ese pipeline — los 16 agentes adicionales se invocan por separado según el contexto del negocio.

## Endpoint de Reglas de Comportamiento

Las reglas NUNCA/SIEMPRE NO van en los workflows de n8n. Se gestionan centralizadamente en ZIAY.

### Endpoint

```
GET /api/agents/rules
```

Retorna el catálogo completo de reglas (29 NUNCA + 17 SIEMPRE = 46 reglas) con formato compacto y verbose.

### Cómo funciona

1. **n8n** recibe el mensaje del cliente (webhook)
2. **n8n** llama a `POST /api/agents/[agentName]` (sin reglas en n8n)
3. **ZIAY** inyecta las reglas en el system prompt del agente
4. **ZIAY** valida el output contra las reglas (`validateOutput`)
5. **ZIAY** devuelve la respuesta validada a n8n
6. **n8n** responde al cliente

### Consultar reglas desde n8n (opcional)

Si necesitas mostrar las reglas en un dashboard de n8n:

```json
{
  "method": "GET",
  "url": "http://localhost:3000/api/agents/rules",
  "authentication": "headerAuth",
  "sendHeaders": true,
  "headerParameters": {
    "parameters": [
      { "name": "Cookie", "value": "next-auth.session-token={{$env.ZIAY_SESSION}}" }
    ]
  }
}
```

### Reglas por categoría

| Categoría | NUNCA aplicables | SIEMPRE aplicables |
|-----------|------------------|--------------------|
| Pre-venta | Todas | S01,S02,S03,S04,S05,S06,S09,S20,S21 |
| Post-venta | N11 (devoluciones→humano) | S01,S03,S04,S05,S20 |
| Inteligencia | — | S01,S04,S20 |
| Especializados | — | S01,S03,S04,S20 |

### Catálogo completo

Ver: `docs/GUIA-COMPORTAMIENTO-AGENTES.md`
