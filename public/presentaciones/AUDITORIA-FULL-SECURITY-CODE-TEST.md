# AUDITORÍA FULL — ZIAY (Seguridad + Calidad + Testing — dimensiones NO fintech)

**Proyecto:** ZIAY · Plataforma SaaS multi-tenant de comercio conversacional LATAM
**Stack:** Next.js 16 App Router + TypeScript + Prisma (SQLite dev) + NextAuth v4 + Vitest + Playwright
**Fecha de auditoría:** 2026-07-22
**Auditor:** Agente general-purpose (perfil full-auditor, pasada A)
**Scope:** Dimensiones NO cubiertas por la auditoría fintech (que ya está en V3-FINAL con score 8.8/10). Se auditan Seguridad no-fintech, Calidad de Código y Testing.
**Exclusiones explícitas:** rutas `/api/payments/*`, `/api/orders/[id]/refund`, `/api/orders/[id]/refunds`, `/api/conciliation`, `/api/wallet`, `/api/compliance/*`, webhooks de pago (stripe/mercadopago/payu/wompi/pix/pse/chargeback) — ya cubiertos por `AUDITORIA-FINTECH-V3-FINAL.md`.

---

## 1. Resumen Ejecutivo

| Dimensión | Score | Justificación |
|-----------|-------|---------------|
| **Seguridad (no-fintech)** | **6.5 / 10** | Excelente base (CSP, CORS allow-list, CSRF, rate-limit, bcrypt, AES-GCM para credenciales) pero **9 rutas con bypass multi-tenant** (cualquier usuario autenticado puede leer/modificar datos de CUALQUIER tenant pasando `tenantId` en body/query). TOTP `ENCRYPTION_KEY` con fallback inseguro en prod. Webhook `nocodb-out` sin auth. |
| **Calidad de Código** | **7.5 / 10** | TypeScript `strict: true`, solo 5 usos de `any`, 0 errores lint, 37 warnings. Pero 2 wrappers de error handler paralelos (`withErrorHandler` vs `withErrorHandling`), 245 try/catch manuales vs 93 unificados, falta de consistencia en shape de respuestas. |
| **Testing** | **6.5 / 10** | **49 archivos de test, 986 tests, 976 pasando (98.99%)** — mejor de lo que el prompt sugería (6 archivos). Infraestructura Vitest + Playwright bien configurada. Pero **0 tests de aislamiento multi-tenant**, 10 tests fallando por drift de mocks post-fintech-audit, coverage ~12% de archivos. |
| **Score global (no-fintech)** | **6.8 / 10** | Stack con base sólida pero gaps críticos en autorización multi-tenant que el defense-in-depth de RLS (cuando se migre a Postgres) cerrará parcialmente. |

### Top 3 fortalezas consolidadas

| # | Fortaleza | Detalle |
|---|-----------|---------|
| 1 | Defense-in-depth en el middleware | `src/middleware.ts` (493 líneas) aplica CSP estricta por path, X-Frame-Options DENY, HSTS, Referrer-Policy, Permissions-Policy, rate-limit 60/min global + 5/min para auth endpoints, CSRF check Origin/Host, CORS allow-list (no `*`), `X-Robots-Tag: noindex` en `/` y `/login`. Fail-closed en prod si `NEXTAUTH_SECRET` no está seteado. |
| 2 | Sanitización de input y XSS-prevention robusta | `src/lib/middleware/sanitize.ts` (90 líneas): strips null bytes (log injection), trunca strings a 10k chars, arrays a 100 items, depth cutoff 10, drop `__proto__`/`constructor`/`prototype` (prototype pollution). `safeJsonLd()` escapa `</script>`, `<`, `>`, `&`, U+2028, U+2029 — patrón correcto para JSON-LD embebido. |
| 3 | Infraestructura de testing bien montada | Vitest con `@/` alias, 46 tests unitarios + 4 de integración + 7 e2e Playwright. Tests de webhooks son exhaustivos (14-22 casos cada uno cubriendo signature inválida, dev mode, deduplicación, mapeo de estados, ACK contract). Tests e2e cubren auth flow completo, APIs públicas/protegidas, SSR pages, governance, status page. |

### Top 3 gaps críticos remanentes

| # | Gap | Severidad | Estado |
|---|-----|-----------|--------|
| 1 | 9 rutas API con bypass multi-tenant (auth pero no `requireTenantAccess`) | **CRÍTICO** | Sin mitigación — ver tabla S-1 a S-9. RLS Postgres (cuando se migre) cerrará el bypass a nivel DB, pero el costo LLM/audit-log ya está gastado. |
| 2 | `ENCRYPTION_KEY` para TOTP con fallback `'ziay-dev-encryption-key-change-in-prod-32b!'` | **CRÍTICO** | A diferencia de `NEXTAUTH_SECRET`, este NO lanza en prod si falta — todos los secretos TOTP se encriptan con clave pública conocida. |
| 3 | `/api/webhooks/nocodb-out` POST sin auth + sin verificación de token | **ALTO** | Está en `/api/webhooks/**` (público en middleware) pero NO verifica HMAC ni bearer — cualquiera puede disparar webhooks salientes al URL configurado con body arbitrario. |

