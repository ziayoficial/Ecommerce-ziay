# Guía de Deploy a Producción — CommerceFlow OS

> **Objetivo:** Levantar CommerceFlow OS en producción con tres opciones — Docker Compose (recomendado), VPS manual, o Vercel + Railway/Render — cerrando los 27+ secrets de entorno, webhooks HMAC, RLS en Postgres, pgvector, y todos los adapters reales.
>
> **Audiencia:** DevOps engineers, SRE, sysadmins con experiencia en Linux, Docker y reverse proxies.
> **Tiempo estimado:** 30-45 min (Docker) · 60-90 min (VPS manual) · 20 min (Vercel+Railway, solo frontend).
> **Prerrequisito:** VPS con 8 GB RAM, 4 vCPU, 50 GB SSD, Ubuntu 22.04+ o Debian 12+.

---

## Tabla de contenidos

1. [Pre-requisitos](#1-pre-requisitos)
2. [Opción A — Docker Compose (recomendado)](#2-opción-a--docker-compose-recomendado)
3. [Opción B — VPS manual](#3-opción-b--vps-manual)
4. [Opción C — Vercel + Railway/Render](#4-opción-c--vercel--railwayrender)
5. [Variables de entorno](#5-variables-de-entorno)
6. [Configuración de webhooks](#6-configuración-de-webhooks)
7. [Post-deploy verification checklist](#7-post-deploy-verification-checklist)
8. [Troubleshooting](#8-troubleshooting)
9. [Backup y recuperación](#9-backup-y-recuperación)
10. [Monitoring](#10-monitoring)
11. [Scaling strategy](#11-scaling-strategy)
12. [Security hardening](#12-security-hardening)

---

## 1. Pre-requisitos

### 1.1 Hardware mínimo

| Recurso | Mínimo | Recomendado | Notas |
|---------|--------|-------------|-------|
| **CPU** | 4 vCPU | 8 vCPU | n8n + NocoDB + Postgres son CPU-hungry. |
| **RAM** | 8 GB | 16 GB | Ollama con `llama3.1:8b` necesita 6 GB solo. |
| **Disco** | 50 GB SSD | 100 GB NVMe | Postgres + MinIO + logs crecen ~1 GB/semana por tenant activo. |
| **Red** | 100 Mbps | 1 Gbps | Webhooks + imágenes catálogo. |
| **SO** | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS | Kernel 5.15+ para cgroup v2. |

### 1.2 Software requerido (todas las opciones)

| Software | Versión | Cómo instalar |
|----------|---------|---------------|
| **Docker Engine** | 24+ | `curl -fsSL https://get.docker.com \| sh` |
| **Docker Compose v2** | 2.20+ | Incluido con Docker Engine moderno. |
| **Bun** | 1.3+ | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | 20 LTS | Para Vercel/Build: `nvm install 20` |
| **PostgreSQL** | 16+ | Docker o apt. |
| **Redis** | 7+ | Docker o apt. |
| **Caddy** | 2.7+ | Docker o apt. |

### 1.3 DNS y dominio

1. Compra o usa un dominio (ej: `commerceflow.tudominio.com`).
2. Crea un registro A apuntando al IP del VPS.
3. Espera propagación DNS (5-30 min): `dig commerceflow.tudominio.com +short`.

### 1.4 Cuentas externas necesarias

- **Meta Business Suite** — para WhatsApp Cloud API + Messenger + Instagram.
- **Google Cloud Console** — para Google Ads developer token.
- **TikTok For Business** — para TikTok Events API.
- **Pasarela de pago** (al menos una): MercadoPago, Wompi, Stripe, PayU.

---

## 2. Opción A — Docker Compose (recomendado)

Esta opción levanta los **11 servicios** del `docker-compose.yml` en un solo comando.

### 2.1 Los 11 servicios

| # | Servicio | Imagen | Puerto | Rol |
|---|----------|--------|--------|-----|
| 1 | `postgres` | `postgres:16-alpine` | 5432 | DB relacional + pgvector (vía extensión). |
| 2 | `redis` | `redis:7-alpine` | 6379 | Cache + Socket.io adapter para multi-nodo. |
| 3 | `minio` | `minio/minio:latest` | 9000/9001 | Object storage S3-compatible (evidencias, imágenes). |
| 4 | `nocodb` | `nocodb/nocodb:latest` | 1684 | Admin low-code (vista Kanban operativa). |
| 5 | `n8n` | `n8nio/n8n:latest` | 5678 | Workflow automation (11 flujos importables). |
| 6 | `ollama` | `ollama/ollama:latest` | 11434 | LLM local opcional (`proveedorIa=ollama`). |
| 7 | `uptime-kuma` | `louislam/uptime-kuma:1` | 3001 | Monitoreo de uptime + alertas. |
| 8 | `app` | build local (Dockerfile) | 3000 | Next.js dashboard (44 APIs + 14 vistas). |
| 9 | `chat-service` | build local | 3003 | Socket.io mini-service. |
| 10 | `caddy` | build local (Dockerfile.caddy) | 80/443 | Reverse proxy + auto-HTTPS. |
| 11 | (integrado en app) | — | — | Prisma ORM corre dentro del contenedor `app`. |

### 2.2 Pasos

#### Paso A.1 — Clonar y configurar

```bash
ssh root@tu-vps-ip
cd /opt
git clone <tu-repo-git> commerceflow
cd commerceflow
cp .env.example .env
```

#### Paso A.2 — Generar secrets fuertes

```bash
# Genera 4 secrets aleatorios de 64 hex chars
openssl rand -hex 32  # para NEXTAUTH_SECRET
openssl rand -hex 32  # para N8N_ENCRYPTION_KEY
openssl rand -hex 24  # para POSTGRES_PASSWORD
openssl rand -hex 32  # para WA_APP_SECRET
openssl rand -hex 32  # para META_APP_SECRET

# Genera tokens de verificación aleatorios (cualquier string opaco)
openssl rand -hex 16  # para WA_VERIFY_TOKEN
openssl rand -hex 16  # para META_VERIFY_TOKEN
```

#### Paso A.3 — Editar `.env`

Edita con `nano .env` (ver §5 para la tabla completa). Como mínimo obligatorio:

```env
# Dominio
NEXT_PUBLIC_BASE_URL=https://commerceflow.tudominio.com
DATABASE_URL=postgresql://commerceflow:TU_PASSWORD@postgres:5432/commerceflow

# Secrets (¡nunca subas estos a git!)
NEXTAUTH_SECRET=<salida de openssl rand -hex 32>
POSTGRES_PASSWORD=<password fuerte>
WA_APP_SECRET=<salida de openssl rand -hex 32>
META_APP_SECRET=<salida de openssl rand -hex 32>

# Webhook verify tokens
WA_VERIFY_TOKEN=<string opaco random>
META_VERIFY_TOKEN=<string opaco random>

# Real-time
CHAT_CORS_ORIGIN=https://commerceflow.tudominio.com
CHAT_STRICT_AUTH=true

# n8n
N8N_HOST=commerceflow.tudominio.com
N8N_PROTOCOL=https
N8N_WEBHOOK_URL=https://commerceflow.tudominio.com/n8n/
N8N_PASSWORD=<password fuerte>

# NocoDB
NOCODB_PUBLIC_URL=https://commerceflow.tudominio.com/nocodb/
```

#### Paso A.4 — Construir y levantar

```bash
docker compose up -d --build
```

La primera vez tarda 10-15 min (pull de imágenes + build de `app` y `chat-service`).

#### Paso A.5 — Monitorear arranque

```bash
docker compose logs -f --tail=50
```

Cuando veas `✓ Ready` del servicio `app`, presiona `Ctrl+C` (los logs siguen corriendo en background).

#### Paso A.6 — Verificar servicios

```bash
docker compose ps
```

Debes ver 10 servicios con estado `Up` (uptime-kuma es opcional, levántalo con `--profile monitoring`).

#### Paso A.7 — Migrar DB a Postgres + activar pgvector + RLS

```bash
# Aplicar migración Prisma
docker compose exec app bunx prisma migrate deploy

# Activar extensión pgvector
docker compose exec postgres psql -U commerceflow -d commerceflow -c \
  "CREATE EXTENSION IF NOT EXISTS vector;"

# Aplicar políticas RLS (aislamiento multi-tenant a nivel DB)
docker compose exec postgres psql -U commerceflow -d commerceflow -f \
  /docker-entrypoint-initdb.d/99-rls.sql

# Aplicar setup de pgvector (índices HNSW + funciones semánticas)
docker compose exec postgres psql -U commerceflow -d commerceflow -f \
  prisma/sql/pgvector-setup.sql
```

#### Paso A.8 — Cargar datos seed

```bash
# Seed inicial: 5 tenants + catálogo Saramantha
docker compose exec app bun run prisma/seed.ts

# (Opcional) Cargar pedidos reales desde tu CRM
docker compose exec app bun run scripts/load-real-orders.ts

# (Opcional) Backfill de embeddings para todos los mensajes
docker compose exec app bun run scripts/backfill-embeddings.ts
```

#### Paso A.9 — Importar workflows n8n

1. Abre `https://commerceflow.tudominio.com/n8n/` en tu navegador.
2. Completa el setup inicial (crear cuenta owner con `N8N_USER` / `N8N_PASSWORD`).
3. Ve a **Workflows → Import from File**.
4. Importa los 11 archivos de `n8n-workflows/`:
   - `agent-profile.json`, `agent-speech.json`, `agent-quote.json`, `agent-catalog.json`
   - `agent-theme.json`, `agent-objection.json`, `agent-address.json`
   - `agent-logistics.json`, `agent-vision.json`, `agent-checkout.json`
   - `master-orchestrator.json`
5. Activa cada workflow con el toggle (top-right).

#### Paso A.10 — Configurar NocoDB

1. Abre `https://commerceflow.tudominio.com/nocodb/`.
2. Completa el setup (crear admin).
3. NocoDB detecta automáticamente la DB Postgres.
4. Crea una vista Kanban sobre la tabla `Order` agrupada por `status`.
5. Añade a `.env`:
   ```env
   NOCODB_WEBHOOK_URL=https://commerceflow.tudominio.com/nocodb/api/v1/db/data/noco/commerceflow/orders
   ```
6. `docker compose restart app` para que tome la variable.

#### Paso A.11 — Health checks post-deploy

```bash
# Health general (23 checks)
curl -s https://commerceflow.tudominio.com/api/health | jq '.summary'
# Debe retornar: { "ok": 23, "warning": 0, "error": 0, "not_configured": 0 }

# Verificar 26 agentes
curl -s https://commerceflow.tudominio.com/api/agents | jq '.agents | length'
# Debe retornar: 26

# Verificar datos cargados
curl -s "https://commerceflow.tudominio.com/api/monetization/gmv?tenantId=ten-saramantha" | jq

# Verificar HTTPS
curl -I https://commerceflow.tudominio.com/
# Debe mostrar: HTTP/2 200
```

---

## 3. Opción B — VPS manual

Para entornos donde no puedes usar Docker (VPS restringido, requisitos de compliance, preferencia de systemd).

### 3.1 Instalar Node 20 + Bun

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Verificar
node --version   # v20.x
bun --version    # 1.3+
```

### 3.2 Instalar PostgreSQL 16 + Redis + Caddy

```bash
# Postgres 16
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt update && sudo apt install -y postgresql-16 postgresql-16-pgvector

# Redis
sudo apt install -y redis-server

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 3.3 Configurar Postgres

```bash
sudo -u postgres psql <<'SQL'
CREATE USER commerceflow WITH PASSWORD 'TU_PASSWORD_FUERTE';
CREATE DATABASE commerceflow OWNER commerceflow;
\c commerceflow
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

### 3.4 Clonar repo + instalar deps

```bash
sudo mkdir -p /opt/commerceflow
sudo chown $USER:$USER /opt/commerceflow
cd /opt/commerceflow
git clone <tu-repo> .
bun install
```

### 3.5 Configurar `.env`

Crea `/opt/commerceflow/.env` con todos los valores de §5. Como mínimo:

```env
DATABASE_URL=postgresql://commerceflow:TU_PASSWORD@localhost:5432/commerceflow
NEXT_PUBLIC_BASE_URL=https://commerceflow.tudominio.com
NODE_ENV=production
NEXTAUTH_SECRET=<openssl rand -hex 32>
NEXTAUTH_URL=https://commerceflow.tudominio.com
# ... ver §5 para las 27+ variables
```

### 3.6 Inicializar DB

```bash
cd /opt/commerceflow
bun run db:generate
bunx prisma migrate deploy
bun run prisma/seed.ts

# Aplicar RLS + pgvector setup
sudo -u postgres psql -d commerceflow -f prisma/sql/99-rls.sql
sudo -u postgres psql -d commerceflow -f prisma/sql/pgvector-setup.sql
```

### 3.7 Build standalone

```bash
bun run build
# Output: .next/standalone/server.js + .next/static/ + public/
```

### 3.8 PM2 para Next.js

```bash
sudo npm install -g pm2

cat > /opt/commerceflow/ecosystem.app.json <<'JSON'
{
  "apps": [
    {
      "name": "commerceflow-app",
      "script": ".next/standalone/server.js",
      "cwd": "/opt/commerceflow",
      "env": {
        "NODE_ENV": "production",
        "PORT": "3000",
        "HOSTNAME": "127.0.0.1"
      },
      "instances": 2,
      "exec_mode": "cluster",
      "max_memory_restart": "1G",
      "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
      "error_file": "/var/log/commerceflow/app.err.log",
      "out_file": "/var/log/commerceflow/app.out.log"
    }
  ]
}
JSON

sudo mkdir -p /var/log/commerceflow
sudo chown $USER:$USER /var/log/commerceflow

pm2 start ecosystem.app.json
pm2 save
pm2 startup systemd -u $USER --hp /home/$USER
```

### 3.9 PM2 para chat-service

```bash
cd /opt/commerceflow/mini-services/chat-service
bun install

cat > /opt/commerceflow/ecosystem.chat.json <<'JSON'
{
  "apps": [
    {
      "name": "commerceflow-chat",
      "script": "index.ts",
      "cwd": "/opt/commerceflow/mini-services/chat-service",
      "env": {
        "NODE_ENV": "production",
        "PORT": "3003",
        "CHAT_CORS_ORIGIN": "https://commerceflow.tudominio.com",
        "CHAT_STRICT_AUTH": "true"
      },
      "instances": 1,
      "exec_mode": "fork",
      "max_memory_restart": "500M",
      "error_file": "/var/log/commerceflow/chat.err.log",
      "out_file": "/var/log/commerceflow/chat.out.log"
    }
  ]
}
JSON

pm2 start ecosystem.chat.json
pm2 save
```

### 3.10 Caddy reverse proxy con HTTPS automático

Edita `/etc/caddy/Caddyfile`:

```caddyfile
commerceflow.tudominio.com {
    encode gzip zstd

    # Socket.io — DEBE ir antes de /chat para que el upgrade funcione
    location /socket.io/ {
        reverse_proxy 127.0.0.1:3003 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
        }
    }

    # Next.js app (dashboard + APIs + SSR)
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Logs
    log {
        output file /var/log/caddy/commerceflow.log {
            roll_size 100MB
            roll_keep 7
        }
    }

    # Headers de seguridad
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }
}
```

Recarga Caddy:

```bash
sudo systemctl reload caddy
```

Verifica HTTPS:

```bash
curl -I https://commerceflow.tudominio.com/
# HTTP/2 200
```

---

## 4. Opción C — Vercel + Railway/Render

Para equipos que prefieren managed services. **Importante**: Socket.io no funciona en serverless (Vercel Functions no mantienen WebSocket). Por eso separamos frontend (Vercel) de backend de tiempo real (Railway/Render).

### 4.1 Diagrama

```
┌─────────────────────────────────────────────────────────────┐
│  Vercel (frontend + API routes serverless)                  │
│  • Next.js build con `next build`                            │
│  • Dashboard + SSR pages + 44 API routes (sin WebSocket)    │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Railway (chat-service)                                      │
│  • Socket.io mini-service                                    │
│  • WebSocket persistente                                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Neon / Supabase / Railway Postgres (DB + pgvector)         │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Pasos

1. **Forkea el repo** a tu cuenta de GitHub.
2. **Vercel**: importa el repo. Set environment variables (ver §5). Build command: `bun run build`. Output directory: `.next`.
3. **Railway**: crea un servicio desde `mini-services/chat-service/`. Set `CHAT_CORS_ORIGIN` al dominio Vercel (`https://commerceflow.vercel.app`).
4. **Neon/Supabase**: crea DB Postgres 16 con pgvector activado. Copia el `DATABASE_URL`.
5. **Redis**: Upstash (serverless Redis) — pega el `REDIS_URL` en Railway chat-service.
6. **Variables en Vercel**: set `NEXT_PUBLIC_SOCKET_URL=https://commerceflow-chat.up.railway.app`.
7. Deploy en Vercel.

### 4.3 Limitaciones

- **No n8n propio** en Vercel. Usa n8n Cloud o self-host n8n en Railway.
- **No NocoDB propio**. Usa Airtable o alternativa.
- **No Ollama**. Cambia `proveedorIa` a `zai` o `openai` para todos los tenants.
- **No MinIO**. Usa S3 directo (AWS) o Cloudflare R2.
- **Cold starts** en serverless: primer request de cada función tarda 1-3s. Para webhooks Meta con SLA estricto, considera moverlos a Railway.
- **Costo**: Vercel Pro $20/mes + Railway $5/mes + Neon free tier → ~$30/mes para MVP, escala rápido con tráfico.

### 4.4 Cuándo NO usar esta opción

- Tienes >10 tenants activos (los costos de bandwidth de Vercel escalan mal).
- Necesitas n8n + NocoDB + Ollama en el mismo stack.
- Tienes compliance que prohíbe data en US (Vercel/Neon tienen regiones EU pero limitadas).
- Necesitas latencia <100ms para Socket.io en LATAM (Vercel edge no soporta WS).

---

## 5. Variables de entorno

### 5.1 Tabla completa (27+ variables)

| Variable | Descripción | Requerido | Default | Ejemplo |
|----------|-------------|-----------|---------|---------|
| `DATABASE_URL` | URL de conexión Prisma. SQLite en dev, Postgres en prod. | ✅ Sí | `file:./db/custom.db` | `postgresql://user:pass@host:5432/db` |
| `NEXT_PUBLIC_BASE_URL` | URL pública del deployment. | ✅ Sí | `https://commerceflow.app` | `https://commerceflow.tudominio.com` |
| `NEXT_PUBLIC_APP_URL` | URL interna (para dev). | No | `http://localhost:3000` | — |
| `NEXTAUTH_URL` | URL canónica para NextAuth. | ✅ Sí (prod) | — | `https://commerceflow.tudominio.com` |
| `NEXTAUTH_SECRET` | Secret JWT para sesiones. | ✅ Sí (prod) | — | `openssl rand -hex 32` |
| `POSTGRES_USER` | Usuario de Postgres. | Docker | `commerceflow` | — |
| `POSTGRES_PASSWORD` | Password de Postgres. | ✅ Sí (prod) | `change_me_in_production` | `<password fuerte>` |
| `POSTGRES_DB` | Nombre de la DB. | Docker | `commerceflow` | — |
| `WA_VERIFY_TOKEN` | Token opaco para verify GET de webhook WhatsApp. | ✅ Sí | `change_me_in_production` | `<string random>` |
| `WA_APP_SECRET` | App Secret de Meta para HMAC POST webhook. | ✅ Sí (prod) | `change_me_in_production` | `<openssl rand -hex 32>` |
| `META_VERIFY_TOKEN` | Token verify para webhook Messenger/IG. | ✅ Sí | `change_me_in_production` | — |
| `META_APP_SECRET` | App Secret Meta para HMAC Messenger/IG. | ✅ Sí (prod) | `change_me_in_production` | — |
| `CHAT_CORS_ORIGIN` | Origins permitidas para Socket.io (CSV). | ✅ Sí (prod) | `http://localhost:3000` | `https://commerceflow.tudominio.com` |
| `CHAT_STRICT_AUTH` | Rechazar sockets sin `auth.tenantId`. | No | `false` | `true` en prod |
| `OPENAI_API_KEY` | Para tenants con `proveedorIa=openai`. | No | — | `sk-...` |
| `XAI_API_KEY` | Para tenants con `proveedorIa=xai`. | No | — | — |
| `OLLAMA_BASE_URL` | Para tenants con `proveedorIa=ollama`. | No | `http://localhost:11434` | — |
| `WOOCOMMERCE_CONSUMER_KEY` | Adapter WooCommerce. | No | — | `ck_...` |
| `WOOCOMMERCE_CONSUMER_SECRET` | Adapter WooCommerce. | No | — | `cs_...` |
| `SHOPIFY_ACCESS_TOKEN` | Adapter Shopify. | No | — | `shpat_...` |
| `SHOPIFY_SHOP_DOMAIN` | Adapter Shopify. | No | — | `mi-tienda.myshopify.com` |
| `SUPABASE_URL` | Adapter Supabase catálogo. | No | — | `https://xxx.supabase.co` |
| `SUPABASE_API_KEY` | Adapter Supabase. | No | — | — |
| `DROPI_API_KEY` | Adapter Dropi (catálogo + logística CO). | No | — | — |
| `ENVIOS99_API_KEY` | Adapter 99envíos. | No | — | — |
| `AVEONLINE_API_KEY` | Adapter Aveonline. | No | — | — |
| `MERCADOPAGO_ACCESS_TOKEN` | Gateway MP. | No | — | `APP_USR-...` |
| `MERCADOPAGO_WEBHOOK_SECRET` | HMAC webhook MP. | No | — | — |
| `WOMPI_PUBLIC_KEY` | Gateway Wompi. | No | — | `pub_...` |
| `WOMPI_PRIVATE_KEY` | Gateway Wompi. | No | — | `prv_...` |
| `WOMPI_EVENT_SECRET` | HMAC webhook Wompi. | No | — | — |
| `STRIPE_SECRET_KEY` | Gateway Stripe. | No | — | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | HMAC webhook Stripe. | No | — | `whsec_...` |
| `PAYU_API_KEY` | Gateway PayU. | No | — | — |
| `PAYU_MERCHANT_ID` | Gateway PayU. | No | — | — |
| `PAYU_API_LOGIN` | Gateway PayU. | No | — | — |
| `PAYU_TEST_MODE` | Sandbox PayU. | No | `true` | `false` en prod |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Token developer Google Ads (dev-scoped). | No | — | — |
| `GOOGLE_ADS_ACCESS_TOKEN` | OAuth token por tenant. | No | — | — |
| `TIKTOK_ACCESS_TOKEN` | Token TikTok Events API. | No | — | — |
| `N8N_HOST` | Host público de n8n. | Docker | `localhost` | `commerceflow.tudominio.com` |
| `N8N_PROTOCOL` | Protocolo n8n. | Docker | `http` | `https` |
| `N8N_WEBHOOK_URL` | URL base webhooks n8n. | Docker | `http://localhost:5678/` | `https://commerceflow.tudominio.com/n8n/` |
| `N8N_USER` | Usuario admin n8n. | Docker | `admin` | — |
| `N8N_PASSWORD` | Password admin n8n. | ✅ Sí (prod) | `change_me_in_production` | `<password fuerte>` |
| `N8N_ENCRYPTION_KEY` | Llave de cifrado de credenciales n8n. | ✅ Sí (prod) | — | `openssl rand -hex 32` |
| `NOCODB_PUBLIC_URL` | URL pública NocoDB. | Docker | `http://localhost:1684` | `https://commerceflow.tudominio.com/nocodb/` |
| `NOCODB_WEBHOOK_URL` | Webhook saliente hacia NocoDB. | No | — | — |
| `MINIO_ROOT_USER` | Root user MinIO. | Docker | `commerceflow` | — |
| `MINIO_ROOT_PASSWORD` | Root password MinIO. | ✅ Sí (prod) | `change_me_in_production` | `<password fuerte>` |

### 5.2 Reglas de oro

1. **Nunca** dejes `change_me_in_production` en producción. El health check lo reporta como `error`.
2. **Nunca** subas `.env` a git. Verifica con `git status` antes de cada commit.
3. **Rota** `NEXTAUTH_SECRET`, `WA_APP_SECRET`, `META_APP_SECRET` cada 90 días (las sesiones se invalidan, los usuarios deben re-login).
4. **Diferentes** tokens para dev, staging y prod. Si usas el mismo `WA_VERIFY_TOKEN` en dev y prod, un ataque al dev te compromete prod.
5. **Variables `NEXT_PUBLIC_*`** son visibles en el bundle del navegador. Nunca pongas secrets ahí.

---

## 6. Configuración de webhooks

### 6.1 WhatsApp Cloud API

#### Obtener `WA_VERIFY_TOKEN` + `WA_APP_SECRET`

1. Ve a [Meta Business Suite](https://business.facebook.com) → Settings → WhatsApp Manager.
2. Crea una **WhatsApp Business Account** (WABA) verificada.
3. En **API Setup**, ve a **Configuration**.
4. **App Secret**: copia el valor desde **App Settings → Basic → App Secret**. Pégalo en `WA_APP_SECRET`.
5. **Verify Token**: inventa un string opaco aleatorio (ej: `openssl rand -hex 16`). Pégalo en `WA_VERIFY_TOKEN` en tu `.env` y en Meta.
6. **Callback URL**: `https://commerceflow.tudominio.com/api/webhooks/whatsapp`.
7. Suscríbete al campo `messages`.
8. Click **Verify and Save**. Meta hace un GET a tu endpoint con `hub.verify_token` — tu endpoint debe responder `200 hub.challenge`.

#### Verificación HMAC

Cada POST que Meta envía incluye header `X-Hub-Signature-256: sha256=<hex>`. Tu endpoint (`src/app/api/webhooks/whatsapp/route.ts`) computa `HMAC-SHA256(rawBody, WA_APP_SECRET)` y compara con `crypto.timingSafeEqual`. Si no coincide → 401.

### 6.2 Meta Messenger + Instagram

#### Obtener `META_VERIFY_TOKEN` + `META_APP_SECRET`

1. Ve a [Meta for Developers](https://developers.facebook.com) → tu App → **Dashboard**.
2. **App Secret**: Settings → Basic → App Secret. Pégalo en `META_APP_SECRET`.
3. **Verify Token**: inventa un string opaco (diferente al de WhatsApp). Pégalo en `META_VERIFY_TOKEN`.
4. **Webhooks**: producto Messenger → Settings → Callback URL: `https://commerceflow.tudominio.com/api/webhooks/meta`.
5. Suscríbete a: `messages`, `messaging_postbacks`, `messaging_deliveries`, `messaging_reads`, `leadgen`.
6. Para Instagram DM: producto Instagram → Settings → suscríbete a `messages`.

### 6.3 Payment webhooks

#### 6.3.1 MercadoPago

1. Ve a [MercadoPago Developers](https://www.mercadopago.com.co/developers/panel) → tu app → **Notificaciones / Webhooks**.
2. URL: `https://commerceflow.tudominio.com/api/webhooks/mercadopago`.
3. Eventos: `payment`, `merchant_order`.
4. **Secret**: genera un secret en la UI. Pégalo en `MERCADOPAGO_WEBHOOK_SECRET`.
5. Cada POST incluye header `x-signature: ts=<timestamp>,v1=<hex>`. Tu endpoint (`src/app/api/webhooks/mercadopago/route.ts`) valida con `adapter.webhookVerify(rawBody, x-signature)`.

#### 6.3.2 Wompi

1. Ve a [Wompi Dashboard](https://dashboard.wompi.co) → tu comercio → **Configuración → Eventos**.
2. URL: `https://commerceflow.tudominio.com/api/webhooks/wompi`.
3. Eventos: `transaction.updated`.
4. **Checksum secret**: en la misma sección, genera un secret. Pégalo en `WOMPI_EVENT_SECRET`.
5. Cada POST incluye header `X-Events-Signature: <hex>`. Tu endpoint valida con `WompiAdapter.webhookVerify(rawBody, signature, WOMPI_EVENT_SECRET)`.

#### 6.3.3 Stripe

1. Ve a [Stripe Dashboard](https://dashboard.stripe.com) → Developers → **Webhooks**.
2. Add endpoint: `https://commerceflow.tudominio.com/api/webhooks/stripe`.
3. Eventos: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`.
4. **Signing secret**: copia el `whsec_...`. Pégalo en `STRIPE_WEBHOOK_SECRET`.
5. Cada POST incluye header `stripe-signature: t=<ts>,v1=<hex>`. Tu endpoint valida con `StripeAdapter.webhookVerify(rawBody, signature, secret)` (usa `stripe.webhooks.constructEvent`).

#### 6.3.4 PayU

1. Ve a [PayU Dashboard](https:// merchants.payulatam.com) → tu comercio → **Configuración → Notificaciones**.
2. URL: `https://commerceflow.tudominio.com/api/webhooks/payu`.
3. PayU no firma HMAC; usa un hash MD5 sobre `state_pol` + `merchant_id` + `reference_sale` + `value` + `currency` + `API_KEY`. Configura `PAYU_API_KEY` en tu `.env`.
4. Cada POST envía body JSON o form-encoded con `state_pol` (1=PENDING, 4=APPROVED, 5=REFUNDED, 6=DECLINED, 7=ERROR).

### 6.4 Testing de webhooks

```bash
# Test local con ngrok
ngrok http 3000
# Copia la URL HTTPS y configúrala como callback URL temporal en Meta/MP/Stripe.

# Test del verify token (GET)
curl "https://commerceflow.tudominio.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=12345"
# Debe retornar: 12345

# Test HMAC inválido (POST)
curl -X POST https://commerceflow.tudominio.com/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=invalid" \
  -d '{}'
# Debe retornar: 401 Unauthorized
```

---

## 7. Post-deploy verification checklist

Marca cada ítem como ✅ cuando verifiques:

### Infraestructura
- [ ] **DNS resuelve al VPS**: `dig commerceflow.tudominio.com +short` retorna el IP correcto.
- [ ] **HTTPS funciona**: `curl -I https://commerceflow.tudominio.com/` retorna `HTTP/2 200`.
- [ ] **Certificado válido**: `echo \| openssl s_client -connect commerceflow.tudominio.com:443 2>/dev/null \| openssl x509 -noout -dates`.
- [ ] **Firewall**: ufw solo abre 22, 80, 443. Postgres (5432) y Redis (6379) NO expuestos.
- [ ] **Docker services Up**: `docker compose ps` muestra 10+ servicios `Up`.
- [ ] **Logs limpios**: `docker compose logs --tail=100 app` sin errores ni warnings.

### Base de datos
- [ ] **Migración aplicada**: `bunx prisma migrate status` dice `Database schema is up to date`.
- [ ] **pgvector activo**: `psql -c "SELECT extname FROM pg_extension;"` muestra `vector` y `pgcrypto`.
- [ ] **RLS activo**: `psql -c "SELECT tablename FROM pg_tables WHERE schemaname='public';"` → para cada tabla, `SELECT relrowsecurity FROM pg_class WHERE relname='<table>';` retorna `t`.
- [ ] **Seed cargado**: `psql -c "SELECT COUNT(*) FROM Tenant;"` retorna al menos 5.
- [ ] **62 modelos Prisma**: `bunx prisma db pull --print | grep "^model " | wc -l` retorna 62.

### Aplicación
- [ ] **Health 23/23**: `curl /api/health | jq '.summary'` → `{ "ok": 23, "warning": 0, "error": 0, "not_configured": 0 }`.
- [ ] **26 agentes**: `curl /api/agents | jq '.agents | length'` → `26`.
- [ ] **14 módulos**: carga el dashboard y verifica que el sidebar muestra 14 ítems.
- [ ] **5 SSR pages**: `curl /t/saramantha`, `curl /t/saramantha/p/<sku>`, `curl /sitemap.xml`, `curl /robots.txt` retornan 200.
- [ ] **Socket.io**: en el dashboard, abre mensajería. La consola del browser muestra `socket connected`.
- [ ] **Tema claro/oscuro**: toggle funciona y persiste en localStorage.

### Webhooks
- [ ] **WhatsApp verify**: Meta Business confirma webhook verificado.
- [ ] **Messenger verify**: Meta App confirma webhook verificado.
- [ ] **MercadoPago**: envía un pago test → llega POST a tu endpoint → 200 OK.
- [ ] **Wompi**: envía transacción test → 200 OK.
- [ ] **Stripe**: usa `stripe trigger checkout.session.completed` → 200 OK.
- [ ] **PayU**: ejecuta transacción de prueba → 200 OK.

### Seguridad
- [ ] **Webhook sin HMAC rechazado**: `curl -X POST /api/webhooks/whatsapp -H "X-Hub-Signature-256: sha256=invalid" -d '{}'` retorna 401.
- [ ] **Tenant guard**: `curl /api/orders` (sin `tenantId`) retorna 400.
- [ ] **Rate limit LLM**: ejecuta `for i in {1..15}; do curl -X POST /api/agents/speech ...; done` — al 11° request retorna 429.
- [ ] **Wallet sin header**: `curl /api/wallet` retorna 401.
- [ ] **Secrets no en git**: `git log --all -p \| grep -E "OPENAI_API_KEY\|STRIPE_SECRET_KEY"` solo encuentra placeholders.

### n8n + NocoDB
- [ ] **11 workflows importados** y activos en n8n.
- [ ] **NocoDB conectado** a la DB `commerceflow`.
- [ ] **Vista Kanban** de `Order` agrupada por `status` funcional.

### Backup
- [ ] **Backup diario en cron**: `crontab -l` muestra el `pg_dump` programado.
- [ ] **Backup MinIO** (si usas evidencias): script de sync a S3/R2 programado.
- [ ] **Restore test**: ejecuta `psql < backup.sql` en una DB test → funciona.

### Monitoring
- [ ] **Uptime Kuma** monitorea `/api/health/uptime` cada 60s.
- [ ] **Alertas configuradas** (email/Telegram/Slack) en Uptime Kuma.
- [ ] **Logrotate** configurado para `/var/log/commerceflow/*.log`.

---

## 8. Troubleshooting

### 8.1 El app no arranca

```bash
docker compose logs app --tail=100
```

**Error común**: `DATABASE_URL` mal configurada. Verifica:
```env
DATABASE_URL=postgresql://commerceflow:TU_PASSWORD@postgres:5432/commerceflow
```
El host debe ser `postgres` (nombre del servicio en Docker Compose), no `localhost`.

### 8.2 n8n no puede conectar al app

Los workflows usan `http://app:3000`. Si no resuelve:
```bash
docker compose exec n8n ping app
```
Si no funciona, edita los workflows para usar `http://host.docker.internal:3000`.

### 8.3 NocoDB no ve las tablas

NocoDB usa una DB separada (`nocodb`). Para ver las tablas de CommerceFlow:
1. NocoDB → Settings → Data Sources.
2. Añade la DB `commerceflow` como nueva conexión Postgres.

### 8.4 Webhooks Meta fallan verificación

```bash
grep VERIFY_TOKEN .env
```
El valor en `.env` debe coincidir **exactamente** con lo configurado en Meta Business. Sin espacios, sin comillas extra.

Si persiste, prueba el GET manualmente:
```bash
curl "https://commerceflow.tudominio.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_TOKEN&hub.challenge=test123"
# Debe retornar: test123
```

### 8.5 pgvector no funciona

```bash
docker compose exec postgres psql -U commerceflow -d commerceflow -c \
  "SELECT * FROM pg_extension WHERE extname='vector';"
```

Si está vacío:
```bash
docker compose exec postgres psql -U commerceflow -d commerceflow -c "CREATE EXTENSION vector;"
docker compose exec postgres psql -U commerceflow -d commerceflow -f prisma/sql/pgvector-setup.sql
```

### 8.6 Socket.io no conecta en producción

**Síntoma**: el dashboard carga pero los mensajes no llegan en tiempo real.

**Causa probable**: Caddy no hace upgrade del WebSocket. Verifica el `Caddyfile`:
```caddyfile
location /socket.io/ {
    reverse_proxy 127.0.0.1:3003
}
```
Debe estar **antes** del `reverse_proxy` general al app.

Verifica:
```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://commerceflow.tudominio.com/socket.io/?EIO=4&transport=websocket
# Debe retornar: 101 Switching Protocols
```

### 8.7 Prisma migrate falla con "drift detected"

```bash
bunx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > fix.sql
# Aplica fix.sql manualmente o resetea:
bunx prisma migrate reset --force
```

### 8.8 Build falla con "out of memory"

```bash
# Aumenta swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

Para build de Docker:
```bash
docker build --memory=4g -t commerceflow-app .
```

### 8.9 Wallet retorna 401 siempre

Verifica que el frontend envía el header:
```js
fetch('/api/wallet', {
  headers: { 'X-Trafficker-Id': traffickerId }
})
```
El header debe coincidir con el `traffickerId` del query/body. Si usas `X-Tenant-Id`, debe coincidir con el `tenantId` del scope.

### 8.10 Embeddings no se generan

```bash
docker compose exec app bun run scripts/backfill-embeddings.ts
```
Si falla con "vector extension not found", aplica el setup de pgvector (§8.5).

### 8.11 LLM responde siempre lo mismo

Verifica que `proveedorIa` del tenant no sea `zai` si no tienes el SDK configurado. Para cambiar:
```sql
UPDATE Tenant SET proveedorIa='openai' WHERE slug='saramantha';
```
Y asegúrate de que `OPENAI_API_KEY` esté en `.env`.

---

## 9. Backup y recuperación

### 9.1 DB Postgres

**Backup diario (cron)**:
```bash
# Añade a crontab (crontab -e)
0 3 * * * docker compose -f /opt/commerceflow/docker-compose.yml exec -T postgres \
  pg_dump -U commerceflow commerceflow | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz

# Mantén solo los últimos 30 días
0 4 * * * find /backups -name "db_*.sql.gz" -mtime +30 -delete
```

**Restore de prueba** (mensual):
```bash
docker compose exec postgres created -U commerceflow commerceflow_test
zcat /backups/db_20260115.sql.gz | docker compose exec -T postgres psql -U commerceflow commerceflow_test
# Verifica que las tablas tienen datos
docker compose exec postgres psql -U commerceflow -d commerceflow_test -c "SELECT COUNT(*) FROM Tenant;"
# Limpia
docker compose exec postgres dropdb -U commerceflow commerceflow_test
```

### 9.2 MinIO (evidencias, imágenes)

```bash
# Sync a S3/R2 (necesitas mc client)
mc alias set minio http://localhost:9000 commerceflow TU_PASSWORD
mc alias set backup s3://commerceflow-backup AWS_KEY AWS_SECRET

# Cron diario
0 5 * * * mc mirror minio backup/$(date +\%Y\%m\%d)/
```

### 9.3 n8n workflows

```bash
# Exportar todos los workflows
docker cp cf-n8n:/home/node/.n8n /backups/n8n_$(date +%Y%m%d)/

# Restore
docker cp /backups/n8n_20260115/ cf-n8n:/home/node/.n8n
docker compose restart n8n
```

### 9.4 Logs

```bash
# Rotación con logrotate
sudo tee /etc/logrotate.d/commerceflow > /dev/null <<'EOF'
/var/log/commerceflow/*.log /var/log/caddy/commerceflow.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    missingok
    copytruncate
}
EOF
```

### 9.5 Redis (cache)

Redis es **efímero** — no necesitas backup. Si pierdes Redis, los usuarios se reconectan automáticamente y la cache se regenera.

---

## 10. Monitoring

### 10.1 Uptime Kuma

1. Levanta el servicio: `docker compose --profile monitoring up -d uptime-kuma`.
2. Abre `https://commerceflow.tudominio.com:3001` (o configura proxy en Caddy).
3. Crea cuenta admin.
4. Añade monitors:
   - **HTTP(s)**: `https://commerceflow.tudominio.com/api/health/uptime` cada 60s.
   - **HTTP(s)**: `https://commerceflow.tudominio.com/api/agents` cada 5 min.
   - **TCP Port**: `commerceflow.tudominio.com:443` cada 60s.
   - **TCP Port**: `commerceflow.tudominio.com:5432` (Postgres) cada 60s — solo si Postgres es público (no debería).
5. Configura notificaciones: email, Telegram, Slack, Discord.

### 10.2 Logs centralizados

Para producción seria, considera:

- **Loki + Grafana** (self-hosted) — log aggregation.
- **Datadog** (managed) — log + metrics + traces.
- **Sentry** — error tracking para frontend + backend.

Configura `pino` o `winston` en el app para logs estructurados JSON.

### 10.3 Métricas de aplicación

El endpoint `/api/health` ya retorna un snapshot. Para métricas continuas:

```bash
# Prometheus scrape config (ejemplo)
scrape_configs:
  - job_name: 'commerceflow'
    metrics_path: /api/health
    static_configs:
      - targets: ['commerceflow.tudominio.com']
```

### 10.4 Alertas críticas

Configura alertas para:
- `/api/health` retorna `status: error` → **P1 inmediato**.
- Postgres CPU > 80% por 5 min → **P1**.
- Redis memory > 90% → **P2**.
- Disk usage > 85% → **P2**.
- Webhooks Meta fallando (401/500) → **P1**.
- Socket.io connections < 1 por 10 min (si hay agentes activos) → **P2**.

---

## 11. Scaling strategy

### 11.1 Vertical (más recursos en un nodo)

| Recurso | Cuándo escalar | Cómo |
|---------|----------------|------|
| RAM | Postgres usa > 70% de `shared_buffers` | Sube VPS a 16 GB → 32 GB. |
| CPU | CPU > 70% sostenido | Sube a 8 vCPU → 16 vCPU. |
| Disco | Disco > 80% | Aumenta volumen o migra a NVMe. |

### 11.2 Horizontal (múltiples nodos)

**Requisito previo**: Redis adapter para Socket.io (ya configurado en `mini-services/chat-service/index.ts`).

```yaml
# docker-compose.scale.yml
services:
  app:
    deploy:
      replicas: 3
    # Quita el puerto publicado, usa un load balancer
  chat-service:
    deploy:
      replicas: 2
```

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d
```

**Load balancer**: HAProxy o Caddy con `reverse_proxy app:3000 app:3000 app:3000`.

**Postgres**: migra a managed (Neon, Supabase, RDS) con read replicas para dashboards analíticos.

### 11.3 Caching

- **Redis** ya está configurado para Socket.io adapter.
- Añade cache HTTP en Caddy para assets estáticos:
  ```caddyfile
  @static path /_next/static/* /favicon.ico /logo.svg
  handle @static {
      header Cache-Control "public, max-age=31536000, immutable"
      reverse_proxy 127.0.0.1:3000
  }
  ```
- Para APIs de lectura lenta (`/api/overview`, `/api/ads`), considera cache en Redis con TTL de 60s.

### 11.4 CDN

- **Cloudflare** (free tier) para DNS + CDN + WAF.
- **Cloudflare R2** para almacenar imágenes de catálogo (compatible S3, sin egress fees).
- Configura `NEXT_PUBLIC_BASE_URL` al dominio Cloudflare.

### 11.5 Read replicas en Postgres

Para dashboards analíticos pesados:
```sql
-- En la replica
ALTER SYSTEM SET hot_standby = on;
```
Y en Prisma, crea un cliente de solo lectura:
```ts
const prismaRead = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_READ_URL } } })
```

---

## 12. Security hardening

### 12.1 Firewall (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp           # SSH (considera cambiar puerto)
sudo ufw allow 80/tcp           # HTTP (redirect a HTTPS)
sudo ufw allow 443/tcp          # HTTPS
sudo ufw enable
```

**Bloquear acceso directo** a Postgres (5432), Redis (6379), MinIO (9000), n8n (5678), NocoDB (1684) — solo accesibles vía Caddy o desde dentro del network Docker.

### 12.2 SSH hardening

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
Port 2222  # opcional, cambia el default

sudo systemctl restart sshd
```

### 12.3 SSL/TLS

Caddy maneja HTTPS automáticamente con Let's Encrypt. Para verificar:
```bash
echo | openssl s_client -connect commerceflow.tudominio.com:443 -servername commerceflow.tudominio.com 2>/dev/null | openssl x509 -noout -text | grep -A2 "Validity"
```

Considera **HSTS preload**: añade tu dominio a https://hstspreload.org después de confirmar que todos los subdominios usan HTTPS.

### 12.4 Secrets rotation

| Secret | Frecuencia | Procedimiento |
|--------|-----------|---------------|
| `NEXTAUTH_SECRET` | 90 días | Cambia valor → reinicia app → todos los JWT se invalidan. |
| `WA_APP_SECRET` / `META_APP_SECRET` | 90 días | Regenera en Meta Business → actualiza `.env` → reinicia. |
| `WA_VERIFY_TOKEN` / `META_VERIFY_TOKEN` | 90 días | Regenera → actualiza en Meta Business **y** en `.env` simultáneamente. |
| `POSTGRES_PASSWORD` | 180 días | `ALTER USER commerceflow WITH PASSWORD 'nueva';` → actualiza `.env` → reinicia. |
| `STRIPE_SECRET_KEY` | Si hay sospecha de leak | Roll en Stripe Dashboard → actualiza `.env`. |
| API keys de adapters | 180 días | Regenera en cada plataforma. |

### 12.5 RLS en Postgres (Row-Level Security)

**Activación** (ya cubierta en Paso A.7):
```sql
-- Para cada tabla multi-tenant
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Order"
  USING ("tenantId" = current_setting('app.current_tenant', true));
```

**Aplicación**: cada transacción Prisma establece el tenant:
```ts
// src/lib/rls.ts
await prisma.$executeRaw`SET app.current_tenant = ${tenantId}`;
```

### 12.6 Audit log

Toda acción sensible escribe en `AuditLog`:
- Kill-switch de anuncios (con `userId`, `adId`, `reason`).
- Retiros de wallet (con `traffickerId`, `amount`, `totpValid`).
- Webhooks entrantes (con `platform`, `signatureValid`, `rawBody.slice(0, 1000)`).
- Escalación de novedades (con `caseId`, `escalatedTo`).
- Cambios de configuración de tenant.

Revisa audit logs semanalmente:
```sql
SELECT "action", COUNT(*), MAX("createdAt") as last
FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '7 days'
GROUP BY "action"
ORDER BY COUNT(*) DESC;
```

### 12.7 Rate limiting avanzado

El rate limiter in-memory (`src/lib/middleware/rate-limit.ts`) funciona para un solo nodo. Para multi-nodo:

1. **Redis-based rate limiter**: usa `ioredis` + script Lua atómico.
2. **Cloudflare WAF**: rate limit a nivel edge antes de que llegue al app.
3. **Caddy rate limit plugin**: `caddy-l4` o middleware HTTP.

### 12.8 DDoS protection

- **Cloudflare** (free tier) — proxy cache + rate limit + bot fight mode.
- **AWS Shield Advanced** (managed) si tienes budget.
- Configura `Always Online` y `Under Attack Mode` en Cloudflare.

### 12.9 Backups cifrados

```bash
# Cifra backups con GPG
gpg --symmetric --cipher-algo AES256 backup.sql.gz
# Resultado: backup.sql.gz.gpg

# Sube a storage offsite
gpg --decrypt backup.sql.gz.gpg | gzip -d | psql
```

### 12.10 Penetration testing

Antes de go-live en producción seria:
1. Contrata un pentest externo (OWASP Top 10 + ASVS Level 2).
2. Ejecuta `nuclei` con templates de webhooks + APIs.
3. Escanea con `OWASP ZAP` el dashboard.
4. Verifica que `AUDIT-REPORT.md` está actualizado y todos los findings cerrados.

---

## Soporte

| Recurso | Ubicación |
|---------|-----------|
| Auditoría completa | `AUDIT-REPORT.md` (1202 líneas) |
| Onboarding | `upload/ONBOARDING-COMPLETO.md` (~700 líneas) |
| README del proyecto | `README.md` (689 líneas) |
| Bitácora | `worklog.md` (2209 líneas) |
| Health endpoint | `https://tu-dominio/api/health` |
| Issues | GitHub Issues del repo |
| Security disclosures | `security@indisutex.com` (privado) |

---

**Última actualización:** sincronizada con `worklog.md` tras el sprint `AUTOFIX-A + REPORT-001`.
**Versión del documento:** 2.0 — reemplaza la versión anterior (que cubría solo Docker Compose con 9 servicios).
