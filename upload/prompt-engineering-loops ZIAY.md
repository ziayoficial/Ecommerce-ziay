# Prompt Engineering para Loops de Auditoría Autónoma — ZIAY

> Guía de mejores prácticas para escribir prompts que disparan loops de agente
> ("vibe coding" autónomo) sobre este repositorio. Complementa a `AGENTS.md`
> (reglas de ingeniería). Está basada en los ciclos de auditoría reales ya
> ejecutados sobre el proyecto — el ciclo full-stack de `AUDIT-PLAN.md` →
> `AUDIT-REPORT.md` (42 hallazgos, Critical 8→0), la auditoría fintech en 3
> iteraciones (score 5.5→8.8/10), las auditorías de seguridad y UX/SEO/docs/deploy
> en `public/presentaciones/`, y las decenas de tareas con Task ID documentadas en
> `agent-ctx/` — y en las lecciones acumuladas en `upload/LECCIONES-APRENDIDAS.md`.

---

## 1. Por qué un prompt de loop "abierto" falla

Un prompt de loop mal especificado se ve, en esencia, así:

> *"Audita todo el proyecto, soluciona todos los hallazgos, re-audita, repite las
> veces necesarias hasta el 100% de productividad. Eres autónomo, no preguntes."*

Funciona como intención, pero como prompt de ingeniería tiene tres huecos que en
un repo de este tamaño (78+ modelos Prisma, 114 rutas de API, 24 agentes IA,
multi-tenant con RLS, compliance LATAM — DIAN/KYC/Ley 1581) se pagan caro:

| Problema | Por qué falla | Qué pasa en la práctica |
|---|---|---|
| Sin alcance declarado | "todo el proyecto" no es un conjunto verificable | El agente re-audita módulos ya estables, gasta presupuesto, o dos tareas paralelas se pisan (ver `AGENTS.md` → "Alcance") |
| Sin condición de parada | "100% de productividad" no es medible | El loop no converge; sigue "encontrando" hallazgos Low/Info cosméticos indefinidamente |
| "No preguntes" sin excepciones | Choca con reglas ya no-negociables del proyecto (financiero, KYC, segunda revisión) | El agente puede tomar una decisión de negocio (ej. qué pasa con un tenant bloqueado, elegir pasarela de pago) sin que nadie la apruebe |
| Worklog como única fuente de verdad | Un worklog narrativo puede afirmar cobertura que no existe en disco | Ya pasó en este proyecto: el worklog inicial claimaba `src/lib/rls.ts`, `src/lib/llm/`, `src/lib/vision/`, `src/lib/embeddings/` — **ninguno existía** (ver `upload/LECCIONES-APRENDIDAS.md` → L1) |

La versión mejorada no elimina la autonomía — la acota a lo que **sí** puede
decidirse sin intervención humana, y define explícitamente cuándo parar y cuándo
escalar.

---

## 2. Anatomía de un buen prompt de loop

Un prompt de loop autónomo efectivo tiene siempre estas seis partes. Faltar
cualquiera de ellas es la causa más común de loops que no convergen o que se
salen de alcance.

```xml
<contexto>
  Qué es el sistema, qué stack usa, qué documentos de referencia existen
  (AGENTS.md, upload/LECCIONES-APRENDIDAS.md, docs/adr/). No asumas que el
  agente "ya sabe" — nómbralos explícitamente.
</contexto>

<alcance>
  Módulo(s) o directorio(s) exactos. "src/lib/wallet/ + src/app/api/wallet/"
  no "el proyecto". Si de verdad es todo el proyecto, dilo explícitamente y
  exige un inventario previo (paso 1 del loop) antes de tocar nada.
</alcance>

<criterio_de_hallazgo>
  Qué cuenta como "hallazgo": ¿solo bugs funcionales? ¿también deuda técnica?
  ¿también cosmético/a11y? Define la escala de 5 niveles igual que
  AUDIT-REPORT.md §2 (Critical/High/Medium/Low/Info).
</criterio_de_hallazgo>

<autonomia_y_limites>
  Qué puede decidir solo el agente vs. qué requiere pausa. Nombra los módulos
  críticos explícitamente (wallet, payouts/escrow, DIAN, KYC, anti-fraude,
  firma AP2, pasarelas de pago).
</autonomia_y_limites>

<condicion_de_parada>
  Medible, no aspiracional. Ver sección 4.
</condicion_de_parada>

<formato_de_entrega>
  Qué reporte final esperas: tabla de hallazgos, entrada en CHANGELOG.md,
  archivo en agent-ctx/, lección nueva si aplica. Ver sección 6.
</formato_de_entrega>
```