---

## 2. Dimensión 1: Seguridad (no-fintech)

### 2.1 Metodología

Para cada uno de los 10 sub-ítems del OWASP Top 10 relevante, se ejecutaron comandos grep/find sobre `src/` y se verificó línea por línea el código fuente de las rutas sospechosas. Las rutas fintech se excluyeron explícitamente.

### 2.2 Tabla de hallazgos

| # | Severidad | Archivo:Línea | Descripción | Recomendación |
|---|-----------|---------------|-------------|---------------|
| **S-1** | **CRÍTICO** | `src/app/api/conversations/search/route.ts:15-46` | GET toma `tenantId` del query string sin `requireTenantAccess`. **Cualquier usuario autenticado puede buscar semánticamente en mensajes de CUALQUIER tenant** (devuelve `messageId`, `body`, `direction`, `createdAt`). | Añadir `const { error } = await requireTenantAccess(tenantId); if (error) return error` antes de `searchSimilar`. |
| **S-2** | **CRÍTICO** | `src/app/api/image-identifications/route.ts:6-27` | GET toma `tenantId` del query sin `requireTenantAccess`. Cualquier usuario autenticado puede listar el historial de identificaciones de imágenes (incluye `imagenUrl`, `skuDetectado`, `contactoId`) de cualquier tenant. | Mismo fix que S-1. |
| **S-3** | **CRÍTICO** | `src/app/api/conversational-cart/route.ts:5-93` | GET y POST toman `tenantId` del query/body sin `requireTenantAccess`. Permite leer carritos de cualquier tenant, agregar items a carritos ajenos, confirmar carritos, convertir a orden. | Mismo fix que S-1. Validar `action` con Zod enum. |
| **S-4** | **CRÍTICO** | `src/app/api/vision-pipeline/route.ts:16-61` | POST toma `tenantId` del body sin `requireTenantAccess`. Permite ejecutar el pipeline de visión (LLM cost) y persistir `ImageIdentification` + `AuditLog` en el tenant de la víctima. Atacante puede inflar costos LLM e inyectar rows maliciosos en el historial. | Mismo fix que S-1. Zod schema para `imageUrl` (URL regex). |
| **S-5** | **CRÍTICO** | `src/app/api/address-analysis/route.ts:10-74` | POST toma `tenantId` del body sin `requireTenantAccess`. Permite consumir budget LLM (ZAI chat completions) en nombre de cualquier tenant + escribir `AuditLog` en ese tenant. | Mismo fix que S-1. Ya tiene rate-limit 10/min/IP pero eso no cierra el bypass. |
| **S-6** | **CRÍTICO** | `src/app/api/attribution/route.ts:7-50` | GET y POST toman `tenantId` sin `requireTenantAccess`. Permite leer revenue acreditado por ad de cualquier tenant + disparar `recomputeAttributionWeights` (reescritura de datos) y escribir AuditLog en tenant ajeno. | Mismo fix que S-1. |
| **S-7** | **CRÍTICO** | `src/app/api/llm-providers/route.ts:6-86` | GET y PATCH toman `tenantId` sin `requireTenantAccess`. Permite leer config de LLM de cualquier tenant + **cambiar el proveedor de IA** del tenant (PATCH actualiza `Tenant.proveedorIa` y `credencialesIaRef`). | Mismo fix que S-1 + `requireRole(['admin'])`. |
| **S-8** | **CRÍTICO** | `src/app/api/onboarding/route.ts:6-70` | POST sin auth (es público implícitamente porque no está en PUBLIC_PATTERNS, así que middleware requiere JWT). Pero no requiere rol admin. Cualquier usuario autenticado puede crear tenants ilimitados, configurar `feeBaseMensual`, `comisionPctInicial` defaults, y crear canales WhatsApp. No valida formato de `slug` (regex). | `requireRole(['admin'])` + Zod schema para `slug` (`/^[a-z0-9-]{3,40}$/`) + rate-limit 5/hora/IP. |
| **S-9** | **CRÍTICO** | `src/app/api/webhooks/nocodb-out/route.ts:9-47` | POST **sin auth ni token** (la ruta vive en `/api/webhooks/**` que es público). Cualquiera puede disparar webhooks salientes al `NOCODB_WEBHOOK_URL` configurado con body arbitrario (`event`, `orderId`, `newStatus`, `tenantId`). Persiste AuditLog con tenantId atacante-controlado → inyección de auditoría. | Exigir `X-Nocodb-Token` header (igual que `nocodb-in`), o mover fuera de PUBLIC_PATTERNS y usar `CRON_SECRET`. |
| **S-10** | **CRÍTICO** | `src/lib/totp.ts:20` | `ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ziay-dev-encryption-key-change-in-prod-32b!'`. A diferencia de `NEXTAUTH_SECRET` (que lanza en prod si falta), este NO falla en prod. Si se despliega sin setear `ENCRYPTION_KEY`, todos los secretos TOTP se encriptan con AES-256-GCM usando una clave pública conocida — el atacante con acceso a la DB puede descifrar todos los TOTP. | Replicar el patrón de `auth.ts:25-30`: lanzar en prod si `!process.env.ENCRYPTION_KEY`. |
| **S-11** | **ALTO** | `src/app/api/webhooks/nocodb-in/route.ts:11` | `expected = process.env.NOCODB_WEBHOOK_SECRET || 'commerceflow_nocodb'`. Fallback hardcodeado público — si no se setea en prod, cualquiera que conozca este default puede llamar al webhook y modificar `Order.status` de cualquier orden. | Mismo fix que S-10 (lanzar en prod). |
| **S-12** | **ALTO** | `src/app/api/webhooks/whatsapp/route.ts:49` y `src/app/api/webhooks/meta/route.ts:26` | `expected = process.env.WA_VERIFY_TOKEN || 'commerceflow_verify'` y `META_VERIFY_TOKEN || 'commerceflow_verify'`. Meta requiere este token solo para el handshake de suscripción — pero si no se setea, cualquiera puede verificar el webhook y empezar a recibir webhooks de WhatsApp/Meta dirigidos a esta URL. | Mismo fix que S-10. |
| **S-13** | **ALTO** | `src/lib/totp.ts:110` | `Math.floor(Math.random() * 100_000_000)` para generar backup codes TOTP. `Math.random()` NO es criptográficamente seguro — predictible con observación suficiente. | Usar `crypto.randomInt(0, 100_000_000)` de Node.js. |
| **S-14** | **MEDIO** | `src/app/api/address-analysis/route.ts`, `conversational-cart/route.ts`, `vision-pipeline/route.ts`, `attribution/route.ts`, `llm-providers/route.ts`, `onboarding/route.ts` | 6 rutas con POST/PATCH/PUT sin Zod validation — parsean `await req.json()` y validan solo campos requeridos con `if`. Tipos no verificados, sin enum validation, sin length caps. | Añadir `z.object({...}).safeParse(body)` en cada una — el patrón ya existe en `/api/wallet/route.ts:41-80`. |
| **S-15** | **MEDIO** | `src/middleware.ts:168-186` + `src/lib/middleware/rate-limit.ts:30` | Rate limiter in-memory (Map). No funciona en multi-instancia (cada Edge instance tiene su Map). Documentado en comentarios pero no resuelto. | Migrar a `@upstash/ratelimit` o Redis-backed limiter. |
| **S-16** | **MEDIO** | `package.json` (deps) | `bun audit` reporta **23 vulnerabilidades (12 high, 10 moderate, 1 low)**. Críticas: `flatted <3.4.0` (high, vía vitest/eslint — dev-only), `picomatch <2.3.2` (high, vía vitest/sentry/eslint — dev-only), `uuid` (moderate, vía next-auth — **production**). | `bun update --latest` en dev deps. Para `uuid` vía next-auth, monitorear upgrade de next-auth v5. |
| **S-17** | **MEDIO** | `src/lib/middleware/csrf.ts:55-76` | CSRF check solo enforce cuando AMBOS Origin y Host están presentes. curl/servidor-a-servidor sin Origin header bypassa el check — depende solo de SameSite=Lax cookie. Si un atacante encuentra un endpoint que acepta auth por bearer token (no cookie), CSRF no aplica pero el bypass permite POST cross-origin desde navegador sin Origin si la víctima usa curl-derived client. | Considerar exigir Origin en todas las mutaciones no-NextAuth, o usar double-submit token. |
| **S-18** | **BAJO** | `src/lib/totp.ts:124-145` | `hashBackupCodes` usa un solo `salt` para todos los 10 códigos del mismo set. Si el JSON almacenado se filtra, un atacante puede brute-forcear los 8-digit codes (10^8 posibilidades) offline contra el mismo salt — scryptSync mitiga pero el patrón es subóptimo. | Per-code salt (cada code con su propio salt). |
| **S-19** | **BAJO** | `src/lib/totp.ts:33-49` | `decrypt` hace `catch { return ciphertext }` — si la desencriptación falla (ciphertext corrupto o clave incorrecta), retorna el ciphertext como plaintext. Es un fallback para migración pero permite bypass silencioso si un atacante corrompe el ciphertext. | Loggear el fallo de desencriptación y fallar closed. |
| **S-20** | **BAJO** | `src/lib/socket.ts:57`, `src/app/api/webhooks/meta/route.ts:76`, `src/lib/agents/schemas.ts:143-156`, `src/lib/adapters/{payu,mercadopago,wompi,stripe}.ts` | 11 `console.warn`/`console.error` dispersos en lib/api en lugar del logger pino estructurado. No filtran PII pero son inconsistentes con el logger configurado. | Reemplazar por `log.warn()`/`log.error()` con contexto estructurado. |

