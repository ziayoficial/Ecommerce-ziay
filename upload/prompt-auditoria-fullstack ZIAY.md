Antes de auditar nada, incorpora al repositorio los dos documentos de
gobernanza adjuntos:
- Guarda el contenido de `AGENTS.md` en la raíz del proyecto como `AGENTS.md`
  (si ya existe uno distinto ahí, no lo sobreescribas a ciegas: compáralo,
  y si difiere pregúntame cuál debe prevalecer antes de continuar).
- Guarda el contenido de `prompt-engineering-loops.md` en `docs/` (o en la
  raíz si el proyecto no tiene convención de `docs/` para este tipo de
  documento) como `prompt-engineering-loops.md`.
- Haz commit de ambos con Conventional Commits, ej.
  `docs: add AGENTS.md and prompt-engineering-loops.md as engineering standard`.
- A partir de este commit, estos dos documentos son el estándar vigente del
  proyecto: todo trabajo tuyo en este repo — este ciclo de auditoría y
  cualquier tarea futura — debe seguirlos, no solo como referencia sino como
  reglas que aplicas literalmente (flujo Explorar→Planificar→Ejecutar→Revisar,
  verificación no-negociable, trazabilidad con Task ID en `agent-ctx/`,
  módulos críticos con segunda revisión, etc.). Si en algún punto de este
  ciclo una instrucción mía entra en conflicto con lo que dicen esos MD,
  señálamelo explícitamente en vez de resolverlo en silencio.

Una vez hecho esto, vas a ejecutar un ciclo de auditoría autónoma full-stack
(backend + frontend + end-to-end + resiliencia) sobre este repositorio,
siguiendo al pie de la letra `AGENTS.md` → "Loop de auditoría autónoma" y
`prompt-engineering-loops.md` que acabas de incorporar. No saltes directo a
auditar: primero confírmame que ambos archivos quedaron commiteados y que
entendiste el flujo antes del paso 1.

<contexto>
Trabajas sobre ZIAY (Ecommerce-ziay), Next.js 16 / TypeScript 5 (strict) /
Prisma 6 (SQLite dev / PostgreSQL 16 prod, 35 RLS) / Bun / NextAuth v4 /
Socket.io / Tailwind 4 + shadcn/ui. Consulta AGENTS.md (reglas de ingeniería,
ya en la raíz tras el paso anterior), upload/LECCIONES-APRENDIDAS.md (no
repitas errores ya documentados — en particular L1: no confíes en un worklog
sin verificar contra disco), y docs/adr/ (22 ADRs — no propongas alternativas
ya evaluadas y descartadas ahí).
</contexto>

<alcance>
Todo el proyecto, declarado explícitamente como tal — por lo tanto el paso 1
(INVENTARIO) es obligatorio y no se salta:
- Backend: los 114+ endpoints bajo src/app/api/, los 78+ modelos de
  prisma/schema.prisma, los adapters en src/lib/adapters/, los 24 agentes IA en
  src/lib/agents/, el orchestrator, los cron jobs de instrumentation.ts.
- Frontend: componentes bajo src/components/ (dashboard + shadcn/ui), rutas
  SSR públicas (/t/[slug], /t/[slug]/p/[sku]), accesibilidad WCAG 2.1 AA,
  dark mode, responsive/mobile.
- End-to-end: los flujos cubiertos por e2e/*.spec.ts (auth, dashboard, api,
  governance, llm-costs, ssr-pages, status-page) y cualquier flujo de usuario
  crítico no cubierto todavía por Playwright.
- Resiliencia: circuit breakers (per-agent), reintentos de cron (DIAN retry,
  refund retry), manejo de fallos en webhooks (siempre 200 a Meta, idempotencia,
  rotación de firma), comportamiento ante caída de un adapter externo
  (LLM provider, pasarela de pago), degradación cuando Postgres/Redis no
  responden.
Fuera de alcance de este ciclo: provisión de infraestructura externa,
pentesting más allá de lo automatizable en este entorno, revisión contractual/SLA.
</alcance>

<criterio_de_hallazgo>
Usa la escala de 5 niveles ya definida en AUDIT-REPORT.md §2 — no inventes
otra:
- Critical: hueco explotable, pérdida de datos/dinero, outage total, bypass de
  RLS/2FA, webhook sin HMAC, ruta que expone datos sin auth. SLA 24h, bloquea
  release, fix solo mecánico-patrón.
- High: rotura de correctness en un path core, falta de tenantId guard, falta
  de validación Zod en una mutación, integración stub disfrazada de real,
  ausencia de manejo de fallo en un punto de resiliencia crítico. SLA 72h, fix
  solo mecánico-patrón.
- Medium: defecto de UX, falta de índice, error handling ausente en un path de
  lectura, console.log en prod, falta de tipo, retry sin backoff. SLA 1 semana.
- Low: cosmético, doc drift, a11y menor, warning de deprecación no bloqueante.
  SLA 2 semanas.
- Info: observación, sin acción requerida.
</criterio_de_hallazgo>

<autonomia_y_limites>
Autónomo para: inventariar, auditar, escribir fixes Medium/Low completos con
test, correr bun run test / test:e2e / lint / tsc, hacer commits atómicos
Conventional Commits con Task ID.
Fixes Critical/High: solo con el patrón mecánico ya validado en este proyecto
(añadir requireTenantAccess, añadir schema Zod, cerrar fallback de token
público, envolver una llamada externa con el circuit breaker existente) — nunca
un rediseño de flujo sin segunda pasada.
NUNCA decidas solo, pausa y pregúntame: cambios de tasas/comisiones/montos,
elección entre proveedores de pago o LLM cuando ambos son técnicamente válidos,
cualquier cambio de comportamiento observable en wallet, payouts/escrow, DIAN,
KYC, o firma de mandatos AP2 — estos van con segunda revisión aunque el fix
"se vea" simple. Qué hacer con datos de un tenant ya bloqueado. Rotación de
credenciales expuestas — repórtalas, no las regeneres vos.
</autonomia_y_limites>

<condicion_de_parada>
Detente cuando se cumplan las tres:
(a) Cobertura: backend, frontend, e2e y los 4 puntos de resiliencia arriba
    fueron auditados al menos una vez.
(b) Cero Critical/High abiertos: una re-auditoría completa no arroja hallazgos
    Critical/High nuevos (Medium/Low/Info pueden quedar en backlog
    documentado).
(c) Suite verde: bun run lint && npx tsc --noEmit && bun run test &&
    bun run test:e2e pasan sin regresión frente al baseline actual.
Máximo 3 ciclos de re-auditoría en total. Si al tercero siguen apareciendo
hallazgos nuevos del mismo tipo, detente y repórtalo como causa raíz
arquitectónica pendiente — no sigas parchando síntomas.
</condicion_de_parada>

<formato_de_entrega>
Al final de cada ciclo (y al cierre final):
1. Tabla de hallazgos (id, archivo:línea, severidad, causa raíz, fix aplicado,
   test que lo cubre) — formato de AUDIT-REPORT.md §3.
2. Un archivo por tarea sustancial en agent-ctx/<TASK-ID>-<rol>.md.
3. Entrada nueva en CHANGELOG.md.
4. Lección nueva en upload/LECCIONES-APRENDIDAS.md solo si el hallazgo revela
   un patrón reincidente, no por cada bug individual.
5. Backlog explícito de lo pendiente y por qué (ambigüedad de negocio,
   decisión humana requerida, fuera de alcance).
No des la tarea por terminada sin este entregable — "creo que quedó bien" no
es un cierre de ciclo válido.
</formato_de_entrega>
