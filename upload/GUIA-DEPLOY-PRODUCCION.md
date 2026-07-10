# Guía de Deploy a Producción — CommerceFlow OS

> **Objetivo:** Levantar CommerceFlow OS en tu VPS con Docker, cerrando los últimos 2 ítems pendientes (n8n + NocoDB corriendo físicamente) y activando Postgres+pgvector, RLS, y todos los adapters reales.
>
> **Tiempo estimado:** 30-45 minutos (la mayoría es espera de descarga de imágenes Docker).
> **Prerrequisito:** VPS con 8GB+ RAM, Ubuntu 22.04+ o Debian 12+, acceso root/sudo.

---

## PRE-REQUISITOS (5 min)

### 1. Instalar Docker + Docker Compose en el VPS

```bash
# SSH a tu VPS
ssh root@tu-vps-ip

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Verificar
docker --version
docker compose version
```

### 2. Clonar el repo

```bash
cd /opt
git clone <tu-repo-git> commerceflow
cd commerceflow
```

> Si no tienes el repo en git, sube los archivos vía `scp -r ./* root@tu-vps:/opt/commerceflow/`

### 3. Configurar DNS

Apunta tu dominio (ej: `commerceflow.tudominio.com`) al IP del VPS en tu proveedor de DNS.

---

## PASO 1 — Configurar .env (5 min)

```bash
cp .env.example .env
nano .env
```

Edita estos valores obligatorios:

```env
# Dominio
DOMAIN=commerceflow.tudominio.com
NEXTAUTH_URL=https://commerceflow.tudominio.com
WEBHOOK_URL=https://commerceflow.tudominio.com/n8n

# Database (genera contraseñas fuertes)
POSTGRES_PASSWORD=cambia_esta_clave_por_una_muy_fuerte

# Secrets (genera con: openssl rand -hex 32)
NEXTAUTH_SECRET=(ejecuta: openssl rand -hex 32)
N8N_ENCRYPTION_KEY=(ejecuta: openssl rand -hex 32)

# Webhook verify tokens (deben coincidir con Meta Business)
WA_VERIFY_TOKEN=tu_token_verificacion_wa
META_VERIFY_TOKEN=tu_token_verificacion_meta
```

Credenciales opcionales (según qué tenants uses):

```env
# Si un tenant usa ChatGPT
OPENAI_API_KEY=sk-...

# Si un tenant usa Dropi real
DROPI_API_KEY=...

# Si un tenant usa WooCommerce real
WOOCOMMERCE_CONSUMER_KEY=ck_...
WOOCOMMERCE_CONSUMER_SECRET=cs_...
WOOCOMMERCE_STORE_URL=https://tienda.com

# Si un tenant usa Shopify real
SHOPIFY_ACCESS_TOKEN=shpat_...
SHOPIFY_SHOP=mi-tienda.myshopify.com
```

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## PASO 2 — Levantar el stack con Docker (10-15 min)

```bash
# Construir y levantar todos los servicios
docker compose up -d --build
```

Esto levanta 9 servicios:
- `postgres` (PostgreSQL 16 + pgvector)
- `n8n` (orquestador de agentes)
- `minio` (almacenamiento de imágenes)
- `nocodb` (tablero Kanban operativo)
- `app` (Next.js CommerceFlow)
- `chat-service` (Socket.io)
- `redis` (cache + socket adapter)
- `caddy` (gateway + SSL automático)
- `uptime-kuma` (monitoreo) — opcional con profile

Monitorea el arranque:

```bash
docker compose logs -f --tail=50
```

Cuando veas `✓ Ready` del app, presiona `Ctrl+C`.

Verifica que todos están corriendo:

```bash
docker compose ps
```

Debes ver 8 servicios con estado `Up` (uptime-kuma es opcional).

---

## PASO 3 — Migrar DB a Postgres + activar RLS + pgvector (3 min)

```bash
# Ejecutar migración de Prisma
docker compose exec app bun run db:migrate

# Activar pgvector
docker compose exec postgres psql -U commerceflow -d commerceflow -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Aplicar políticas RLS (aislamiento multi-tenant a nivel DB)
docker compose exec postgres psql -U commerceflow -d commerceflow -f /docker-entrypoint-initdb.d/99-rls.sql

# Aplicar setup de pgvector (índices HNSW + funciones de búsqueda semántica)
docker compose exec postgres psql -U commerceflow -d commerceflow -f prisma/sql/pgvector-setup.sql
```

Verifica:

```bash
docker compose exec postgres psql -U commerceflow -d commerceflow -c "SELECT extname FROM pg_extension;"
# Debe mostrar: vector, pgcrypto
```

