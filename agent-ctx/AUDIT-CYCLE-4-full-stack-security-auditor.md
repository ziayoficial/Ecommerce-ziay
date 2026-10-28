# Task AUDIT-CYCLE-4 — Full-stack security auditor (Audit → Fix → Re-audit)

**Fecha:** 2026-10-27 · **Loop:** AUDIT-CYCLE-4 conforme a AGENTS.md
**Alcance declarado:** (1) verificación con evidencia de los hallazgos surgidos de una lectura completa del proyecto, (2) barrido de invariantes de seguridad (tenant guards en 102 rutas API, secretos hardcodeados, Zod en mutaciones, IDOR en 13 páginas SSR).

## Contexto cargado

- Lectura completa del proyecto vía 4 exploraciones paralelas (src/app con 125 rutas + 13 páginas, src/lib con 143 archivos, prisma con 81 modelos, tests con 1098+ cases, docs/agent-ctx/worklog).
- Baseline: v0.4.3 + [Unreleased] (vision anti-injection, ANTIFRAUD-VERIFY-001).
- Working tree al iniciar: 11 archivos modificados sin commitear de una sesión previa (wallet.service, credentials.service, capi-auto-fire, whatsapp-cloud, prisma/schema, 2 tests) — NO tocados por este ciclo, preservados.

## AUDITORÍA — hallazgos con evidencia (y refutaciones)

