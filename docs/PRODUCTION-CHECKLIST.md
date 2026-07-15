# Checklist de Producción — CommerceFlow OS

Checklist exhaustivo para verificar que un deployment de CommerceFlow OS está listo para go-live. Cada ítem debe marcarse ✅ antes del cutover a producción.

> 📖 Para la guía de deploy completa ver [`../upload/GUIA-DEPLOY-PRODUCCION.md`](../upload/GUIA-DEPLOY-PRODUCCION.md).
> 📖 Para referencia de variables de entorno ver [`ENVIRONMENT.md`](./ENVIRONMENT.md).

---

## 📋 Cómo usar este checklist

1. **Antes del cutover**: completa todas las secciones de **Infraestructura**, **Base de datos**, **Datos**, **Integraciones**, **Seguridad**.
2. **Durante el cutover**: ejecuta la sección **Verificación** en orden.
3. **Después del cutover**: activa la sección **Post-deploy** en la primera semana.

Cada ítem tiene:
- ✅ = marcado / verificado
- ⬜ = pendiente
- ⚠️ = bloqueador crítico (no puedes ir a prod sin esto)

---

## 1. Infraestructura

### Docker y contenedores

- [ ] ⚠️ Docker Engine 24+ instalado en el servidor
- [ ] ⚠️ Docker Compose v2+ instalado (`docker compose version` devuelve v2+)
- [ ] ⚠️ `docker-compose.yml` copiado al servidor
- [ ] ⚠️ `.env` creado en el servidor con TODAS las variables de producción (ver [`ENVIRONMENT.md`](./ENVIRONMENT.md))
- [ ] Contenedor `postgres` (pgvector/pgvector:pg16) levantado y healthy
- [ ] Contenedor `app` (Next.js standalone build) levantado y healthy
- [ ] Contenedor `chat-service` (Socket.io) levantado y healthy
- [ ] Contenedor `caddy` (gateway) levantado y healthy
- [ ] Contenedor `redis` (socket.io adapter) levantado y healthy
- [ ] Contenedor `minio` levantado y healthy
- [ ] Contenedor `nocodb` levantado y healthy
- [ ] Contenedor `n8n` levantado y healthy
- [ ] (Opcional) Contenedor `ollama` levantado si algún tenant lo usa
- [ ] (Opcional) Contenedor `uptime-kuma` levantado con profile `monitoring`
- [ ] Todos los contenedores se reinician automáticamente en caso de crash (`restart: unless-stopped`)

### DNS y red

- [ ] ⚠️ Registro DNS A/AAAA apuntando al servidor para el dominio (`commerceflow.indisutex.com`)
- [ ] ⚠️ Registro DNS A/AAAA apuntando al servidor para el subdominio wildcard (`*.commerceflow.indisutex.com`) si se usan subdominios por tenant
- [ ] Puerto 80 abierto en el firewall (para HTTP → HTTPS redirect)
- [ ] Puerto 443 abierto en el firewall (para HTTPS)
- [ ] Puertos 22 (SSH), 80, 443 son los ÚNICOS abiertos al público
- [ ] Puertos internos (5432, 6379, 9000, 3000, 3003, 3001, 5678) NO expuestos al público — solo en la red Docker interna

### SSL / TLS