### Ejemplo aplicado a este repo

```
<contexto>
Trabajas sobre ZIAY (Ecommerce-ziay), Next.js 16 / TypeScript 5 / Prisma 6 /
Bun. Sigue AGENTS.md (Explorar→Planificar→Ejecutar→Revisar + sección "Loop de
auditoría autónoma"). Consulta upload/LECCIONES-APRENDIDAS.md antes de tocar
RLS, tenant scoping, o el límite server/client component de Next — ya hay
lecciones documentadas sobre ambos.
</contexto>

<alcance>
src/lib/wallet/, src/app/api/wallet/, y su cobertura en tests/ + src/**/*.test.ts.
Fuera de alcance: adapters de pasarelas de pago (src/lib/adapters/), módulo DIAN,
frontend fuera de la vista de wallet en el dashboard.
</alcance>

<criterio_de_hallazgo>
Critical: cualquier ruta donde el balance/transacción mostrado o persistido
pueda divergir del real (redondeo, condición de carrera, falta de tenant guard,
falta de auth en una ruta que expone saldo).
High: bug funcional sin exposición de datos, pero que rompe un flujo core
(ej. retiro que no actualiza estado).
Medium/Low/Info: según AUDIT-REPORT.md §2.
</criterio_de_hallazgo>

<autonomia_y_limites>
Autónomo para: leer código, escribir fixes Medium/Low, escribir tests, correr
`bun run test`, hacer commits atómicos con Conventional Commits.
Fixes Critical/High solo con el patrón mecánico ya validado (añadir
`requireTenantAccess`, añadir schema Zod, cerrar un fallback de token público) —
nunca un rediseño del flujo sin segunda pasada.
Pausa y pregunta si: un fix cambia el comportamiento observable de un cálculo
financiero ya en producción (requiere aprobación antes de mergear, no solo de
codear). Nunca asumas la resolución de un caso de negocio ambiguo (ej. qué pasa
con el saldo de un tenant ya suspendido).
</autonomia_y_limites>

<condicion_de_parada>
Detente cuando: (a) src/lib/wallet/ y src/app/api/wallet/ fueron auditados al
menos una vez, (b) una re-auditoría no arroja Critical/High nuevos, (c)
`bun run test` completo pasa en verde sin regresión.
Máximo 3 ciclos de re-auditoría; si el 3° ciclo sigue arrojando hallazgos del
mismo tipo, detente y repórtalo como causa raíz arquitectónica pendiente.
</condicion_de_parada>

<formato_de_entrega>
Tabla de hallazgos (id, archivo:línea, severidad, fix, test) en el mismo
formato que AUDIT-REPORT.md §3, archivo nuevo en agent-ctx/<TASK-ID>-wallet-audit.md,
entrada nueva en CHANGELOG.md, y si aplica, lección nueva en
upload/LECCIONES-APRENDIDAS.md.
</formato_de_entrega>
```

---

## 3. El loop en sí: Explorar → Auditar → Priorizar → Fix → Re-auditar

Ver `AGENTS.md` → "Loop de auditoría autónoma" para el procedimiento completo.
Puntos de prompt engineering específicos por fase:

- **Explorar/Inventario**: pide explícitamente el escaneo recursivo del árbol
  (`git/trees/{branch}?recursive=1`) en vez de dejar que el modelo adivine rutas
  por nombre de módulo — este repo ya tuvo un worklog que afirmaba paths que no
  existían en disco (`src/lib/rls.ts`, `src/lib/llm/`); la exploración por árbol
  real evita repetir ese error.
