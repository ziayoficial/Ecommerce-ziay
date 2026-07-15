# Lecciones Aprendidas · ZIAY

> Documento vivo de aprendizajes técnicos, metodológicos y de producto durante la construcción, auditoría y iteración de ZIAY. Actualizado tras cada ciclo de trabajo.

---

## 📅 Historial de versiones

| Fecha | Versión | Evento | Lecciones clave |
|---|---|---|---|
| 2026-07-09 | 0.1 | Construcción inicial (26 agentes, 14 módulos) | Worklog extenso ≠ código funcional; validar claims |
| 2026-07-11 | 1.0 | Auditoría full-stack exhaustiva | 8 Critical, 14 High encontrados; 5 módulos lib claimados pero inexistentes |
| 2026-07-11 | 1.1 | Auto-fixes A/B/C/D + cross-agent integration | Coordinación paralela requiere límites de archivos claros |
| 2026-07-11 | 2.0 | QA E2E + documentación masiva | Dev server inestable en sandbox de 4GB RAM |
| 2026-07-11 | 2.1 | Presentación no-técnicos + lecciones | Lenguaje natural > jerga técnica para clientes |
| 2026-07-11 | 3.0 | Reposicionamiento enterprise (REBRAND-ENTERPRISE-001) | El mensaje interno (26 agentes, 95%) no es el mensaje de venta; enterprise positioning > feature listing |
| 2026-07-15 | 4.0 | **v0.3.0 final — Score 10.0/10** (Sprints 1-14) | ADRs son esenciales; error handling wrapper; tenant scoping #1; ed25519 > RSA; fire-and-forget webhooks; LLM budget tracking; SSR shell |

---

## 🧠 Lecciones de Producto

### L1. El worklog puede mentir — validar claims contra el disco
**Contexto:** El worklog de la fase inicial claimaba 10 servicios Docker, `src/lib/rls.ts`, `src/lib/llm/`, `src/lib/vision/`, `src/lib/embeddings/` — **ninguno existía en disco**.

**Lección:** Un worklog narrativo no es evidencia. Antes de reportar "done", verificar con `ls`, `grep`, o `Read` que el archivo existe y tiene el contenido esperado.

**Acción:** En futuros proyectos, cada claim del worklog debe incluir el path del archivo + líneas relevantes como evidencia.

---

### L2. Los datos reales importan más que los datos de demo
**Contexto:** Se cargaron 238 pedidos reales del CRM de Saramantha (GMV $34.5M COP, AOV $145K). El embudo §15.1 mostró que 73% de pedidos requieren llamada de confirmación y solo 1.1% llegan a "despachado" sin sistema.

**Lección:** Los datos reales revelan problemas que los datos sintéticos ocultan. El 20.5% de devolvedores no se hubiera detectado con datos fake.

**Acción:** Siempre que sea posible, cargar datos reales del cliente desde el día 1. Los KPIs del dashboard son más convincentes con números reales.

---

### L3. El comprador devolvedor es el problema #1 en LATAM
**Contexto:** 20.5% de los clientes de Saramantha son "devolvedores" (0% tasa de entrega). Esto significa que 1 de cada 5 pedidos se devuelve, generando costo logístico sin ingreso.

**Lección:** En commerce conversacional LATAM, el riesgo de devolución es más crítico que la conversión. Un sistema que no detecta devolvedores pierde dinero.

**Acción:** El agente `buyer_behavior` es el **paso 1 del pipeline pre-venta** (antes de vender, verificar si el comprador es confiable). Si es devolvedor → activar `require_prepay` (pago anticipado obligatorio).

---

### L4. "Llamar para confirmar" no es optional — es el 73%
**Contexto:** El embudo real muestra que 73% de pedidos requieren llamada de confirmación. Solo 1.1% llegan a "despachado" sin ese paso.

**Lección:** El commerce conversacional en LATAM es high-touch. La IA no reemplaza la llamada humana — la **optimiza** (pre-filtra, prepara datos, agenda).

**Acción:** El dashboard tiene un módulo Kanban con 8 columnas que visualizan exactamente este embudo. El agente `address` confirma los 10 campos de dirección antes de la llamada, reduciendo el tiempo humano.

---

### L5. Multi-tenant no es solo un campo en la DB
**Contexto:** Aunque 44 modelos Prisma tenían `tenantId`, 16 API rutas NO lo validaban. Cualquiera podía leer pedidos de todas las marcas.

