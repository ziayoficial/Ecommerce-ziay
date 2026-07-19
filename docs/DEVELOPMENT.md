# Guía de Desarrollo — ZIAY

Esta guía te lleva desde cero hasta tener el dashboard corriendo localmente con datos reales, los 9 módulos funcionando, y te explica cómo extender el sistema (nuevos agentes, nuevos adaptadores).

> 📖 Para referencia de API ver [`API-REFERENCE.md`](./API-REFERENCE.md).
> 📖 Para referencia de variables de entorno ver [`ENVIRONMENT.md`](./ENVIRONMENT.md).

---

## 📋 Tabla de contenidos

- [Prerequisitos](#prerequisitos)
- [Setup del entorno](#setup-del-entorno)
- [Levantar el dev server](#levantar-el-dev-server)
- [Levantar el chat-service (Socket.io)](#levantar-el-chat-service-socketio)
- [Levantar el gateway Caddy](#levantar-el-gateway-caddy)
- [Cargar datos demo](#cargar-datos-demo)
- [Cargar 239 pedidos reales del CRM](#cargar-239-pedidos-reales-del-crm)
- [Scripts útiles](#scripts-útiles)
- [Smoke tests](#smoke-tests)
- [Lint y type check](#lint-y-type-check)
- [Cómo añadir un nuevo agente conversacional](#cómo-añadir-un-nuevo-agente-conversacional)
- [Cómo añadir un nuevo adaptador](#cómo-añadir-un-nuevo-adaptador)
- [Cómo añadir un nuevo módulo al dashboard](#cómo-añadir-un-nuevo-módulo-al-dashboard)
- [Troubleshooting](#troubleshooting)

---

## Prerequisitos

| Herramienta | Versión mínima | Por qué |
|--------------|----------------|---------|
| **Bun** | 1.3+ | Runtime recomendado, package manager, ejecución de scripts TS directamente |
| **Node.js** | 20+ | Alternativa a Bun si no lo puedes instalar |
| **Git** | 2.40+ | Flujo de trabajo |
| **Caddy** | 2.7+ | Gateway opcional pero recomendado para socket.io realista |
| **Docker** | 24+ | Solo si quieres levantar el stack completo (Postgres, n8n, MinIO) |

### Instalar Bun

```bash
# Linux / macOS / WSL
curl -fsSL https://bun.sh/install | bash

# Verificar
bun --version
```

---

## Setup del entorno

### 1. Clonar el repo

```bash
git clone https://github.com/ziayoficial/Ecommerce-ziay.git
cd Ecommerce-ziay
```

### 2. Instalar dependencias

```bash
bun install
```

Esto instala **85+ dependencias** declaradas en `package.json`, incluyendo Next.js 16, React 19, Prisma 6, todas las Radix UI primitives, tesseract.js, @xenova/transformers, z-ai-web-dev-sdk, etc.

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env`. **Para dev local, lo mínimo indispensable es**:

```bash
# Solo necesitas DATABASE_URL para arrancar con SQLite
DATABASE_URL="file:./dev.db"
```

Las demás variables son opcionales — si no las configuras, los adaptadores y LLM providers operan en modo stub/demo. Ver [`ENVIRONMENT.md`](./ENVIRONMENT.md) para la referencia completa.

### 4. Crear la base de datos y generar el cliente Prisma

```bash
bun run db:push      # Crea/actualiza el schema (auto-detecta SQLite/Postgres via scripts/db-push.ts)
bun run db:generate  # Regenera el cliente Prisma tipado
```

> 💡 **v0.4.0**: `bun run db:push` y `bun run db:seed` son **smart scripts**
> (`scripts/db-push.ts` y `scripts/db-seed.ts`) que auto-detectan el provider
> de Prisma (`sqlite` para dev / `postgresql` para staging+prod) y rutean en
> consecuencia — no necesitas editar manualmente `schema.prisma`.
>
> ⚠️ **Importante**: si modificas `prisma/schema.prisma`, **siempre** corre
> `db:push` + `db:generate` antes de levantar el dev server. Si el dev server
> sigue mostrando "db.X is undefined" para un modelo nuevo, mata el proceso
> `next dev` (puede tener un `globalThis.prisma` cacheado) y reinicia. Ver
> [Troubleshooting](#troubleshooting).

---

## Levantar el dev server

```bash
bun run dev
# → Next.js 16 inicia en http://localhost:3000
# → Output se loguea a dev.log (tee)
```

El primer compile tarda ~30s (muchos Radix components). Subsecuentes HMR son instantáneos.

### Verificar que arrancó

```bash
curl http://localhost:3000/api/health
# → 200 OK con { "status": "warning", "summary": { "ok": 6, "warning": 4, ... } }
```

Las 4 warnings esperadas en dev son:
- `database`: SQLite en vez de Postgres (esperado en dev).
- `pgvector`: no configurado (esperado en dev).
- `rls`: SQLite no soporta RLS (esperado en dev).
- `n8n`: contenedor no levantado (esperado en dev).

---

## Levantar el chat-service (Socket.io)

El dashboard de Mensajería usa Socket.io para mensajes en tiempo real. El cliente se conecta a `ws://localhost:3003` directamente, o a través del gateway Caddy en `ws://localhost:81/?XTransformPort=3003`.

```bash
cd mini-services/chat-service
bun install   # solo la primera vez (socket.io + bun-types)
bun run index.ts
# → Socket.io server escuchando en http://localhost:3003
# → bun --hot habilitado: reinicia al guardar cambios
```

### Eventos socket.io

| Evento | Dirección | Payload | Descripción |
|--------|-----------|---------|-------------|
| `message:sent` | cliente → server | `{ conversationId, body, tenantId }` | Mensaje outbound del agente |
| `message:new` | server → cliente | `{ conversationId, message: {...} }` | Mensaje nuevo (inbound o confirmación outbound) |
| `agent:typing` | server → cliente | `{ conversationId, agent }` | Indicador de "escribiendo..." del agente |
| `status:change` | server → cliente | `{ conversationId, status }` | Cambio de estado de conversación |

### Auto-reply simulado

Para demos: cuando el cliente envía un `message:sent`, el chat-service responde con un `message:new` automático tras 3-6s con un mensaje simulado del cliente. Esto permite probar el flujo completo sin un webhook real de Meta.

---

## Levantar el gateway Caddy

Opcional pero recomendado para probar el routing de producción localmente:

```bash
caddy run --config Caddyfile
# → Escucha en http://localhost:81
# → Rutea / a localhost:3000
# → Rutea ?XTransformPort=3003 a localhost:3003 (websocket upgrade)
```

Luego accede al dashboard vía `http://localhost:81` (en vez de `:3000`). Esto te da el mismo routing que en producción.

---

## Cargar datos demo

### Seed base — 4 marcas ZIAY + tenant INTL

```bash
bun run db:seed   # Smart script (scripts/db-seed.ts) — auto-detecta provider
# o equivalentemente: bun run prisma/seed.ts
```

Crea:
- **5 tenants**: `ten-demo`, `ten-saramantha`, `ten-majestic`, `ten-lovely`, `ten-reina`.
- **3 users**: admin, agent, trafficker (con roles).
- **4 channels**: WhatsApp CO, WhatsApp MX, Messenger Global, Instagram.
- **5 productos** Saramantha con imágenes reales.
- **Volume prices** por tramo (mayorista 6-11, 12-35, 36+).
- **SalesSpeech** por 4 perfiles.
- **5 objection types**.
- **2 themes** (Stitch, Hello Kitty).
- **CategoryCombo** 'familia'.
- **5 carriers** canónicos con 6 variantes de Interrapidísimo.
- **15 orders** simulando el embudo §15.1.
- **Invoice** del período.

### Seed 239 pedidos sintéticos calibrados al §15

```bash
bun run scripts/seed-239-pedidos.ts
```

Genera 239 pedidos sintéticos calibrados al embudo exacto del §15.1 (175/21/15/12/9/3/3/1), AOV $116k, GMV $27.8M. Útil para probar el Kanban con carga realista.

### Seed multi-touch (5 pedidos con 2-3 touchpoints)

```bash
bun run scripts/seed-multitouch.ts
```

Crea 5 pedidos de prueba con 2-3 `Attribution` por pedido. Útil para verificar que los 4 modelos de atribución (`last_click`, `first_click`, `linear`, `time_decay`) den resultados diferentes.

---

## Cargar 239 pedidos reales del CRM

Si tienes los 4 CSV exportados desde chateapro.app en `upload/`:

```bash
bun run scripts/load-real-orders.ts
```

Lee `users (28).csv`, `users (29).csv`, `users (30).csv`, `users (31).csv`, deduplica por phone+fecha, y carga 238 pedidos reales del CRM Saramantha con GMV $32,647,242 COP, AOV $137,173 COP, embudo 174/21/15/3, 8 ciudades con conteos reales, 6 variantes de Interrapidísimo.

---

## Scripts útiles

Todos los scripts viven en `scripts/` y se corren con `bun run scripts/<nombre>.ts`.

| Script | Qué hace |
|--------|----------|
| `prisma/seed.ts` | Seed base (4 marcas + catálogo + 15 pedidos demo) |
| `scripts/seed-239-pedidos.ts` | 239 pedidos sintéticos calibrados §15.1 |
| `scripts/seed-multitouch.ts` | 5 pedidos con 2-3 touchpoints (multi-touch) |
| `scripts/load-real-orders.ts` | Carga 238 pedidos reales desde CSV del CRM |
| `scripts/backfill-embeddings.ts` | Genera embeddings para todos los mensajes existentes |
| `scripts/fix-saramantha-messages.ts` | Repara mensajes con franja de metadata visible |
| `scripts/generate-n8n-workflows.ts` | Genera 11 workflows JSON para n8n (10 agentes + master) |

### Backfill embeddings

Después de cargar pedidos o mensajes, genera embeddings para memoria semántica:

```bash
bun run scripts/backfill-embeddings.ts
# → Genera embeddings TF-hash (1024 dims) para todos los Message sin embedding
```

### Fix Saramantha messages

Algunos mensajes seed necesitan la franja de metadata visible (Saramantha §4). Este script los repara:

```bash
bun run scripts/fix-saramantha-messages.ts
```

---

## Smoke tests

Después de levantar todo, corre estos smoke tests para verificar que el sistema está sano:

```bash
# 1. Health check general
curl http://localhost:3000/api/health | jq '.summary'
# Esperado: { "ok": 6, "warning": 4, "error": 0, "not_configured": 13 }

# 2. Uptime (lightweight, para Uptime Kuma)
curl http://localhost:3000/api/health/uptime
# Esperado: { "status": "ok", "dbLatencyMs": <4-10>, "timestamp": "..." }

# 3. Overview con tenant Saramantha
curl "http://localhost:3000/api/overview?days=30&tenantId=ten-saramantha" | jq '.kpis'

# 4. Conversations
curl "http://localhost:3000/api/conversations?tenantId=ten-saramantha" | jq '.conversations | length'

# 5. Orders
curl "http://localhost:3000/api/orders?tenantId=ten-saramantha&limit=5" | jq '.orders[0].number'

# 6. Ads con verdicts
curl "http://localhost:3000/api/ads?tenantId=ten-saramantha" | jq '.ads[0].verdict'

# 7. Agents list
curl http://localhost:3000/api/agents | jq '.agents | length'
# Esperado: 10

# 8. Llamar a un agente
curl -X POST http://localhost:3000/api/agents/speech \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"ten-saramantha","perfil":"mayorista"}' | jq '.reply'

# 9. Monetización GMV
curl "http://localhost:3000/api/monetization/gmv?tenantId=ten-saramantha" | jq '.gmv'
# Esperado: ~32647242

# 10. Métricas
curl "http://localhost:3000/api/metrics?tenantId=ten-saramantha" | jq '.margen.netMarginPct'
# Esperado: ~60

# 11. Health específico de tenant
curl "http://localhost:3000/api/health?tenantId=ten-saramantha" | jq '.summary'

# 12. Shipping quote real
curl -X POST http://localhost:3000/api/shipping/quote \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"ten-saramantha","ciudad":"Bogotá","pais":"CO","cantidad_unidades":1}'
# Esperado: { "tarifa": 9500, "tiempoEstimadoDias": 1, "transportadora": "Coordinadora" }

# 13. Catalog sync
curl -X POST http://localhost:3000/api/catalog/sync \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"ten-saramantha"}'
# Esperado: { "synced": 7, "adapter": "WhatsappCatalogAdapter" }

# 14. Attribution multi-touch
curl "http://localhost:3000/api/attribution?tenantId=ten-saramantha&model=time_decay" | jq '.ads[0].creditedRevenue'

# 15. Conciliación anti-fuga
curl "http://localhost:3000/api/conciliation?tenantId=ten-saramantha" | jq '.riskLevel'
```

Si todos devuelven 200 con datos coherentes, el sistema está sano.

---

## Lint y type check

### ESLint

```bash
bun run lint
# → Debe dar 0 errores. Warnings aceptables pero se prefieren resolver.
#    En v0.4.0 hay 38 warnings (pre-existentes en scripts/tests/legacy adapters).
```

Configuración en `eslint.config.mjs` (ESLint 9 flat config + `eslint-config-next`).

### TypeScript

```bash
npx tsc --noEmit
# → 0 errores esperados en src/, scripts/, prisma/
#    En v0.4.0: 0 errores (fue 58 antes de la remedación del audit cycle).
#    `next.config.ts` tiene `typescript.ignoreBuildErrors: false` (gate real).
```

### Tests (v0.4.0)

```bash
bun run test        # 986 unit tests (51 archivos) — fue 964 antes del audit cycle
bun run test:e2e    # 52 tests Playwright (7 spec files)
```

### CI Pipeline

El repo tiene CI configurado en `.github/workflows/ci.yml` con **6 jobs** que se
corren en cada push / PR a `main`:

1. **lint** — `bun run lint` (0 errores)
2. **typecheck** — `npx tsc --noEmit` (0 errores)
3. **unit-tests** — `bun run test` (986 tests)
4. **openapi** — `bun run openapi:validate` (valida `docs/openapi.yaml`)
5. **build** — `bun run build` (Next.js production build con provider PostgreSQL)
6. **e2e** — `bun run test:e2e` (52 tests Playwright)

Todos los 6 jobs deben estar **green** antes de mergear un PR. Pre-flight local:

```bash
bun run lint && npx tsc --noEmit && bun run test && bun run test:e2e
```

### Si rompes algo

```bash
# Auto-fix de ESLint
bunx eslint . --fix

# Ver solo errores (no warnings) en src/
bunx eslint src/ --quiet
```

---

## Cómo añadir un nuevo agente conversacional

Sigue el patrón de los **26 agentes** en `src/lib/agents/prompts.ts`. Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#cómo-añadir-un-nuevo-agente-conversacional) para el ejemplo paso a paso.

Resumen:

1. Añade el nombre al tipo `AgentName` (union de strings).
2. Implementa `buildXxxPrompt(ctx)` que retorna `{ system, user }`.
3. Añádelo al router `buildAgentPrompt`.
4. Añádelo a `AGENT_NAMES` y `AGENT_LABELS`.
5. Si tiene side-effects, añádelos en `src/app/api/agents/[agentName]/route.ts`.
6. Si entra en el orquestador, actualiza `src/lib/orchestrator/constants.ts ORCHESTRATOR_STEPS`.
7. Actualiza `docs/AGENTS-REFERENCE.md` y `docs/API-REFERENCE.md`.

📖 Ver [`AGENTS-REFERENCE.md`](./AGENTS-REFERENCE.md) para el spec completo de cada agente.

---

## Cómo añadir un nuevo adaptador

Sigue el patrón en `src/lib/adapters/`. Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#cómo-añadir-un-nuevo-adaptador) y [`ADAPTERS.md`](./ADAPTERS.md) para el ejemplo completo.

Resumen para un `EcommerceAdapter`:

1. Crea `src/lib/adapters/mi-ecommerce.ts` implementando la interfaz `EcommerceAdapter` (5 métodos).
2. Añádelo al registry `src/lib/adapters/registry.ts` en el switch sobre `Tenant.plataformaCatalogo`.
3. Añade las variables de entorno a `.env.example` y `docs/ENVIRONMENT.md`.
4. Documenta en `docs/ADAPTERS.md`.
5. Si el adapter tiene HTTP real, asegúrate de hacer fallback a stub cuando no haya creds.

---

## Cómo añadir un nuevo módulo al dashboard

1. Crea `src/components/dashboard/mi-modulo-view.tsx` (cliente component).
2. Añade el módulo al sidebar (`src/components/dashboard/sidebar.tsx`) con icono Lucide.
3. Añade el caso al switch en `src/app/page.tsx` que renderiza la vista activa.
4. Si el módulo tiene APIs, créalas en `src/app/api/mi-modulo/`.
5. Documenta en `README.md` (sección "Módulos del dashboard") y `docs/API-REFERENCE.md`.

### Convenciones UI

- **Tema emerald**: NUNCA uses indigo o blue (decisión de diseño del doc Saramantha).
- **shadcn/ui**: usa los componentes en `src/components/ui/` (60+ disponibles).
- **Dark mode**: todos los componentes deben soportar `dark:` via `next-themes`.
- **Sticky footer**: el footer del dashboard es sticky y siempre visible.
- **Responsive**: mobile-first; el sidebar colapsa a drawer en mobile.

---

## Troubleshooting

### "db.X is undefined" para un modelo Prisma nuevo

**Causa**: el proceso `next dev` tiene un `globalThis.prisma` cacheado de un schema anterior.

**Fix**:
```bash
# Encuentra el proceso
ps aux | grep "next dev" | grep -v grep

# Mátalo
kill <PID>

# Reinicia
nohup bun run dev &
```

El nuevo proceso instancia un `PrismaClient` fresco con el schema actualizado.

### Socket.io no conecta

**Síntoma**: el dashboard muestra "Desconectado" en el panel de mensajería.

**Pasos**:
1. Verifica que el chat-service esté corriendo: `curl http://localhost:3003` debe responder.
2. Verifica la URL del socket en `src/lib/socket.ts` — debe ser `http://localhost:3003` en dev o `http://localhost:81/?XTransformPort=3003` a través de Caddy.
3. Abre DevTools → Network → WS — debe haber una conexión `ws://localhost:3003/socket.io/` con status 101.
4. Si hay CORS errors, verifica que el chat-service tenga `cors: { origin: '*' }` en `mini-services/chat-service/index.ts` (en dev).

### Webhook Meta no verifica (403 forbidden)

**Síntoma**: Meta devuelve "Couldn't validate URL. Callback verification failed with the following errors: ..." al suscribir el webhook.

**Causa**: el `WA_VERIFY_TOKEN` o `META_VERIFY_TOKEN` no coincide con el que configuraste en el dashboard de Meta.

**Fix**:
1. Verifica en `.env`:
   ```bash
   WA_VERIFY_TOKEN=tu_token_aqui
   META_VERIFY_TOKEN=tu_token_aqui
   ```
2. En el dashboard de Meta (developers.facebook.com → tu app → WhatsApp → Configuration), pon EXACTAMENTE el mismo token en "Verify Token".
3. Reinicia el dev server.
4. Prueba manualmente:
   ```bash
   curl "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tu_token_aqui&hub.challenge=test123"
   # Esperado: test123 con status 200
   ```

### El agente IA tarda demasiado o falla

**Síntoma**: `POST /api/agents/[agentName]` tarda >20s y devuelve un fallback.

**Causa**: el LLM provider del tenant no responde.

**Pasos**:
1. Verifica el proveedor IA del tenant:
   ```bash
   curl http://localhost:3000/api/tenants | jq '.tenants[] | {slug, proveedorIa: .proveedorIa // "zai"}'
   ```
2. Si es `zai` (default), no necesita creds — el SDK `z-ai-web-dev-sdk` está siempre disponible.
3. Si es `chatgpt`/`xai`/`ollama`, verifica las variables de entorno en `.env` (`OPENAI_API_KEY`, `XAI_API_KEY`, `OLLAMA_BASE_URL`).
4. Verifica el health:
   ```bash
   curl "http://localhost:3000/api/health?tenantId=ten-xxxx" | jq '.checks[] | select(.name | startswith("llm"))'
   ```

### Kanban pierde cards al arrastrar

**Síntoma**: al hacer drag & drop, una card desaparece.

**Causa**: el PATCH al backend falla y el card no se reposiciona en el estado local.

**Pasos**:
1. Abre DevTools → Network → busca el PATCH fallido.
2. Verifica el status code (404 = orderId no existe, 422 = status inválido).
3. Si es 422, verifica que el status sea uno de los 8 valores válidos (`llamar_para_confirmar`, `intento_cancelacion`, `datos_completados`, `oficina`, `programado`, `despachado`, `novedad`, `devuelto`).

### Embeddings no funcionan (score siempre 0)

**Síntoma**: `/api/conversations/search?q=familia` devuelve score 0 para todos los mensajes.

**Causa**: los mensajes no tienen embedding generado.

**Fix**:
```bash
bun run scripts/backfill-embeddings.ts
```

Verifica que se generaron:
```bash
curl "http://localhost:3000/api/conversations/search?q=familia&tenantId=ten-saramantha"
# Esperado: algún resultado con score > 0
```

### Dropi/99envios/Aveonline devuelve tarifa 0

**Síntoma**: `/api/shipping/quote` devuelve tarifa 0.

**Causa**: el adapter está en modo stub y no encontró la ciudad en la tabla hardcodeada.

**Fix**: configura la API key real del proveedor en `.env`:
```bash
DROPI_API_KEY=tu_api_key_real
```

Reinicia el dev server y vuelve a probar.

---

## Próximos pasos

- 📖 Lee [`docs/DATA-MODEL.md`](./DATA-MODEL.md) para entender el schema (78 modelos Prisma).
- 📖 Lee [`docs/AGENTS-REFERENCE.md`](./AGENTS-REFERENCE.md) para entender los 26 agentes.
- 📖 Lee [`docs/ADAPTERS.md`](./ADAPTERS.md) para entender la capa de adaptadores.
- 📖 Lee [`docs/PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md) antes de desplegar.
- 📖 Lee [`upload/onboarding-end-to-end.md`](../upload/onboarding-end-to-end.md) para el onboarding completo de 2.006 líneas.

¡Feliz hacking! 🚀