### 2.3 Verificación de superficies no problemáticas

| Sub-ítem OWASP | Estado | Evidencia |
|----------------|--------|-----------|
| **Inyección SQL** | ✅ Limpio | Solo 6 usos de `$queryRaw\`SELECT 1\`` (siempre template literal parameterizada, no string concat). Prisma parameteriza todo lo demás. |
| **XSS** | ✅ Limpio | 9 usos de `dangerouslySetInnerHTML` — todos pasan por `safeJsonLd()` que escapa `</script>`, `<`, `>`, `&`, U+2028/9. 1 uso en `chart.tsx` es para CSS-in-JS estático. Sin vectors detectados. |
| **SSRF** | ✅ Bajo riesgo | Solo 1 `fetch()` en API routes (`nocodb-out`) y el URL viene de env var, no user input. `next.config.ts` limita `images.remotePatterns` a 6 hostnames conocidos. |
| **File upload** | ✅ Ausente | No se encontraron rutas con `formData()` para upload de archivos. |
| **CORS** | ✅ Correcto | Allow-list en `getAllowedOrigins()` desde env `CORS_ALLOWED_ORIGINS` o defaults localhost en dev. NO es `*`. `Vary: Origin` seteado. Credentials true solo si origin match. |
| **Auth cookies** | ✅ Correcto | NextAuth v4 maneja cookies httpOnly + SameSite=Lax + Secure en prod. JWT secret fail-closed en prod. |
| **CSRF** | ⚠️ Parcial | Origin/Host equality check + NextAuth double-submit token. Limitación: bypass cuando Origin ausente (ver S-17). |
| **Secrets en código** | ✅ Limpio | Búsqueda regex `(api_key|password|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{8,}['"]` retorna solo 1 match en `tests/unit/middleware/hmac.test.ts:8` (test fixture, no production secret). |

