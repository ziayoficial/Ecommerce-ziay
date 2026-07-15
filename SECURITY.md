# Política de Seguridad — CommerceFlow OS

La seguridad de CommerceFlow OS y de los datos de nuestros tenants es una prioridad crítica. Este documento describe qué está protegido, cómo reportar vulnerabilidades y qué esperar del proceso de divulgación responsable.

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
| `1.0.x` | ✅ Current | Soporte completo |
| `< 1.0` | ❌ No soportada | Actualizar obligatoriamente |

Solo se aplican patches de seguridad a la versión más reciente de la rama `1.x`. Las versiones mayores anteriores no reciben backports.

---

## Qué está protegido

### Aislamiento multi-tenant (RLS)

Implementamos **Row Level Security a nivel de base de datos** en PostgreSQL para garantizar que un tenant **nunca** pueda acceder a los datos de otro, incluso si hay un bug en el código de la aplicación.

- **`prisma/sql/rls-policies.sql`** aplica `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` en las **19 tablas multi-tenant**.
- Cada `CREATE POLICY tenant_isolation_*` filtra por `current_setting('app.tenant_id')`.
- **`src/lib/rls.ts`** expone `withTenant(db, tenantId, fn)` y `createTenantScopedClient` que inyectan `SET LOCAL app.tenant_id` antes de cada query.
- El rol de aplicación **NO es superuser** — el `FORCE` garantiza que el RLS aplique incluso al owner de la tabla.
- En desarrollo (SQLite) el RLS no aplica (SQLite no lo soporta), pero el `tenantId` se incluye en cada `where`.

### Verificación de webhooks (HMAC + verify token)

Todos los webhooks entrantes verifican firma y origen antes de procesar el payload:

| Webhook | Verificación | Variables |
|---------|--------------|-----------|
| `POST /api/webhooks/whatsapp` | `X-Hub-Signature-256` HMAC SHA-256 con `META_APP_SECRET` + verify token handshake | `WA_VERIFY_TOKEN`, `META_APP_SECRET` |
| `POST /api/webhooks/meta` | `X-Hub-Signature-256` HMAC SHA-256 con `META_APP_SECRET` + verify token handshake | `META_VERIFY_TOKEN`, `META_APP_SECRET` |
| `POST /api/webhooks/nocodb-in` | Token secreto compartido en header `X-NocoDB-Secret` | `NOCODB_WEBHOOK_SECRET` |

```typescript
// Ejemplo del patrón de verificación HMAC (en /api/webhooks/whatsapp)
const appSecret = process.env.META_APP_SECRET
const rawBody = await req.text()

if (appSecret) {
  const signature = req.headers.get('x-hub-signature-256') || ''
  const expectedSignature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
  if (signature !== expectedSignature) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }
}
```

> ⚠️ Si `META_APP_SECRET` no está configurada (modo dev), solo se valida el verify token. En producción esta variable es **obligatoria**.

### Gestión de secretos

- **NUNCA** se commitean secretos al repositorio. `.gitignore` excluye `.env`, `.env.local`, `.env.*.local`.
- Las credenciales por tenant (`credencialesCatalogoRef`, `credencialesIaRef`, `credencialesLogisticaRef`, `wabaTokenRef`) son **referencias** a un secrets manager (Vault / AWS Secrets Manager / Doppler), no valores en claro en la DB.
- El `.env.example` solo contiene placeholders vacíos.
- Las API keys de los adaptadores (`OPENAI_API_KEY`, `WOOCOMMERCE_CONSUMER_KEY`, etc.) se leen de `process.env` solo en el servidor — nunca se exponen al cliente (Next.js serializa solo las variables con prefijo `NEXT_PUBLIC_`).

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
2. Envía un email a **security@indisutex.com** con:
   - Asunto: `[SECURITY] CommerceFlow OS — <breve descripción>`
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
- **Bounty / recompensa**: actualmente no tenemos un programa formal de bug bounty, pero reconocemos los reportes válidos con menciones y swag de CommerceFlow OS.

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

- Vulnerabilidades en dependencias de terceros **sin PoC** en CommerceFlow OS.
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

Si estás desplegando CommerceFlow OS en producción, asegúrate de:

- ✅ **Generar `NEXTAUTH_SECRET` y `N8N_ENCRYPTION_KEY`** con `openssl rand -hex 32`. NUNCA uses los valores del `.env.example`.
- ✅ **Cambiar `POSTGRES_PASSWORD` y `MINIO_ROOT_PASSWORD`** a contraseñas fuertes (mínimo 24 caracteres).
- ✅ **Configurar `META_APP_SECRET`** para que los webhooks verifiquen HMAC signature.
- ✅ **Cambiar `WA_VERIFY_TOKEN` y `META_VERIFY_TOKEN`** a valores únicos y secretos.
- ✅ **Cambiar `NOCODB_WEBHOOK_SECRET`** a un valor aleatorio.
- ✅ **Habilitar RLS** ejecutando `prisma/sql/rls-policies.sql` contra la base Postgres.
- ✅ **Crear un rol de aplicación no-superuser** para que el `FORCE` del RLS aplique.
- ✅ **Habilitar pgvector** ejecutando `prisma/sql/pgvector-setup.sql`.
- ✅ **Configurar firewall** para que solo Caddy escuche en 80/443, y los demás servicios (Postgres, MinIO, n8n, etc.) solo en la red interna de Docker.
- ✅ **Habilitar backup automático** de Postgres (al menos diario, retenido 30 días).
- ✅ **Monitorear `/api/health` y `/api/health/uptime`** con Uptime Kuma o equivalente.
- ✅ **Rotar API keys** de LLM providers y adapters cada 90 días.
- ✅ **Revisar `AuditLog`** semanalmente en busca de actividad sospechosa.

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

- **No almacenamos datos de tarjetas de crédito**. Los pagos se procesan vía pasarelas externas (Wompi, MercadoPago, Stripe) que redirigen al cliente.
- Solo almacenamos `paymentGateway`, `paymentRef` (ID de la transacción en la pasarela) y `paidAt` en la tabla `Order`.

---

## Contacto

- **Email de seguridad**: `security@indisutex.com`
- **PGP key**: disponible bajo pedido (fingerprint en el footer del sitio)
- **Response time SLA**: 48 horas hábiles para confirmación de recepción
- **Languages**: Español, English

Para preguntas generales (no vulnerabilidades), usa las issues de GitHub.

---

**Última actualización**: 2026-01-15
**Próxima revisión**: 2026-07-15
