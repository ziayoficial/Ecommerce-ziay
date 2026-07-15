# Referencia de Variables de Entorno — CommerceFlow OS

Este documento describe **todas** las variables de entorno que CommerceFlow OS puede consumir, agrupadas por categoría. El archivo `.env.example` contiene los placeholders vacíos — este documento explica cada una.

> 📖 Para la guía de setup de desarrollo ver [`DEVELOPMENT.md`](./DEVELOPMENT.md).
> 📖 Para el checklist de producción ver [`PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md).

---

## 📋 Convenciones

- **Requerido**: la app no arranca o la feature crítica no funciona sin esta variable.
- **Opcional**: la feature funciona en modo stub/demo sin esta variable, pero no se conecta a servicios reales.
- **Dev-only**: solo se usa en desarrollo, **NUNCA** debe estar en producción.
- **Prod-only**: solo se usa en producción, ignorada en dev.

Todas las variables se cargan vía `process.env` en el servidor. Las variables con prefijo `NEXT_PUBLIC_` se exponen también al cliente (browser) — úsalas solo para valores no sensibles.

---

## 📑 Tabla de contenidos

1. [Dominio y URL](#1-dominio-y-url)
2. [Base de datos](#2-base-de-datos)
3. [Secretos de aplicación](#3-secretos-de-aplicación)
4. [Webhook verify tokens](#4-webhook-verify-tokens)
5. [LLM Providers](#5-llm-providers)
6. [Ecommerce Adapters](#6-ecommerce-adapters)
7. [Logistics Adapters](#7-logistics-adapters)
8. [NocoDB bidireccional](#8-nocodb-bidireccional)
9. [MinIO (almacenamiento de imágenes)](#9-minio-almacenamiento-de-imágenes)
10. [n8n (orquestación externa)](#10-n8n-orquestación-externa)
11. [Postgres + pgvector](#11-postgres--pgvector)
12. [Caddy / SSL](#12-caddy--ssl)

---

## 1. Dominio y URL

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `DOMAIN` | ✅ prod | `commerceflow.example.com` | Dominio principal del deployment. Usado por Caddy y por los webhooks salientes para construir URLs absolutas. |
| `NEXTAUTH_URL` | ✅ prod | `https://commerceflow.example.com` | URL canónica de la app para NextAuth. Debe incluir el protocolo (`https://`). |
| `N8N_PROTOCOL` | ❌ | `https` | Protocolo para construir URLs de n8n (`http` o `https`). |
| `WEBHOOK_URL` | ❌ | `https://commerceflow.example.com/n8n` | URL base para registrar webhooks en n8n. |

### Ejemplo

```bash
DOMAIN=commerceflow.indisutex.com
NEXTAUTH_URL=https://commerceflow.indisutex.com
N8N_PROTOCOL=https
WEBHOOK_URL=https://commerceflow.indisutex.com/n8n
```

**Habilita**: HTTPS en Caddy, webhooks absolutos, NextAuth callbacks.

---

## 2. Base de datos

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `DATABASE_URL` | ✅ | `file:./dev.db` (dev) | URL de conexión. SQLite: `file:./dev.db`. Postgres: `postgresql://user:pass@host:5432/db?schema=public`. |
| `POSTGRES_PASSWORD` | ✅ prod | `change_me_to_a_strong_password` | Password del usuario postgres en el contenedor Docker. Generar con `openssl rand -hex 24`. |

### Ejemplo dev (SQLite)

```bash
DATABASE_URL="file:./dev.db"
```

### Ejemplo prod (Postgres)

```bash
DATABASE_URL="postgresql://commerceflow:super_secret_password@postgres:5432/commerceflow?schema=public"
POSTGRES_PASSWORD=super_secret_password
```

**Habilita**: conexión a la DB. SQLite en dev, Postgres en prod.

---

## 3. Secretos de aplicación

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `NEXTAUTH_SECRET` | ✅ prod | `generate_with_openssl_rand_hex_32` | Secreto para firmar sesiones JWT de NextAuth. Generar con `openssl rand -hex 32`. |
| `N8N_ENCRYPTION_KEY` | ✅ prod | `generate_with_openssl_rand_hex_32` | Secreto para cifrar credenciales almacenadas en n8n. Generar con `openssl rand -hex 32`. |

### Generación

```bash
openssl rand -hex 32
# Output: 4f8a7b2c9d1e6f3a8b5c2d9e6f1a4b7c8d5e2f9a6b3c0d7e4f1a8b5c2d9e6f3a
```

**Habilita**: NextAuth sessions (login), cifrado de creds en n8n.

---

## 4. Webhook verify tokens

Estos tokens se configuran en el dashboard de Meta (developers.facebook.com) y deben coincidir EXACTAMENTE con los de tu `.env`. Se usan en el handshake GET de los webhooks.

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `WA_VERIFY_TOKEN` | ✅ | `commerceflow_verify_change_me` | Token para verificar la subscripción del webhook de WhatsApp Cloud API. |
| `META_VERIFY_TOKEN` | ✅ | `commerceflow_verify_change_me` | Token para verificar la subscripción del webhook de Messenger / Instagram. Puede ser igual o diferente al de WA. |
| `META_APP_SECRET` | ✅ prod | (no set) | App Secret de tu app de Meta. Habilita la verificación HMAC de `X-Hub-Signature-256` en los webhooks entrantes. **Sin esto, los webhooks no verifican firma**. |

### Ejemplo

```bash
WA_VERIFY_TOKEN=indisutex_wa_token_2026_xyz
META_VERIFY_TOKEN=indisutex_meta_token_2026_abc
META_APP_SECRET=abc123def456ghi789jkl012mno345pqr678
```

**Habilita**: handshakes de webhook subscription, verificación de firma HMAC en payloads entrantes (prod).

> ⚠️ **Crítico**: en producción, `META_APP_SECRET` es **obligatorio** — sin esto, un atacante podría enviar mensajes falsos al webhook haciéndose pasar por Meta.

---

## 5. LLM Providers

Cada tenant tiene configurado `proveedorIa` en la tabla `Tenant`. El registry `getLLMAdapter(tenantId)` en `src/lib/llm/adapter.ts` decide qué adapter instanciar. Las API keys se leen de `process.env` (en producción, deberían venir de un secrets manager keyed by `Tenant.credencialesIaRef`).

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `OPENAI_API_KEY` | ❌ | (vacío) | API key de OpenAI. Habilita `OpenAIAdapter` (gpt-4o-mini, gpt-4o vision, text-embedding-3-small). Para tenants con `proveedorIa='chatgpt'`. |
| `XAI_API_KEY` | ❌ | (vacío) | API key de xAI. Habilita `XaiAdapter` (grok-2-latest, grok-2-vision). Para tenants con `proveedorIa='xai'`. |
| `OLLAMA_BASE_URL` | ❌ | `http://localhost:11434` | URL del servidor Ollama self-hosted. Para tenants con `proveedorIa='ollama'`. En Docker: `http://ollama:11434`. |

### Zai (default)

El adapter `ZaiAdapter` usa `z-ai-web-dev-sdk` y **no requiere variables de entorno** — está siempre disponible.

### Ejemplo

```bash
# OpenAI (ChatGPT)
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx

# xAI (Grok)
XAI_API_KEY=xai-xxxxxxxxxxxxxxxxxxxxx

# Ollama (self-hosted, perfil Docker opcional)
OLLAMA_BASE_URL=http://ollama:11434
```

**Habilita**: proveedores IA alternativos al default (Zai). Sin estas variables, los tenants con `proveedorIa != 'zai'` fallan al llamar al LLM.

### Cómo cambiar el proveedor de un tenant

```bash
curl -X PATCH http://localhost:3000/api/llm-providers \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"ten-saramantha","proveedorIa":"chatgpt"}'
```

O vía SQL directo:
```sql
UPDATE Tenant SET proveedorIa = 'chatgpt' WHERE slug = 'saramantha';
```

---

## 6. Ecommerce Adapters

Cada tenant tiene `plataformaCatalogo` y `bdCatalogo` en la tabla `Tenant`. El registry `getEcommerceAdapter(tenantId)` en `src/lib/adapters/registry.ts` decide qué adapter instanciar.

### WooCommerce

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `WOOCOMMERCE_CONSUMER_KEY` | ❌ | (vacío) | Consumer key de la REST API de WooCommerce. Generar en `/wp-admin/profile.php` → Applications → Add new. |
| `WOOCOMMERCE_CONSUMER_SECRET` | ❌ | (vacío) | Consumer secret correspondiente. |
| `WOOCOMMERCE_STORE_URL` | ❌ | (vacío) | URL base de la tienda WooCommerce, sin slash final. Ej: `https://tienda.com` (la API está en `/wp-json/wc/v3/`). |

**Habilita**: `WooCommerceAdapter` con HTTP real a `/wp-json/wc/v3/products` con Basic Auth. Sin estas variables, el adapter opera en modo stub (lee `Product` con `fuenteSincronizacion='woocommerce'` ya existente en DB).

### Shopify

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `SHOPIFY_ACCESS_TOKEN` | ❌ | (vacío) | Access token de la Admin GraphQL API de Shopify. Generar vía OAuth flow o como custom app. |
| `SHOPIFY_SHOP` | ❌ | (vacío) | Dominio de la tienda Shopify. Ej: `mi-tienda.myshopify.com`. |

**Habilita**: `ShopifyAdapter` con HTTP real a `https://{SHOPIFY_SHOP}/admin/api/2024-01/graphql.json` con header `X-Shopify-Access-Token`. Sin estas variables, modo stub.

### Supabase

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `SUPABASE_URL` | ❌ | (vacío) | URL del proyecto Supabase. Ej: `https://xxx.supabase.co`. |
| `SUPABASE_ANON_KEY` | ❌ | (vacío) | Anon key de Supabase (público, solo lectura). |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | (vacío) | Service role key de Supabase (secreto, bypassa RLS). **Solo servidor, NUNCA exponer al cliente**. |

**Habilita**: `SupabaseCatalogAdapter` con llamadas reales a PostgREST. Modo `cliente` = solo lectura con anon key. Modo `nuestro` = read-write con service role key.

### Oracle

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `ORACLE_CONNECTION_STRING` | ❌ | (vacío) | Connection string Oracle. Ej: `(DESCRIPTION=(ADDRESS=(PROTOCOL=tcps)(HOST=db.oracle.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=xxx)))`. |
| `ORACLE_USER` | ❌ | (vacío) | Usuario de la DB Oracle. |
| `ORACLE_PASSWORD` | ❌ | (vacío) | Password del usuario Oracle. |

**Habilita**: `OracleCatalogAdapter` con driver `oracledb` + wallet mTLS. Para tenants con `bdCatalogo='oracle_nuestro'`. **Stub**: actualmente no implementado, falla con error explícito. Ver TODO en `src/lib/adapters/oracle-catalog.ts`.

### Ejemplo

```bash
# WooCommerce
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxx
WOOCOMMERCE_STORE_URL=https://tienda-cliente.com

# Shopify
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_SHOP=mi-tienda.myshopify.com

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Oracle
ORACLE_CONNECTION_STRING=(DESCRIPTION=(ADDRESS=...))
ORACLE_USER=commerceflow
ORACLE_PASSWORD=super_secret
```

---

## 7. Logistics Adapters

Cada tenant tiene `proveedorLogistico` en la tabla `Tenant`. El registry `getLogisticsAdapter(tenantId)` decide qué adapter instanciar.

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `DROPI_API_KEY` | ❌ | (vacío) | API key de Dropi (https://api.dropi.co). Habilita HTTP real a `/api/v2/rates`. Sin esto, modo stub con tarifas hardcodeadas (Bogotá $9.5k, Pasto $15.5k, etc.). |
| `ENVIOS99_API_KEY` | ❌ | (vacío) | API key de 99envios. |
| `AVEONLINE_API_KEY` | ❌ | (vacío) | API key de Aveonline. |

### Ejemplo

```bash
DROPI_API_KEY=dropi_xxxxxxxxxxxxxxxxxxxxxxxx
ENVIOS99_API_KEY=99e_xxxxxxxxxxxxxxxxxxxxxxxx
AVEONLINE_API_KEY=avo_xxxxxxxxxxxxxxxxxxxxxxxx
```

**Habilita**: HTTP real a los proveedores logísticos. Sin estas variables, los adapters operan en modo stub con tarifas realistas (2024-2025 Colombian dropshipping market rates).

---

## 8. NocoDB bidireccional

NocoDB se usa como capa de visualización y edición de pedidos para operadores (Saramantha §10). CommerceFlow envía cambios a NocoDB (webhook out) y recibe cambios de NocoDB (webhook in).

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `NOCODB_PUBLIC_URL` | ✅ prod | `https://commerceflow.example.com/nocodb` | URL pública de la instancia NocoDB (ruteada por Caddy). |
| `NOCODB_WEBHOOK_URL` | ✅ prod | `https://commerceflow.example.com/nocodb/api/v1/db/data/noco/commerceflow/orders` | Endpoint al que CommerceFlow envía webhooks salientes hacia NocoDB. |
| `NOCODB_WEBHOOK_SECRET` | ✅ prod | `commerceflow_nocodb_change_me` | Token secreto compartido. Se envía en el header `X-NocoDB-Secret` en ambos sentidos. |

### Ejemplo

```bash
NOCODB_PUBLIC_URL=https://commerceflow.indisutex.com/nocodb
NOCODB_WEBHOOK_URL=https://commerceflow.indisutex.com/nocodb/api/v1/db/data/noco/commerceflow/orders
NOCODB_WEBHOOK_SECRET=indisutex_nocodb_secret_xyz_2026
```

**Habilita**: sync bidireccional Kanban ↔ NocoDB. Sin esto, los endpoints `/api/webhooks/nocodb-in` y `/api/webhooks/nocodb-out` rechazan payloads con 403.

---

## 9. MinIO (almacenamiento de imágenes)

MinIO se usa para almacenar imágenes de productos y screenshots de identificaciones visuales.

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `MINIO_ROOT_USER` | ✅ prod | `commerceflow` | Usuario root de MinIO. |
| `MINIO_ROOT_PASSWORD` | ✅ prod | `change_me_to_a_strong_password` | Password root de MinIO. Mínimo 24 caracteres. |

### Ejemplo

```bash
MINIO_ROOT_USER=commerceflow
MINIO_ROOT_PASSWORD=super_secret_minio_password_2026
```

**Habilita**: almacenamiento de imágenes en MinIO (en vez de URLs externas). Sin esto, las imágenes se referencian por URL externa (https://...).

---

## 10. n8n (orquestación externa)

n8n se usa como capa opcional de orquestación externa. Los 11 workflows JSON en `n8n-workflows/` se importan en la instancia n8n y llaman a las APIs de CommerceFlow.

Las variables de n8n se configuran en el contenedor Docker, no en `.env` de CommerceFlow directamente. Ver `docker-compose.yml` servicio `n8n`:

| Variable | Servicio | Descripción |
|----------|----------|-------------|
| `N8N_ENCRYPTION_KEY` | n8n | Secreto para cifrar creds almacenadas. |
| `N8N_PROTOCOL` | n8n | `https` en prod. |
| `WEBHOOK_URL` | n8n | URL pública de n8n para registrar webhooks. |
| `N8N_HOST` | n8n | `0.0.0.0` en contenedor. |

---

## 11. Postgres + pgvector

Para habilitar Postgres + pgvector en producción, ejecuta `prisma/sql/pgvector-setup.sql` después del primer `prisma migrate deploy`. Las variables se configuran en `docker-compose.yml` servicio `postgres`.

| Variable | Servicio | Descripción |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | postgres | Password del superuser. |
| `POSTGRES_DB` | postgres | Nombre de la DB inicial. Default `commerceflow`. |
| `POSTGRES_USER` | postgres | Usuario inicial. Default `commerceflow`. |

### Setup pgvector

```bash
# 1. Conectarse a Postgres
docker exec -it commerceflow-postgres psql -U commerceflow -d commerceflow

# 2. Ejecutar el setup SQL
\i /docker-entrypoint-initdb.d/pgvector-setup.sql

# 3. Ejecutar las políticas RLS
\i /docker-entrypoint-initdb.d/rls-policies.sql

# 4. Verificar
\dx vector
\dt
```

**Habilita**: embeddings vectoriales nativas (búsqueda semántica sub-100ms vs ~500ms con TF-hash fallback).

---

## 12. Caddy / SSL

Caddy se configura vía `Caddyfile` (dev) o `Caddyfile.prod` (prod). Las variables se interpolan con `{$VAR_NAME}` en el Caddyfile.

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `DOMAIN` | ✅ prod | `commerceflow.example.com` | Dominio para el que Caddy gestiona certificados TLS. |
| `ACME_EMAIL` | ❌ | `admin@{$DOMAIN}` | Email para registros ACME (Let's Encrypt / ZeroSSL). |

### Certificados

Caddy obtiene certificados automáticamente:
- **Staging**: vía Let's Encrypt staging (rate limits altos).
- **Production**: vía Let's Encrypt + ZeroSSL con HTTP-01 challenge.
- **Renovación**: automática cada 30 días (los certs son válidos 90 días).

---

## Variables por entorno

### Dev (mínimo)

```bash
# .env (dev)
DATABASE_URL="file:./dev.db"
WA_VERIFY_TOKEN=commerceflow_verify_dev
META_VERIFY_TOKEN=commerceflow_verify_dev
# Todo lo demás: vacío → modo stub
```

### Staging

```bash
# .env (staging)
DOMAIN=staging.commerceflow.indisutex.com
NEXTAUTH_URL=https://staging.commerceflow.indisutex.com
DATABASE_URL=postgresql://commerceflow:pass@postgres:5432/commerceflow
NEXTAUTH_SECRET=$(openssl rand -hex 32)
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
WA_VERIFY_TOKEN=indisutex_staging_wa_xyz
META_VERIFY_TOKEN=indisutex_staging_meta_abc
META_APP_SECRET=staging_app_secret
NOCODB_WEBHOOK_SECRET=staging_nocodb_secret
POSTGRES_PASSWORD=staging_strong_password
MINIO_ROOT_PASSWORD=staging_minio_password_2026
# LLM providers (puede que solo Zai para staging)
OPENAI_API_KEY=
XAI_API_KEY=
OLLAMA_BASE_URL=
# Ecommerce adapters (vacíos en staging)
# Logistics adapters (vacíos en staging)
DROPI_API_KEY=
```

### Production

Ver [`PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md) para el checklist completo. Todas las variables de la tabla de contenidos deben estar configuradas.

---

## Validación

Después de configurar `.env`, valida con:

```bash
# Verificar que las variables críticas están set
bun -e 'console.log({
  DATABASE_URL: !!process.env.DATABASE_URL,
  NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
  WA_VERIFY_TOKEN: !!process.env.WA_VERIFY_TOKEN,
  META_VERIFY_TOKEN: !!process.env.META_VERIFY_TOKEN,
  META_APP_SECRET: !!process.env.META_APP_SECRET,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  DROPI_API_KEY: !!process.env.DROPI_API_KEY,
})'

# Health check del endpoint
curl "http://localhost:3000/api/health" | jq '.summary'
# Esperado en prod: { "ok": 23, "warning": 0, "error": 0, "not_configured": 0 }

# Health específico del tenant
curl "http://localhost:3000/api/health?tenantId=ten-saramantha" | jq '.checks[] | select(.status != "ok")'
```

---

## Rotación de secretos

**Recomendación**: rotar cada 90 días.

### NextAuth secret

```bash
# 1. Generar nuevo
NEW_SECRET=$(openssl rand -hex 32)

# 2. Actualizar .env
sed -i "s|NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$NEW_SECRET|" .env

# 3. Reiniciar app
docker compose restart app

# 4. Todos los usuarios deben volver a login (sesiones JWT invalidated)
```

### API keys (LLM, Ecommerce, Logistics)

1. Generar nueva key en el dashboard del proveedor.
2. Actualizar `.env`.
3. Reiniciar app.
4. Revocar key vieja en el dashboard del proveedor.
5. Verificar health: `curl /api/health | jq '.checks[] | select(.name | startswith("llm"))'`

### META_APP_SECRET

⚠️ Rotar este secreto **invalida todos los webhooks suscritos**. Procedimiento:

1. Generar nuevo App Secret en developers.facebook.com.
2. Actualizar `.env`.
3. Reiniciar app.
4. Re-suscribir webhooks en Meta dashboard (debes re-verificar la URL).
5. Notificar a Meta que el App Secret cambió.

---

## Seguridad

- **NUNCA** commitear `.env` al repo (verificado por `.gitignore`).
- **NUNCA** exponer `SUPABASE_SERVICE_ROLE_KEY` o `META_APP_SECRET` al cliente (no tienen prefijo `NEXT_PUBLIC_`).
- **SIEMPRE** generar secretos con `openssl rand -hex 32` (no usar strings humanos).
- **SIEMPRE** rotar si hay sospecha de leak.
- **Para reportar un leak**: sigue [`../SECURITY.md`](../SECURITY.md) — **NO abras issue público**.
