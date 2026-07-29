# Política de Seguridad — ZIAY

La seguridad de ZIAY (ZIAY SAS) y de los datos de nuestros tenants es una prioridad crítica. Este documento describe qué está protegido, cómo reportar vulnerabilidades y qué esperar del proceso de divulgación responsable.

> **v0.4.0 (2026-07-18) — Comercio Agéntico + Fintech Hardened**: este documento refleja los controles de seguridad tras 3 iteraciones de auditoría fintech (V1 5.5/10 → V3 8.8/10) + 4 dimensiones de auditoría full (security / code-quality / testing / UX-SEO-docs-deploy). 13 issues de seguridad cerrados, 28 riesgos fintech resueltos (96.4%), 9 rutas cross-tenant bypass cerradas, 35 políticas RLS activas, anti-fraude full-service, cifrado AES-256-GCM para credenciales, y resolución fail-closed de secretos en producción.

---

## 📋 Tabla de contenidos

- [Versiones soportadas](#versiones-soportadas)
- [Qué está protegido](#qué-está-protegido)
- [Reportar una vulnerabilidad](#reportar-una-vulnerabilidad)
- [Proceso de divulgación responsable](#proceso-de-divulgación-responsable)
- [Buenas prácticas para operadores](#buenas-prácticas-para-operadores)
- [Cumplimiento normativo](#cumplimiento-normativo)
- [Contacto](#contacto)

---

## Versiones soportadas

| Versión | Estado | Soporte de seguridad |
|---------|--------|----------------------|
| `0.4.x` | ✅ Current (2026-07-18) | Soporte completo — fintech hardened |
| `0.3.x` | ⚠️ Mantenimiento | Solo patches críticos — se recomienda migrar a 0.4.x |
| `< 0.3` | ❌ No soportada | Actualizar obligatoriamente — múltiples vulnerabilidades cross-tenant conocidas |

Solo se aplican patches de seguridad a la versión más reciente de la rama `0.4.x`. Las versiones anteriores no reciben backports.

---

## Qué está protegido

### Aislamiento multi-tenant (RLS + app-layer guards)

Implementamos **defensa en profundidad de 3 capas** para garantizar que un tenant **nunca** pueda acceder a los datos de otro:

1. **App layer** — `requireTenantAccess(tenantId)` en cada ruta API (155 usages). Cualquier ruta sin este guard es un bug de seguridad. En v0.4.0 se cerraron **9 rutas con cross-tenant bypass** (`conversations/search`, `image-identifications`, `conversational-cart`, `vision-pipeline`, `address-analysis`, `attribution`, `llm-providers`, `onboarding`, `webhooks/nocodb-out`).
2. **ORM layer** — `makeTenantPrismaExtension()` Prisma `$extends` auto-inyecta `tenantId` en cada query.
3. **DB layer** — **35 políticas RLS** en PostgreSQL (`prisma/sql/rls-policies.sql`) — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en las **tablas multi-tenant** (incluyendo `fraud_blocklist`, `fraud_event`, `velocity_window`, `refund`). Cada `CREATE POLICY tenant_isolation_*` filtra por `current_setting('app.tenant_id')`.

- **`src/lib/rls.ts`** expone `withTenant(db, tenantId, fn)` y `createTenantScopedClient` que inyectan `SET LOCAL app.tenant_id` antes de cada query.
- El rol de aplicación **NO es superuser** — el `FORCE` garantiza que el RLS aplique incluso al owner de la tabla.
- En desarrollo (SQLite) el RLS no aplica (SQLite no lo soporta), pero el `tenantId` se incluye en cada `where`.
- **0 cross-tenant bypasses restantes** verificados en v0.4.0.

### Anti-fraud service (full)

El servicio `src/lib/services/fraud.service.ts` implementa defensa anti-fraude completa para todas las transacciones de pago:

- **Velocity checks** — sliding window por IP / email / card BIN (umbrales configurables via `VELOCITY_WINDOW_MINUTES` + `VELOCITY_MAX_ATTEMPTS`).
- **Blocklist** — email / phone / card BIN / IP. Sincronizado con webhooks de disputas (`recordChargeback` bloquea customer + email + phone + card BIN cuando llega un `charge.dispute.created`).
- **OFAC screening** — dual-pass: primario por `customerName` (alta sensibilidad, email reenviado), complementario por local-part del email. Cobertura ~80% de las transacciones.
- **3DS / SCA flagging** — marca transacciones de alto riesgo para forzar autenticación fuerte del cliente.
- **CVV / AVS result capture** — `applyPaymentUpdate` recibe `cvvResult` + `avsResult` para alimentar el score de fraude.
- **Chargeback loop** — `recordChargeback` añade al blocklist y decrementa el score del merchant.
- **`payment_mismatch` defense (R-6)** — si el monto reportado por la pasarela difiere de `order.total` por >1%, `applyPaymentUpdate` rechaza marcar el pedido como `paid` y lo deja en `payment_mismatch`.
- **`maskPii(type, value)`** — enmascara PII en logs (email, phone, card, ip) — cerrado en v0.4.0 (N-4).

### Credential encryption (AES-256-GCM at-rest)

Todas las credenciales por tenant se almacenan **cifradas** en la base de datos, no en claro:

- **`src/lib/crypto/secret-encryption.ts`** — cifrado simétrico AES-256-GCM.
- Cubre todas las llaves `cred::*` (`credencialesCatalogoRef`, `credencialesIaRef`, `credencialesLogisticaRef`, `wabaTokenRef`).
- Las credenciales se cifran **antes** del DB write y se descifran **on read** — la DB nunca contiene el plaintext.
- El `ENCRYPTION_KEY` es **obligatorio en producción** (fail-closed at boot en `src/lib/totp.ts` — throw + `captureError` a Sentry si falta). Generar con `openssl rand -hex 32`.
- Backward-compat preservado: el path de derivación de llave no cambió, los secretos TOTP existentes siguen siendo descifrables.

### Webhook signature verification (HMAC-SHA256 + 2-layer idempotency + rotation)

Todos los webhooks entrantes verifican firma y origen antes de procesar el payload. Adicionalmente, idempotencia de 2 capas y grace period para rotación de secretos.

| Webhook | Verificación | Variables |
|---------|--------------|-----------|
| `POST /api/webhooks/whatsapp` | `X-Hub-Signature-256` HMAC SHA-256 con `META_APP_SECRET` + verify token handshake | `WA_VERIFY_TOKEN`, `META_APP_SECRET` |
| `POST /api/webhooks/meta` | `X-Hub-Signature-256` HMAC SHA-256 con `META_APP_SECRET` + verify token handshake | `META_VERIFY_TOKEN`, `META_APP_SECRET` |
| `POST /api/webhooks/nocodb-in` | Token secreto compartido en header `X-NocoDB-Secret` | `NOCODB_WEBHOOK_SECRET` |
| `POST /api/webhooks/nocodb-out` | `X-NocoDB-Signature` HMAC-SHA256 sobre raw body con `NOCODB_WEBHOOK_SECRET` (v0.4.0 — era totalmente sin auth) | `NOCODB_WEBHOOK_SECRET` |
| `POST /api/webhooks/mercadopago` | HMAC + `verifyPayment` re-check (defense-in-depth) | `MP_WEBHOOK_SECRET` |
| `POST /api/webhooks/stripe` | HMAC + 3 nuevos branches: `charge.refunded` (sync Refund ledger), `charge.dispute.created` (recordChargeback + blocklist), `charge.dispute.closed` (OrderEvent audit) | `STRIPE_WEBHOOK_SECRET` |
| `POST /api/webhooks/wompi` | HMAC + idempotencia 2-capas | `WOMPI_WEBHOOK_SECRET` |
| `POST /api/webhooks/payu` | MD5 + `adapter.verifyPayment(txId)` re-check (v0.4.0 R-13 — defense-in-depth parity con MercadoPago) | `PAYU_WEBHOOK_SECRET` |
| `POST /api/webhooks/pse` / `pix` / `oxxo` / `spei` | HMAC + status polling | `*_WEBHOOK_SECRET` |

**Idempotencia 2 capas:** (1) in-memory Map (rápido, mismo proceso), (2) DB `AuditLog` con SHA-256 del body (persistente, sobrevive reinicios). Duplicados se descartan antes de procesar.

**Signature rotation grace period (ADR-0018):** los 4 webhooks de pago (MercadoPago, Wompi, Stripe, PayU) aceptan tanto `*_WEBHOOK_SECRET` (nuevo) como `*_WEBHOOK_SECRET_OLD` (anterior) durante una rotación. Permite rotar secretos sin perder webhooks in-flight.

### Fail-closed secret resolution in production

`src/lib/middleware/webhook-secrets.ts` (v0.4.0) es un resolver compartido que **falla cerrado** en producción:

- En `NODE_ENV=production`: si la variable de entorno falta, retorna `null` → el caller devuelve HTTP 500 (request rechazado).
- En dev: usa un default determinístico inseguro + `console.warn` explicando cómo generarlo.
- Reemplaza los fallbacks hardcoded `'commerceflow_nocodb'`, `'commerceflow_verify'`, `'ziay-dev-encryption-key-change-in-prod-32b!'` (todos eliminados del código runtime en v0.4.0).

```typescript
// src/lib/middleware/webhook-secrets.ts (resumen)
export function resolveNocodbSecret(): string | null {
  const secret = process.env.NOCODB_WEBHOOK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') return null; // caller returns 500
  console.warn('NOCODB_WEBHOOK_SECRET missing — using insecure dev default');
  return 'dev-nocodb-secret-change-me';
}
```

### AuditLog cold-storage export before deletion (R-14)

`src/lib/compliance/retention.ts` exporta los registros de `AuditLog` a cold-storage **antes** de eliminarlos:

- Formato: JSONL en `./data/cold-storage/auditlog-export-{YYYY-MM-DD}-{stamp}.jsonl`.
- SHA-256 checksum del archivo (tamper-evidence).
- Modelo Prisma `AuditLogExport` rastrea cada export.
- **Fail-closed**: si el export falla, los registros **NO se eliminan** (preservar evidencia > limpiar storage).
- Production TODO: migrar a S3/Glacier (formato JSONL idéntico).

### Gestión de secretos

- **NUNCA** se commitean secretos al repositorio. `.gitignore` excluye `.env`, `.env.local`, `.env.*.local`.
- Las credenciales por tenant (`credencialesCatalogoRef`, `credencialesIaRef`, `credencialesLogisticaRef`, `wabaTokenRef`) se almacenan **cifradas con AES-256-GCM** en la DB (ver sección "Credential encryption" arriba). En v0.4.0 se eliminó el patrón de "referencia a secrets manager externo" en favor del cifrado at-rest con `ENCRYPTION_KEY` (fail-closed en prod).
- El `.env.example` (v0.4.0, 135 vars en 14 categorías) solo contiene placeholders vacíos + defaults explícitamente marcados como inseguros en dev. 11 vars marcadas `# REQUIRED in production`.
- Las API keys de los adaptadores (`OPENAI_API_KEY`, `WOOCOMMERCE_CONSUMER_KEY`, etc.) se leen de `process.env` solo en el servidor — nunca se exponen al cliente (Next.js serializa solo las variables con prefijo `NEXT_PUBLIC_`).
- **Fail-closed en producción** para `ENCRYPTION_KEY`, `NOCODB_WEBHOOK_SECRET`, `WA_VERIFY_TOKEN`, `META_VERIFY_TOKEN`, `META_APP_SECRET` — sin ellos, el servicio falla al arrancar o rechaza requests con HTTP 500 (v0.4.0).

### Aislamiento de agentes IA (regla de oro §2 Saramantha)

Los **system prompts de los 10 agentes nunca contienen datos de negocio** (catálogo, precios, objeciones, discursos). Solo contienen instrucciones de comportamiento. Los datos se inyectan en el `user` message después de consultar la DB filtrada por `tenantId`.

Esto significa:
- Un prompt leak **no expone** datos de otros tenants.
- Un prompt injection **no puede** exfiltrar datos que el agente no tenga en su `user` message.
- El contexto de cada agente es explícito y auditable en el código (`src/lib/agents/prompts.ts`).

### Timeout y rate limiting en agentes

- **Cada llamada a un agente individual** tiene un timeout de **20s** (`/api/agents/[agentName]`).
- **Cada paso del orquestador** tiene un timeout de **15s** con fallback determinístico por agente (worst case total 135s).
- En caso de timeout o error del LLM, se devuelve un fallback determinístico (no se propaga el error al cliente).

### Audit log

Toda acción sensible escribe un `AuditLog` con `userId`, `tenantId`, `action`, `entity`, `entityId`, `meta`:

- Kill-switch de anuncios (`ad.kill`, `ad.pause`, `ad.scale`)
- Webhooks entrantes (`webhook.wa.inbound`, `webhook.meta.inbound`, `webhook.nocodb.in`)
- Generación de guías (`shipment.guide.generated`)
- Sincronización de catálogo (`catalog.sync`)
- Cambios de comisión (`commission.recognized.50`, `commission.recognized.100`)
- Onboarding de tenants (`tenant.created`)

### HTTPS obligatorio en producción

- **Caddy** termina TLS en el puerto 443 con certificados automáticos (Let's Encrypt / ZeroSSL).
- **Redirección 301** del puerto 80 al 443.
- **HSTS** habilitado en el Caddyfile.prod.
- Los webhooks de Meta requieren HTTPS — sin esto no se puede verificar la subscripción.

---

## Reportar una vulnerabilidad

### Proceso

1. **NO abras un issue público** en GitHub.
2. Envía un email a **security@ziay.co** con:
   - Asunto: `[SECURITY] ZIAY — <breve descripción>`
   - Cuerpo:
     - Descripción de la vulnerabilidad
     - Pasos para reproducir (POC si es posible)
     - Impacto estimado (CVSS si lo calculas)
     - Versión afectada
     - Sugerencia de mitigación (opcional pero apreciada)
3. Recibirás **confirmación de recepción en 48 horas hábiles**.
4. Trabajaremos contigo para validar y remediar la vulnerabilidad.

### Compromisos del equipo

- **Confirmación en 48 horas hábiles** desde el reporte.
- **Evaluación inicial en 7 días** con clasificación (Critical / High / Medium / Low).
- **Patch para Critical/High en 30 días** desde la confirmación.
- **Patch para Medium/Low en 90 días** desde la confirmación.
- **Crédito público** en el advisory (si lo deseas — también respetamos el anonimato).
- **Bounty / recompensa**: actualmente no tenemos un programa formal de bug bounty, pero reconocemos los reportes válidos con menciones y swag de ZIAY.

### Divulgación coordinada

- Una vez liberado el patch, publicaremos un **Security Advisory en GitHub** con la descripción, impacto y mitigación.
- **Esperamos 90 días** desde la confirmación del reporte antes de divulgar públicamente, dándote tiempo suficiente para aplicar el patch.
- Si necesitas más tiempo, coordina con nosotros — somos flexibles mientras haya progreso activo.

### Scope (en scope)

| Componente | En scope |
|------------|----------|
| API routes (`src/app/api/`) | ✅ |
| Adaptadores (`src/lib/adapters/`) | ✅ |
| Prompts de agentes (`src/lib/agents/prompts.ts`) | ✅ Solo bugs de aislamiento, no bypass de comportamiento |
| Schema Prisma + RLS (`prisma/sql/rls-policies.sql`) | ✅ Especialmente bypass de RLS |
| Webhooks (`src/app/api/webhooks/`) | ✅ Especialmente bypass de firma HMAC |
| Mini-service Socket.io (`mini-services/chat-service/`) | ✅ |
| Gateway Caddy (`Caddyfile`, `Caddyfile.prod`) | ✅ Solo config incluida en el repo |
| Docker compose (`docker-compose.yml`) | ✅ |
| Dependencias de terceros (npm) | ✅ Pero reporta primero al upstream |

### Out of scope

- Vulnerabilidades en dependencias de terceros **sin PoC** en ZIAY.
- Ataques que requieran acceso físico al servidor.
- Ataques DoS volumétricos (red).
- Clickjacking en iframes de terceros (no usamos iframes).
- Faltas de ortografía o problemas cosméticos.
- Reportes de herramientas automáticas (Snyk, Dependabot) sin análisis manual — para eso ya tenemos automatización.

---

## Proceso de divulgación responsable

Creemos en la transparencia. Cuando se descubre y remedia una vulnerabilidad:

1. **T+0**: Recibimos el reporte por email.
2. **T+48h**: Confirmación de recepción + clasificación inicial.
3. **T+7d**: Validación técnica + asignación de severity.
4. **T+30d** (Critical/High) o **T+90d** (Medium/Low): Patch liberado en una release.
5. **T+90d desde confirmación**: Advisory público en GitHub Security Advisories.
6. **T+90d**: Crédito al reporter (si lo autoriza).

---

## Buenas prácticas para operadores

Si estás desplegando ZIAY en producción, asegúrate de:

- ✅ **Generar `NEXTAUTH_SECRET`, `N8N_ENCRYPTION_KEY` y `ENCRYPTION_KEY`** con `openssl rand -hex 32`. NUNCA uses los valores del `.env.example`. **`ENCRYPTION_KEY` es OBLIGATORIO en v0.4.0** (fail-closed at boot en `src/lib/totp.ts`).
- ✅ **Cambiar `POSTGRES_PASSWORD` y `MINIO_ROOT_PASSWORD`** a contraseñas fuertes (mínimo 24 caracteres).
- ✅ **Configurar `META_APP_SECRET`, `NOCODB_WEBHOOK_SECRET`, `WA_VERIFY_TOKEN`, `META_VERIFY_TOKEN`** — todos son **fail-closed en producción** desde v0.4.0 (sin ellos, los webhooks devuelven HTTP 500).
- ✅ **Habilitar RLS** ejecutando `prisma/sql/rls-policies.sql` contra la base Postgres (35 políticas en v0.4.0).
- ✅ **Crear un rol de aplicación no-superuser** para que el `FORCE` del RLS aplique.
- ✅ **Habilitar pgvector** ejecutando `prisma/sql/pgvector-setup.sql`.
- ✅ **Migrar de SQLite a PostgreSQL** para producción (RLS solo funciona en Postgres). El schema Prisma es portable vía `scripts/db-push.ts` (auto-detección de provider).
- ✅ **Configurar firewall** para que solo Caddy escuche en 80/443, y los demás servicios (Postgres, MinIO, n8n, etc.) solo en la red interna de Docker.
- ✅ **Habilitar backup automático** de Postgres (al menos diario, retenido 30 días). El cold-storage de `AuditLog` (v0.4.0) escribe a `./data/cold-storage/` — migrar a S3/Glacier para producción.
- ✅ **Monitorear `/api/health` y `/api/health/uptime`** con Uptime Kuma o equivalente.
- ✅ **Configurar el cron de retención** (BullMQ job) — actualmente documentado como TODO, pero la lógica está en `src/lib/compliance/retention.ts`. Exporta AuditLog a cold-storage antes de borrar.
- ✅ **Rotar API keys** de LLM providers y adapters cada 90 días. Para webhooks de pago, usar el grace period de rotación (ADR-0018) — setear `*_WEBHOOK_SECRET_OLD` al secret anterior antes de rotar.
- ✅ **Revisar `AuditLog`** semanalmente en busca de actividad sospechosa (especialmente `webhook.wa.inbound`, `webhook.nocodb.in`, `ad.kill`, `tenant.created`).
- ✅ **Configurar las 10 variables anti-fraude** (`OFAC_API_KEY`, `VELOCITY_WINDOW_MINUTES`, `VELOCITY_MAX_ATTEMPTS`, `BLOCKLIST_TTL_DAYS`, `FRAUD_SCORE_THRESHOLD`, etc.) — ver `.env.example` sección "Anti-Fraud".

---

## Cumplimiento normativo

### Colombia — Ley 1581 de 2012 (Habeas Data)

- Los datos personales de los customers (nombre, teléfono, dirección) se almacenan en la tabla `Customer` con `tenantId` para aislamiento.
- **Derecho al olvido**: implementado vía endpoint interno que ejecuta `Customer.delete()` + cascade de conversaciones y mensajes (soft-delete disponible como opción).
- **Retention policy**: configurable por tenant. Por defecto: conversaciones 2 años, audit logs 5 años, pedidos 10 años (requisito fiscal).

### Unión Europea — GDPR

- Aplica a los tenants con `tenant.country` en EU (ej. tenant INTL).
- **Data Processing Agreement (DPA)** disponible para tenants EU.
- **Cross-border transfer**: las API keys de OpenAI y xAI implican transferencia a EEUU. Los tenants EU deben consentir esto en el onboarding.
- **Right to be forgotten**: mismo endpoint que Ley 1581.
- **Data portability**: endpoint `GET /api/conversations?customerId=X` devuelve todos los datos del customer en JSON.

### PCI DSS

- **No almacenamos datos de tarjetas de crédito**. Los pagos se procesan vía pasarelas externas (Wompi, MercadoPago, Stripe, PayU + 4 locales: PSE/PIX/OXXO/SPEI) que redirigen al cliente.
- Solo almacenamos `paymentGateway`, `paymentRef` (ID de la transacción en la pasarela) y `paidAt` en la tabla `Order`.
- En v0.4.0 capturamos `cvvResult` + `avsResult` (resultado de verificación, no los datos sensibles) para alimentar el anti-fraud service.
- El `payment_mismatch` defense (R-6) previene marcación fraudulenta de pedidos como `paid` si el monto reportado difiere del `order.total` por >1%.

### LATAM — Compliance fintech

- **Colombia (DIAN)**: implementación completa con Alegra adapter (ADR-0020) — `submitToDian()` genera CUFE (SHA-384) y envía a DIAN. Retry job con exponential backoff (`dianBackoffMs(n) = min(5·2^n, 1440) min`, cap 24h en retry 9).
- **Ley 1480 Art 47 (Derecho al retracto)**: implementado con reembolso automático fire-and-forget (ADR-0019) — `processRetracto()` llama al payment adapter después del `$transaction` commit.
- **OFAC screening**: el anti-fraud service hace dual-pass OFAC por `customerName` + complementario por email local-part (v0.4.0, N-3).
- **Anti-fraud full-service**: velocity, blocklist, 3DS/SCA, CVV/AVS, chargeback loop — ver sección "Anti-fraud service" arriba.
- **Refund ledger**: modelo `Refund` con 2-layer idempotency en `gatewayRef` (pre-create check dentro de `$transaction` + post-gateway check).
- **Escrow (ADR-0021, Proposed)**: diseño de `EscrowHolding` model + 7-day auto-release cron. Implementación pendiente en un sprint de seguimiento.

### Auditoría iterativa (transparencia)

ZIAY fue auditado en 3 iteraciones (V1 5.5/10 → V2 7.7/10 → V3 8.8/10 → V3.1 ~9.0) más una auditoría full de 4 dimensiones (security / code-quality / testing / UX-SEO-docs-deploy). Los reportes están en `public/presentaciones/`:

- `AUDITORIA-FINTECH.md` (V1)
- `AUDITORIA-FINTECH-V2.md` (V2)
- `AUDITORIA-FINTECH-V3-FINAL.md` (V3 final — 8 secciones)
- `AUDITORIA-FULL-SECURITY-CODE-TEST.md` (security / code-quality / testing)
- `AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md` (UX / SEO / docs / deploy)

---

## Contacto

- **Email de seguridad**: `security@ziay.co`
- **PGP key**: disponible bajo pedido (fingerprint en el footer del sitio)
- **Response time SLA**: 48 horas hábiles para confirmación de recepción
- **Languages**: Español, English

Para preguntas generales (no vulnerabilidades), usa las issues de GitHub.

---

**Última actualización**: 2026-07-18 (v0.4.0 — Comercio Agéntico + Fintech Hardened)
**Próxima revisión**: 2027-01-18 (o antes si se descubre una vulnerabilidad Critical/High)
**Audit score**: 8.8/10 (independent fintech audit, 3 iterations)
**CI status**: 6/6 jobs green (lint, typecheck, unit-tests, openapi, build, e2e)
