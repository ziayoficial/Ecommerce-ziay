# Despliegue de ZIAY — Paso a Paso

> **SPRINT-FIXES-N8N-DEPLOY-001** — guía de despliegue producción paso a paso.
> Cubre el stack completo: Next.js app + PostgreSQL + Redis + MinIO + n8n + NocoDB + Caddy + Prometheus/Grafana/Loki + Alertmanager.
>
> Stack: 16 servicios en Docker Compose. Tiempo estimado: 60-90 min en un servidor limpio.

---

## Pre-requisitos

### Servidor

| Recurso | Mínimo | Recomendado |
|---|---|---|
| **RAM** | 4 GB | 8 GB (Ollama + n8n + Postgres simultáneos) |
| **CPU** | 2 vCPU | 4 vCPU (LLM inference + build) |
| **Disco** | 40 GB SSD | 100 GB SSD (imágenes + DB + backups) |
| **SO** | Ubuntu 22.04 LTS / Debian 12 / Rocky 9 | Ubuntu 24.04 LTS |
| **Swap** | 2 GB | 4 GB (OOM safety para builds) |

### Software

- **Docker 24+** (`docker --version`)
- **Docker Compose v2+** (`docker compose version`)
- **git** (`git --version`)
- **curl + jq** (`sudo apt install curl jq`)

### Dominio + DNS

- Un dominio o subdominio apuntando al servidor (registro A → IP pública del servidor).
- Puertos **80 (HTTP)** y **443 (HTTPS)** abiertos en el firewall del cloud provider + del SO.
- (Opcional) Un subdominio adicional por cada servicio si quieres exponerlos por separado (n8n.tudominio.com, nocodb.tudominio.com, etc.). En esta guía asumimos un solo dominio con paths.

### Credenciales externas (recoger antes de empezar)

| Servicio | Variable | Cómo obtenerla |
|---|---|---|
| WhatsApp Cloud API | `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_TOKEN`, `WA_VERIFY_TOKEN` | Meta Business → WhatsApp → API Setup |
| OpenAI | `OPENAI_API_KEY` | platform.openai.com → API Keys |
| xAI | `XAI_API_KEY` | console.x.ai → API Keys |
| ZAI | `ZAI_API_KEY` | Consola ZAI |
| Sentry | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | sentry.io → Settings → API Keys |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Developers → API Keys |
| MercadoPago | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | mercadopago.com.co → Tu negocio → Configuración → Credenciales |
| Wompi | `WOMPI_PRIVATE_KEY`, `WOMPI_PUBLIC_KEY`, `WOMPI_EVENT_SECRET` | wompi.co → Panel → Credenciales |

> Si no tienes alguna de estas credenciales, la app arranca igual en modo stub (los gateways devuelven `success=false, status='stub'` y la UI degrada graciosamente). Solo necesitas las credenciales para los servicios que vayas a usar en producción.

---

## Paso 1 — Preparar el servidor

### 1.1 Conectarse por SSH

```bash
ssh root@TU_IP_PUBLICA
# o
ssh ubuntu@TU_IP_PUBLICA
```

### 1.2 Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git jq ufw fail2ban ca-certificates gnupg
```

### 1.3 Configurar firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 80/tcp        # HTTP (Caddy lo usa para el challenge de Let's Encrypt)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw enable
sudo ufw status verbose
```

**Output esperado:**
```
Status: active
To                         Action      From
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
22/tcp (v6)                ALLOW       Anywhere (v6)
80/tcp (v6)                ALLOW       Anywhere (v6)
443/tcp (v6)               ALLOW       Anywhere (v6)
```

### 1.4 Configurar swap (recomendado en VPS < 8GB RAM)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
free -h
```

**Output esperado:**
```
              total        used        free      shared  buff/cache   available
Mem:          7.7Gi       1.2Gi       4.5Gi       0.0Ki       2.0Gi       6.2Gi
Swap:         4.0Gi          0B       4.0Gi
```

### 1.5 Instalar Docker

```bash
# Repositorio oficial de Docker (NO uses el .deb del SO — está desactualizado)
curl -fsSL https://get.docker.com | sudo sh

# Agregar tu usuario al grupo docker (evita el sudo en cada comando)
sudo usermod -aG docker $USER
newgrp docker

# Verificar
docker --version
docker compose version
```

**Output esperado:**
```
Docker version 24.0.x, build xxxxxxx
Docker Compose version v2.x.x
```

### Troubleshooting

- **`Cannot connect to the Docker daemon`**: `sudo systemctl start docker && sudo systemctl enable docker`.
- **`permission denied while trying to connect to the Docker daemon`**: cierra sesión y vuelve a entrar (para que el grupo docker se aplique), o corre `newgrp docker`.

---

## Paso 2 — Clonar el repositorio

### 2.1 Clonar

```bash
cd /opt
sudo git clone https://github.com/ziay/ziay.git
sudo chown -R $USER:$USER ziay
cd ziay
```

### 2.2 Verificar que el branch es `main` y está actualizado

```bash
git branch --show-current    # debe decir 'main' (o 'master' si tu repo usa master)
git log -1 --oneline
```

### 2.3 Listar los archivos clave

```bash
ls -la docker-compose.yml Caddyfile Caddyfile.prod Dockerfile Dockerfile.caddy prisma/schema.prisma
```

**Output esperado (todos presentes):**
```
-rw-r--r-- 1 user user  8.2K  docker-compose.yml
-rw-r--r-- 1 user user  1.5K  Caddyfile
-rw-r--r-- 1 user user  1.7K  Caddyfile.prod
-rw-r--r-- 1 user user  1.2K  Dockerfile
-rw-r--r-- 1 user user  0.5K  Dockerfile.caddy
-rw-r--r-- 1 user user  45K   prisma/schema.prisma
```

---

## Paso 3 — Configurar variables de entorno

### 3.1 Crear `.env` desde el template

```bash
cp docs/ENVIRONMENT.md .env.reference   # solo referencia — lee para saber qué setear
touch .env
chmod 600 .env   # solo el owner puede leer (tiene secretos)
```

### 3.2 Generar secretos aleatorios

```bash
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -base64 24)"
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)"
echo "ALERTMANAGER_WEBHOOK_SECRET=$(openssl rand -hex 24)"
```

> Copia cada línea de output a tu `.env`. **NO** uses los valores de ejemplo de esta guía — son ejemplos.

### 3.3 Editar `.env`

```bash
nano .env
```

Contenido mínimo para producción (reemplaza los `<...>` con tus valores reales):

```bash
# ── Dominio y URL ───────────────────────────────────────────────────────────
DOMAIN=ziay.tudominio.com
NEXTAUTH_URL=https://ziay.tudominio.com
NEXT_PUBLIC_BASE_URL=https://ziay.tudominio.com
NEXT_PUBLIC_APP_URL=https://ziay.tudominio.com
APP_DOMAIN=ziay.tudominio.com