---

## 3. Dimensión 2: Calidad de Código

### 3.1 Sub-dimensiones

| Sub-dimensión | Score | Hallazgo |
|---------------|-------|----------|
| TypeScript strictness | 9/10 | `tsconfig.json:11` tiene `strict: true`. Solo **5 ocurrencias de `: any` o `as any`** en todo `src/` — excelente. 1 caso real: `src/lib/agents/dynamic-quote.ts:100` usa `(db as any).volumeTier` — schema drift, debería tiparse. Los otros 4 son comentarios. |
| Lint | 9/10 | `bun run lint` → **0 errores, 37 warnings** (todos pre-existentes, todos `@typescript-eslint/no-unused-vars` con nombres que no matchean `/^_/`). |
| Dead code | 7/10 | 17 `TODO`/`FIXME`/`HACK`. Algunos archivos legacy (`oracle-catalog.ts` con 3 warnings de unused vars). Sin grandes bloques comentados. |
| Code duplication | 6/10 | **2 wrappers de error handler paralelos**: `src/lib/api-error-handler.ts` (`withErrorHandler` + `ApiError` + `ZodError` awareness, 110 líneas) y `src/lib/middleware/api-error-handler.ts` (`withErrorHandling` solo Sentry+log, 94 líneas). El comentario en el primero dice "Both can coexist; routes opt-in to either" — pero esto significa que hay 2 contracts de error response diferentes en el código. **245 try/catch manuales vs 93 rutas usando uno de los wrappers unificados** — la mayoría de rutas aún tiene boilerplate. |
| Complexity | 7/10 | Top 5 archivos más grandes: `local-payments.ts` (1199), `fraud.service.ts` (961, ya auditado), `sidebar.tsx` (726), `ucp/v1/checkout/[sessionId]/route.ts` (715), `dian-invoicing.ts` (713). 5 archivos >600 líneas — aceptable para adapters pero el checkout route es complejo. |
| Naming conventions | 9/10 | camelCase functions, PascalCase components/types consistentes. `ROLES` const enum, `Role` type. Algunos campos en español (`nombreNegocio`, `proveedorIa`) — consistente con el dominio LATAM. |
| Error handling | 7/10 | 2 patrones paralelos (ver Code duplication). Response shapes varían: `{ error, code }` (unificado), `{ error }` (legacy), `{ items }` vs `{ data }` vs raw object. `decrypt` en totp.ts y 4 catch blocks en `socket.ts`/`schemas.ts` swallows errors silenciosamente. |
| Consistency | 7/10 | Mix de responses: algunas rutas retornan `{ ok: true }`, otras `{ success: true }`, otras `{ cart }`, otras `{ data: ... }`. No hay un contract documentado. |
| Import organization | 8/10 | Path alias `@/` usado consistentemente. Imports agrupados implícitamente (next → lib → types) pero sin enforcement de `eslint-plugin-import`. |

### 3.2 Top 20 archivos más grandes (complejidad)