- **Auditar**: exige evidencia por hallazgo (`archivo:línea` + comportamiento
  observado vs. esperado), nunca "parece que hay un problema en X". Un hallazgo
  sin evidencia verificable no es un hallazgo, es una sospecha. `AUDIT-REPORT.md`
  ya modela este formato con su tabla `# | Severity | Workstream | Finding |
  Status | Fix reference`.
- **Priorizar**: usa la misma escala de 5 niveles que ya usa el proyecto
  (Critical/High/Medium/Low/Info, `AUDIT-REPORT.md` §2) — reutilizar el
  vocabulario existente evita ambigüedad entre sesiones y entre agentes distintos.
- **Fix**: un hallazgo, un fix, un test — nunca un commit que agrupa "varios
  arreglos relacionados" sin desglosar, porque rompe la trazabilidad exigida en
  `AGENTS.md` → "Trazabilidad" (cada tarea sustancial tiene su propio Task ID y
  su propio archivo en `agent-ctx/`).
- **Re-auditar**: repite el auditar solo sobre lo tocado en este ciclo, no todo
  el alcance de nuevo desde cero (salvo que sea el ciclo de cierre) — si no, el
  costo crece cuadráticamente con el número de iteraciones.

---

## 4. Condiciones de parada: la parte que más se olvida

Un loop sin condición de parada verificable es la causa #1 de que un agente
"itere para siempre" o se detenga arbitrariamente a mitad de camino. Usa
condiciones que se puedan responder con sí/no a partir de datos reales del
repo, no con una sensación de "ya está bastante bien":

| Mala condición | Buena condición |
|---|---|
| "hasta el 100% de productividad" | "hasta que Critical = 0 abiertos (el mismo release-blocker gate que ya usa AUDIT-REPORT.md)" |
| "hasta que quede perfecto" | "hasta que `bun run test` + `bun run test:e2e` pasen en verde (≥ N tests, sin regresión) y los 6 jobs de CI estén verdes" |
| "arréglalo todo" | "arregla los hallazgos del inventario inicial; los nuevos que aparezcan en la re-auditoría van a un ciclo 2 explícito, no se mezclan con el ciclo 1" |
| (sin límite de iteraciones) | "máximo 3 ciclos de re-auditoría por módulo; al 3° reporta causa raíz en vez de seguir parcheando síntomas" |

Un límite de iteraciones no es desconfianza en el agente — es lo mismo que un
`max_retries` en cualquier sistema: sin él, un bug que genera otro bug al
arreglarse (loop de regresión) consume presupuesto indefinidamente sin que nadie
se entere hasta que alguien revisa la factura o el historial de commits. Este
repo ya documentó el patrón contrario que sí funciona: el ciclo fintech cerró en
3 iteraciones explícitas (5.5 → 6.x → 7.x → 8.8/10), no en un loop indefinido.

---

## 5. Autonomía real vs. autonomía de fachada

"No preguntes" es útil para eliminar fricción en decisiones **técnicas** donde
solo hay una respuesta correcta (¿la ruta necesita `requireTenantAccess`? sí, si
es tenant-scoped — patrón ya establecido y mecánico). Es peligroso aplicado sin
matices a decisiones **de negocio o de riesgo**, que es exactamente lo que
`AGENTS.md` ya distingue en "Decisiones de producto" y "Revisión como último
filtro".

Regla práctica para el prompt: enumera explícitamente qué NO puede decidir el
agente solo, en vez de confiar en que "usará buen juicio". En este proyecto, como
mínimo:
- Cambios de tasas, comisiones o montos financieros.
- Elección entre proveedores/canales cuando ambos son técnicamente válidos (ej.
  qué pasarela de pago local usar para un mercado nuevo, o qué proveedor LLM
  priorizar en el adapter multi-provider).
- Cualquier cambio de comportamiento observable en wallet, payouts/escrow,
  DIAN (facturación electrónica), KYC, o firma de mandatos AP2, sin la segunda
  pasada de revisión — los dos hallazgos High que este proyecto dejó abiertos
  por diseño (cifrado TOTP en reposo + migración RLS a Postgres) son el ejemplo
  real de "documentar en vez de forzar" cuando la decisión excede el ciclo
  autónomo.