---

## PASO 4 — Cargar datos (239 pedidos reales + seed) (2 min)

```bash
# Seed inicial (5 tenants + catálogo Saramantha)
docker compose exec app bun run prisma/seed.ts

# Cargar los 239 pedidos reales del CRM
docker compose exec app bun run scripts/load-real-orders.ts

# Re-crear conversaciones + mensajes con embeddings
docker compose exec app bun run scripts/fix-saramantha-messages.ts

# Backfill embeddings para todos los mensajes
docker compose exec app bun run scripts/backfill-embeddings.ts
```

---

## PASO 5 — Importar los 11 workflows n8n (5 min)

1. Abre n8n en tu navegador: `https://commerceflow.tudominio.com/n8n/`
2. Completa el setup inicial (crear cuenta owner)
3. Ve a **Workflows** → **Import from File**
4. Importa los 11 archivos de `n8n-workflows/`:
   - `agent-profile.json`
   - `agent-speech.json`
   - `agent-quote.json`
   - `agent-catalog.json`
   - `agent-theme.json`
   - `agent-objection.json`
   - `agent-address.json`
   - `agent-logistics.json`
   - `agent-vision.json`
   - `agent-checkout.json`
   - `master-orchestrator.json`
5. Activa cada workflow con el toggle (top-right)

---

## PASO 6 — Configurar NocoDB (3 min)

1. Abre NocoDB: `https://commerceflow.tudominio.com/nocodb/`
2. Completa el setup inicial (crear cuenta admin)
3. NocoDB detecta automáticamente la base Postgres
4. Crea una vista Kanban sobre la tabla `Order` agrupada por `status`
5. Configura el webhook saliente en CommerceFlow:

```bash
# En .env, añade:
NOCODB_WEBHOOK_URL=https://commerceflow.tudominio.com/nocodb/api/v1/db/data/noco/commerceflow/orders
NOCODB_WEBHOOK_SECRET=tu_secret_nocodb
```

```bash
# Reiniciar app para que tome las variables
docker compose restart app
```

---

## PASO 7 — Configurar webhooks de Meta (5 min)

### WhatsApp Cloud API