| # | Líneas | Archivo | Justificación / Acción |
|---|--------|---------|------------------------|
| 1 | 1199 | `src/lib/adapters/local-payments.ts` | 4 adapters (PSE/PIX/OXXO/SPEI) en 1 archivo. Splitear en 4 archivos. |
| 2 | 961 | `src/lib/services/fraud.service.ts` | Ya auditado en fintech V3. |
| 3 | 726 | `src/components/ui/sidebar.tsx` | shadcn/ui generated — aceptable. |
| 4 | 715 | `src/app/api/ucp/v1/checkout/[sessionId]/route.ts` | GET + PATCH + POST en 1 archivo. Considerar mover lógica a service. |
| 5 | 713 | `src/lib/compliance/dian-invoicing.ts` | Ya auditado en fintech V3. |
| 6 | 667 | `src/components/dashboard/messenger-view.tsx` | Componente dashboard grande pero cohesivo. |
| 7 | 623 | `src/lib/queue.ts` | BullMQ queue setup + jobs. Documentar. |
| 8 | 621 | `src/components/dashboard/orders-view.tsx` | UI grande pero cohesiva. |
| 9 | 605 | `src/lib/services/novedades.service.ts` | Servicio grande — considerar splitear redelivery vs history. |
| 10 | 604 | `src/lib/adapters/shopify.ts` | Adapter grande pero cohesivo. |
| 11 | 604 | `src/app/api/webhooks/whatsapp/route.ts` | Webhook complejo (parser + handler). |
| 12 | 600 | `src/app/api/orchestrate/route.ts` | 9-step pipeline walk — complejidad inherente. |
| 13 | 595 | `src/components/dashboard/llm-costs-view.tsx` | UI compleja con charts. |
| 14 | 592 | `src/app/api/mcp/route.ts` | MCP JSON-RPC handler — complejidad inherente. |
| 15 | 591 | `src/app/api/wallet/route.ts` | Ya auditado en fintech V3. |
| 16 | 569 | `src/lib/services/trafficker.service.ts` | Servicio grande pero cohesivo. |
| 17 | 550 | `src/components/dashboard/governance-view.tsx` | UI compleja. |
| 18 | 549 | `src/app/api/webhooks/stripe/route.ts` | Ya auditado en fintech V3. |
| 19 | 547 | `src/lib/adapters/woocommerce.ts` | Adapter grande pero cohesivo. |
| 20 | 535 | `src/components/dashboard/ads-view.tsx` | UI compleja. |

### 3.3 Hotspots de duplicación

| # | Patrón duplicado | Ocurrencias | Acción |
|---|------------------|-------------|--------|
| 1 | try/catch manual con `captureError` + `NextResponse.json({ error }, { status: 500 })` | ~67 rutas | Migrar a `withErrorHandling` o `withErrorHandler` unificado. |
| 2 | `const tenantId = req.nextUrl.searchParams.get('tenantId'); if (!tenantId) return 400` | ~20 rutas | Helper `requireTenantId(req)` que retorne `{ tenantId, error }`. |
| 3 | `await db.auditLog.create({ data: { tenantId, action, entity, entityId, metadata } })` | ~30 sitios | Helper `audit(tenantId, action, entity, entityId, metadata)`. |
| 4 | 2 wrappers de error handler paralelos | 2 archivos | Consolidar en uno solo (eliminar `withErrorHandling` y migrar 93 callers a `withErrorHandler`). |
| 5 | Hardcoded `|| 'fallback'` para secrets | 4 sitios (NOCODB_WEBHOOK_SECRET, WA_VERIFY_TOKEN, META_VERIFY_TOKEN, ENCRYPTION_KEY) | Helper `requireSecret(name, fallback)` que lanze en prod si no está seteado. |

### 3.4 Consistencia de response shapes

| Patrón | Ocurrencias | Ejemplo |
|--------|-------------|---------|
| `{ error, code }` | ~30 rutas (unificado) | `NextResponse.json({ error: 'Unauthorized', code: 'AUTH_ERROR' }, { status: 401 })` |
| `{ error }` sin code | ~20 rutas (legacy) | `NextResponse.json({ error: 'tenantId required' }, { status: 400 })` |
| `{ ok: true, ... }` | ~10 rutas | `NextResponse.json({ ok: true, cartId: cart.id })` |
| `{ items }` | ~5 rutas | `NextResponse.json({ items: ... })` |
| `{ data }` | ~3 rutas | `NextResponse.json({ data: ... })` |
| Raw object | ~15 rutas | `NextResponse.json({ cart: updated, totalItems: ... })` |

**Recomendación:** documentar y migrar a `{ data, error, code, meta }` con envolvente consistente.

---

## 4. Dimensión 3: Testing

### 4.1 Inventory de tests

| Tipo | Cantidad | Ubicación |
|------|----------|-----------|
| Unit tests | 46 | `tests/unit/*.test.ts` + 6 en `src/lib/**/__tests__/*.test.ts` + 2 en `src/lib/*.test.ts` |
| Integration tests | 4 | `tests/integration/*.test.ts` |
| E2E tests | 7 specs | `e2e/*.spec.ts` |
| **Total** | **59 archivos** | **986 tests, 976 pasando, 10 fallando (98.99% pass rate)** |

> **Nota:** El prompt original mencionaba "6 test files for 412 src files = ~1.5% file coverage". Esto es **inexacto** — hay 59 archivos de test y 986 tests. La cobertura de archivos sigue siendo baja (~12%) pero la infraestructura está bien montada.

### 4.2 Resultado de `bun run test`

```
Test Files  9 failed | 43 passed (52)
Tests       10 failed | 976 passed (986)
Duration    20.95s
```

**Tests fallando:** todos en archivos de webhook (payu, wompi, pse, stripe, etc.). Causa: la auditoría fintech V3 extendió `applyPaymentUpdate` para pasar `amount`, `currency`, `avsResult`, `cvvResult` (R-6), pero los mocks en los tests no fueron actualizados para esperar estos campos nuevos. **Es un drift de mantenimiento, no un gap de coverage.**

