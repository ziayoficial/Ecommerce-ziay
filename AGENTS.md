# AGENTS.md — reglas de ingeniería para trabajo asistido por IA

## Stack y comandos
- Lenguaje/framework: TypeScript 5 (strict, 0 errores), Next.js 16.2.10 (App Router,
  Turbopack, SSR shell + client islands), React 19
- Base de datos: Prisma 6 — SQLite en dev (`file:./dev.db`), PostgreSQL 16 en
  staging/prod (35 políticas RLS a nivel de tabla, multi-tenant). El provider se
  auto-detecta, nunca se edita `prisma/schema.prisma` a mano para cambiar de motor.
- UI: Tailwind CSS 4 + shadcn/ui (48 componentes, WCAG 2.1 AA), texto de UI en
  español (mercado LATAM)
- Auth: NextAuth.js v4 + JWT + RBAC (6 roles) + TOTP 2FA (AES-256-GCM en reposo)
- Runtime/paquetes: Bun 1.3+ (recomendado) o Node.js 20+; sin build step aparte de
  Next.js — instalar con `bun install`
- Real-time: Socket.io (`mini-services/chat-service`, puerto 3003)
- Instalar dependencias:
  ```bash
  bun install
  ```
- Levantar el entorno de desarrollo (equivalente a "build/dev"):
  ```bash
  bun run dev              # Next.js en :3000, log en dev.log
  cd mini-services/chat-service && bun run index.ts   # Socket.io en :3003 (opcional)
  caddy run --config Caddyfile                        # Gateway local (opcional)
  ```
- Base de datos (siempre tras tocar `prisma/schema.prisma`):
  ```bash
  bun run db:push       # push del schema (auto-detecta sqlite/postgres)
  bun run db:generate   # regenera el cliente Prisma tipado
  bun run db:seed       # datos demo/reference
  ```
- Correr TODA la suite de tests:
  ```bash
  bun run test           # vitest run — unit + integration
  bun run test:e2e       # playwright test — E2E
  ```
- Correr un subconjunto de tests (vitest no tiene `--group`; se filtra por ruta o
  nombre):
  ```bash
  bunx vitest run src/lib/wallet          # todo lo que matchee la ruta
  bunx vitest run -t "requireTenantAccess"  # por nombre de test/describe
  bunx playwright test e2e/auth.spec.ts   # un archivo e2e puntual
  ```
- Lint / typecheck:
  ```bash
  bun run lint            # eslint . (0 errores permitidos; warnings existentes no bloquean)
  npx tsc --noEmit         # 0 errores permitidos
  ```
- Validar el contrato de API antes de dar por buena una ruta nueva:
  ```bash
  npx @redocly/cli lint docs/openapi.yaml --config .redocly.yaml
  ```

## Flujo de trabajo obligatorio: Explorar → Planificar → Ejecutar → Revisar
No saltes directo a editar código, ni siquiera en tareas que parezcan simples.
1. **Explorar**: lee los archivos relevantes al alcance de la tarea antes de proponer
   cambios. No asumas el comportamiento de un módulo sin leerlo — este repo tiene un
   historial documentado de `worklog.md` afirmando rutas que no existían en disco
   (ver `upload/LECCIONES-APRENDIDAS.md` → L1). Para búsquedas amplias en el código,
   usar el escaneo recursivo del árbol de Git (`GET /repos/{REPO}/git/trees/main?recursive=1`)
   es más confiable que adivinar rutas.
2. **Planificar**: si la tarea es ambigua, no trivial, o toca más de un archivo,
   escribe primero un plan breve (qué vas a cambiar y por qué) antes de escribir
   código. En herramientas con "plan mode" (solo lectura), úsalo.
3. **Ejecutar**: implementa siguiendo el plan. Si descubres que el plan estaba mal
   a mitad de camino, dilo explícitamente antes de desviarte, no cambies de rumbo
   en silencio.
