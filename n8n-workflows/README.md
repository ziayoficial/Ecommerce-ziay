# Guía de importación de workflows n8n (Saramantha §1.2, §11.2)

Esta carpeta contiene **11 workflows n8n** listos para importar en tu instancia de n8n autoalojada (incluida en `docker-compose.yml`).

## Archivos

| Archivo | Descripción |
|---|---|
| `agent-profile.json` | 6.1 Agente de perfilamiento de leads |
| `agent-speech.json` | 6.2 Agente de discurso de ventas por perfil |
| `agent-quote.json` | 6.3 Agente de cotización cruzada |
| `agent-catalog.json` | 6.4 Agente de catálogo visual-primero |
| `agent-theme.json` | 6.5 Agente de búsqueda por tema/personaje |
| `agent-objection.json` | 6.6 Agente de manejo de objeciones |
| `agent-address.json` | 6.7 Agente de confirmación de datos (10 campos) |
| `agent-logistics.json` | 6.8 Agente de logística de fletes |
| `agent-vision.json` | 6.9 Agente de visión (identificación por imagen) |
| `agent-checkout.json` | 6.10 Agente de checkout y sincronización |
| `master-orchestrator.json` | Orquestador master — ejecuta los 10 agentes en secuencia (§12) |
| `10-agentes-conversacionales.json` | Workflow legacy (un solo flujo con los 10 agentes encadenados) |

## Cómo importar

### Opción A — Desde la UI de n8n
1. Levanta el stack: `docker compose up -d`
2. Abre n8n: `http://localhost:5678` (o `https://tu-dominio.com/n8n/` en prod)
3. Completa el setup inicial (crear cuenta owner)
4. Ve a **Workflows** → **Import from File**
5. Importa los 11 archivos JSON uno por uno
6. Activa cada workflow con el toggle (top-right)

### Opción B — Vía CLI (bulk import)
```bash
# After docker compose up -d, exec into n8n container:
docker compose exec n8n n8n import:input --input=/import-workflows/agent-profile.json
docker compose exec n8n n8n import:input --input=/import-workflows/agent-speech.json
# ... (repeat for all 11)
```

### Opción C — Script automático
```bash
for f in n8n-workflows/*.json; do
  echo "Importing $f..."
  docker compose exec n8n n8n import:input --input=/import-workflows/$(basename $f)
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

## Webhooks entrantes

Una vez activados los workflows, n8n expone estos webhooks:

| Webhook | URL | Body |
|---|---|---|
| Perfilamiento | `POST /webhook/agent-profile` | `{tenantId, message}` |
| Discurso | `POST /webhook/agent-speech` | `{tenantId, perfil}` |
| Cotización | `POST /webhook/agent-quote` | `{tenantId, items, perfil}` |
| Catálogo | `POST /webhook/agent-catalog` | `{tenantId, query}` |
| Tema | `POST /webhook/agent-theme` | `{tenantId, tema}` |
| Objeciones | `POST /webhook/agent-objection` | `{tenantId, message}` |
| Dirección | `POST /webhook/agent-address` | `{tenantId, partialAddress}` |
| Logística | `POST /webhook/agent-logistics` | `{tenantId, ciudad, unidades}` |
| Visión | `POST /webhook/agent-vision` | `{tenantId, imageUrl}` |
| Checkout | `POST /webhook/agent-checkout` | `{tenantId, customerId, items}` |
| **Orquestador** | `POST /webhook/orchestrate` | `{tenantId, scenario, customerId?}` |

## WhatsApp Cloud API → n8n

Para conectar WhatsApp entrante a n8n:

1. En Meta Business → WhatsApp → Webhooks, configura la URL:
   ```
   https://tu-dominio.com/n8n/webhook/whatsapp-inbound
   ```
2. Verify token: el valor de `WA_VERIFY_TOKEN` en `.env`
3. Suscríbete al evento `messages`

El workflow `master-orchestrator.json` recibe el webhook, resuelve el `tenantId` desde el WABA que recibió el mensaje, y ejecuta el escenario completo.

## Validación

Después de importar y activar, prueba:

```bash
# Test agent-profile
curl -X POST http://localhost:5678/webhook/agent-profile \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","message":"para surtir mi tienda"}'

# Test master orchestrator
curl -X POST http://localhost:5678/webhook/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","scenario":"indisutex_wa_catalog"}'
```

## Notas

- Los workflows llaman a `http://app:3000/api/agents/[name]` (el CommerceFlow Next.js app).
- Si n8n no puede resolver `app`, usa `http://host.docker.internal:3000` en su lugar.
- Los 10 agentes también funcionan sin n8n (vía la UI del Orquestador en el dashboard), pero n8n permite que un equipo no-técnico edite los flujos visualmente.