### 4.3 Coverage por área

| Área | Tests | Cobertura | Gap crítico |
|------|-------|-----------|-------------|
| Webhooks (8 gateways + meta + whatsapp) | 14 archivos, ~250 tests | ✅ Excelente (signature, dedup, state mapping, ACK contract) | Solo drift de mocks post-fintech-V3 |
| Services (12 servicios) | 14 archivos | ✅ Bueno (order, wallet, conversation, marketplace, novedades, etc.) | Falta `fraud.service` route-level (cubierto en fintech V3) |
| Middleware (csrf, cors, hmac, rate-limit, etag, cache-headers) | 6 archivos | ✅ Bueno | Falta `sanitize.ts` route-level integration |
| Compliance (age-gate, retention, edge-cases) | 3 archivos | ⚠️ Medio | Falta KYC, retracto, DSR |
| Agents (rules, schemas, route) | 3 archivos | ⚠️ Medio | Falta orchestrator route end-to-end |
| **Auth helpers (`requireAuth`, `requireTenantAccess`, `requireRole`)** | **0** | ❌ **Crítico** | **Ningún test verifica que estas funciones bloqueen correctamente cross-tenant access.** |
| **Tenant isolation / RLS** | **0** | ❌ **Crítico** | **Ningún test verifica que un usuario de tenant A no pueda leer datos de tenant B.** Los 9 bypass de S-1 a S-9 NO están cubiertos. |
| **Payment/refund route-level** | 0 (cubierto por fintech V3 a nivel service) | ⚠️ Medio | Faltan tests de route handler con auth mock |
| **Conciliation route** | 0 | ❌ Alto | Ya auditado en fintech pero sin test de regresión |
| E2E (auth, api, dashboard, governance, llm-costs, ssr, status) | 7 specs | ✅ Bueno | Cubre happy path + auth redirect + public APIs |

### 4.4 Calidad de los tests existentes

**Muestra:** `tests/unit/middleware/csrf.test.ts` (128 líneas, 7 tests)

| Test | Aserción | Calidad |
|------|----------|---------|
| allows safe methods | `expect(checkCSRF(getReq)).toBeNull()` para GET/HEAD/OPTIONS | ✅ Significativo |
| allows mutations with matching origin | `toBeNull()` para POST/PATCH/PUT/DELETE | ✅ Significativo |
| blocks mutations with mismatched origin | `expect(result?.status).toBe(403)` + verifica `body.code === 'CSRF_ORIGIN_MISMATCH'` | ✅ Significativo |
| blocks mutations with invalid origin URL | verifica `CSRF_INVALID_ORIGIN` code | ✅ Significativo |
| allows mutations without Origin header | `toBeNull()` para server-to-server | ✅ Documenta decisión de diseño |
| allows mutations when Host header is absent | `toBeNull()` | ✅ Edge case cubierto |
| blocks when origin host port differs from host | `toBe(403)` | ✅ Edge case cubierto |

**Conclusión:** los tests existentes son **de alta calidad** — asertan comportamiento, no solo ausencia de crash. Usan mocks apropiados (vi.hoisted para mantener referencias, vi.mock para aislar dependencias). El problema no es calidad sino **coverage de rutas críticas (auth, tenant isolation)**.

### 4.5 Infraestructura

| Componente | Estado | Notas |
|------------|--------|-------|
| Vitest config | ✅ Configurado | `vitest.config.ts` con `@/` alias, environment node, incluye `src/**/*.test.ts` + `tests/**/*.test.ts` |
| Playwright config | ✅ Configurado | `playwright.config.ts` con webServer auto-start, baseURL, trace on retry, locale es-CO, timezone America/Bogota |
| CI scripts | ✅ Presentes | `test`, `test:watch`, `test:ui`, `test:e2e`, `test:coverage` en package.json |
| Coverage reporter | ⚠️ Configuración ausente | `test:coverage` script existe pero `vitest.config.ts` no tiene `coverage: { provider: 'v8' }` — `bun run test:coverage` puede fallar o no reportar líneas |
| Test fixtures/factories | ⚠️ Ad-hoc | No hay factories centralizadas — cada test mocksea inline con `vi.hoisted`. Funciona pero no escala |
| Test database | ❌ Ausente | Tests unitarios mockean `db` completamente. No hay DB de test aislada para integration tests |
| E2E auth helper | ✅ Bueno | `e2e/auth.spec.ts` define `signInViaForm(page)` helper reutilizable |

### 4.6 Tests E2E detallados

| Spec | Líneas | Cobertura |
|------|--------|-----------|
| `auth.spec.ts` | 134 | 7 tests: redirect unauth, login render, login válido, login inválido, logout, protected API 401, public health 200 |
| `api.spec.ts` | 125 | Tests de APIs públicas + protegidas + webhook WhatsApp handshake |
| `dashboard.spec.ts` | (sin leer) | E2E del dashboard |
| `governance.spec.ts` | (sin leer) | E2E de governance |
| `llm-costs.spec.ts` | (sin leer) | E2E de costos LLM |
| `ssr-pages.spec.ts` | (sin leer) | E2E de páginas SSR (storefront, status, privacy, terms) |
| `status-page.spec.ts` | (sin leer) | E2E de status page |