4. **Revisar**: corre la verificación (ver abajo) antes de declarar la tarea
   terminada. "Creo que funciona" no es revisión — un worklog narrativo tampoco lo es.

## Alcance
- No modifiques código fuera del alcance de la tarea asignada, salvo que sea
  estrictamente necesario para completarla. Si detectas una mejora fuera de alcance,
  repórtala por separado (backlog, no la mezcles en el mismo commit).
- No toques código ya verificado como funcionando en una tarea anterior, a menos que
  la tarea actual lo requiera explícitamente.
- Si la instrucción es abierta o ambigua, define 2-3 casos de prueba concretos que
  acoten el alcance antes de codear. Si sigue ambiguo, pregunta (ver "Decisiones de
  producto" abajo) en vez de asumir.

## Verificación — no negociable
- Todo fix, sin excepción (incluyendo cambios de una línea), viene con un test que lo
  verifica: `bun run test` (Vitest, unit + integration) y, si el cambio toca una
  ruta o flujo navegable, `bun run test:e2e` (Playwright). El test debe importar y
  ejercer el código real, nunca reimplementar la misma lógica de forma aislada
  dentro del propio archivo de test.
- Al terminar cada cambio, corre la suite completa (`bun run test`), no solo el test
  nuevo, y confirma explícitamente que nada existente se rompió (debe mantenerse en
  verde, ≥ tests existentes — ver el número vigente en `README.md` / badge de
  `CHANGELOG.md`) antes de dar la tarea por terminada.
- Pre-flight local obligatorio antes de push, replicando el pipeline de CI de 6 jobs
  (`.github/workflows/ci.yml`: lint, typecheck, unit-tests, openapi, build, e2e):
  ```bash
  bun run lint && npx tsc --noEmit && bun run test && bun run test:e2e
  ```
- El repo ya trae un git hook (`.githooks/pre-commit`, activado vía
  `git config core.hooksPath .githooks`) que corre `tsc --noEmit --incremental` y
  lint de los archivos en stage antes de cada commit. No lo desactives con
  `--no-verify` salvo para un WIP explícito que tú mismo vas a squashear.
- Si la ambigüedad lo permite, deja verificación automática no-negociable ya
  configurada (el pre-commit hook, el CI de 6 jobs) en vez de depender solo del
  juicio del modelo en cada paso.

## Contra los "fixes cosméticos"
- Un cambio que "se ve" resuelto no cuenta como resuelto hasta que verificaste el
  dato/comportamiento de punta a punta: desde su origen (DB/Prisma, API route,
  adapter externo) hasta su destino final (UI, respuesta de API, webhook saliente).
  Ejemplo real de este repo: el dashboard raíz tiraba
  `TypeError: NAV_ITEMS.find is not a function` porque `page.tsx` (Server
  Component) importaba una constante desde un módulo `'use client'`
  (`sidebar.tsx`) — Turbopack devuelve un proxy no serializable en ese caso.
  Parecía un bug de datos, pero era un problema de límite RSC/client boundary;
  el fix real fue mover `NAV_ITEMS` a un módulo plano sin `'use client'`
  (ver `agent-ctx/IF-1-full-stack-developer-p0-blockers.md`).
- No des por buena una función, ruta o componente nuevo sin confirmar que algo más
  en el sistema realmente lo consume (registrado en `AGENT_NAMES`/`AGENT_LABELS`,
  montado en el router de `src/app/`, invocado por un webhook real). Código que
  nadie invoca no es una solución — este repo ya tuvo módulos "documentados" en
  `worklog.md` (`src/lib/rls.ts`, `src/lib/llm/`, `src/lib/vision/`,
  `src/lib/embeddings/`) que **no existían en disco**.
- Desconfía de comentarios/documentación que describen una intención sin código real
  que la ejecute.
- Si un cambio de UI no se refleja, revisa primero si el server component/client
  component boundary está bien puesto, o si hay caché de Next (`.next/cache`) o del
  build de Turbopack de por medio antes de asumir que el fix no funcionó
  (`scripts/clean-cache.sh` limpia `tsconfig.tsbuildinfo`, `.eslintcache`,
  `.next/cache`, `node_modules/.vite`).

## Trazabilidad
- Marca cada fix con una referencia identificable (Task ID, siguiendo la
  convención ya usada en `agent-ctx/` — p. ej. `IF-1`, `SPRINT6-ARCH-001`,
  `HARDENING-001`) en el código y en el commit, usando Conventional Commits
  (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`).
- Cada tarea de agente sustancial deja su propio archivo en
  `agent-ctx/<TASK-ID>-<rol>.md` con contexto cargado, cambios hechos y
  verificación corrida — no reemplaces esto por un mensaje de commit largo.
- Actualiza `worklog.md` con lo que realmente cambió, y solo lo que realmente
  cambió — no dupliques ahí afirmaciones que no puedas respaldar con
  archivo:línea.
- No dejes código muerto "por si acaso". Si algo queda obsoleto, elimínalo o deja un
  comentario explícito de por qué no debe usarse — nunca lo sigas parcheando como si
  estuviera en uso.
- Si tocas documentación (`docs/`, `README.md`, ADRs), verifica que coincide con el
  estado real del código; no la des por correcta solo porque ya existía.

## Seguridad por defecto
- Nunca incluyas credenciales, tokens ni secretos en código, commits, ni en el propio
  prompt/conversación. En producción la resolución de secretos es *fail-closed* — sin
  fallback hardcodeado — y así debe seguir.
- Valida todo input de rutas API con Zod antes de tocar la base de datos.
- Toda ruta API tenant-scoped debe llamar `requireTenantAccess(tenantId)` — 9 rutas
  de bypass cross-tenant ya se cerraron en una auditoría anterior; no reintroduzcas
  el patrón de leer `tenantId` de un query param sin validar sesión.
- Toda ruta que recibe webhooks (WhatsApp, Meta, pasarelas de pago) verifica firma
  HMAC-SHA256 con `timingSafeEqual` + idempotencia (2 capas) + período de gracia de
  rotación de firma. Nunca un fallback a un token público por defecto si la env var
  no está seteada.
- Secretos y TOTP en reposo van cifrados con AES-256-GCM, nunca en texto plano.
- Nunca `console.log` en código de servidor — usa el `logger` (pino). Alertas van a
  través de `sendAlert()` (4 canales: log + Sentry + socket.io + webhook), no a
  `console.error` suelto.
- Revisa con cuidado extra la lógica de autenticación/roles/RLS que generes: puede
  verse correcta sin proteger nada realmente (ver ejemplo real: `GET /api/wallet`
  exponía balance/transacciones sin chequeo de sesión, solo con un query param).
- Si un token o contraseña queda expuesto en texto plano en un archivo del proyecto,
  una sesión de chat o un commit, **rotarlo de inmediato** — borrarlo del archivo no
  invalida el secreto ya expuesto.

## Decisiones de producto
- Si un fix requiere una decisión de negocio (tasa de comisión, elección entre
  proveedores de pago/canal válidos igual de correctos técnicamente, qué pasa con
  datos de un tenant/vendor bloqueado, cambio de comportamiento observable en un
  cálculo financiero ya en producción), pregunta antes de asumir.
- Declara tu interpretación del alcance antes de ejecutar cambios grandes o ambiguos.

## Revisión como último filtro
- Trata cada cambio como un pull request que debe revisarse y aprobarse — nunca se
  fusiona a ciegas aunque los tests pasen. El flujo estándar es rama `feat/`/`fix/`
  → PR → squash-merge a `main`.
- Para cambios críticos (wallet, payouts/escrow, DIAN — facturación electrónica vía
  Alegra, KYC, anti-fraude — velocity/blocklist/OFAC/3DS/CVV-AVS, firma de mandatos
  AP2 con ed25519, cualquier pasarela de pago — MercadoPago/Wompi/Stripe/PayU/PSE/
  PIX/OXXO/SPEI), usa una segunda pasada o un segundo modelo para revisar el diff
  antes de darlo por bueno.
- Control de versiones real, sin excepciones: revisa diffs vía GitHub API o
  `git diff` antes de cada push a `main`, y confirma que los 6 jobs de CI
  (lint, typecheck, unit-tests, openapi, build, e2e) están en verde.

---

## Loop de auditoría autónoma (Audit → Fix → Re-audit)

> Este proyecto ya opera así en la práctica: `AUDIT-PLAN.md` → `AUDIT-REPORT.md`
> (ciclo full-stack, 42 hallazgos, Critical 8→0), los ciclos de auditoría fintech en
> 3 iteraciones (score 5.5→8.8/10, ver `public/presentaciones/AUDITORIA-FINTECH-V3-FINAL.md`),
> la auditoría de seguridad no-fintech (`AUDITORIA-FULL-SECURITY-CODE-TEST.md`) y de
> UX/SEO/docs/deploy (`AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md`), y decenas de tareas
> con Task ID documentadas en `agent-ctx/` (`SPRINT1`…`SPRINT8`, `IA-1`…`IA-6A`,
> `IF-1`…`IF-4`, `I2-R3`, `I2-R8R11R12`, `I2-R9R10`, `HARDENING-001`, `AUTOFIX-D`,
> etc.) son ejemplos reales de este patrón. Esta sección lo formaliza como
> procedimiento estándar para tareas de auditoría/hardening de alcance amplio
> ("audita todo el proyecto", "cierra todos los gaps de X módulo").

### Cuándo usar este loop
- Auditorías full-stack de un módulo o del proyecto completo.
- Barridos de hardening (seguridad, performance, accesibilidad, regresiones) sin un
  bug puntual ya identificado.
- Cierre de un ciclo de release antes de un deploy mayor (como los ciclos v0.3.0 y
  v0.4.3 "Production Hardened").

No lo uses para un fix puntual y acotado — para eso basta el flujo
Explorar → Planificar → Ejecutar → Revisar de arriba, sin el envoltorio de auditoría.

### Estructura del loop

```
1. INVENTARIO   → mapear el módulo/proyecto (árbol de archivos, rutas API,
                   modelos Prisma, agentes registrados).
2. AUDITORÍA    → identificar hallazgos concretos, uno por uno, con evidencia
                   (archivo:línea, comportamiento observado vs. esperado).
3. PRIORIZACIÓN → clasificar cada hallazgo con la escala de 5 niveles ya usada
                   en AUDIT-REPORT.md §2:
                   Critical (hueco explotable, pérdida de datos/dinero, outage
                     total, bypass de RLS/2FA, webhook sin HMAC) — SLA 24h,
                     bloquea release
                   High (rotura de correctness en un path core, falta de
                     tenantId guard, integración stub disfrazada de real) — SLA 72h
                   Medium (defecto de UX, falta de índice, console.log en prod,
                     falta de tipo) — SLA 1 semana
                   Low (cosmético, doc drift, a11y menor) — SLA 2 semanas
                   Info (observación, sin acción requerida)
4. FIX          → resolver 1:1, cada hallazgo con su propio fix + test, según
                   "Verificación — no negociable" de arriba. Critical/High solo
                   con fix mecánico-patrón (ver tabla de severidad); Medium/Low
                   pueden llevar diff más amplio si queda documentado.
5. RE-AUDITORÍA → repetir el escaneo del módulo tocado para detectar
                   regresiones o hallazgos nuevos introducidos por los fixes.
6. STOP CHECK   → evaluar condición de parada (ver abajo) antes de iterar de nuevo.
```

### Autonomía dentro del loop — y sus límites
El agente puede y debe operar de forma autónoma **dentro de una iteración técnica**
(auditar código, escribir fixes, correr tests, hacer commits atómicos) sin pedir
permiso en cada paso, siempre que:
- cada hallazgo tenga una solución técnica objetivamente correcta (no ambigua), y
- no toque los módulos marcados como críticos en "Revisión como último filtro"
  (wallet, payouts/escrow, DIAN, KYC, anti-fraude, firma AP2, pasarelas de pago)
  sin pasar igualmente por la segunda pasada de revisión ya exigida arriba.

El agente **debe pausar y preguntar** (no asumir) cuando un hallazgo requiere una
decisión de negocio — mismo criterio que "Decisiones de producto" arriba. Ejemplos
reales de este proyecto: los 2 hallazgos High que quedaron abiertos por diseño en
el ciclo de auditoría full-stack (cifrado en reposo del secreto TOTP + migración de
RLS a Postgres) porque requerían migraciones de schema y cambio de provider fuera
del alcance de un ciclo autónomo — se documentaron como condiciones en vez de
forzarse. La instrucción "sé autónomo, no preguntes" aplica al *cómo* técnico,
nunca a decisiones de negocio o a saltarse la segunda revisión en módulos
financieros — esas reglas del documento son no-negociables y no se relajan por el
modo loop.

### Condiciones de parada (obligatorias, no "hasta el 100% de productividad")
"100% de productividad" no es una condición verificable — sin criterio de parada
explícito el loop no converge, quema presupuesto de cómputo/tokens y arriesga
tocar código ya estable sin necesidad ("Alcance" arriba). Usa en su lugar:
- **Cobertura del inventario**: todos los archivos/módulos del alcance declarado
  fueron revisados al menos una vez.
- **Cero Critical abiertos**: es el gate de release real de este proyecto — el
  ciclo de auditoría full-stack cerró con "Critical = 0 open → release-blocker
  gate PASSED". Una re-auditoría completa del alcance no debe producir Critical/High
  nuevos sin resolver (Low/Info pueden quedar en backlog documentado).
- **Suite verde**: `bun run test` + `bun run test:e2e` pasan (≥ tests existentes,
  sin regresiones), y los 6 jobs de CI en verde.
- **Límite de iteraciones**: si tras 3 ciclos de re-auditoría siguen apareciendo
  hallazgos nuevos del mismo tipo, detente y reporta — probablemente hay una causa
  raíz arquitectónica que necesita decisión humana, no otro parche.
- Al llegar a cualquiera de estas condiciones, entrega un resumen: hallazgos
  encontrados, fixes aplicados, tests agregados, y lo que quedó pendiente (con
  motivo, siguiendo el mismo formato de "Open (accepted)" que usa
  `AUDIT-REPORT.md`). Ver `prompt-engineering-loops.md` para el detalle de cómo
  estructurar este resumen y el prompt del propio loop.

### Registro de cada ciclo
- Cada hallazgo resuelto se documenta como una lección nueva en
  `upload/LECCIONES-APRENDIDAS.md` si revela un patrón de error reincidente (ya
  tiene un historial de versiones por ciclo — v0.1 a v4.3 — y lecciones numeradas
  L1, L2...; solo se agrega si generaliza, no cada bug individual).
- Cada tarea de agente sustancial deja su propio archivo en
  `agent-ctx/<TASK-ID>-<rol>.md` (contexto cargado, root cause, fix, verificación).
- Cada ciclo completo se resume en `CHANGELOG.md` y, si aplica a un hito de
  release, en `RELEASE-NOTES.md`.

---
Regla madre: generar código ya no es el cuello de botella — verificar que hace lo que
dice hacer sí lo es. Cada regla de este documento mueve esa verificación al momento en
que el cambio se propone, no a cuando alguien lo descubre roto en producción.