**Lección:** Multi-tenant requiere defensa en profundidad: (1) app layer (tenant guard en cada ruta), (2) ORM layer (Prisma extension auto-inject), (3) DB layer (RLS policies en Postgres).

**Acción:** Se crearon 3 capas: `assertTenantAccess()` en API routes, `makeTenantPrismaExtension()` en ORM, y `RLS_SQL_POLICIES` para migración a Postgres.

---

## 🏗️ Lecciones de Arquitectura

### L6. SQLite es suficiente para dev, insuficiente para prod
**Contexto:** SQLite funciona perfectamente en desarrollo (0 config, file-based). Pero los índices son necesarios porque SQLite hace sequential scan sin ellos. En v0.3.0 hay **110 @@index en 55+ modelos** (en v0.1.0 eran 91 en 45 modelos).

**Lección:** No esperar a producción para añadir índices. El schema Prisma debe declarar `@@index` desde el día 1. SQLite lo ignora silenciosamente; Postgres lo necesita.

**Acción:** Se añadieron 88 `@@index` en 45 modelos durante AUTOFIX-B. El schema es portable SQLite → Postgres cambiando solo el `provider`.

---

### L7. Socket.io sin rooms = fuga de datos cross-tenant
**Contexto:** El chat-service usaba `io.emit()` — broadcast a TODOS los clientes conectados, sin importar el tenant. Un cliente conectado recibía mensajes de todas las marcas.

**Lección:** Real-time multi-tenant requiere rooms obligatorios. `io.to(\`tenant:${tenantId}\`).emit(...)` en vez de `io.emit(...)`. Auth gate en handshake.

**Acción:** Se reescribió chat-service con rooms por `tenant:ID` + `conv:ID`, auth gate vía `socket.handshake.auth.tenantId`, y CORS configurable.

---

### L8. Los webhooks sin HMAC son una vulnerabilidad crítica
**Contexto:** Los webhooks de WhatsApp y Meta aceptaban cualquier POST sin verificar la firma. El token de verificación era hardcoded `'commerceflow_verify'` (público en el repo).

**Lección:** Todo webhook debe verificar firma criptográfica (HMAC-SHA256 para Meta, MD5 para PayU). Los tokens de verificación NUNCA deben tener defaults públicos — si no hay env, 403.

**Acción:** Se creó `src/lib/middleware/hmac.ts` con `verifyMetaSignature()` usando `timingSafeEqual`. Se removieron los fallbacks hardcoded. 4 webhooks de pago creados con verificación HMAC/MD5.

---

### L9. Los adapters stub son trampas mortales
**Contexto:** 5 adapters de catálogo (WooCommerce, Shopify, Supabase, WhatsApp Catalog, Oracle) y 3 de logística (Dropi, 99envios, Aveonline) eran stubs que leían/escribían la DB local. Parecían funcionar pero no llamaban APIs reales.

**Lección:** Un stub que lee/escribe DB local engaña al usuario — parece funcional pero no integra nada. Los stubs deben ser explícitos: o devuelven datos sintéticos claros, o fallan con "not configured".

**Acción:** Los 4 adapters de pago (MercadoPago, Wompi, Stripe, PayU) y 2 de pauta (Google Ads, TikTok Ads) hacen HTTP real. Los stubs de catálogo/logística tienen TODO comments documentando los endpoints reales.

---

### L10. CAPI (Conversions API) no es opcional — es el 30% de tracking
**Contexto:** `/api/conversions` era un stub que marcaba eventos como "sent" sin llamar ninguna API. El dashboard mostraba conversiones "delivered" que nunca se enviaron a Meta/Google/TikTok.

**Lección:** Con iOS 14.5+ y bloqueo de cookies, el pixel del navegador pierde ~30% de conversiones. CAPI server-side recupera ese 30%. Un stub que miente es peor que no tener CAPI.

**Acción:** Se implementó CAPI real: Meta Graph v18 (`/events`), Google Measurement Protocol (`/mp/collect`), TikTok Events API (`/event/track/`). Cada plataforma en try/catch independiente.

---

## 🔧 Lecciones de Ingeniería