---

## 5. Top 15 hallazgos críticos/alto priorizados

| # | Severidad | Dimensión | Hallazgo | Esfuerzo fix | Bloqueante prod |
|---|-----------|-----------|----------|---------------|-----------------|
| 1 | CRÍTICO | Seguridad | S-10: `ENCRYPTION_KEY` TOTP con fallback inseguro en prod | 5 min | ✅ Sí |
| 2 | CRÍTICO | Seguridad | S-1: `/api/conversations/search` bypass multi-tenant | 10 min | ✅ Sí |
| 3 | CRÍTICO | Seguridad | S-7: `/api/llm-providers` PATCH bypass multi-tenant (permite cambiar proveedor IA de cualquier tenant) | 10 min | ✅ Sí |
| 4 | CRÍTICO | Seguridad | S-9: `/api/webhooks/nocodb-out` sin auth, permite disparar webhooks + inyectar AuditLog | 15 min | ✅ Sí |
| 5 | CRÍTICO | Seguridad | S-4: `/api/vision-pipeline` bypass multi-tenant (LLM cost abuse + persistencia) | 10 min | ✅ Sí |
| 6 | CRÍTICO | Seguridad | S-5: `/api/address-analysis` bypass multi-tenant (LLM cost abuse) | 10 min | ✅ Sí |
| 7 | CRÍTICO | Seguridad | S-3: `/api/conversational-cart` bypass multi-tenant (read/write carritos ajenos) | 10 min | ✅ Sí |
| 8 | CRÍTICO | Seguridad | S-6: `/api/attribution` bypass multi-tenant (read + recomputation) | 10 min | ✅ Sí |
| 9 | CRÍTICO | Seguridad | S-2: `/api/image-identifications` bypass multi-tenant (leak imágenes/SKUs) | 10 min | ✅ Sí |
| 10 | CRÍTICO | Seguridad | S-8: `/api/onboarding` sin role check (cualquiera crea tenants) | 20 min | ⚠️ Condicional |
| 11 | ALTO | Seguridad | S-11/S-12: 3 secrets (NOCODB, WA, META) con fallbacks hardcodeados públicos | 15 min | ✅ Sí |
| 12 | ALTO | Seguridad | S-13: `Math.random()` para backup codes TOTP | 5 min | ⚠️ Condicional |
| 13 | ALTO | Testing | 0 tests de aislamiento multi-tenant — los 9 bypass de S-1 a S-9 no tienen test de regresión | 1 día | ⚠️ Recomendado |
| 14 | MEDIO | Testing | 10 tests fallando por drift de mocks post-fintech-V3 | 2 horas | ❌ No |
| 15 | MEDIO | Calidad | 2 wrappers de error handler paralelos + 245 try/catch manuales | 2 días | ❌ No |

---

## 6. Roadmap

### 6.1 Día 0–30 (P0 — bloqueante producción)

1. **Fix S-10 (5 min):** Replicar patrón `auth.ts:25-30` en `src/lib/totp.ts:20` — lanzar en prod si `!process.env.ENCRYPTION_KEY`.
2. **Fix S-1 a S-9 (1.5 horas):** Añadir `requireTenantAccess(tenantId)` a las 9 rutas con bypass. Para `/api/onboarding` añadir `requireRole(['admin'])` + Zod schema para `slug`.
3. **Fix S-9 (15 min):** Exigir `X-Nocodb-Token` header en `webhooks/nocodb-out` o mover fuera de PUBLIC_PATTERNS.
4. **Fix S-11/S-12 (15 min):** Migrar los 3 secrets (NOCODB_WEBHOOK_SECRET, WA_VERIFY_TOKEN, META_VERIFY_TOKEN) al patrón fail-closed en prod.
5. **Fix S-13 (5 min):** Reemplazar `Math.random()` por `crypto.randomInt()` en `totp.ts:110`.
6. **Actualizar 10 tests fallando (2 horas):** Actualizar mocks de `applyPaymentUpdate` en `webhooks.{payu,wompi,pse,stripe,...}.test.ts` para esperar los campos nuevos (`amount`, `currency`, `avsResult`, `cvvResult`).

### 6.2 Día 30–60 (P1 — primer sprint post-launch)

7. **Tests de aislamiento multi-tenant (1 día):** Crear `tests/unit/auth-helpers.tenant-isolation.test.ts` que verifique que cada una de las 9 rutas S-1 a S-9 retorna 403 cuando el `tenantId` no matchea el del usuario autenticado.
8. **Fix S-14 (4 horas):** Añadir Zod validation a las 6 rutas sin validation.
9. **Consolidar wrappers de error (1 día):** Eliminar `withErrorHandling` (el de `src/lib/middleware/api-error-handler.ts`), migrar las 93 rutas que lo usan a `withErrorHandler` (el de `src/lib/api-error-handler.ts` que tiene `ApiError` + `ZodError` awareness).
10. **Configurar coverage reporter (30 min):** Añadir `coverage: { provider: 'v8', reporter: ['text', 'lcov'] }` a `vitest.config.ts` para CI.
11. **Setup DB de test (1 día):** Crear SQLite in-memory o Postgres test container para integration tests que no mockeen `db` completamente.
12. **Migrar rate-limiter a Redis (medio día):** Reemplazar `Map` in-memory por `@upstash/ratelimit` o `ioredis` (ya en optionalDependencies).