- Qué hacer con datos de un tenant/vendor específico ya bloqueado o en disputa.
- Rotación o manejo de credenciales expuestas — repórtalo, no lo "arregles" tú
  mismo generando una nueva credencial sin que el dueño del proyecto la rote.

---

## 6. Formato de entrega de cada ciclo

Un loop que no deja rastro verificable es indistinguible de un loop que no hizo
nada. Cada ciclo debe cerrar con:

1. **Tabla de hallazgos** (id, archivo:línea, severidad, causa raíz, fix aplicado,
   test que lo cubre) — mismo formato que ya usa `AUDIT-REPORT.md` §3.
2. **Archivo de tarea en `agent-ctx/<TASK-ID>-<rol>.md`** con el contexto cargado,
   el root cause de cada fix (no solo el diff) y la verificación corrida — este es
   el formato que ya usan decenas de tareas reales del proyecto (`IF-1`, `IA-4`,
   `SPRINT6-ARCH-001`, etc.).
3. **Entrada en `CHANGELOG.md`**, y si cierra un hito de release, en
   `RELEASE-NOTES.md`.
4. **Lección nueva en `upload/LECCIONES-APRENDIDAS.md`** solo si el hallazgo
   revela un patrón reincidente o una regla preventiva nueva (no cada bug
   individual necesita una lección — solo los que enseñan algo generalizable,
   como ya hace el historial de versiones L1...L-actual de ese archivo).
5. **Backlog explícito de lo que quedó pendiente** y por qué (ambigüedad de
   negocio, requiere decisión humana, fuera del alcance declarado del ciclo) —
   igual que la sección "Open (accepted)" de `AUDIT-REPORT.md`.

---

## 7. Checklist rápido antes de lanzar un loop

- [ ] ¿El alcance es un conjunto de archivos/módulos verificable, no "todo"?
- [ ] ¿La condición de parada se puede responder con sí/no desde el repo (tests,
      re-auditoría, inventario, Critical=0), no desde una sensación subjetiva?
- [ ] ¿Hay un límite explícito de iteraciones de re-auditoría?
- [ ] ¿Está explícito qué decisiones NO puede tomar el agente solo?
- [ ] ¿El formato de entrega por ciclo está definido (tabla de hallazgos +
      archivo en agent-ctx/ + CHANGELOG + lección si aplica)?
- [ ] ¿Los módulos financieros/KYC/DIAN/pagos tienen la segunda revisión exigida
      en `AGENTS.md`, incluso dentro del loop?
- [ ] ¿Ninguna credencial o secreto va a terminar en un commit, log, o prompt
      como texto plano durante el loop?
- [ ] ¿Se verificaron los claims del worklog contra el disco antes de asumir
      cobertura existente (ver L1 de `upload/LECCIONES-APRENDIDAS.md`)?

---

## 8. Referencia cruzada

- `AGENTS.md` — reglas de ingeniería no-negociables + sección "Loop de auditoría
  autónoma" (el procedimiento operativo que este documento explica cómo redactar
  en forma de prompt).
- `AUDIT-PLAN.md` / `AUDIT-REPORT.md` — plan y reporte del ciclo de auditoría
  full-stack de referencia (42 hallazgos, escala de 5 niveles, formato de tabla).
- `public/presentaciones/AUDITORIA-FINTECH-V3-FINAL.md`,
  `AUDITORIA-FULL-SECURITY-CODE-TEST.md`, `AUDITORIA-FULL-UX-SEO-DOCS-DEPLOY.md` —
  ciclos de auditoría por dimensión ya ejecutados.
- `upload/LECCIONES-APRENDIDAS.md` — historial de versiones + lecciones ya
  extraídas de ciclos reales; léelo antes de auditar para no "redescubrir" un
  patrón ya documentado.
- `agent-ctx/` — un archivo por tarea de agente sustancial; formato de referencia
  para el paso 5 de la sección 6.
- `CHANGELOG.md` / `RELEASE-NOTES.md` — formato de referencia para cerrar ciclos
  que coinciden con un hito de versión.
- `docs/adr/` — decisiones de arquitectura ya tomadas (22 ADRs); consulta antes
  de proponer una alternativa que ya fue evaluada y descartada.