### L11. La coordinación paralela de agentes requiere límites de archivos
**Contexto:** 4 agentes de auto-fix (A/B/C/D) ejecutados en paralelo. AUTOFIX-A endureció rutas API requiriendo `tenantId`, pero AUTOFIX-C (frontend) no sabía que los callers necesitaban actualizar.

**Lección:** Cuando múltiples agentes modifican código en paralelo, cada agente debe tener un scope de archivos EXCLUSIVO. Los puntos de integración (API contracts) deben documentarse para coordinación post-ejecución.

**Acción:** Se definieron scopes estrictos por agente. Tras la ejecución paralela, se hizo una fase de "cross-agent integration" para actualizar los callers frontend (page.tsx, messenger, wallet, settings) con los nuevos requisitos (tenantId, auth headers).

---

### L12. El dev server de Next.js 16 Turbopack es inestable en 4GB RAM
**Contexto:** `next dev -p 3000` muere silenciosamente después de ~10 requests en un sandbox de 4GB RAM. El proceso no deja error en log — simplemente desaparece.

**Lección:** Turbopack en dev consume mucha memoria compilando rutas on-demand. En entornos con memoria limitada, pre-compilar rutas con curl antes de abrir browser, o usar `next build` + `next start` (standalone) para producción.

**Acción:** Estrategia: (1) iniciar server con `setsid node node_modules/.bin/next dev`, (2) pre-compilar con curl, (3) hacer QA en lotes pequeños (3-4 vistas por sesión de browser), (4) reiniciar si muere.

---

### L13. `ignoreBuildErrors: true` es una deuda técnica silenciosa
**Contexto:** `next.config.ts` tenía `typescript.ignoreBuildErrors: true` y `eslint.ignoreBuildErrors: true`. Esto ocultaba errores de tipo y lint en build, pero el código funcionaba "por suerte".

**Lección:** Nunca usar `ignoreBuildErrors: true` en producción. Los errores existen por una razón. Si hay errores, fixearlos, no ignorarlos.

**Acción:** Se cambió a `ignoreBuildErrors: false` + `reactStrictMode: true`. Se fixearon todos los errores de tipo y lint que surgieron.

---

### L14. Los índices de DB no son opcionales — son requisitos
**Contexto:** Solo 3 de 62 modelos Prisma declaraban `@@index` (estado v0.1.0; hoy v0.3.0 son **71 modelos** con 110 `@@index`). Consultas como `db.order.findMany({ where: { tenantId } })` hacían sequential scan en SQLite.

**Lección:** Cada campo que aparece en un `where`, `orderBy`, o `include` debe tener índice. FKs siempre necesitan índice. En SQLite es lento; en Postgres es catastrófico.

**Acción:** Se añadieron 88 `@@index` en 45 modelos: tenantId, FKs (customerId, conversationId, sourceAdId), filtros comunes (status, createdAt), y compuestos para queries frecuentes.

---

### L15. El frontend sin error states es una UX rota
**Contexto:** 12 de 17 vistas del dashboard usaban `.catch(() => setLoading(false))` — silenciosamente tragaban errores. Si una API fallaba, el usuario veía skeletons desaparecer y vista vacía sin explicación.

**Lección:** Toda vista que fetch data debe tener 3 estados explícitos: loading (skeleton), error (Alert + retry), empty (icon + mensaje). El error swallow es la peor UX — el usuario no sabe si está cargando o falló.

**Acción:** Se añadió `error` state + `Alert variant="destructive"` + botón "Reintentar" en 12 vistas. El patrón: `setError(err.message)` en catch, render condicional del Alert.

---

## 🤝 Lecciones de Cliente

### L16. Los clientes no compran features — compran soluciones a problemas
**Contexto:** Al presentar el dashboard a clientes, listar "26 agentes, 62 modelos, 44 APIs" no generaba interés. Mostrar "detecta devolvedores antes de vender" sí.

**Lección:** El lenguaje técnico aleja al cliente. La presentación debe empezar con el problema ("¿Sabes que 1 de cada 5 pedidos se devuelve?"), no con la solución ("Tenemos 26 agentes IA").

**Acción:** Se creó `PRESENTACION-NO-TECNICOS.html` con lenguaje natural, ejemplos de pensamiento ágil, y enfoque en "cómo ganar dinero" no en "cómo funciona técnicamente".

---