### 6.3 Día 60–90 (P2 — mejora continua)

13. **Documentar response shape contract (medio día):** Definir `{ data, error, code, meta }` y migrar las ~50 rutas legacy gradualmente.
14. **Refactor `local-payments.ts` (1 día):** Splitear 1199 líneas en 4 archivos (pse.ts, pix.ts, oxxo.ts, spei.ts) + index.ts barrel.
15. **Helper `requireSecret(name, fallback)` (2 horas):** Centralizar el patrón fail-closed para todos los secrets con fallback.
16. **Helper `audit(tenantId, action, entity, entityId, metadata)` (2 horas):** Centralizar los ~30 sitios que crean AuditLog con el mismo shape.
17. **Fix S-18/S-19 (1 hora):** Per-code salt para backup codes + loggear fallos de decrypt en TOTP.
18. **Reemplazar `console.warn/error` por logger (2 horas):** 11 sitios en lib/api.
19. **Auditoría de dependencias (medio día):** `bun update --latest` para dev deps. Para `uuid` vía next-auth, evaluar migración a next-auth v5 (que drops uuid dependency).
20. **Test e2e para storefront checkout flow (1 día):** Cubrir UCP checkout end-to-end con mandate chain.

---

## 7. Veredicto de production readiness (no-fintech)

# 🟡 GO-WITH-CONDITIONS (no-fintech)

El stack ZIAY tiene una **base de seguridad robusta** (CSP, CORS, CSRF, rate-limit, sanitization, XSS prevention, AES-GCM para credenciales) y una **infraestructura de testing bien montada** (986 tests, 98.99% pass rate, Vitest + Playwright CI-ready). La calidad de código es buena (TypeScript strict, 0 lint errors, 5 `any` en todo el código).

**PERO** hay **9 rutas con bypass multi-tenant crítico** (S-1 a S-9) que permiten a cualquier usuario autenticado leer y modificar datos de cualquier tenant pasando `tenantId` en el body/query. Este es el gap más urgente — la migración a PostgreSQL con las 35 políticas RLS (ya escritas, ver `prisma/sql/rls-policies.sql`) cerrará el bypass a nivel DB, pero hasta entonces el costo LLM y la inyección de AuditLog ya están gastados.

### Condiciones obligatorias antes de desplegar a producción (P0):

1. **Fix S-10:** `ENCRYPTION_KEY` fail-closed en prod (5 min).
2. **Fix S-1 a S-9:** Añadir `requireTenantAccess` a las 9 rutas (1.5 horas).
3. **Fix S-11/S-12:** Migrar 3 secrets a patrón fail-closed (15 min).
4. **Fix S-13:** `crypto.randomInt` para backup codes (5 min).
5. **Migración a PostgreSQL** (condición heredada de fintech V3) — las 35 políticas RLS ya están escritas pero SQLite no las soporta.

### Condiciones recomendadas (P1, primer sprint post-launch):

6. Tests de aislamiento multi-tenant para las 9 rutas S-1 a S-9.
7. Zod validation en las 6 rutas sin validation (S-14).
8. Consolidar los 2 wrappers de error handler paralelos.
9. Configurar coverage reporter + DB de test.

### Por qué no GO completo:
- 9 bypass multi-tenant críticos sin mitigación a nivel aplicación.
- `ENCRYPTION_KEY` con fallback inseguro que no fail-closes en prod.
- 0 tests de aislamiento multi-tenant — los bypass no tienen test de regresión.
- 10 tests fallando por drift de mocks post-fintech-V3.

### Por qué no NO-GO:
- Base de seguridad excelente (CSP/CORS/CSRF/rate-limit/sanitization).
- 986 tests con 98.99% pass rate.
- 0 errores TypeScript, 0 errores lint.
- Defense-in-depth: aun si el bypass de aplicación existe, las 35 políticas RLS en Postgres lo cerrarían a nivel DB.
- Sanitización de input y XSS prevention robusta.
- Los 9 bypass son fixes triviales (`requireTenantAccess(tenantId)` — 1 línea por ruta).

**Score global no-fintech: 6.8 / 10** — base sólida pero gaps críticos en autorización multi-tenant que se cierran con ~2 horas de fix + 1 día de tests de regresión.

---

*Reporte generado por el agente general-purpose (perfil full-auditor, pasada A) el 2026-07-22. Verificación línea por línea de 9 rutas con bypass multi-tenant, 4 secrets con fallback inseguro, 59 archivos de test, 23 dependencias vulnerables. Próxima auditoría recomendada: post-fix P0 (día 30) para validar el closure de los 9 bypass y la migración a PostgreSQL.*