| ID | Sev | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| H1 | High | `POST /api/trafficker`: 5 de 6 acciones sin ownership/role check — `confirm_sale`/`fail_sale` acreditan wallets, `register` aceptaba email arbitrario (identity squatting) | `api/trafficker/route.ts:204-345` (solo `withdraw` tenía el fix #13) | ✅ Fixed |
| H2 | High | `/vendedor` pública: exponía email de staff, nombres de clientes y montos de órdenes cross-tenant; fallback anónimo al primer agente de la plataforma | `vendedor/page.tsx:29-37,67-78,150-157` + `middleware.ts` PUBLIC_PATTERNS | ✅ Fixed |
| H3 | High | Flujo consentimiento parental (Ley 1098) roto end-to-end: form sin action, API rechazaba `parental_consent_minor`, sesión imposible para el tutor → menores bloqueados en `requires_escalation` sin salida; NADA podía crear el registro que `requireParentalConsent` espera | `parental-consent/page.tsx:54`, `consent/route.ts:20-25`, `age-gate.ts:163`, `ucp/v1/checkout/[sessionId]/route.ts:418` | ✅ Fixed |
| M1 | Medium | `GET /api/tenants` sin filtro por rol pese a docstring que lo prometía — cualquier usuario autenticado veía config interna (proveedorIa, politicaPago) de todos los tenants | `tenants/route.ts:24-37`, `tenants.service.ts:26-48` | ✅ Fixed |
| M2 | Medium | `GET /api/agents/traces` accesible a admins tenant-bound — traces con PII cross-tenant (doc: "restricted to platform admins") | `agents/traces/route.ts:23-25` | ✅ Fixed |
| M3 | Medium | `POST/DELETE /api/integrations/credentials` sin Zod ni role gate — un agent podía sobreescribir credenciales de pasarelas del tenant | `route.ts:109-155,187-252` | ✅ Fixed |
| L1 | Low | `alertmanager-webhook` comparaba Bearer con `!==` (timing side-channel; estándar del repo: `timingSafeEqual`) | `route.ts:52` | ✅ Fixed |
| L2 | Low | `ucp/v1/order` llamaba `requireAuth()` dos veces + doc `@security` decía "Public bearer" (es sesión) | `route.ts:21,40` | ✅ Fixed |
| L3 | Low | 9 módulos muertos (~2.000 líneas, 0 importadores): rls.ts, http.ts, graceful-shutdown.ts, api-error-handler.ts, security-headers.ts, country-detection.ts, prompt-versioning.ts, oracle-catalog.ts, orchestrator/orchestrator.ts. SECURITY.md documentaba `makeTenantPrismaExtension()` como capa 2 de defensa (¡con funciones `withTenant`/`createTenantScopedClient` que ni existían!) | grep: solo self-refs; `SECURITY.md:40,43` | ✅ Fixed (eliminados + SECURITY.md honesto) |
| L4 | Low | Doc drift: docker-compose "11 services" (16), `summarize.ts` "aún NO cableada" (sí lo está), `meta-agent-config.ts` "26 agents" (24), web-vitals `@security` erróneo | varios | ✅ Fixed (parcial — ver Open) |
| I1 | Info | `isPrivileged` por rol permite a admin tenant-bound operar wallets de traffickers de toda la plataforma (Trafficker no tiene tenantId en schema); PayU MD5 (limitación del proveedor, documentada) | `wallet/route.ts:121-129`, `trafficker/route.ts:25-36` | 🟡 Reportado (decisión de authz vigente) |

**Refutados en verificación** (falsos positivos de la primera lectura):
- `payments/local/[reference]/status` — tenant guard inline EXISTE (`route.ts:77-84`).
- `ucp/v1/order` — tenant guard inline EXISTE (`route.ts:39-48`); quedaba solo el code smell L2.
- `analytics/web-vitals` — protegido por el middleware JWT (no está en PUBLIC_PATTERNS); solo doc drift.
- api.spec `/api/tenants` e2e — la aserción de Saramantha sigue pasando con el filtro M1 (Saramantha es el tenant del caller).

**Categorías limpias (0 hallazgos):** secretos hardcodeados reales (solo placeholders UI + defaults dev fail-closed), `console.log` en servidor, tenant guards (97/102 correctos, incluidos todos los DELETE/PATCH), Zod en mutaciones (60+ rutas), webhooks (12/12 con HMAC, idempotencia 2 capas, rotación).

## Decisiones de producto (preguntadas al usuario — no asumidas)

1. **H2 /vendedor** → "Exigir sesión" (self o admin; platform admin cualquier vendedor, tenant admin solo los de su tenant).
2. **H3 consentimiento** → "Flujo anónimo con firma": endpoint público endurecido; documento del tutor hasheado (Ley 1581 principio de mínimos).
3. **Demo accounts** → ocultas en production builds (`process.env.NODE_ENV !== 'production'` — dead-code-eliminated del bundle client).
4. **Dead code** → eliminar + corregir SECURITY.md (cablear la extensión Prisma de rls.ts rompería flujos cross-tenant por diseño: marketplace listings, lead referrals).

## FIX — implementación (Task ID: AUDIT-CYCLE-4 en cada site)

- **H1** `api/trafficker/route.ts`: `requirePrivileged()` nuevo (confirm/fail) + `authorizeTraffickerAccess` extendido a register/create_campaign/register_sale. Matriz documentada en el header del POST.
- **H2** `vendedor/page.tsx` (guard getServerSession + redirect + self-or-admin) + `middleware.ts` (removed PUBLIC_PATTERNS) + `privacy/page.tsx` comment.
- **H3** nuevos `api/compliance/parental-consent/route.ts` (CSRF checkCSRF + rateLimit 5/10min + findFirst isMinor + computeHash para doc + proof IP/UA + idempotencia) y `components/compliance/parental-consent-form.tsx` (client island con estados success/error); page reescrita con Suspense; `consent/route.ts` enum + `parental_consent_minor`; `middleware.ts` PUBLIC_PATTERNS + comentario; `openapi.yaml` nuevo path (Redocly válido).
- **M1** `tenants/route.ts` filtro per-session post-cache (cache guarda lista completa; el filtro nunca va al cache-key).
- **M2** `agents/traces/route.ts` + tenantId null gate.
- **M3** `integrations/credentials/route.ts` Zod schemas + requireRole(['admin']) en POST/DELETE (GET/PUT sin cambio: masked read + registry público).
- **L1** `timingSafeEqual` + length check (patrón AUTOFIX-L-2 del cron).
- **L2** requireAuth único + guard de tenant en el mismo fetch.
- **L3** `git rm` de 9 archivos + `SECURITY.md` reescrito a 2 capas reales + `docs/ERD.md:66` corregido.
- **L4** docker-compose header (16 services), `summarize.ts` comment, `meta-agent-config.ts` (24 agentes).

## Tests añadidos (37)

| Archivo | Cubre | Tests |
|---|---|---|
| tests/unit/trafficker-route-authorization.test.ts | matriz H1 (15 casos: self/agent/admin/finance × 5 acciones, aserciones negativas de no-llamada al service) | 15 |
| tests/unit/parental-consent-route.test.ts | H3 (Zod 400, isMinor gate 404 sin oráculo, documento hasheado en proof, idempotencia 200, CSRF 403, rate-limit 429 — con computeHash REAL) | 8 |
| tests/unit/tenants-route.test.ts | M1 (tenant-bound → solo propio tenant; platform → todos; 401) | 3 |
| tests/unit/agents-traces-route.test.ts | M2 (tenant-admin 403, platform-admin 200, filtro agentName, passthrough de error) | 4 |
| tests/unit/credentials-route-guards.test.ts | M3 (agent 403, Zod 400, unknown integration 400, whitelist de fields contra registry REAL, response masked) | 7 |

E2E: +2 casos en `auth.spec.ts` (/vendedor anónimo → /login?callbackUrl; /vendedor autenticado → panel propio) y la aserción de demo accounts invertida (en build de producción NO deben verse).

## VERIFICACIÓN (pre-flight completo)

- `bun run lint`: **0 errores** (74 warnings, todos preexistentes; 0 en archivos del ciclo).
- `bunx tsc --noEmit`: **0 errores**.
- `bun run test`: **1169 passed | 18 skipped** (suite completa; +37 tests del ciclo; 0 regresiones). Nota: 1 corrida tuvo 2 fallos flaky de timing en circuit-breaker que pasaron en re-run (timing del half-open, documentado como sensible).
- `npx @redocly/cli lint docs/openapi.yaml`: **válido** (nuevo endpoint en el contrato).
- `bun run build`: **standalone OK** (requirió NEXTAUTH_SECRET + ENCRYPTION_KEY en env — fail-closed correcto).
- `bunx playwright test`: **68/70 consistentes**. 2 fallos restantes son AMBIENTALES: `/api/health` (api.spec + auth.spec) devuelve 503 porque el disco de la máquina local está al **2.9% libre** y el check `disk_space` reporta `error` — el check funciona exactamente como debe; en CI (disco sano) pasa. 1 flake ECONNRESET en dashboard.spec pasó en re-run aislado (24/24).

## RE-AUDITORÍA (2a pasada del diff)

- H1 (módulo financiero, regla de 2a pasada): guards ejecutan ANTES de todo side-effect; `confirm/fail` rechazan antes del fetch del sale (fail-fast, sin oráculo de existencia para no-privilegiados); `register` valida ownership ANTES del 409 de duplicado (no probing); firmas de services y response shapes sin cambios.
- H3: el endpoint anónimo es una excepción documentada y aprobada a "toda ruta tenant-scoped llama requireTenantAccess" — no hay sesión posible; el endurecimiento (isMinor gate + CSRF + rate limit + hash) reemplaza el guard de sesión.
- borrar rls.ts no rompió nada (grep 0 importadores + tsc 0 + suite verde + build OK).

## Open (accepted) — backlog documentado

1. **I1 (Info):** admin tenant-bound opera wallets de toda la plataforma — si se quiere restringir, requiere diseño (Trafficker no tiene tenantId en schema). No accionable mecánicamente en este ciclo.
2. **Doc drift menores NO tocados** (fuentes históricas): `docs/API-REFERENCE.md:942` describe "23 checks incl. RLS/pgvector" en /api/health (el endpoint real reporta otro set); `docs/INDEX.md` es snapshot v0.4.0 con métricas antiguas; AUDIT-REPORT/AUDIT-PLAN/agent-ctx históricos referencian `src/lib/rls.ts` como registro de lo que pasó (intencionalmente no reescritos — son registros históricos).
3. **Flaky conocido:** circuit-breaker timing tests (half-open windows) — 2 fallos esporádicos observados en 1 de 3 corridas; pasan en re-run. Candidato a fake-timers en un ciclo de test-stability.
4. **e2e local requiere env manual** (sin .env, el standalone no resuelve DATABASE_URL): DATABASE_URL absoluta + secrets + rate limits relajados (ver CI `.github/workflows/ci.yml:148-163` para el set completo).

## Lección añadida

- **L67** en upload/ y public/presentaciones/LECCIONES-APRENDIDAS.md (ambas copias idénticas): la documentación de seguridad que describe capas inexistentes es en sí misma un hallazgo — SECURITY.md documentaba una capa ORM con funciones que nunca existieron.