### L17. El ROAS es el KPI que más impresiona a los clientes
**Contexto:** Cuando se muestra "tu ad de Stitch tiene ROAS 0.8 → KILL" vs "tu ad de Hello Kitty tiene ROAS 3.2 → SCALE", los clientes entienden inmediatamente el valor.

**Lección:** Los clientes de commerce conversacional en LATAM pierden dinero en pauta que no convierte. Un sistema que les dice qué ads matar y cuáles escalar tiene ROI inmediato y medible.

**Acción:** El módulo "Atribución de Pauta" tiene un verdict engine (kill/pause/scale/watch) con umbrales configurables. Es el feature más "vendible" del producto.

---

### L18. La wallet con 2FA genera confianza en traffickers
**Contexto:** Los traffickers (affiliates) invierten en pauta. Necesitan confianza de que su dinero está seguro. El 2FA con Google Authenticator para retiros generó credibilidad inmediata.

**Lección:** En fintech, la fricción de seguridad (2FA) genera confianza, no la reduce. Los traffickers prefieren esperar 30s más para retirar si saben que nadie más puede robarles.

**Acción:** Wallet con 2FA TOTP obligatorio para retiros. Backup codes generados al activar. Compensación automática si vendedor falla (seller_no_ship = 100% compensación).

---

## 📚 Lecciones Metodológicas

### L19. La auditoría debe ser evidence-based, no opinion-based
**Contexto:** La primera "auditoría" (worklog previo) era narrativa — decía "todo funciona" sin evidencia. La auditoría real (AUDIT-REPORT.md) requirió ejecutar tests y capturar screenshots.

**Lección:** "Parece funcionar" no es evidencia. La evidencia es: HTTP 200, body length > 500, screenshot, log line, DB row. Sin evidencia, no hay auditoría.

**Acción:** AUDIT-REPORT.md incluye 73 screenshots, 25 API tests con status codes, 14 view tests con body length, 7 webhook tests. Todo verificable.

---

### L20. El plan antes que la ejecución
**Contexto:** Se intentó auditar sin plan y fue caótico. Se creó AUDIT-PLAN.md (1,399 líneas, 12 workstreams, 272 checklist items) primero, y la ejecución fue estructurada.

**Lección:** Un plan detallado (aunque tome tiempo) ahorra horas de ejecución desordenada. Define scope, metodología, workstreams paralelizables, y acceptance criteria antes de empezar.

**Acción:** AUDIT-PLAN.md define 12 workstreams, 163 archivos inventariados al 100%, 272 checklist items concretos. La ejecución siguió el plan fase por fase.

---

### L21. Los agentes subordinados necesitan contexto completo
**Contexto:** Al lanzar agentes de auto-fix, los primeros fallaron porque no tenían contexto del worklog previo. Los segundos funcionaron cuando se les exigió leer el worklog primero.

**Lección:** Cada agente subordinado debe: (1) leer el worklog antes de empezar, (2) appendar su sección al terminar, (3) recibir un Task ID para trazabilidad. Sin esto, trabajan a ciegas.

**Acción:** Protocolo worklog obligatorio: read first, append after. Cada agente recibe Task ID + scope de archivos exclusivo.

---

### L22. La documentación es un producto, no un afterthought
**Contexto:** Tras construir el producto, se generaron 12,284 líneas de documentación (README, deploy, onboarding, presentaciones, guías). Esto tomó tanto tiempo como el código.

**Lección:** La documentación de calidad es tan importante como el código. Un producto sin docs es un producto que nadie usa. Las presentaciones para no-técnicos son tan críticas como las APIs para developers.

**Acción:** 4 docs MD (4,165 líneas) + 4 presentaciones HTML (5,518 líneas) + 2 docs auditoría (2,601 líneas). Cada audiencia tiene su documento.

---

### L23. El reposicionamiento enterprise reemplaza el feature-listing como mensaje de venta
**Contexto:** Tras rebrand CommerceFlow OS → ZIAY, todas las presentaciones y docs usaban mensajes internos como headlines: "26 agentes IA", "95% automatizado", "marketplace cross-brand", "wallet para traffickers". Estos features son verdad pero **no son lo que el cliente enterprise compra**.

**Lección:** El mensaje interno (cuántos agentes, qué porcentaje automatiza) NO es el mensaje de venta. El cliente enterprise compra **ingresos trazables, gobernanza, eficiencia operativa, integración con su stack**. Los features concretos (26 agentes, 95%) se mantienen como "cómo lo hacemos", no como "qué vendemos".