1. Ve a [Meta Business](https://business.facebook.com) → WhatsApp → API Setup
2. En "Webhook", configura:
   - **Callback URL:** `https://commerceflow.tudominio.com/api/webhooks/whatsapp`
   - **Verify Token:** el valor de `WA_VERIFY_TOKEN` en tu `.env`
3. Suscríbete al evento `messages`
4. Verifica que Meta confirma el webhook (debe devolver 200)

### Meta Ads (Messenger + Instagram)

1. En Meta Business → Configuración → Webhooks
2. **Callback URL:** `https://commerceflow.tudominio.com/api/webhooks/meta`
3. **Verify Token:** el valor de `META_VERIFY_TOKEN`
4. Suscríbete a `messages`, `messaging_postbacks`, `leadgen`

---

## PASO 8 — Configurar Uptime Kuma (opcional, 2 min)

```bash
# Levantar Uptime Kuma (profile monitoring)
docker compose --profile monitoring up -d uptime-kuma
```

1. Abre `https://commerceflow.tudominio.com:3001` (o configura proxy en Caddy)
2. Crea cuenta admin
3. Añade monitor:
   - **Type:** HTTP(s)
   - **URL:** `https://commerceflow.tudominio.com/api/health/uptime`
   - **Interval:** 60 seconds
   - **Accepted Status Codes:** 200
4. Añade notificaciones (email, Telegram, Slack)

---

## PASO 9 — Verificación final (2 min)

### Health check completo

```bash
curl https://commerceflow.tudominio.com/api/health?tenantId=ten-saramantha | python3 -m json.tool
```

Debes ver:
```json
{
  "status": "ok",
  "summary": {
    "ok": 23,
    "warning": 0,
    "error": 0,
    "not_configured": 0
  }
}
```

Si tienes `not_configured > 0`, revisa qué falta:

```bash
curl -s https://commerceflow.tudominio.com/api/health | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d['checks']:
    if c['status'] != 'ok':
        print(f\"{c['status']}: {c['name']} — {c['detail']}\")
"
```

### Verificar datos cargados

```bash
# 239 pedidos reales
curl -s "https://commerceflow.tudominio.com/api/monetization/gmv?tenantId=ten-saramantha" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Orders: {d[\"ordenes\"]} | GMV: \${d[\"gmv\"]:,} | AOV: \${d[\"gmv\"]//d[\"ordenes\"]:,}')
"

# 10 agentes funcionando
curl -s -X POST https://commerceflow.tudominio.com/api/agents/speech \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","perfil":"mayorista"}'
```

### Verificar n8n

Abre `https://commerceflow.tudominio.com/n8n/` → debes ver los 11 workflows importados y activos.

### Verificar NocoDB

Abre `https://commerceflow.tudominio.com/nocodb/` → debes ver la vista Kanban con los pedidos.

---

## PASO 10 — SSL automático (automático)

Caddy genera certificados SSL automáticamente con Let's Encrypt. Verifica:

```bash
curl -I https://commerceflow.tudominio.com/
# Debe mostrar: HTTP/2 200
```

Si SSL no funciona, verifica que el DNS apunta al VPS y que el puerto 443 está abierto:

```bash
# Abrir puertos en el firewall
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3001/tcp  # Uptime Kuma (opcional)
```

---

## POST-DEPLOY — Operación diaria

### Monitoreo

```bash
# Ver logs del app
docker compose logs -f app --tail=50

# Ver logs de n8n
docker compose logs -f n8n --tail=50

# Ver uso de recursos
docker stats
```

### Backup diario (añadir a cron)

```bash
# Backup de Postgres
docker compose exec postgres pg_dump -U commerceflow commerceflow > backup_$(date +%Y%m%d).sql

# Backup de n8n workflows
docker cp cf-n8n:/home/node/.n8n n8n_backup_$(date +%Y%m%d)/
```

Añade a crontab:
```bash
crontab -e
# Añadir:
0 3 * * * cd /opt/commerceflow && docker compose exec -T postgres pg_dump -U commerceflow commerceflow > /backups/db_$(date +\%Y\%m\%d).sql
```

### Actualizar el código

```bash
cd /opt/commerceflow
git pull
docker compose up -d --build
docker compose exec app bun run db:migrate
```

---

## TROUBLESHOOTING

### El app no arranca

```bash
docker compose logs app --tail=100
```

Error común: `DATABASE_URL` mal configurada. Verifica que en `.env`:
```env
DATABASE_URL=postgresql://commerceflow:TU_PASSWORD@postgres:5432/commerceflow
```

### n8n no puede conectar al app

Los workflows usan `http://app:3000`. Si no resuelve:
```bash
docker compose exec n8n ping app
```
Si no funciona, edita los workflows para usar `http://host.docker.internal:3000`.

### NocoDB no ve las tablas

NocoDB usa una base separada (`nocodb`). Para ver las tablas de CommerceFlow:
1. En NocoDB → Settings → Data Sources
2. Añade la base `commerceflow` como nueva conexión Postgres

### Webhooks de Meta fallan verificación

Verifica que el verify token coincide:
```bash
grep VERIFY_TOKEN .env
```
Debe coincidir con lo configurado en Meta Business.

### pgvector no funciona

```bash
docker compose exec postgres psql -U commerceflow -d commerceflow -c "SELECT * FROM pg_extension WHERE extname='vector';"
```
Si está vacío:
```bash
docker compose exec postgres psql -U commerceflow -d commerceflow -c "CREATE EXTENSION vector;"
docker compose exec postgres psql -U commerceflow -d commerceflow -f prisma/sql/pgvector-setup.sql
```

---

## CHECKLIST FINAL

- [ ] Docker instalado
- [ ] .env configurado con contraseñas fuertes
- [ ] `docker compose up -d --build` exitoso
- [ ] 8 servicios corriendo (`docker compose ps`)
- [ ] Prisma migrate ejecutado
- [ ] pgvector + RLS aplicados
- [ ] 239 pedidos reales cargados
- [ ] Embeddings backfilled
- [ ] 11 workflows n8n importados y activos
- [ ] NocoDB configurado con vista Kanban
- [ ] Webhooks Meta configurados y verificados
- [ ] Uptime Kuma monitoreando `/api/health/uptime`
- [ ] SSL funcionando (https://)
- [ ] `/api/health` muestra 23 ok, 0 error
- [ ] Backup diario configurado en cron

**¡Listo! CommerceFlow OS está en producción al 100% del documento Saramantha.**

---

## SOPORTE

- **Health endpoint:** `https://tu-dominio/api/health`
- **Auditoría completa:** `upload/RE-AUDITORIA-honesta.md`
- **Arquitectura:** `upload/MAESTRO-arquitectura.md`
- **Onboarding:** `upload/onboarding-end-to-end.md`
- **Worklog:** `worklog.md` (bitácora de los 23 sprints)