# ── Base de datos ───────────────────────────────────────────────────────────
# Postgres en el contenedor Docker — la app se conecta vía red interna.
DATABASE_URL=postgresql://ziay:TU_POSTGRES_PASSWORD@postgres:5432/ziay?schema=public
POSTGRES_USER=ziay
POSTGRES_PASSWORD=TU_POSTGRES_PASSWORD
POSTGRES_DB=ziay

# ── Secretos de aplicación ──────────────────────────────────────────────────
NEXTAUTH_SECRET=TU_NEXTAUTH_SECRET

# ── Webhook verify tokens (Meta + gateways) ─────────────────────────────────
WA_VERIFY_TOKEN=TU_VERIFY_TOKEN_ALEATORIO
WA_BUSINESS_TOKEN=TU_WA_BUSINESS_TOKEN
WA_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID

# ── LLM providers (uno o más) ───────────────────────────────────────────────
ZAI_API_KEY=TU_ZAI_API_KEY
OPENAI_API_KEY=TU_OPENAI_API_KEY
XAI_API_KEY=TU_XAI_API_KEY

# ── Payment gateways (los que uses) ─────────────────────────────────────────
MP_ACCESS_TOKEN=TU_MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET=TU_MP_WEBHOOK_SECRET
STRIPE_SECRET_KEY=TU_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=TU_STRIPE_WEBHOOK_SECRET
WOMPI_PRIVATE_KEY=TU_WOMPI_PRIVATE_KEY
WOMPI_PUBLIC_KEY=TU_WOMPI_PUBLIC_KEY
WOMPI_EVENT_SECRET=TU_WOMPI_EVENT_SECRET

# ── Sentry (opcional pero recomendado) ──────────────────────────────────────
SENTRY_DSN=TU_SENTRY_DSN
SENTRY_AUTH_TOKEN=TU_SENTRY_AUTH_TOKEN
SENTRY_ORG=tu-org
SENTRY_PROJECT=ziay

# ── MinIO ───────────────────────────────────────────────────────────────────
MINIO_ROOT_USER=ziay
MINIO_ROOT_PASSWORD=TU_MINIO_ROOT_PASSWORD

# ── Grafana ─────────────────────────────────────────────────────────────────
GRAFANA_ADMIN_PASSWORD=TU_GRAFANA_ADMIN_PASSWORD

# ── Alertmanager ────────────────────────────────────────────────────────────
ALERTMANAGER_WEBHOOK_SECRET=TU_ALERTMANAGER_WEBHOOK_SECRET
SMTP_PASSWORD=TU_SMTP_PASSWORD
PAGERDUTY_ROUTING_KEY=
SLACK_FINANCE_WEBHOOK=
SLACK_SUPPORT_WEBHOOK=
SLACK_BUSINESS_WEBHOOK=

# ── Local payments (LATAM) ──────────────────────────────────────────────────
PSE_MERCHANT_ID=
PSE_API_KEY=
PIX_API_KEY=
SPEI_BANK_CLABE=

# ── Operational alerts (v0.4.3) ─────────────────────────────────────────────
# Slack/Discord incoming webhook URL for operational alerts (circuit breaker
# open, Governor veto, pipeline failure, refund retry exhausted). When empty,
# alerts still go to log + Sentry + socket.io dashboard. Optional but
# recommended for 24/7 coverage.
ALERT_WEBHOOK_URL=

# ── Meta Business Agent strategy (v0.4.3) ───────────────────────────────────
# How Meta channel (WhatsApp/Messenger/Instagram) messages are routed:
#   own_stack    → ZIAY agents handle everything (full control + tracing)
#   hybrid       → high-confidence intents to ZIAY agents, general chat to
#                  Meta's native Business Agent (cost optimization)
#   meta_native  → Meta handles everything (cheapest, least control)
# Default: own_stack
META_AGENT_STRATEGY=own_stack

# ── Chat service ────────────────────────────────────────────────────────────
CHAT_CORS_ORIGIN=https://ziay.tudominio.com
```

### 3.4 Validar que el `.env` parsea

```bash
# Bash no valida, pero al menos verifica que no haya líneas rotas:
bash -c 'set -a; source .env; set +a; echo "OK: $DOMAIN / $POSTGRES_USER"'
```

**Output esperado:**
```
OK: ziay.tudominio.com / ziay
```

### Troubleshooting

- **`unbound variable`**: hay una línea con `=` pero sin valor. Es válido solo si la variable es opcional; si no, agrégale un valor.
- **`NEXTAUTH_SECRET must be set in production`** en el build: el `.env` no se carga en el contexto del build. Asegúrate de que `NEXTAUTH_SECRET` tenga un valor real (no vacío).

---

## Paso 4 — Configurar Caddy (HTTPS)

### 4.1 Seleccionar el Caddyfile de producción

```bash
# El repo trae dos Caddyfiles:
#   Caddyfile        — dev, sin HTTPS, dominio 'localhost'
#   Caddyfile.prod   — prod, HTTPS automático vía Let's Encrypt, dominio vía $DOMAIN