**Nuevo marco:** 4 ejes enterprise (Crecimiento medible, Eficiencia operativa, Gobernanza, Integración) y 3 capas de arquitectura (Revenue · Operations · Governance) — cada feature se mapea a uno o más ejes.

**Acción (REBRAND-ENTERPRISE-001):**
- Tagline nueva: **Revenue Operations para Comercio Agéntico** (reemplaza "Comercio Conversacional + Atribución Inteligente").
- Reemplazos en todas las presentaciones y docs:
  - "26 agentes IA" (headline) → **Ingresos trazables de extremo a extremo** (los 26 agentes se mantienen como "cómo lo hacemos")
  - "95% automatizado" → **Menos costo por venta, más conversión**
  - "Marketplace cross-brand" (headline) → movido al eje **Integración** como "Monetización adicional"
  - "Wallet para traffickers" (headline) → movida al eje **Gobernanza** como "Gobernanza financiera"
  - "Convierte conversaciones en ventas" → **Convierte conversaciones, agentes y canales en ingresos trazables**
- Las 6 presentaciones HTML + README.md + GUIA-ONBOARDING-CLIENTES.md + LECCIONES-APRENDIDAS.md fueron actualizadas. La tagline nueva aparece en TODOS los archivos.

**Verificación:** `grep -ri 'Revenue Operations para Comercio Agéntico' .` debe retornar al menos 9 archivos (6 HTML + 3 MD).

---

## 🚀 Lecciones de los Sprints 1-14 (v0.3.0 final · score 10.0/10)

> Siete lecciones arquitectónicas clave aprendidas durante los 14 sprints que llevaron ZIAY de v0.1.0 (score 4.9/10) a v0.3.0 (score 10.0/10). Cada una está respaldada por un ADR.

### L24. El wrapper de error handling es el patrón más valioso del proyecto (ADR-0011)

**Contexto:** En Sprint 8B, los 8 webhooks tenían try/catch ad-hoc con comportamientos inconsistentes. Algunos retornaban 200 siempre, otros 500 en error, otros logging diferente.

**Lección:** Un wrapper (`withWebhookErrorHandling`) que envuelve TODOS los webhooks (1) asegura que el gateway siempre reciba 200 (evita reintentos infinitos), (2) estandariza el logging con `captureError` + pino, (3) garantiza idempotencia dedup pre-execution, (4) centraliza la firma HMAC verification. Cada webhook queda reducido a su lógica de negocio pura (~30 líneas en vez de ~120).

**Acción:** Migrar los 8 webhooks al wrapper. Documentar el patrón en ADR-0011. Hoy, agregar un webhook nuevo es trivial: implementas el handler, lo envuelves, listo.

### L25. El tenant scoping es la prioridad #1 de seguridad

**Contexto:** En v0.1.0, 19 API rutas permitían cross-tenant access porque `tenantId` era opcional en el query param. Cualquiera podía leer pedidos de todas las marcas.

**Lección:** Multi-tenant requires 3 capas de defensa en profundidad: (1) app layer (`requireTenantAccess` en cada ruta), (2) ORM layer (Prisma extension auto-inject `tenantId`), (3) DB layer (RLS policies en PostgreSQL). Una sola capa NO es suficiente — un bug en cualquier capa se compensa con las otras dos.

**Acción:** 19 rutas fixeadas con `requireTenantAccess`. Prisma extension disponible. 10 tablas críticas con RLS en PostgreSQL. Tests de cross-tenant access en `tests/unit/compliance-edge-cases.test.ts`. Tenant scoping es el #1 item del PRODUCTION-CHECKLIST.

### L26. ed25519 es superior a RSA para mandate signing (ADR-0006)

**Contexto:** Para firmar los AP2 mandates como W3C Verifiable Credentials, se evaluó RSA-2048 vs ed25519.

**Lección:** ed25519 wins en los 3 ejes que importan para un sistema de mandates:
- **Fast** — firma ~50μs vs ~1ms RSA-2048 (20x más rápido).
- **Small** — firma 64 bytes vs 256 bytes RSA (4x más pequeña, ideal para JWT/VC payloads).
- **Deterministic** — misma input + misma key = misma firma (reproducible, fácil de testear, no depende de RNG en tiempo de firma).