- [ ] ⚠️ Caddy obtuvo certificados automáticamente (Let's Encrypt / ZeroSSL)
- [ ] HTTPS responde con cert válido en `https://commerceflow.indisutex.com`
- [ ] HTTP → HTTPS redirect funciona (`curl http://commerceflow.indisutex.com` devuelve 301 a `https://`)
- [ ] HSTS habilitado en `Caddyfile.prod`
- [ ] TLS 1.2+ únicamente (TLS 1.0/1.1 deshabilitados)
- [ ] Cipher suites modernas (verificar con `https://www.ssllabs.com/ssltest/`)

### Recursos del servidor

- [ ] Mínimo 4 vCPU
- [ ] Mínimo 8 GB RAM
- [ ] Mínimo 50 GB disco SSD
- [ ] Swap de 4 GB configurado
- [ ] Disk usage < 70% después del deploy
- [ ] CPU usage < 50% en idle

---

## 2. Base de datos

### PostgreSQL

- [ ] ⚠️ PostgreSQL 15+ corriendo (contenedor `pgvector/pgvector:pg16`)
- [ ] ⚠️ `POSTGRES_PASSWORD` es una contraseña fuerte (mínimo 24 caracteres, generada con `openssl rand -hex 24`)
- [ ] ⚠️ `POSTGRES_USER` no es `postgres` (usar `commerceflow` o similar)
- [ ] Database `commerceflow` creada
- [ ] Conexión desde la app funciona (`curl /api/health` → `database: ok`)

### Schema y migraciones

- [ ] ⚠️ `prisma migrate deploy` ejecutado con éxito
- [ ] Las 31 tablas creadas (verificar con `\dt` en psql)
- [ ] `prisma/sql/pgvector-setup.sql` ejecutado
  - [ ] `CREATE EXTENSION vector` aplicada
  - [ ] `CREATE EXTENSION pgcrypto` aplicada
  - [ ] Conversión `bytea → vector` creada
  - [ ] HNSW indexes (m=16, ef_construction=64) creados en `Message.embedding`, `Product.embeddingTexto`, `Product.embeddingVisual`
  - [ ] Funciones `semantic_memory_search` y `semantic_memory_search_vec` creadas
- [ ] `prisma/sql/rls-policies.sql` ejecutado
  - [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` aplicado en las 19 tablas multi-tenant
  - [ ] `ALTER TABLE ... FORCE ROW LEVEL SECURITY` aplicado (RLS aplica incluso al owner)
  - [ ] `CREATE POLICY tenant_isolation_*` creada en cada tabla
  - [ ] Rol de aplicación creado (NO superuser)
  - [ ] App se conecta con el rol no-superuser

### Backups

- [ ] ⚠️ Backup automático configurado (al menos diario, preferible cada 6h)
- [ ] Backups retenidos por 30 días mínimo
- [ ] Backup incluye tanto el dump SQL como el WAL archiving
- [ ] Restauración de backup probada al menos 1 vez (en servidor staging)
- [ ] Procedimiento de restore documentado y accesible al equipo de ops

### Performance

- [ ] `shared_buffers` = 25% de RAM total
- [ ] `effective_cache_size` = 75% de RAM total
- [ ] `work_mem` = 16 MB
- [ ] `maintenance_work_mem` = 1 GB
- [ ] Conexiones pooling configurado (PgBouncer si es necesario)

---

## 3. Datos

### Seed inicial

- [ ] Seed base ejecutado: `bun run prisma/seed.ts` (4 marcas Indisutex + tenant INTL)
- [ ] 5 tenants activos visibles en `GET /api/tenants`
- [ ] Catálogo Saramantha cargado (7 productos con imágenes)
- [ ] Volume prices por tramo cargados
- [ ] SalesSpeech por 4 perfiles cargados
- [ ] 5 objection types cargados
- [ ] 2 themes cargados (Stitch, Hello Kitty)
- [ ] 5 carriers canónicos con variantes cargados

### Pedidos reales

- [ ] 239 pedidos cargados vía `scripts/load-real-orders.ts` (o CSV fresco del CRM)
- [ ] GMV verificado: $32,647,242 COP (0.3% tolerancia)
- [ ] AOV verificado: $137,173 COP (0.1% tolerancia)
- [ ] Embudo §15.1 verificado: 174/21/15/3 (tolerancia ±2)
- [ ] 6 variantes de Interrapidísimo presentes en Shipments
- [ ] 8 ciudades con conteos correctos

### Embeddings

- [ ] `scripts/backfill-embeddings.ts` ejecutado
- [ ] Todos los `Message` tienen `embedding` no nulo
- [ ] Búsqueda semántica funciona: `GET /api/conversations/search?q=familia` devuelve score > 0
- [ ] (Solo prod) Embeddings migrados a `vector(1024)` nativo pgvector
- [ ] HNSW index efectivo (verificar con `EXPLAIN ANALYZE` que usa `Index Scan` y no `Seq Scan`)

### Mensajes

- [ ] `scripts/fix-saramantha-messages.ts` ejecutado
- [ ] Franjas de metadata visibles en imágenes de productos (Saramantha §4)

---

## 4. Integraciones

### n8n workflows

- [ ] Contenedor n8n accesible en `https://commerceflow.indisutex.com/n8n/`
- [ ] Login admin de n8n configurado con password fuerte
- [ ] Los 11 workflows importados (ver `n8n-workflows/README.md`):
  - [ ] `10-agentes-conversacionales.json` (master)
  - [ ] `agent-profile.json`
  - [ ] `agent-speech.json`
  - [ ] `agent-quote.json`
  - [ ] `agent-catalog.json`
  - [ ] `agent-theme.json`
  - [ ] `agent-objection.json`
  - [ ] `agent-address.json`
  - [ ] `agent-logistics.json`
  - [ ] `agent-vision.json`
  - [ ] `agent-checkout.json`
- [ ] Cada workflow activado
- [ ] Webhook URLs de n8n registradas y verificadas con `curl`
- [ ] Credenciales de LLM providers configuradas en n8n (si workflows las llaman directo)

### NocoDB

- [ ] Contenedor NocoDB accesible en `https://commerceflow.indisutex.com/nocodb/`
- [ ] Proyecto `commerceflow` creado
- [ ] Tabla `orders` creada con columnas mapeadas al schema Prisma
- [ ] Webhook saliente de NocoDB → CommerceFlow configurado con header `X-NocoDB-Secret`
- [ ] Webhook entrante de CommerceFlow → NocoDB configurado
- [ ] `NOCODB_WEBHOOK_SECRET` coincide en ambos extremos
- [ ] Prueba end-to-end: editar pedido en NocoDB → ver reflejado en Kanban CommerceFlow

### Webhooks Meta (WhatsApp + Messenger + Instagram)

- [ ] ⚠️ App de Meta creada en developers.facebook.com
- [ ] ⚠️ WhatsApp Business API verificada (subir documentos de empresa)
- [ ] ⚠️ `META_APP_SECRET` configurado en `.env` (habilita HMAC verification)
- [ ] Webhook WhatsApp suscrito a URL `https://commerceflow.indisutex.com/api/webhooks/whatsapp`
- [ ] Webhook Meta (Messenger+Instagram) suscrito a URL `https://commerceflow.indisutex.com/api/webhooks/meta`
- [ ] Verify tokens (`WA_VERIFY_TOKEN`, `META_VERIFY_TOKEN`) coinciden con Meta dashboard
- [ ] Webhook handshake verificado (Meta dashboard muestra "Active")
- [ ] Permisos aprobados: `whatsapp_business_messaging`, `pages_messaging`, `instagram_manage_messages`
- [ ] Prueba end-to-end: enviar mensaje WhatsApp → ver aparece en Mensajería

### Adaptadores externos (por tenant)

Para cada tenant con plataforma/BD/proveedor externo:

- [ ] Tenant Saramantha: WhatsApp Catalog activo (default, sin creds externas)
- [ ] Tenant Majestic: plataforma/BD configurada
- [ ] Tenant Lovely: plataforma/BD configurada
- [ ] Tenant Reina: plataforma/BD configurada
- [ ] Variables de entorno de adapters configuradas según los tenants activos:
  - [ ] `WOOCOMMERCE_*` si algún tenant usa WooCommerce
  - [ ] `SHOPIFY_*` si algún tenant usa Shopify
  - [ ] `SUPABASE_*` si algún tenant usa Supabase
  - [ ] `ORACLE_*` si algún tenant usa Oracle
  - [ ] `DROPI_API_KEY` si algún tenant usa Dropi
  - [ ] `ENVIOS99_API_KEY` si algún tenant usa 99envios
  - [ ] `AVEONLINE_API_KEY` si algún tenant usa Aveonline

### LLM Providers

- [ ] Zai (default) siempre disponible (no requiere creds)
- [ ] `OPENAI_API_KEY` configurado si algún tenant tiene `proveedorIa='chatgpt'`
- [ ] `XAI_API_KEY` configurado si algún tenant tiene `proveedorIa='xai'`
- [ ] `OLLAMA_BASE_URL` configurado si algún tenant tiene `proveedorIa='ollama'`
- [ ] Health check de LLM pasa: `curl /api/health | jq '.checks[] | select(.name | startswith("llm"))'` → todos `ok`

### Uptime Kuma

- [ ] Contenedor `uptime-kuma` levantado (profile `monitoring`)
- [ ] Uptime Kuma accesible (idealmente en una URL interna o detrás de auth)
- [ ] Monitor HTTP configurado apuntando a `https://commerceflow.indisutex.com/api/health/uptime`
- [ ] Intervalo de check: 60s
- [ ] Notificaciones configuradas (email / Slack / Telegram)
- [ ] Probar downtime: detener app, verificar que Uptime Kuma alerta en <2min

---

## 5. Seguridad

### Secretos y credenciales

- [ ] ⚠️ TODAS las contraseñas generadas con `openssl rand -hex 32` o similar (NO humanas)
- [ ] ⚠️ `NEXTAUTH_SECRET` único y secreto
- [ ] ⚠️ `N8N_ENCRYPTION_KEY` único y secreto
- [ ] ⚠️ `POSTGRES_PASSWORD` mínimo 24 caracteres
- [ ] ⚠️ `MINIO_ROOT_PASSWORD` mínimo 24 caracteres
- [ ] `META_APP_SECRET` configurado (HMAC webhooks)
- [ ] `NOCODB_WEBHOOK_SECRET` único y secreto
- [ ] `WA_VERIFY_TOKEN` y `META_VERIFY_TOKEN` únicos y diferentes entre sí
- [ ] `.env` tiene permisos `600` (solo owner lee/escribe)
- [ ] `.env` NO está commiteado al repo (verificar `git log --all -- .env` está vacío)
- [ ] Backups de `.env` almacenados de forma segura (password manager, no en texto plano)

### Webhooks

- [ ] ⚠️ `META_APP_SECRET` configurado → HMAC verification activa en `/api/webhooks/whatsapp` y `/api/webhooks/meta`
- [ ] `/api/webhooks/nocodb-in` rechaza requests sin header `X-NocoDB-Secret` válido (probar con `curl` sin header → 403)
- [ ] Verify tokens NO son strings triviales (`commerceflow_verify` está prohibido en prod)

### RLS y aislamiento multi-tenant

- [ ] ⚠️ `prisma/sql/rls-policies.sql` ejecutado contra Postgres
- [ ] Rol de aplicación NO es superuser (`SELECT rolname, rolsuper FROM pg_roles WHERE rolname='commerceflow'` → `rolsuper = false`)
- [ ] `FORCE ROW LEVEL SECURITY` aplicado (RLS aplica incluso al owner)
- [ ] Test de aislamiento: insertar row con `tenantId='ten-A'`, hacer query con `SET LOCAL app.tenant_id='ten-B'` → no retorna la row
- [ ] `src/lib/rls.ts` `withTenant(db, tenantId, fn)` usado en TODAS las queries de API routes

### Firewalls y red

- [ ] ⚠️ Solo puertos 22, 80, 443 expuestos al público
- [ ] Postgres (5432) SOLO accesible desde la red Docker interna
- [ ] MinIO (9000) SOLO accesible vía Caddy (no directo)
- [ ] n8n (5678) SOLO accesible vía Caddy
- [ ] NocoDB (8080) SOLO accesible vía Caddy
- [ ] Socket.io (3003) SOLO accesible vía Caddy (`?XTransformPort=3003`)
- [ ] SSH inhabilitado para root (`PermitRootLogin no`)
- [ ] SSH requiere key-based auth (no password)
- [ ] Fail2ban o equivalente instalado para SSH brute-force

### Headers HTTP

- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HSTS)
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `Content-Security-Policy: default-src 'self'; ...` (configurar apropiadamente)
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`

### Cumplimiento

- [ ] Política de retención de datos documentada (conversaciones 2 años, audit logs 5 años, pedidos 10 años)
- [ ] Endpoints de "derecho al olvido" (Ley 1581 / GDPR) accesibles
- [ ] DPA (Data Processing Agreement) disponible para tenants EU
- [ ] Log de consentimiento de tenants para cross-border data transfer (OpenAI, xAI)

---

## 6. Verificación (durante el cutover)

Ejecutar en orden. Si algo falla, NO continuar con el cutover.

### Smoke tests críticos

- [ ] `curl https://commerceflow.indisutex.com/api/health/uptime` → 200 OK con `dbLatencyMs < 50`
- [ ] `curl https://commerceflow.indisutex.com/api/health` → 200 OK con `summary.error == 0`
- [ ] `curl https://commerceflow.indisutex.com/api/tenants` → 200 OK con 5 tenants
- [ ] `curl "https://commerceflow.indisutex.com/api/overview?tenantId=ten-saramantha"` → 200 OK con KPIs coherentes
- [ ] `curl "https://commerceflow.indisutex.com/api/orders?tenantId=ten-saramantha&limit=5"` → 200 OK
- [ ] `curl "https://commerceflow.indisutex.com/api/ads?tenantId=ten-saramantha"` → 200 OK con verdicts
- [ ] `curl "https://commerceflow.indisutex.com/api/monetization/gmv?tenantId=ten-saramantha"` → 200 OK con GMV $32M+
- [ ] `curl "https://commerceflow.indisutex.com/api/metrics?tenantId=ten-saramantha"` → 200 OK con margen 60%+

### Webhook verification

- [ ] Handshake WhatsApp: Meta dashboard muestra "Active"
- [ ] Handshake Messenger: Meta dashboard muestra "Active"
- [ ] Test inbound: enviar WhatsApp → aparece en Mensajería < 5s
- [ ] HMAC verification: enviar webhook sin `X-Hub-Signature-256` → 403

### Socket.io verification

- [ ] Browser se conecta a `wss://commerceflow.indisutex.com/?XTransformPort=3003`
- [ ] Mensaje enviado desde Mensajería → broadcast a otros clientes conectados
- [ ] Auto-reply simulado deshabilitado en prod (solo dev)

### Agentes IA

- [ ] `curl https://commerceflow.indisutex.com/api/agents` → 200 OK con 10 agentes
- [ ] Llamar a `POST /api/agents/speech` con `tenantId=ten-saramantha` → 200 OK en <5s con reply coherente
- [ ] Llamar a `POST /api/agents/quote` con items → 200 OK con formato "pagas $X → vendes $Y → margen $Z"
- [ ] Llamar a `POST /api/agents/vision` con imageUrl → 200 OK con JSON `{sku, confianza, metodo}`

### Kanban

- [ ] Vista Kanban carga con 8 columnas
- [ ] Cards distribuidas: 174 en "Llamar para confirmar", 21 en "Intento cancelación", 15 en "Datos completados", 3 en "Despachado"
- [ ] Drag & drop mueve card de "Datos completados" → "Despachado" y crea CommissionEntry al 100%
- [ ] Audit log registra la acción

### Adaptadores

- [ ] `POST /api/catalog/sync` con `tenantId=ten-saramantha` → 200 OK con `synced: 7`
- [ ] `POST /api/shipping/quote` con `ciudad=Bogotá` → 200 OK con tarifa > 0
- [ ] (Si tenant tiene HTTP real configurado) `POST /api/shipping/guide` genera guía y actualiza `Order.status='shipped'`

### Orquestador

- [ ] `POST /api/orchestrate` con `mode=full` y `scenario=indisutex_wa_catalog` → 200 OK en <30s con history de 9 entries
- [ ] Cada step tiene reply no vacío (no fallback de timeout)

### Conciliación

- [ ] `GET /api/conciliation?tenantId=ten-saramantha` → 200 OK con `riskLevel` y `gapPct`
- [ ] Si `riskLevel='high'` (gap > 15%), notificar al equipo de finanzas

---

## 7. Post-deploy (primera semana)

### Monitoreo

- [ ] Uptime Kuma alerta configurada para `/api/health/uptime` cada 60s
- [ ] Uptime Kuma alerta configurada para `/api/health` cada 5min (con `summary.error == 0`)
- [ ] Alertas de CPU > 80% por 5min
- [ ] Alertas de RAM > 80% por 5min
- [ ] Alertas de disk > 70%
- [ ] Alertas de Postgres connections > 80% del max
- [ ] Logs centralizados (Loki / CloudWatch / Datadog)
- [ ] Dashboard de monitoreo creado y accesible al equipo de ops

### Backups automatizados

- [ ] Cron de backup Postgres configurado (al menos diario, preferible cada 6h)
- [ ] Backups retenidos por 30 días
- [ ] Backup de `.env` y configs de Caddy en password manager
- [ ] Backup de workflows n8n exportados como JSON
- [ ] Test de restore ejecutado en servidor staging

### Auditoría

- [ ] Revisar `AuditLog` semanalmente en busca de:
  - Múltiples `ad.kill` del mismo anuncio (puede indicar bugs)
  - `webhook.wa.inbound` sin messages correspondientes (webhook caído)
  - `tenant.created` inesperados (onboarding no autorizado)
- [ ] Revisar `/api/conciliation` semanalmente — si `gapPct > 15%`, investigar

### Performance

- [ ] Después de 7 días de tráfico real, revisar p95 de:
  - `/api/overview` < 500ms
  - `/api/agents/[name]` < 5000ms
  - `/api/conversations/search` < 200ms (con pgvector)
  - `/api/shipping/quote` < 1000ms
- [ ] Si algún endpoint excede p95, optimizar (index, cache, query plan)
- [ ] Verificar que el dev server del equipo de desarrollo sigue corriendo sin warnings nuevas

### Operaciones

- [ ] Runbook de incidentes documentado y accesible
- [ ] Procedimiento de rollback documentado (regresar a versión anterior de la app)
- [ ] Equipo de on-call entrenado (al menos 2 personas)
- [ ] Contacto de escalación con Meta (para problemas de WhatsApp Business API)
- [ ] Contacto de escalación con proveedores logísticos (Dropi / 99envios / Aveonline)
- [ ] Contacto de escalación con LLM providers (OpenAI / xAI)

### Documentación operativa

- [ ] Diagrama de arquitectura actualizado
- [ ] Lista de servicios y URLs internas/externas
- [ ] Lista de variables de entorno activas (sin valores, solo nombres)
- [ ] Procedimiento de rotación de secretos documentado
- [ ] Procedimiento de agregar un tenant nuevo documentado (onboarding wizard)

---

## 🎯 Criterios de go-live

**PUEDES ir a producción** si:

- ✅ Todos los ítems marcados ⚠️ están completos
- ✅ Todas las secciones 1-5 tienen al menos 90% de ítems completos
- ✅ La sección 6 (Verificación) pasa al 100%
- ✅ Hay un plan para completar la sección 7 (Post-deploy) en la primera semana

**NO PUEDES ir a producción** si:

- ❌ Cualquier ítem ⚠️ está pendiente
- ❌ `META_APP_SECRET` no está configurado (webhooks sin firma)
- ❌ RLS no está habilitado (aislamiento multi-tenant en riesgo)
- ❌ Backups no están configurados (pérdida de datos en riesgo)
- ❌ Cualquier smoke test de la sección 6 falla

---

## 🆘 Rollback

Si algo crítico falla después del cutover:

1. **Comunicar**: notificar al equipo de ops y al stakeholder del tenant afectado.
2. **Rollback de la app**:
   ```bash
   # En el servidor
   git checkout <previous-tag>
   docker compose build app
   docker compose up -d app
   ```
3. **Rollback de DB** (solo si el schema cambió):
   ```bash
   # Restaurar backup pre-cutover
   docker exec -i commerceflow-postgres psql -U commerceflow -d commerceflow < /backups/pre-cutover-YYYYMMDD.sql
   ```
4. **Verificar**: ejecutar smoke tests de la sección 6.
5. **Postmortem**: documentar el incidente en `worklog.md` con causa raíz y prevención.

---

## 📞 Contactos de emergencia

- **Equipo de ops (Indisutex)**: `ops@indisutex.com` / +57 XXX XXX XXXX
- **Security incidents**: `security@indisutex.com` (ver [`../SECURITY.md`](../SECURITY.md))
- **Meta WhatsApp Business**: a través de Business Support Center
- **n8n community**: https://community.n8n.io
- **Prisma support**: via GitHub issues para problemas del ORM

---

**Última actualización**: 2026-01-15