# En producción, sobreescribimos el Caddyfile con la versión prod:
cp Caddyfile Caddyfile.dev.bak
cp Caddyfile.prod Caddyfile
```

### 4.2 Verificar que `Caddyfile` referencia a `$DOMAIN`

```bash
head -10 Caddyfile
```

**Output esperado:**
```
# ZIAY — Caddyfile for production
# Routes: / → app (3000), /?XTransformPort=3003 → chat-service (3003)
# n8n on /n8n/, NocoDB on /nocodb/, MinIO console on /minio/

{
    email admin@{$DOMAIN}
}

# Main domain — ZIAY app + chat-service gateway
{$DOMAIN} {
```

> Caddy lee `DOMAIN` desde el environment del contenedor (`APP_DOMAIN` → `DOMAIN` en docker-compose). **NO** edites el Caddyfile para poner tu dominio literal — se inyecta vía env.

### 4.3 Configurar el email del admin (para notificaciones de Let's Encrypt)

Edita la primera línea del `Caddyfile`:

```
{
    email admin@tudominio.com
}
```

> Caddy usa este email para avisarte 14 días antes de que un certificado expire. **NO** uses `admin@{$DOMAIN}` en producción — usa un email real que monitores.

### 4.4 Testear la configuración de Caddy

```bash
docker run --rm -v $(pwd)/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

**Output esperado:**
```
2024/xx/xx 12:00:00.000 INFO    using provided configuration    {"config_file": "/etc/caddy/Caddyfile", "config_adapter": ""}
2024/xx/xx 12:00:00.000 INFO    validated configuration
```

### Troubleshooting

- **`error: rate limit reached`**: Let's Encrypt limita 5 certificados por dominio por semana. Si reinicias Caddy muchas veces, agotas el cupo. En staging usa `tls internal` para emitir certs locales de prueba.
- **`connection refused` en el challenge ACME**: el puerto 80 debe estar abierto — Caddy lo usa para HTTP-01 challenge. Si tu cloud provider bloquea el 80, usa DNS-01 challenge (más complejo, fuera del scope de esta guía).

---

## Paso 5 — Levantar servicios

### 5.1 Build + start (primer arranque — tarda ~10 min por el build de la app)

```bash
docker compose build --pull
docker compose up -d
```

### 5.2 Monitorear el arranque

```bash
docker compose ps
```

**Output esperado (todos `Up` o `healthy`):**
```
NAME                  IMAGE                          STATUS                    PORTS
ziay-app-1            ziay-app                       Up (healthy)              3000/tcp
ziay-caddy-1          ziay-caddy                     Up                        0.0.0.0:80-443->80-443/tcp
ziay-chat-service-1   ziay-chat-service              Up (healthy)              3003/tcp
ziay-grafana-1        grafana/grafana:latest         Up                        3000/tcp
ziay-loki-1           grafana/loki:latest            Up                        3100/tcp
ziay-minio-1          minio/minio:latest             Up (healthy)              9000/tcp, 9001/tcp
ziay-n8n-1            n8nio/n8n:latest               Up                        5678/tcp
ziay-nocodb-1         nocodb/nocodb:latest           Up                        8080/tcp
ziay-ollama-1         ollama/ollama:latest           Up                        11434/tcp
ziay-postgres-1       postgres:16-alpine             Up (healthy)              5432/tcp
ziay-prometheus-1     prom/prometheus:latest         Up                        9090/tcp
ziay-promtail-1       grafana/promtail:latest        Up
ziay-redis-1          redis:7-alpine                 Up (healthy)              6379/tcp
ziay-alertmanager-1   prom/alertmanager:latest       Up                        9093/tcp
ziay-mailhog-1        mailhog/mailhog:latest         Up                        1025/tcp, 8025/tcp
ziay-uptime-kuma-1    louislam/uptime-kuma:1         Up                        3001/tcp
```

> Los servicios que no tienen `healthy` en la columna STATUS no necesariamente están rotos — algunos (n8n, NocoDB, Mailhog) no tienen healthcheck definido.

### 5.3 Si algún servicio no arranca

```bash
# Ver logs del servicio que falla
docker compose logs app --tail=100
docker compose logs caddy --tail=100
docker compose logs postgres --tail=100

# Restart específico
docker compose restart app

# Restart completo (cuando cambiaste el .env)
docker compose down
docker compose up -d
```

### Troubleshooting

- **`app` caído con `NEXTAUTH_SECRET must be set`**: el `.env` no tiene `NEXTAUTH_SECRET` o el valor está vacío.
- **`postgres` caído con `FATAL: password authentication failed`**: el `POSTGRES_PASSWORD` del `.env` no coincide con el password ya persistido en el volumen. Si es la primera vez, borra el volumen: `docker compose down -v && docker compose up -d` (⚠️ borra todos los datos).
- **`caddy` caído con `tls.issuance.acme.error`**: problema de DNS o puerto 80 bloqueado. Verifica con `dig ziay.tudominio.com` y `curl -v http://ziay.tudominio.com`.

---

## Paso 6 — Inicializar la base de datos

### 6.1 Aplicar migraciones

```bash
docker compose exec app bunx prisma migrate deploy
```

**Output esperado:**
```
Applying migration `20240101000000_init`
Applying migration `20240102000000_add_orders`
...
Applied N migrations.
```

> Si es la primera vez, también puedes usar `prisma db push` (más rápido pero sin historial de migraciones — NO recomendado en prod):
> ```bash
> docker compose exec app bunx prisma db push
> ```

### 6.2 Generar el Prisma Client

```bash
docker compose exec app bunx prisma generate
```

### 6.3 Sembrar datos iniciales (tenant demo + usuarios admin)

```bash
docker compose exec app bunx prisma db seed
```

**Output esperado:**
```
🌱 Seeded database with:
  - 1 tenant (ten-saramantha — ZIAY demo)
  - 3 users (admin@ziay.com, agent@ziay.com, finance@ziay.com)
  - 47 products (pijamasfamilia)
  - 4 scenarios (mayorista_familia, detal_stitch, regalo_hello_kitty, cancelacion_inventario)
```

### 6.4 Verificar

```bash
# Conectar a Postgres y contar registros
docker compose exec postgres psql -U ziay -d ziay -c \
  "SELECT (SELECT COUNT(*) FROM \"Tenant\") AS tenants, (SELECT COUNT(*) FROM \"User\") AS users, (SELECT COUNT(*) FROM \"Product\") AS products;"
```

**Output esperado:**
```
 tenants | users | products
---------+-------+----------
       1 |     3 |       47
(1 row)
```

### Troubleshooting

- **`P1003: Database does not exist`**: el `POSTGRES_DB` del `.env` no coincide con el nombre creado. Crea la DB manualmente: `docker compose exec postgres psql -U ziay -c "CREATE DATABASE ziay;"`.
- **`P1014: Schema is empty`**: todavía no hay migraciones aplicadas. Corre `prisma migrate deploy` primero.
- **Seed falla con `unique constraint`**: ya había datos seed. Borra y vuelve a intentar: `docker compose exec app bunx prisma migrate reset --force` (⚠️ borra todos los datos).

---

## Paso 7 — Verificar salud

### 7.1 Health check de la app

```bash
curl -s https://ziay.tudominio.com/api/health | jq .
```

**Output esperado:**
```json
{
  "status": "ok",
  "uptime": 1234,
  "db": "ok",
  "redis": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 7.2 Verificar cada servicio

```bash
# App (Next.js)
curl -fsS https://ziay.tudominio.com/api/health && echo " ✅ app"

# Chat service (Socket.io)
curl -fsS https://ziay.tudominio.com/api/health?service=chat && echo " ✅ chat"

# n8n
curl -fsS https://ziay.tudominio.com/n8n/healthz && echo " ✅ n8n"

# NocoDB
curl -fsS https://ziay.tudominio.com/nocodb/api/v1/health && echo " ✅ nocodb"

# MinIO console (responde HTML)
curl -fsS -o /dev/null -w "%{http_code}" https://ziay.tudominio.com/minio/ && echo " ✅ minio"

# Prometheus
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:9090/-/healthy && echo " ✅ prometheus"

# Grafana (debe redirigir al login → 302)
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:3002/ && echo " ✅ grafana"

# Loki
curl -fsS http://localhost:3100/ready && echo " ✅ loki"
```

### 7.3 Verificar el dashboard desde el navegador

Abre en el browser:
- `https://ziay.tudominio.com/` → login de ZIAY (admin@ziay.com / password del seed)
- `https://ziay.tudominio.com/n8n/` → n8n (crear cuenta owner la primera vez)
- `https://ziay.tudominio.com/nocodb/` → NocoDB
- `https://ziay.tudominio.com/minio/` → MinIO console (user: ziay / pass: TU_MINIO_ROOT_PASSWORD)
- `http://localhost:3002/` (vía SSH tunnel: `ssh -L 3002:localhost:3002 user@server`) → Grafana (admin / TU_GRAFANA_ADMIN_PASSWORD)

### Troubleshooting

- **`502 Bad Gateway` en Caddy**: el servicio detrás está caído. `docker compose ps` para ver cuál.
- **`504 Gateway Timeout`**: el servicio está up pero no responde a tiempo. Revisa `docker compose logs app --tail=50`.
- **`ERR_SSL_PROTOCOL_ERROR`**: Caddy todavía no emitió el certificado. Revisa `docker compose logs caddy --tail=50` — busca `certificate obtained successfully`.

---

## Paso 8 — Configurar webhooks

### 8.1 WhatsApp Cloud API (Meta)

1. Ve a [Meta Business → WhatsApp → API Setup](https://business.facebook.com/wa/manage/message-templates/).
2. Configura el webhook con:
   - **Callback URL**: `https://ziay.tudominio.com/api/webhooks/whatsapp`
   - **Verify Token**: el valor de `WA_VERIFY_TOKEN` en tu `.env`
3. Suscríbete a los eventos: `messages`, `message_status`, `message_delivered`, `message_read`.
4. Verifica:
   ```bash
   curl -X POST https://ziay.tudominio.com/api/webhooks/whatsapp \
     -H "Content-Type: application/json" \
     -d '{"test":"ping"}' -i | head -3
   ```
   **Output esperado**: `HTTP/2 200`.

### 8.2 Stripe

1. Ve a [dashboard.stripe.com → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Crea un endpoint:
   - **URL**: `https://ziay.tudominio.com/api/webhooks/stripe`
   - **Events**: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`
3. Copia el **Signing Secret** (`whsec_...`) y pégalo en tu `.env` como `STRIPE_WEBHOOK_SECRET`.
4. Restart app: `docker compose restart app`.

### 8.3 MercadoPago

1. Ve a [mercadopago.com.co → Tu negocio → Configuración → Webhooks](https://www.mercadopago.com.co/settings/notifications).
2. Crea una notificación:
   - **URL**: `https://ziay.tudominio.com/api/webhooks/mercadopago`
   - **Eventos**: `payment`, `merchant_order`
3. El **Signing Secret** es el último segmento del `x-signature` header. Configúralo como `MP_WEBHOOK_SECRET` en el `.env`.

### 8.4 Wompi

1. Ve a [wompi.co → Panel → Configuración → Eventos](https://dashboard.wompi.co/settings/events).
2. Crea un evento:
   - **URL**: `https://ziay.tudominio.com/api/webhooks/wompi`
   - **Eventos**: `transaction.updated`
3. Copia el **Events Secret** y pégalo como `WOMPI_EVENT_SECRET` en el `.env`.

### 8.5 PayU

1. Ve a [developers.payulatam.com → Webhooks](https://developers.payulatam.com/latam/plugin/webhooks-es.html).
2. Configura la URL: `https://ziay.tudominio.com/api/webhooks/payu`.
3. Copia el **verify signature** como `PAYU_WEBHOOK_SECRET` en el `.env`.

### 8.6 Meta Conversions API (CAPI) — opcional

1. Ve a [Meta Events Manager](https://business.facebook.com/events_manager).
2. Crea un dataset de eventos para el pixel.
3. Copia el **Access Token** y el **Pixel ID** al `.env`:
   ```bash
   META_CAPI_TOKEN=TU_TOKEN
   META_PIXEL_ID=TU_PIXEL_ID
   ```
4. Restart app: `docker compose restart app`.

### 8.7 Verificar que los webhooks llegan

Después de configurar, envía un evento de prueba desde el dashboard de cada gateway y verifica en los logs:

```bash
docker compose logs app --tail=20 | grep -i webhook
```

**Output esperado (ejemplo Stripe):**
```
app-1  | {"level":"info","msg":"webhook received","gateway":"stripe","event":"checkout.session.completed",...}
```

### Troubleshooting

- **El webhook responde 403 Forbidden**: el signature header no coincide con el secret del `.env`. Verifica que pegaste el secret completo (sin espacios).
- **Meta no verifica el webhook**: el `WA_VERIFY_TOKEN` que pusiste en Meta debe ser EXACTAMENTE igual al del `.env`. Reinicia la app si lo cambiaste: `docker compose restart app`.
- **El webhook llega pero la app no lo procesa**: revisa `docker compose logs app --tail=50` — busca errores de Zod validation o DB.

---

## Paso 8.5 — Operaciones automáticas (v0.4.3)

> A partir de v0.4.3, los cron jobs y las alertas se arrancan automáticamente al iniciar la app (vía `instrumentation.ts` de Next.js). No requieren n8n ni configuración adicional. Esta sección documenta qué se ejecuta y dónde verlo.

### 8.5.1 Cron jobs (auto-start en boot)

Los siguientes 4 cron jobs se registran vía `setInterval` cuando la app arranca. No necesitan activación manual:

| Cron job | Intervalo | Función | Qué hace |
|---|---|---|---|
| **DIAN retry** | 10 min | `src/lib/cron/dian-retry.ts` | Recoge `Invoice.status='pending' AND dianError != null` y reintenta envío a DIAN con backoff exponencial (`min(5·2^n, 1440) min`). |
| **Retention cleanup** | 24 h | `src/lib/cron/retention-cleanup.ts` | Exporta `AuditLog` rows pasados los 7 años de retención a cold-storage JSONL (`./data/cold-storage/auditlog-export-{date}-{stamp}.jsonl` + SHA-256 checksum), luego los borra. **Fail-closed**: si el export falla, no borra. |
| **Refund retry** | 5 min | `src/lib/cron/refund-retry.ts` | Recoge `Refund.status='pending' AND nextRetryAt < now()` y reintenta el gateway call con backoff exponencial. Tras 5 fallos, dispara alerta. |
| **Escrow placeholder** | 30 min | `src/lib/cron/escrow-placeholder.ts` | No-op log. El feature de escrow (ADR-0021) sigue en Proposed; este cron asegura que el wiring está testeado en prod para cuando se implemente el auto-release de 7 días. |

> **Workaround note:** BullMQ repeatable jobs no están todavía disponibles en este environment, por lo que usamos `setInterval` + `enqueue` (workaround válido). Cuando BullMQ repeatable esté disponible, se reemplazan los `setInterval` por `queue.add('job', {}, { repeat: { every: N } })` sin tocar los handlers.

**Verificar que están corriendo:**
```bash
docker compose logs app --tail=100 | grep -E "(dian-retry|retention-cleanup|refund-retry|escrow-placeholder)"
```

**Output esperado:**
```
app-1  | {"level":"info","msg":"cron:dian-retry:tick","time":"...","processed":0}
app-1  | {"level":"info","msg":"cron:refund-retry:tick","time":"...","processed":2,"retried":2,"failed":0}
```

### 8.5.2 Alertas (4 canales)

`src/lib/alerts.ts` expone `sendAlert(level, title, message, ctx)` que fanea a 4 canales en paralelo (non-blocking):

1. **Log (pino)** — siempre activo, va a `docker compose logs app` + Loki.
2. **Sentry** — `captureMessage` cuando `SENTRY_DSN` está seteado.
3. **Socket.io** — emite `alerts:new` al room del tenant para alertas en tiempo real en el dashboard.
4. **Slack/Discord webhook** — HTTP POST a `ALERT_WEBHOOK_URL` (best-effort; si falla, no bloquea los otros canales).

**Eventos que disparan alertas:**

| Evento | Nivel | Cuándo |
|---|---|---|
| Circuit breaker open | `error` | Un agente falla 5 veces consecutivas (`CircuitBreaker.open()`). |
| Governor veto | `warn` | El agente Governor bloquea una decisión (budget breach, policy violation, safety block). |
| Pipeline failure | `critical` | El pipeline del orquestador falla unrecoverable → dispara handoff humano. |
| Refund retry exhausted | `error` | Un `Refund` ha fallado 5 reintentos consecutivos. |

**Verificar que las alertas llegan a Slack** (cuando `ALERT_WEBHOOK_URL` está seteado):
```bash
# Test manual desde dentro del contenedor app:
docker compose exec app node -e "require('./src/lib/alerts').sendAlert('warn','deploy-test','manual test from deploy','verify')"
```

### 8.5.3 Pipeline failure → handoff humano

Cuando el pipeline del orquestador falla de forma unrecoverable (circuit breaker del agente abierto + LLM provider caído + retry budget agotado):

1. El mensaje se persiste SIEMPRE en `Message` con `status='pending'` (no se pierde).
2. La conversación se escala: `Conversation.botEnabled = false` + `Conversation.pausedReason = 'pipeline_failure'`.
3. El webhook retorna `200 OK` a Meta (para que no reintente).
4. Se dispara `sendAlert('critical', 'Pipeline failure', { conversationId, error })`.
5. El dashboard muestra un badge rojo "Pausado — pipeline failure" en la conversación.

El agente humano entra al Messenger, ve el badge, lee el mensaje pendiente y responde manualmente. Un admin puede re-enablear el bot con el botón **HandoffButton** (header de la conversación).

### 8.5.4 Circuit Breaker Dashboard (Gobernanza)

Disponible en `https://ziay.tudominio.com/dashboard?view=gobernanza` → tab **"Circuit Breakers"**. Muestra:

- Estado por agente: `closed` / `open` / `half-open` (verde / rojo / amarillo).
- Failure count + last failure timestamp + last error message.
- Botón **Reset** (solo admin) para forzar `closed` manualmente.
- Histórico de open events (últimos 30 días).
- Polling cada 5s vía `/api/governance/circuit-breakers`.

### 8.5.5 Handoff humano desde el Messenger

Cualquier agente con rol `agent` o `admin` puede pausar el bot en una conversación:

1. Abrir la conversación en el Messenger view.
2. En el header, clic en el botón **"Handoff"** (icono de mano).
3. La conversación se marca: `botEnabled = false`, `pausedReason = 'manual_handoff'`.
4. Socket event `conversation:paused` notifica a otros agentes viendo la misma conversación.
5. Badge rojo "Pausado" aparece en la lista de conversaciones.
6. Un admin puede revertirlo con el mismo botón (toggle).

### 8.5.6 Fuentes locales (no Google Fonts)

A partir de v0.4.3, el build ya no requiere acceso a `fonts.googleapis.com`. Las fuentes (Inter + Inter Tight) se cargan vía `next/font/local` desde `public/fonts/*.woff2`. Esto significa:

- ✅ El build funciona en CI con red restringida (corporate proxy, air-gapped runners).
- ✅ El build es determinístico — no depende de un servicio externo.
- ✅ No hay requests adicionales a Google desde el browser del usuario final.
- ✅ Las fuentes se cachean con el resto del bundle estático.

Si necesitas cambiar las fuentes, coloca los archivos `.woff2` en `public/fonts/` y actualiza las referencias en `src/app/layout.tsx`.

---

## Paso 9 — Configurar n8n (opcional pero recomendado)

### 9.1 Importar los 28 workflows

```bash
# Bulk import — requiere que n8n ya esté corriendo
for f in n8n-workflows/*.json; do
  echo "Importing $(basename $f)..."
  docker compose exec -T n8n n8n import:input --input=/import-workflows/$(basename $f)
done
```

> Si el directorio `/import-workflows/` no existe dentro del contenedor, monta el bind en el `docker-compose.yml`:
> ```yaml
> n8n:
>   volumes:
>     - n8n_data:/home/node/.n8n
>     - ./n8n-workflows:/import-workflows:ro   # ← agregar esta línea
> ```
> Luego: `docker compose up -d n8n`.

### 9.2 Activar workflows

1. Abre `https://ziay.tudominio.com/n8n/` en el navegador.
2. Inicia sesión con la cuenta owner (la que creaste en el primer arranque).
3. Ve a **Workflows** → verás los 28 workflows importados.
4. Click en cada uno → toggle **Active** (top-right).

### 9.3 Configurar credenciales en n8n

1. Ve a **Settings → Credentials**.
2. Crea las credenciales que necesitan los workflows:

| Credencial | Tipo | Valor |
|---|---|---|
| ZAI API | HTTP Header Auth | Header: `Authorization`, Value: `Bearer $ZAI_API_KEY` |
| OpenAI API | HTTP Header Auth | Header: `Authorization`, Value: `Bearer $OPENAI_API_KEY` |
| PostgreSQL | Postgres | Host: `postgres`, Port: `5432`, DB: `ziay`, User: `ziay`, Password: `$POSTGRES_PASSWORD` |

### 9.4 Testear el orquestador

```bash
# Probar el master-orchestrator (9-step pipeline)
curl -X POST https://ziay.tudominio.com/n8n/webhook/orchestrate \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"ten-saramantha","scenarioId":"mayorista_familia"}' | jq .
```

**Output esperado:**
```json
{
  "ok": true,
  "action": "full",
  "scenario": "mayorista_familia",
  "timeline": [
    {"step":"profile","agent":"profile","label":"Perfilamiento","emoji":"🎯","reply":" mayorista"},
    {"step":"speech","agent":"speech","label":"Discurso","emoji":"💬","reply":"¡Hola! ¿Qué producto te interesa?"},
    ...
    {"step":"checkout","agent":"checkout","label":"Checkout","emoji":"✅","reply":"¿Confirmas el pedido?"}
  ]
}
```

> **Importante**: los workflows n8n llaman a `http://app:3000/api/agents/[name]` (nombre interno del contenedor Docker). Si ves un error `ECONNREFUSED` o `getaddrinfo ENOTFOUND app`, n8n no está en la red de Docker. Solución: asegúrate de que el servicio `n8n` esté en la red `commerceflow` del `docker-compose.yml` (lo está por default).

### 9.5 Configurar WhatsApp → n8n (opcional)

Si quieres que los mensajes de WhatsApp lleguen a n8n en lugar de a la app:

1. En Meta Business → WhatsApp → Webhooks, cambia la URL a:
   ```
   https://ziay.tudominio.com/n8n/webhook/whatsapp-inbound
   ```
2. El workflow `10-agentes-conversacionales.json` (legacy) o `master-orchestrator.json` recibirá el webhook.

> En la mayoría de los casos, **no necesitas n8n para WhatsApp** — la app procesa los webhooks directamente en `/api/webhooks/whatsapp`. n8n es útil solo si quieres editar visualmente el flujo o agregar steps no estándar.

---

## Paso 10 — Monitoreo

### 10.1 Prometheus

- URL: `http://localhost:9090/` (vía SSH tunnel: `ssh -L 9090:localhost:9090 user@server`)
- Verifica que los targets están UP:
  ```bash
  curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
  ```
- **Output esperado** (todos `up`):
  ```json
  {"job":"app","health":"up"}
  {"job":"chat-service","health":"up"}
  {"job":"postgres","health":"up"}
  {"job":"redis","health":"up"}
  ```

### 10.2 Grafana

- URL: `http://localhost:3002/` (vía SSH tunnel: `ssh -L 3002:localhost:3002 user@server`)
- Login: `admin` / `TU_GRAFANA_ADMIN_PASSWORD`
- El dashboard **ZIAY Overview** ya está auto-provisionado (Provisioning → Dashboards).
- Muestra: requests/min, latency p50/p95/p99, error rate, LLM cost/min, DB connections, Redis ops/sec.

### 10.3 Loki (logs centralizados)

- En Grafana → Explore → selecciona datasource `Loki`.
- Queries útiles:
  ```
  {container="ziay-app-1"} |= "error"
  {container="ziay-app-1"} | json | level="error"
  {container="ziay-caddy-1"} | json | status >= "500"
  ```

### 10.4 Alertmanager

- URL: `http://localhost:9093/` (vía SSH tunnel)
- Las alertas se definen en `monitoring/alerts.yml`. Ejemplos:
  - `AppDown` (1 min sin respuesta de `/api/health`) → Slack #support + PagerDuty
  - `HighErrorRate` (>5% de respuestas 5xx por 5 min) → Slack #support
  - `LLMBudgetExceeded` (tenant superó el budget diario) → Slack #finance
  - `DBConnectionsHigh` (>80% del pool) → Slack #support
- Para configurar receptores, edita `monitoring/alertmanager.yml` con tus webhooks de Slack + PagerDuty.

### 10.5 Uptime Kuma (monitoring externo)

- URL: `http://localhost:3001/` (vía SSH tunnel)
- Setup inicial: crear cuenta admin.
- Agrega monitors:
  - HTTPS monitor: `https://ziay.tudominio.com/api/health` (interval 60s)
  - HTTPS monitor: `https://ziay.tudominio.com/n8n/healthz` (interval 60s)
  - TCP port monitor: `ziay.tudominio.com:443` (interval 60s)
- Configura notificaciones (Slack, Telegram, email) en Settings → Notifications.

### 10.6 Sentry (error tracking)

- La app ya está instrumentada (ver `next.config.ts` → `withSentryConfig`).
- Los errores se reportan automáticamente a `SENTRY_DSN`.
- Verifica: provoca un error intencionalmente (ej. visita `/api/_test/error` si existe) y míralo en sentry.io.

### Troubleshooting

- **Prometheus target `down`**: el servicio no tiene el endpoint `/metrics` o no está en la red Docker. Verifica `monitoring/prometheus.yml`.
- **Grafana muestra `No data`**: el rango de tiempo está fuera del rango de datos. Cambia el time picker a "Last 15 minutes".
- **Loki no recibe logs de un contenedor**: Promtail no lo está descubriendo. Verifica `monitoring/promtail.yml` y que el contenedor esté corriendo con el label correcto.

---

## Paso 11 — Backup

### 11.1 Backup de Postgres (crítico)

Crea `/opt/ziay/scripts/backup-db.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/opt/ziay/backups
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE=$BACKUP_DIR/ziay-db-$TIMESTAMP.sql.gz

mkdir -p $BACKUP_DIR

# Dump + gzip
docker compose -f /opt/ziay/docker-compose.yml exec -T postgres \
  pg_dump -U ziay -d ziay --no-owner --clean --if-exists \
  | gzip > $BACKUP_FILE

# Retention: keep last 30 days
find $BACKUP_DIR -name "ziay-db-*.sql.gz" -mtime +30 -delete

echo "✅ Backup: $BACKUP_FILE ($(du -h $BACKUP_FILE | cut -f1))"
```

```bash
chmod +x /opt/ziay/scripts/backup-db.sh
```

### 11.2 Cron (diario a las 3 AM)

```bash
sudo crontab -e
# Agregar:
0 3 * * * /opt/ziay/scripts/backup-db.sh >> /var/log/ziay-backup.log 2>&1
```

### 11.3 Backup de MinIO (imágenes de productos)

```bash
# Instalar el cliente mc (MinIO Client)
docker run --rm minio/mc:latest \
  alias set ziay http://localhost:9000 ziay TU_MINIO_ROOT_PASSWORD

# Sincronizar a un bucket en S3 o a un directorio local
docker run --rm --network=commerceflow -v /opt/ziay/backups/minio:/backup minio/mc:latest \
  mirror ziay /backup/ziay-$(date +%Y%m%d)
```

### 11.4 Backup offsite (recomendado)

Sube los backups a un bucket S3 / Backblaze B2 / Google Drive:

```bash
# Ejemplo con rclone (instalar: https://rclone.org/install/)
rclone copy /opt/ziay/backups remote:ziay-backups/$(date +%Y%m%d) --progress
```

### 11.5 Verificar el restore (probar mensualmente)

```bash
# En un entorno staging:
docker compose exec postgres psql -U ziay -d ziay -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c /opt/ziay/backups/ziay-db-20240101-030000.sql.gz | \
  docker compose exec -T postgres psql -U ziay -d ziay

# Verificar
docker compose exec postgres psql -U ziay -d ziay -c \
  "SELECT (SELECT COUNT(*) FROM \"Tenant\") AS tenants, (SELECT COUNT(*) FROM \"User\") AS users;"
```

---

## Paso 12 — Actualizaciones

### 12.1 Actualizar a una nueva versión

```bash
cd /opt/ziay

# 1. Backup antes de tocar nada
./scripts/backup-db.sh

# 2. Pull latest
git fetch --all
git log --oneline origin/main..HEAD    # ver si hay commits locales no commiteados
git pull origin main

# 3. Re-build + restart
docker compose build --pull
docker compose up -d

# 4. Aplicar migraciones nuevas (si las hay)
docker compose exec app bunx prisma migrate deploy

# 5. Verificar
curl -s https://ziay.tudominio.com/api/health | jq .
```

### 12.2 Rollback (si la nueva versión rompe algo)

```bash
cd /opt/ziay

# 1. Volver al commit anterior
git log --oneline -10         # ver últimos commits
git checkout <commit-hash-anterior>

# 2. Re-build + restart
docker compose build --pull
docker compose up -d

# 3. Restaurar DB si la migración nueva ya corrió (⚠️ puede haber data loss)
gunzip -c /opt/ziay/backups/ziay-db-YYYYMMDD-030000.sql.gz | \
  docker compose exec -T postgres psql -U ziay -d ziay

# 4. Verificar
curl -s https://ziay.tudominio.com/api/health | jq .
```

> ⚠️ **Rollback de migraciones**: prisma no soporta `migrate rollback` nativo. Si una migración nueva hizo cambios destructivos (DROP COLUMN, etc.), el único rollback seguro es restaurar el backup de Postgres. Por eso es **crítico** que el backup corra antes de cada update.

### 12.3 Update de dependencias (mensual)

```bash
# Verificar versions desactualizadas
docker compose exec app bun outdated

# Update seguro (patch + minor)
docker compose exec app bun update

# Update major (revisar changelog de cada paquete primero!)
docker compose exec app bun add next@latest react@latest react-dom@latest

# Re-build + restart
docker compose build --pull
docker compose up -d
```

### 12.4 Update de imágenes Docker (semanal)

```bash
# Pull latest de todas las imágenes
docker compose pull

# Recrear contenedores con las nuevas imágenes (preserva volumes)
docker compose up -d

# Limpiar imágenes viejas (libera disco)
docker image prune -f
```

### Troubleshooting

- **`prisma migrate deploy` falla con `P3008`**: ya hay una migración con el mismo nombre. Mira `prisma/migrations/` y elimina el directorio duplicado.
- **App no arranca después del update**: revisa `docker compose logs app --tail=50`. Lo más común: una variable de env nueva es requerida (ver `docs/ENVIRONMENT.md`).
- **Rollback de DB falla con `relation already exists`**: el schema no se dropeó completo. Corre `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` antes del restore.

---

## Apéndice A — Comandos rápidos

```bash
# Status del stack
docker compose ps

# Logs en tiempo real (todos)
docker compose logs -f --tail=20

# Logs de un servicio específico
docker compose logs -f app --tail=100

# Restart un servicio
docker compose restart app

# Restart todo
docker compose down && docker compose up -d

# Entrar a un contenedor
docker compose exec app bash
docker compose exec postgres psql -U ziay -d ziay

# Ver uso de recursos
docker stats

# Limpiar todo (⚠️ borra datos)
docker compose down -v
```

## Apéndice B — Puertos

| Puerto | Servicio | Accesible desde |
|---|---|---|
| 80 | Caddy (HTTP) | Internet |
| 443 | Caddy (HTTPS) | Internet |
| 3000 | ZIAY app | Solo red Docker (Caddy proxy) |
| 3001 | Uptime Kuma | Solo localhost (SSH tunnel) |
| 3002 | Grafana | Solo localhost (SSH tunnel) |
| 3003 | Chat service | Solo red Docker |
| 3100 | Loki | Solo localhost |
| 5432 | PostgreSQL | Solo red Docker (no exponer) |
| 5678 | n8n | Solo red Docker (Caddy proxy en /n8n/) |
| 6379 | Redis | Solo red Docker (no exponer) |
| 8080 | NocoDB | Solo red Docker (Caddy proxy en /nocodb/) |
| 9000 | MinIO S3 API | Solo red Docker |
| 9001 | MinIO Console | Solo red Docker (Caddy proxy en /minio/) |
| 9090 | Prometheus | Solo localhost |
| 9093 | Alertmanager | Solo localhost |
| 1025 | Mailhog SMTP | Solo localhost |
| 8025 | Mailhog Web UI | Solo localhost |
| 11434 | Ollama | Solo red Docker |

> **Regla de oro**: solo los puertos 80, 443 (y opcionalmente 22 SSH) deben estar abiertos al internet. Todo lo demás se accede vía SSH tunnel o vía el reverse proxy de Caddy.

## Apéndice C — URLs públicas

| URL | Servicio | Auth |
|---|---|---|
| `https://ziay.tudominio.com/` | ZIAY app (login + dashboard) | Email + password |
| `https://ziay.tudominio.com/api/health` | Health check | None |
| `https://ziay.tudominio.com/api/health?service=chat` | Chat service health | None |
| `https://ziay.tudominio.com/n8n/` | n8n | n8n owner account |
| `https://ziay.tudominio.com/n8n/webhook/orchestrate` | n8n webhook (master orchestrator) | None (validación por tenantId) |
| `https://ziay.tudominio.com/nocodb/` | NocoDB | NocoDB account |
| `https://ziay.tudominio.com/minio/` | MinIO console | MinIO root user |
| `https://ziay.tudominio.com/api/webhooks/whatsapp` | WhatsApp Cloud API webhook | Signature verify |
| `https://ziay.tudominio.com/api/webhooks/stripe` | Stripe webhook | Signature verify |
| `https://ziay.tudominio.com/api/webhooks/mercadopago` | MercadoPago webhook | Signature verify |
| `https://ziay.tudominio.com/api/webhooks/wompi` | Wompi webhook | Signature verify |
| `https://ziay.tudominio.com/api/webhooks/payu` | PayU webhook | Signature verify |

## Apéndice D — Soporte

- **Docs internas**: `/docs/` (ver `INDEX.md` para el índice)
- **Runbook de incidentes**: `docs/DR-RUNBOOK.md`
- **Checklist de producción**: `docs/PRODUCTION-CHECKLIST.md`
- **Referencia de env vars**: `docs/ENVIRONMENT.md`
- **Referencia de agentes (26)**: `docs/AGENTS-REFERENCE.md`
- **Cookbook de API**: `docs/API-COOKBOOK.md`
- **Modelo de datos**: `docs/DATA-MODEL.md` + `docs/erd.svg`

---

**Última actualización**: SPRINT-FIXES-N8N-DEPLOY-001
**Versión del stack**: docker-compose.yml (16 servicios) + Caddyfile.prod + next.config.ts (Next.js 16 + Turbopack)