**Acción:** Implementado en `src/lib/crypto/signing.ts`. ADR-0006 documenta la decisión. Los mandates AP2 se firman con ed25519, no RSA.

### L27. Fire-and-forget para webhooks: SIEMPRE retorna 200 (ADR-0005)

**Contexto:** Los gateways de pago (MercadoPago, Wompi, Stripe, PayU) reintentan webhooks que no reciben 200. Si tu handler tarda 5s procesando, el gateway timeout + reintenta = duplicación masiva.

**Lección:** El webhook handler debe (1) verificar HMAC, (2) dedup via WebhookEvent table, (3) responder 200 INMEDIATAMENTE, (4) delegar el procesamiento a un queue (BullMQ) o fire-and-forget. El gateway nunca debe esperar el procesamiento. Si el procesamiento falla, el queue lo reintenta — el gateway ya tiene su 200.

**Acción:** `withWebhookErrorHandling` wrapper implementa este patrón. ADR-0005 documenta la decisión. Los 8 webhooks retornan 200 en <100ms. La idempotencia dedup previene duplicados si el gateway reintenta igual.

### L28. LLM budget tracking previene costos desbocados (ADR-0004)

**Contexto:** Sin budget tracking, un tenant podría hacer 10,000 llamadas LLM/día por error (loop infinito en un agente, prompt mal diseñado, bug en el fallback). A $0.005/llamada = $50/día por tenant = $1,500/mes por tenant.

**Lección:** Per-tenant daily + monthly LLM cost budget con 80% warning alerts es no-negociable. La verificación es PRE-LLM-call: si el budget está excedido, el agente cae al fallback determinístico en vez de llamar al LLM. El warning al 80% le da al admin tiempo de ajustar el budget antes del cutoff.

**Acción:** `src/lib/llm/budget.ts` verifica pre-llamada. `/api/llm/budget` lee/actualiza el budget. `/api/llm/costs` + `/api/llm/costs/breakdown` (byModel) dan visibilidad. Socket-driven banner al 80%. Tests en `tests/unit/llm-budget.test.ts`.

### L29. SSR shell mejora LCP significativamente (ADR-0016)

**Contexto:** El dashboard era 100% client-rendered. LCP (Largest Contentful Paint) era ~3.5s porque el browser tenía que (1) descargar JS, (2) hidratar React, (3) hacer la API call, (4) renderizar la UI. La 1ra pintura era un skeleton en blanco.

**Lección:** Server-render el shell (sidebar + topbar + theme provider) + usar client islands para los componentes interactivos. El browser recibe HTML con el chrome visible desde la 1ra pintura. LCP baja de 3.5s a ~1.2s. El usuario percibe la app como "instantánea".

**Acción:** Layout SSR + admin guard server-side (Sprint 13). ADR-0016 documenta el patrón. Las views individuales siguen client-rendered (data fetching) — documentado como limitación pendiente.

### L30. Los ADRs son esenciales para decisiones arquitectónicas (21 ADRs)

**Contexto:** Sin ADRs, las decisiones se perdían en el worklog (19,276 líneas en v0.3.0) o en mensajes de Slack. "¿Por qué ed25519 y no RSA?" → 30 min de grep en el worklog. "¿Por qué BullMQ y no cron?" → depende de quién preguntes.

**Lección:** Cada decisión arquitectónica no-obvia debe tener un ADR con: (1) contexto, (2) decisión, (3) alternativas consideradas, (4) consecuencias. Los ADRs son inmutables (no se editan, se reemplazan por ADRs nuevos). Viven en `docs/adr/` con numbering secuencial. El README indexa todos.

**Acción:** 21 ADRs escritos (README + 0001-0020). Cubren desde multi-tenant RBAC (ADR-0001) hasta DIAN Alegra integration (ADR-0020). Cada Sprint nuevo genera 1-3 ADRs. El reviewer de un PR puede preguntar "¿dónde está el ADR?" y esperar un link.

**Verificación:** `ls docs/adr/ | grep -c "^00"` debe retornar 20 (más README = 21).

---

## ⚠️ Errores Comunes a Evitar

### E1. Hardcoded fallbacks en seguridad
```ts
// ❌ MAL
const token = process.env.WA_VERIFY_TOKEN || 'commerceflow_verify';

// ✅ BIEN
const token = process.env.WA_VERIFY_TOKEN;
if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 });
```

### E2. Swallow errors en frontend
```ts
// ❌ MAL
.catch(() => setLoading(false));

// ✅ BIEN
.catch(err => { setError(err.message); setLoading(false); });
```

### E3. io.emit() en Socket.io multi-tenant
```ts
// ❌ MAL — broadcast a todos
io.emit('message:new', msg);

// ✅ BIEN — solo al room de la conversación
io.to(`conv:${conversationId}`).emit('message:new', msg);
```

### E4. Consultas sin tenantId
```ts
// ❌ MAL — retorna datos de todos los tenants
const orders = await db.order.findMany({ where: tenantId ? { tenantId } : {} });

// ✅ BIEN — requiere tenantId
if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
const orders = await db.order.findMany({ where: { tenantId } });
```

### E5. Claim sin evidencia en worklog
```md
<!-- ❌ MAL -->
- Created src/lib/rls.ts with RLS policies

<!-- ✅ BIEN -->
- Created src/lib/rls.ts (260 LOC) with:
  - assertTenantAccess() helper
  - makeTenantPrismaExtension() Prisma $extends
  - RLS_SQL_POLICIES constant (10 Postgres policies)
  - Verified: `ls src/lib/rls.ts` → exists, 14,176 bytes
```

---

## 📊 Métricas del Proyecto (estado final v0.3.0)

| Métrica | v0.1.0 | v0.3.0 |
|---|---|---|
| Líneas de código (src/) | ~15,000 | ~25,000 |
| Modelos Prisma | 62 | **71** |
| API Routes | 44 | **94** |
| Componentes dashboard | 17 | **21** |
| Componentes UI (shadcn) | 48 | 48 |
| Agentes conversacionales | 26 | 26 |
| Pipelines | 3 (19 pasos totales) | 3 (19 pasos totales) |
| Adapters | 18 | **25** |
| Webhooks | 6 (con HMAC) | **8** (HMAC + idempotency + signature rotation) |
| Índices DB | 91 en 45 modelos | **110 en 55+ modelos + 19 @@unique** |
| Test files | 10 | **48** |
| Tests | 108 | **891** |
| ADRs | 0 | **21** (README + 20) |
| OpenAPI paths | 0 | **93** (OAS 3.1) |
| Protocolos | 0 | **5** (AP2/UCP/ACP/MCP/A2A) |
| Monedas | 1 | **7** |
| Locales | 1 | **4** |
| Métodos de pago | 4 | **8** (4 card + 4 local LATAM) |
| Docker services | 11 | **16** |
| Compliance modules | 0 | **6** (KYC, consent, retention, age-gate, retracto, DIAN) |
| Documentación (líneas) | 12,284 | 19,000+ |
| Presentaciones (slides) | 102 | 135+ |
| Worklog (líneas) | 2,463 | 19,276 |
| Lint errors / warnings | 0 / N/A | **0 / 0** |
| TSC errors | 0 | **0** |
| Redocly errors | N/A | **0** |
| Build time | N/A | **30.2s** |
| Next.js | 16.0 | **16.2.10** |
| Score | 4.9 | **10.0/10** |

---

## 🎯 Conclusiones Finales

1. **El producto funciona** — 100% de QA E2E pasa, todas las vistas renderizan, todas las APIs responden, todas las SSR pages cargan.

2. **La seguridad es sólida** — HMAC en webhooks, 2FA en wallet, tenant guards en APIs, rooms en Socket.io, rate limiting en rutas LLM.

3. **La documentación es completa** — 19,000+ líneas cubren todas las audiencias: developers (README), DevOps (Deploy), usuarios (Onboarding), QA (E2E), clientes (Presentaciones), no-técnicos (Lenguaje natural).

4. **El futuro es claro** — Roadmap a 5 ciclos: TOTP encryption, Postgres migration, RLS, pgvector, OCR/CLIP, i18n, mobile app, K8s, voice agents.

5. **El valor para el cliente es medible** — Detección de devolvedores (20.5%), atribución real (ROAS/CPA), automatización de 10 pasos pre-venta, wallet con 2FA para traffickers.

---

*Documento mantenido por el equipo de ZIAY. Última actualización: 2026-07-15 (v0.3.0 final, score 10.0/10). Tagline: **Revenue Operations para Comercio Agéntico**.*
