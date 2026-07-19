# Auditoría de Arquitectura de Agentes IA — V2 (post-iteraciones IA-1/IA-2/IA-3)

**Task ID:** IA-REAUDIT
**Fecha:** 2026-07-19
**Autor:** general-purpose (agent-re-auditor)
**Audiencia:** Arquitectura, ingeniería, dirección
**Estado:** Finalizado — re-auditoría tras 3 iteraciones de upgrades

> Esta V2 re-audita la arquitectura de agentes de ZIAY tras las iteraciones IA-1
> (4 agentes de control-plane: Governor, QA Reviewer, Memory Curator, Sentiment),
> IA-2 (hardening: tracing, budget manager, model router, evaluation framework) e
> IA-3 (consolidación: 26 → 24 agentes). La auditoría original
> (`INVESTIGACION-AGENTES-IA.md`) documentó 11 componentes con score agregado
> 3/11 (27%). Esta V2 verifica qué se arregló, qué quedó parcial, y qué issues
> NUEVOS introdujeron los upgrades.

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Score Actualizado de los 11 Componentes](#2-score-actualizado-de-los-11-componentes)
3. [Tabla de Verificación por Upgrade](#3-tabla-de-verificación-por-upgrade)
4. [Issues Nuevos Encontrados](#4-issues-nuevos-encontrados)
5. [Gaps Restantes](#5-gaps-restantes)
6. [Verificación de Build](#6-verificación-de-build)
7. [Próximas Acciones Recomendadas](#7-próximas-acciones-recomendadas)

---

## 1. Resumen Ejecutivo

Las 3 iteraciones entregaron **8 artefactos nuevos** (4 agentes + 4 módulos de
hardening) y consolidaron el fleet de 26 → 24 agentes. La arquitectura
**mejoró substancialmente** en 6 de 11 componentes (System Prompt, Memory
short-term, Self-reflection, Guardrails, Error handling, Evaluation), pero
**2 de los upgrades más críticos de IA-2 están muertos en producción**:

- **Tracing NO está cableado** en las rutas API reales (`/api/orchestrate`,
  `/api/ai-reply`, `/api/agents/[agentName]`). Solo está cableado en
  `src/lib/orchestrator/orchestrator.ts`, módulo que **no es importado por
  ningún consumidor** (grep confirmó 0 usos). En producción, el endpoint
  `/api/agents/traces` retorna listas vacías porque ningún span se crea.
- **Budget Manager (token-level + per-conversation)** sufre el mismo problema:
  está cableado solo en el módulo `orchestrator.ts` muerto. Las rutas API
  reales siguen usando `checkBudgetBeforeCall` del viejo `@/lib/llm/budget`
  (USD-only, sin caps de tokens ni caps por conversación).

Esto significa que **el 40% del esfuerzo de IA-2 no entrega valor en producción**.
Las funcionalidades están implementadas correctamente a nivel de código, pero
el cableado hacia las rutas API que reciben tráfico real nunca se hizo. El
tracing y el budget admin endpoint devuelven datos vacíos o always-zero.

| Métrica | Auditoría V1 | Auditoría V2 | Δ |
|---|---|---|---|
| Score agregado (/110) | 30 | 61 | +31 |
| Componentes en ✅ (≥6/10) | 3/11 (27%) | 6/11 (55%) | +3 |
| Componentes en ❌ (<4/10) | 6/11 | 2/11 | −4 |
| Agentes en el fleet | 26 | 24 (20 + 4 control-plane) | −2 |
| Tests pasando | ~986 | 1029 | +43 |
| Errores TypeScript | 0 | 0 | = |
| Errores ESLint | 0 | 0 | = |

**Productividad estimada:** **55%** del roadmap de agentes robusto completado
(era 27%). Los gaps principales son: (a) cablear tracing+budget en las rutas
API reales (P0), (b) consumir `recallCustomerMemory` desde los prompts de
agentes (P1), (c) consumir `agent:trigger` events del Sentiment en el
orquestador (P1), y (d) actualizar 8 docs customer-facing que aún dicen
referencias al conteo histórico de 26 (P2, corregido en IA-4).

---

## 2. Score Actualizado de los 11 Componentes

Cada componente se re-calificó 0-10 tras leer el código real. La columna
"V1" refleja el score inferido de la auditoría original
(`INVESTIGACION-AGENTES-IA.md` §2.3). La columna "V2" es el score tras
IA-1/IA-2/IA-3.

| # | Componente | V1 | V2 | Δ | Justificación V2 |
|---|---|---|---|---|---|
| 1 | **System Prompt** | 8 ✅ | 9 ✅ | +1 | Los 4 nuevos agentes (governor, qa_reviewer, memory_curator, sentiment) tienen prompts cuidadosos con reglas NUNCA/SIEMPRE, JSON schema estricto, ejemplos few-shot. El governor incluye keywords banneadas configurables por tenant. |
| 2 | **Tool Use** | 3 ⚠️ | 3 ⚠️ | 0 | Sin cambios: los agentes siguen sin usar LLM function-calling. Los "tools" (DB lookups) se ejecutan en el prompt-builder, no en el LLM. No hay tool-schemas, no hay parallel tool calls. |
| 3 | **Memory (short-term)** | 8 ✅ | 8 ✅ | 0 | `pipelineMemory` se mantiene: persistencia en `Conversation.pipelineMemory`, evicción TTL 24h, truncado con resumen LLM cuando >20 mensajes. Sin cambios en IA-1/2/3. |
| 4 | **Memory (long-term)** | 0 ❌ | 5 ⚠️ | +5 | **Mitad implementada.** El Memory Curator extrae hechos, calcula embeddings, los upserta en `CustomerMemory` con dedup por `(tenantId, customerId, type, key)`. PERO `recallCustomerMemory()` está definida y nunca invocada — ningún agente prompt inyecta "lo que sabemos de este cliente" en su contexto. Write-side ✅, read-side ❌. |
| 5 | **Planning** | 1 ❌ | 2 ❌ | +1 | Sin mejora real. El orquestador sigue siendo un pipeline lineal de 8 pasos. El `redirect` del Governor se parsea pero el orquestador nunca lo consume para alterar el routing. No hay LLM-driven planning, no hay ReAct loop. |
| 6 | **Self-reflection** | 0 ❌ | 6 ✅ | +6 | **QA Reviewer** implementa Reflexion (critique → revise) con LLM frontier (glm-4.6), 8s timeout, fail-closed (approve original). Cableado en `/api/orchestrate` y `/api/agents/[agentName]` para `quote`, `novedades`, `address`, `checkout`. Solo revisa 4 agentes — no cubre `objection`, `logistics`, ni los agentes de inteligencia. |
| 7 | **Guardrails** | 3 ⚠️ | 7 ✅ | +4 | **Governor** es un safety gate real: LLM cheap (glm-4.6-flash), 280ms timeout, fail-open, budget check pre-LLM, persiste DecisionLog, emite socket event. Cableado antes de cada agente en `/api/orchestrate`, `/api/ai-reply`, `/api/agents/[agentName]`. Descuento: la lista de keywords banneadas es configurable pero el LLM hace la decisión semántica — un prompt injection sofisticado podría evadirlo. |
| 8 | **Observability** | 0 ❌ | 4 ⚠️ | +4 | **Implementado pero NO cableado a tráfico real.** `AgentTracer` + `AgentSpan` están bien diseñados (spans anidados, 3 sinks: in-memory + DecisionLog + pino). PERO `agentTracer.startSpan()` solo se llama desde `src/lib/orchestrator/orchestrator.ts`, módulo que grep confirmó no es importado por nadie. Las rutas API reales (`/api/orchestrate`, `/api/ai-reply`, `/api/agents/[agentName]`) NO crean traces. El endpoint `/api/agents/traces` retorna arrays vacíos en producción. |
| 9 | **Error handling** | 4 ⚠️ | 6 ✅ | +2 | Timeouts (Governor 280ms, QA 8s, Sentiment 1.5s, Memory 10s, agentes pipeline 15s), fail-open/closed consistente, captura de errores vía `captureError` (Sentry), fallbacks deterministicos por agente. Descuento: no hay retry con backoff, no hay circuit breaker, no hay dead-letter queue. |
| 10 | **Cost control** | 0 ❌ | 4 ⚠️ | +4 | **Implementado pero NO cableado a tráfico real.** `BudgetManager` con caps diarios/mensuales/conversación, plan-based defaults (Starter/Business/Enterprise), admin overrides via `Setting` table, durable ledger en `TokenUsage`. PERO `budgetManager.checkBudget()` y `budgetManager.recordUsage()` solo se llaman desde el módulo `orchestrator.ts` muerto. Las rutas API reales usan `checkBudgetBeforeCall` del viejo `@/lib/llm/budget` (USD-only, sin caps de tokens ni por conversación). Un tenant puede bypassear los caps de tokens llamando `/api/agents/[agentName]` directamente. |
| 11 | **Evaluation** | 1 ❌ | 7 ✅ | +6 | **25 test cases** en `tests/agent-evaluation/` (5 agents × 5 casos): profile, quote, objection, checkout, novedades. Corren en CI (1029 tests pasan). Cada caso tiene `expectedContains`, `expectedNotContains`, `expectedJsonShape`, `maxLatencyMs`, `rubric`. LLM-call path gateado por `LLM_API_KEY` (5 tests skipped en CI sin key). Descuento: el rubric scorer es heurístico (substring matching), no LLM-as-judge. |

**Total:** 30 → 61/110 (27% → 55%)

---

## 3. Tabla de Verificación por Upgrade

### 3.1 Agentes nuevos (IA-1)

| Upgrade | Status | Evidencia |
|---|---|---|
| **Governor** | ✅ Fixed | `governor.service.ts` (330 líneas) + `prompts/governor.ts`. Cableado en `/api/orchestrate` (línea 365), `/api/ai-reply` (línea 144), `/api/agents/[agentName]` (línea 208). Budget check pre-LLM, 280ms timeout, fail-open, persiste DecisionLog + socket event. Skipped para los 4 control-plane agents. |
| **QA Reviewer** | ✅ Fixed | `qa-reviewer.service.ts` (318 líneas) + `prompts/qa_reviewer.ts`. Cableado en `/api/orchestrate` (línea 648) y `/api/agents/[agentName]` (línea 382). Frontier LLM glm-4.6, 8s timeout, fail-closed (approve original). `shouldReviewAgent()` retorna true para `{quote, novedades, address, checkout}`. Reemplaza `reply` con `revisedOutput`, preserva original en `rawReply`, bump confidence a ≥0.85. |
| **Memory Curator** | ⚠️ Partial | `memory-curator.service.ts` (432 líneas) + `prompts/memory_curator.ts`. WRITE-side: cableado async fire-and-forget en `/api/orchestrate` (línea 740) y `/api/ai-reply` (línea 289). Upserta hechos en `CustomerMemory` con embeddings, dedup por `(tenantId, customerId, type, key)`. READ-side: `recallCustomerMemory()` definida (línea 365) pero **0 consumidores** — ningún agente prompt la invoca para inyectar "lo que sabemos de este cliente". |
| **Sentiment Analyzer** | ⚠️ Partial | `sentiment.service.ts` (333 líneas) + `prompts/sentiment.ts`. Cableado async fire-and-forget en `/api/orchestrate` (línea 396) y `/api/ai-reply` (línea 159). 1.5s timeout, neutral fallback. Emite `sentiment:classified` + `agent:trigger` (target: sales_retainer/remarketing/quote). PERO: (a) el evento `agent:trigger` **no tiene listener** en el orquestador — los triggered agents nunca se invocan; (b) el resultado del sentiment no se pasa al ctx de los agentes downstream (no hay campo `sentiment` en `AgentContext`). |
| **CustomerMemory Prisma model** | ✅ Fixed | `prisma/schema.prisma` líneas 317-345. `embeddingTexto Bytes?` (portable SQLite/PG, mismo patrón que `Product.embeddingTexto`). 3 indexes compuestos. Reverse relation en `Tenant.customerMemories`. `bun run db:push` aplicado. |
| **Wiring en orchestrate + ai-reply + agents/[agentName]** | ✅ Fixed | Verificado por grep: 11 call sites de `runGovernor`/`runQAReview`/`runMemoryCuratorAsync`/`runSentimentAsync` en las 3 rutas. |

### 3.2 Hardening (IA-2)

| Upgrade | Status | Evidencia |
|---|---|---|
| **AgentTracer + AgentSpan** | ⚠️ Partial | `tracing.ts` (445 líneas) bien diseñado: spans anidados, 3 sinks (in-memory Map con 1h TTL + sweep 10min, DecisionLog persist, pino JSON log), shape compatible con Langfuse `Generation` schema. **PERO `agentTracer.startSpan()` solo se llama desde `src/lib/orchestrator/orchestrator.ts::callAgentDirect()` (línea 67), y ese módulo no es importado por ningún consumidor** (grep `from '@/lib/orchestrator/orchestrator'` retorna 0 matches en src/). Las rutas API reales tienen su propia función `callAgent` local que no traza. |
| **BudgetManager (token-level + per-conversation)** | ⚠️ Partial | `budget.ts` (629 líneas) bien diseñado: 3 ventanas (daily/monthly/conversation), plan-based defaults, admin overrides via `Setting`, durable ledger en `TokenUsage`, fail-open en DB errors. **PERO `budgetManager.checkBudget()` y `recordUsage()` solo se llaman desde `orchestrator.ts::callAgentDirect()` (líneas 58, 111), módulo muerto.** Las rutas API reales siguen usando `checkBudgetBeforeCall` del viejo `@/lib/llm/budget` (USD-only). |
| **ModelRouter (3-tier)** | ⚠️ Partial | `model-router.ts` (149 líneas) bien diseñado: 3 tiers (cheap=glm-4.6-flash, standard=glm-4.6, frontier=glm-4.6-plus), per-agent tier map, pricing table. **PERO `getModelForAgent()` solo se usa en `orchestrator.ts::callAgentDirect()` (línea 77, módulo muerto) y en `tracing.ts`/`evaluation.ts` (que también son dependencias del módulo muerto).** Las rutas API reales llaman `chat(messages, { provider, thinking })` sin pasar `model` — el adapter usa el default del provider, ignorando el tier mapping. |
| **Evaluation framework** | ✅ Fixed | `evaluation.ts` (405 líneas) + 5 test files (1158 líneas total) en `tests/agent-evaluation/`. 25 casos (5 agents × 5 casos), cada uno con expectedContains/expectedJsonShape/maxLatencyMs/rubric. Corren en CI: `bun run test` → 1029 passed, 5 skipped (los LLM-call tests gateados por `LLM_API_KEY`). `scripts/eval-agents.ts` existe para runs live. |
| **TokenUsage Prisma model** | ✅ Fixed | `prisma/schema.prisma` líneas 2070+. `tenantId`, `conversationId`, `agentName`, `model`, `tokensIn`, `tokensOut`, `costUsd`, `createdAt` + 3 indexes (tenant+date, tenant+agent+date, conversationId). `bun run db:push` aplicado. PERO la tabla se queda vacía en producción porque `recordUsage()` no se llama desde tráfico real. |
| **3 nuevos API endpoints** | ✅ Fixed | `/api/agents/traces` (admin-only, returns recent traces across tenants), `/api/agents/traces/[conversationId]` (tenant-isolated via session filter), `/api/agents/budget` (GET status + POST setLimits, admin-only on POST). Verificado por LS + lectura de cada route.ts. |

### 3.3 Consolidación (IA-3)

| Upgrade | Status | Evidencia |
|---|---|---|
| **8 agentes removidos** | ✅ Fixed | `guide_tracking`, `guide_alert`, `logistics_notifier`, `customer_score`, `carrier_score`, `address_analysis`, `theme`, `cart_builder` ya no están en `AGENT_NAMES` (verificado: `bun -e "..."` → 24 agentes). Los archivos `.ts` fueron eliminados del directorio `prompts/`. |
| **2 agentes creados (merged)** | ✅ Fixed | `postventa_logistics.ts` (3 branches: tracking/alert/notification) y `scoring.ts` (2 branches: customer/carrier). Cada branch preserva el system prompt + DB-lookup del agente original. |
| **3 agentes enhanced** | ✅ Fixed | `address.ts` (mode: collect/analyze), `catalog.ts` (theme branch), `quote.ts` (mode: quote/cart). Discriminadores via `ctx.mode` / `ctx.theme`. |
| **Orchestrator updated** | ✅ Fixed | `constants.ts`: `OrchestratorStepId` removió `'theme'`, `ORCHESTRATOR_STEPS` pasó de 9 → 8 entradas. `orchestrator.ts`: fallback table ya no tiene `theme`. |
| **Dashboard updated** | ✅ Fixed | `catalog-visual-view.tsx`: botón "Tema" ahora llama `askAgent('catalog')` (era `'theme'`). `messenger-view.tsx`: dropdown items no referencian agentes retirados. `logistics/index.tsx`: 4 AgentButtons usan `scoring` y `postventa_logistics`. `orchestrator-view.tsx`: badge "8 pasos · 9 agentes". |
| **Tests + scripts updated** | ✅ Fixed | `agent-schemas.test.ts`, `golden-cases.test.ts`, `agents-route.test.ts`, `eval-live.ts`, `generate-n8n-workflows.ts` todos actualizados. 1029 tests pasan. |
| **Docs updated** | ⚠️ Partial | `README.md`, `CONTRIBUTING.md`, `docs/*.md`, `CHANGELOG.md`, login page, api-docs route, meta-agent-config — todos dicen "24 agentes". PERO **8 archivos customer-facing en `public/presentaciones/`** aún decían 26 (agentes) en IA-REAUDIT (corregido en IA-4 — ver §4.6). |

---

## 4. Issues Nuevos Encontrados

### 4.1 CRITICAL — Tracing y Budget Manager son código muerto

**Severidad:** P0 (bloquea el valor de IA-2)
**Archivo:** `src/lib/orchestrator/orchestrator.ts`

`AgentTracer.startSpan()` y `BudgetManager.checkBudget()/recordUsage()` están
cableados en `callAgentDirect()` (líneas 58, 67, 111), pero ese módulo **no es
importado por ningún consumidor**:

```
$ rg "from '@/lib/orchestrator/orchestrator'" src/
(no matches)

$ rg "callAgentDirect|runOrchestratorStep|runFullScenario" src/app/
(no matches)
```

Las rutas API reales (`/api/orchestrate`, `/api/ai-reply`, `/api/agents/[agentName]`)
tienen sus **propias funciones `callAgent` locales** que:
- No llaman `agentTracer.startSpan()` → no se crean traces.
- No llaman `budgetManager.checkBudget()` → no se aplican caps de tokens.
- No llaman `budgetManager.recordUsage()` → no se debita el ledger `TokenUsage`.
- No llaman `getModelForAgent()` → no se resuelve el modelo por tier (todas las
  llamadas usan el default del adapter, probablemente glm-4.6).

**Impacto:**
- `/api/agents/traces` retorna `[]` en producción.
- `/api/agents/budget` GET retorna siempre `tokensUsed: 0, costUsd: 0`.
- `TokenUsage` table queda vacía — no hay audit ledger de costos.
- El model routing (cheap/standard/frontier) no aplica — todas las llamadas
  usan el mismo modelo, eliminando el ahorro del 55-65% proyectado.
- El admin puede setear limits via POST `/api/agents/budget` pero nunca se
  enforced.

**Fix:** mover la lógica de tracing + budget + model-router desde el módulo
`orchestrator.ts` muerto hacia las funciones `callAgent` locales de cada ruta
API, O refactorizar las rutas para que llamen a `callAgentDirect()` del módulo
`orchestrator.ts`.

### 4.2 HIGH — `recallCustomerMemory()` es código muerto

**Severidad:** P1 (mitad del valor de Memory Curator perdido)
**Archivo:** `src/lib/agents/memory-curator.service.ts:365`

La función `recallCustomerMemory()` está implementada (cosine similarity sobre
`CustomerMemory.embeddingTexto`, top-K, minScore threshold) pero grep confirmó
que **ningún agente prompt la invoca**:

```
$ rg "recallCustomerMemory" src/
src/lib/agents/memory-curator.service.ts  (only definition)
```

El Memory Curator **escribe** hechos en `CustomerMemory` tras cada turno, pero
**ningún agente los lee** al construir su prompt. El "long-term memory" está
medio-implementado: persistencia ✅, recall ❌.

**Impacto:**
- `CustomerMemory` tabla crece sin entregar valor.
- Tokens gastados en extracción de hechos que no se usan.
- El score del componente "Memory (long-term)" queda en 5/10 (no 8).

**Fix:** agregar un `customerMemory` field al `AgentContext`, llamar
`recallCustomerMemory()` antes de `buildAgentPrompt()` en las 3 rutas API,
e inyectar el resultado en los prompts de `quote`, `objection`, `address`,
`checkout` (los agentes que más se benefician de contexto histórico del cliente).

### 4.3 HIGH — Eventos `agent:trigger` del Sentiment no tienen listener

**Severidad:** P1 (rompe la promesa de "sentiment-driven routing")
**Archivo:** `src/lib/agents/sentiment.service.ts:247`

El Sentiment Analyzer emite `agent:trigger` con `target: 'sales_retainer' |
'remarketing' | 'quote'` cuando detecta `frustrated` / `churnRisk=high` /
`buyingIntent=high`. PERO grep confirmó que **ningún consumidor escucha ese
evento**:

```
$ rg "agent:trigger" src/
src/lib/agents/sentiment.service.ts  (only emitter)
```

El orquestador no tiene handler para `agent:trigger` — los triggered agents
nunca se invocan. El análisis de sentimiento genera clasificaciones que se
persisten en `DecisionLog` y se emiten al dashboard, pero no alteran el
routing del pipeline.

**Impacto:**
- Un cliente frustrado no recibe automáticamente el `sales_retainer`.
- Un cliente con churnRisk=high no recibe automáticamente `remarketing`.
- Un cliente con buyingIntent=high no prioriza el paso de `quote`.

**Fix:** agregar un listener de `agent:trigger` en el orquestador (o en el
 Governorservice) que inyecte el agente triggered como próximo paso del pipeline,
 o que invoque directamente el agente via `callAgent` con el contexto del cliente.

### 4.4 HIGH — Resultado del Sentiment no se pasa a agentes downstream

**Severidad:** P1 (el sentimiento no afecta el tono de los agentes)
**Archivo:** `src/lib/agents/sentiment.service.ts:255-314`

El comentario del Sentiment service dice que el resultado se "stamp en
Conversation.pipelineMemory" para que los agentes downstream lo lean. PERO el
código en realidad hace algo diferente — escribe un `DecisionLog` row con
`agentName='sentiment'` y el JSON del resultado en el campo `output`:

```ts
// sentiment.service.ts:292
void db.decisionLog.create({
  data: {
    tenantId: input.tenantId,
    agentName: 'sentiment',
    conversationId: input.conversationId,
    input: JSON.stringify({ message: ... }),
    output: sentimentStamp,  // { _sentiment: { sentiment, score, urgency, ... } }
    ...
  },
})
```

Los agentes downstream no leen `DecisionLog` para conseguir el sentimiento —
construyen su prompt solo desde `pipelineMemory` (que es un array de messages,
no incluye el sentiment stamp). El comentario del código incluso admite esto:

> "To avoid a schema migration, we log the stamp to DecisionLog instead of
> Conversation.pipelineMemory."

**Impacto:** el tono de los agentes no se adapta al sentimiento del cliente
(un cliente frustrado recibe el mismo discurso de `speech` que uno excitado).

**Fix:** agregar `sentiment?: SentimentResult` al `AgentContext`, pasar el
resultado del sentiment desde el orquestador al ctx de los agentes, y usarlo
en los prompts para ajustar el tono.

### 4.5 MEDIUM — `BudgetManager` in-memory Map crece sin bound

**Severidad:** P2 (memory leak en long-running processes)
**Archivo:** `src/lib/agents/budget.ts:192`

`budgetStore = new Map<string, TenantBudgetState>()` nunca se barre. Cada
tenant entry tiene un `conversation: Map<string, BudgetEntry>()` que crece
indefinidamente — cada `conversationId` único deja una entry permanente:

```ts
// budget.ts:324-337
if (conversationId) {
  let convo = state.conversation.get(conversationId)
  if (!convo) {
    convo = { tokensUsed: 0, costUsd: 0, lastResetAt: new Date(), periodKey: conversationId }
    state.conversation.set(conversationId, convo)
  }
  convo.tokensUsed += total
  convo.costUsd += costUsd
}
```

El comentario del código admite esto:
> "conversation never resets — it lives until the conversation is
> garbage-collected"

PEERO no hay GC mechanism implementado. En un proceso Node de larga duración
con alta concurrencia (1000+ conversaciones/día), esto crece ~1 KB por
conversación sin evicción.

**Impacto:** memory leak ~1 MB/día por tenant activo en proceso long-running.

**Fix:** agregar un sweep periódico (similar al de `tracing.ts`) que evicta
conversaciones con `lastResetAt` > 24h, O usar un LRU cache con cap de N
conversaciones por tenant.

### 4.6 MEDIUM — Documentación customer-facing desactualizada

**Severidad:** P2 (inconsistencia con el código)
**Archivos:** 8 archivos en `public/presentaciones/` y `n8n-workflows/`

Tras IA-3, el código define 24 agentes. Los docs técnicos (`README.md`,
`docs/*.md`, `CONTRIBUTING.md`) fueron actualizados correctamente. PERO los
docs customer-facing/investor-facing decían 26 (agentes) en IA-REAUDIT (corregido en IA-4):

| Archivo | Ocurrencias históricas del conteo 26 (corregidas en IA-4) |
|---|---|
| `public/presentaciones/GUIA-ONBOARDING-CLIENTES.md` | 5 |
| `public/presentaciones/RESUMEN-TECNICO-COMPLETO.md` | 5 |
| `public/presentaciones/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md` | 4 |
| `public/presentaciones/INVESTIGACION-MERCADO.md` | 3 |
| `public/presentaciones/LECCIONES-APRENDIDAS.md` | 6 |
| `public/presentaciones/INVESTIGACION-AGENTES-IA.md` | 5 (audit original, histórico) |
| `n8n-workflows/README.md` | 2 |
| `docs/GUIA-COMPORTAMIENTO-AGENTES.md` | 1 (dice "25 agentes más") |

**Impacto:** inconsistencia entre lo que el código hace (24) y lo que ventas/
onboarding comunica (26). Puede generar confusiones en demos.

**Fix:** sed-replace del conteo histórico (26 → 24 agentes: 20 consolidados + 4 control-plane) — **APLICADO EN IA-4**.
en los 8 archivos (excepto el de auditoría original que es histórico).

### 4.7 MEDIUM — `model-router.ts` tiene entradas stale de agentes retirados

**Severidad:** P2 (código muerto, no bug)
**Archivo:** `src/lib/agents/model-router.ts:71-107`

El map `AGENT_MODEL_TIER` aún contiene entradas para los 7 agentes retirados en
IA-3:

```ts
cart_builder: 'standard',
guide_tracking: 'standard',
guide_alert: 'standard',
customer_score: 'standard',
carrier_score: 'standard',
logistics_notifier: 'standard',  // (not in map but in comment)
address_analysis: 'standard',
theme: 'standard',
```

Estos nombres ya no están en `AGENT_NAMES`. El router los resolvería si se
llamara con esos nombres, pero ningún código lo hace. Es código muerto que
confunde al lector sobre qué agentes existen.

**Impacto:** ningún bug funcional, pero afecta mantenibilidad.

**Fix:** borrar las 7 entradas stale del map.

### 4.8 LOW — `agent:trigger` y eventos de control-plane no tienen UI listener

**Severidad:** P3 (telemetría emitida pero no visible en dashboard)
**Archivos:** `dashboard-client.tsx`, `messenger-view.tsx`

El Governor, QA Reviewer, Memory Curator y Sentiment emiten eventos socket
útiles para el dashboard en tiempo real:

- `governor:decision` — cuando el governor bloquea permite
- `qa:review` — cuando QA revisa y/o corrige un output
- `memory:updated` — cuando se extraen hechos del cliente
- `sentiment:classified` — clasificación de sentimiento del último mensaje
- `agent:trigger` — cuando el sentiment dispara un agente de retención
- `agent:low_confidence` — cuando un agente retorna con confidence < 0.6

PERO grep confirmó que el dashboard solo escucha `connect`, `disconnect`,
`message:new` y `llm:budget_warning`. Ninguno de los 6 eventos nuevos tiene
handler en el frontend.

**Impacto:** la telemetría se persiste en `DecisionLog` (queryable via
`/api/governance/decisions`) pero no hay visibilidad en tiempo real.

**Fix:** agregar widgets en `dashboard-client.tsx` que escuchen estos 6 eventos
y muestren badges/notificaciones (ej: "Governor bloqueó mensaje", "QA revisó
output de quote", "Sentimiento: frustrated → triggering sales_retainer").

### 4.9 LOW — Race condition documentada pero inexistente

**Severidad:** P3 (no bug — solo aclaración)
**Archivos:** `/api/orchestrate/route.ts:365-402`, `/api/ai-reply/route.ts:144-165`

El task spec preguntaba si "Governor + Sentiment run in parallel — do they
conflict?". La verificación de código muestra que **NO corren en paralelo**: el
Governor se ejecuta primero con `await` (línea 365 en orchestrate, línea 144 en
ai-reply), y solo si `allow: true` se dispara el Sentiment async fire-and-forget
(línea 396 en orchestrate, línea 159 en ai-reply). El worklog fue misleading al
describirlo como "parallel async".

**No fix necesario.** Solo documentar para evitar confusiones futuras.

### 4.10 LOW — `/api/agents/traces/[conversationId]` no verifica propiedad de conversación

**Severidad:** P3 (potential info leak menor)
**Archivo:** `src/app/api/agents/traces/[conversationId]/route.ts:28-36`

El endpoint retorna traces filtradas por `session.user.tenantId`:

```ts
const traces = agentTracer.getConversationTraces(conversationId)
const userTenantId = session?.user?.tenantId ?? null
const filtered = userTenantId
  ? traces.filter((t) => t.tenantId === userTenantId)
  : traces
```

Esto previene ver traces de otro tenant. PERO no verifica que el `conversationId`
mismo pertenece al tenant del usuario — solo filtra traces que tengan el
`tenantId` correcto. Si un atacante adivina un `conversationId` ajeno, recibe
`traces: []` (no data leak), pero el 200 OK con count:0 podría confirmar la
existencia de la conversación.

**Impacto:** information leak menor (existencia de conversationId confirmable).
Dado que los traces solo existen en memoria por 1h y solo si el módulo
`orchestrator.ts` muerto se invoca, el riesgo práctico es ~0 hoy.

**Fix (defensa en profundidad):** agregar `requireTenantAccess(tenantId)` donde
`tenantId` se obtiene de un lookup `db.conversation.findUnique({ where: { id: conversationId } })`
antes de retornar traces.

---

## 5. Gaps Restantes

### 5.1 Componentes aún no resueltos

| Componente | Gap | Esfuerzo estimado |
|---|---|---|
| **Tool Use** (3/10) | No hay LLM function-calling. Los "tools" son DB lookups en el prompt-builder. Falta: definir tool-schemas, cablear `tools` parameter del adapter, manejar parallel tool calls. | M (3-5 días) |
| **Planning** (2/10) | Pipeline lineal sin LLM-driven routing. Governor's `redirect` parsed but not consumed. Falta: consumir `redirect` en orquestador, o migrar a LangGraph-style state machine. | L (1-2 semanas) |
| **Memory (long-term) read-side** | `recallCustomerMemory()` definida pero sin consumidores. Falta: inyectar en AgentContext + usar en prompts de quote/objection/address/checkout. | S (1 día) |
| **Observability wiring** | `agentTracer.startSpan()` solo en módulo muerto. Falta: cablear en las 3 rutas API. | S (1 día) |
| **Cost control wiring** | `budgetManager.checkBudget/recordUsage` solo en módulo muerto. Falta: cablear en las 3 rutas API. | S (1 día) |
| **Sentiment → routing** | `agent:trigger` event no tiene listener. Falta: handler en orquestador. | S (1 día) |
| **Sentiment → ctx downstream** | Resultado no se pasa a agentes. Falta: `sentiment?: SentimentResult` en AgentContext. | S (1 día) |

### 5.2 Mejoras de robustez no abordadas

- **Retry con backoff** en llamadas LLM (recomendación original §7.1).
- **Circuit breaker** para providers LLM caídos.
- **Dead-letter queue** para mensajes que fallan múltiples agentes.
- **LLM-as-judge scoring** en el evaluation framework (hoy es substring heuristic).
- **Langfuse self-hosted** para reemplazar el tracing in-house (cuando el volumen lo justifique).
- **State persistence** del `OrchestratorState` (hoy en memoria, se pierde al reiniciar).
- **pgvector** indexación para `CustomerMemory.embeddingTexto` en producción (hoy es JS cosine similarity O(n) por cliente).

---

## 6. Verificación de Build

```
$ npx tsc --noEmit 2>&1 | grep -c "error TS"
0

$ bun run lint 2>&1 | tail -3
  138:22  warning  'siempre' is assigned a value but never used.
  ✖ 53 problems (0 errors, 53 warnings)

$ bun run test 2>&1 | tail -5
  Test Files  57 passed (57)
       Tests  1029 passed | 5 skipped (1034)
   Duration  20.32s

$ bun -e "const {AGENT_NAMES} = require('./src/lib/agents/prompts'); console.log('Agents:', AGENT_NAMES.length)"
Agents: 24
Names: profile, speech, quote, catalog, objection, address, logistics, vision,
       checkout, buyer_behavior, novedades, redelivery, remarketing, sales_retainer,
       postventa_logistics, scoring, product_enrichment, marketplace, affiliator,
       traffic_orchestrator, governor, qa_reviewer, memory_curator, sentiment
```

| Verificación | Resultado |
|---|---|
| TypeScript strict | 0 errors ✅ |
| ESLint | 0 errors, 53 warnings (pre-existing, none in IA-1/2/3 code) ✅ |
| Tests | 1029 passed, 5 skipped (LLM-call tests sin `LLM_API_KEY`) ✅ |
| Agent count | 24 (20 consolidados + 4 control-plane) ✅ |
| tsc --noEmit | Limpio ✅ |

---

## 7. Próximas Acciones Recomendadas

### P0 — Crítico (bloquea valor de IA-2)

1. **Cablear `agentTracer` + `budgetManager` + `getModelForAgent` en las rutas
   API reales** (`/api/orchestrate`, `/api/ai-reply`, `/api/agents/[agentName]`).
   Esto desbloquea traces reales, budget enforcement real, y model routing
   real. Esfuerzo: 1 día.

2. **Decidir si eliminar o revivir `src/lib/orchestrator/orchestrator.ts`.**
   Si se elimina: borrar `callAgentDirect`, `runOrchestratorStep`,
   `runFullScenario` y mover la lógica de tracing+budget a las rutas API.
   Si se reviven: refactorizar las rutas API para que deleguen en
   `callAgentDirect`. Esfuerzo: 0.5 día.

### P1 — Alto (mitad del valor de IA-1 perdido)

3. **Cablear `recallCustomerMemory()` en los prompts de `quote`, `objection`,
   `address`, `checkout`.** Agregar `customerMemory?: RecalledFact[]` al
   `AgentContext`, llamar `recallCustomerMemory()` antes de `buildAgentPrompt()`
   en las 3 rutas API. Esfuerzo: 1 día.

4. **Implementar listener de `agent:trigger` en el orquestador** para que el
   sentiment realmente dispare `sales_retainer`/`remarketing`/`quote`. Esfuerzo:
   0.5 día.

5. **Pasar `sentiment: SentimentResult` en el `AgentContext`** para que los
   agentes downstream adapten su tono. Esfuerzo: 0.5 día.

### P2 — Medio (calidad y consistencia)

6. **Actualizar 8 docs customer-facing** en `public/presentaciones/` que aún
   decían 26 (agentes) en IA-REAUDIT. Esfuerzo: 0.5 día. **CORREGIDO EN IA-4.**

7. **Limpiar entradas stale en `AGENT_MODEL_TIER`** (cart_builder, guide_tracking,
   guide_alert, customer_score, carrier_score, address_analysis, theme).
   Esfuerzo: 0.1 día.

8. **Agregar sweep al `BudgetManager.conversation` Map** (LRU o TTL 24h).
   Esfuerzo: 0.5 día.

9. **Agregar widgets de dashboard** para los 6 eventos socket nuevos
   (`governor:decision`, `qa:review`, `memory:updated`, `sentiment:classified`,
   `agent:trigger`, `agent:low_confidence`). Esfuerzo: 1 día.

### P3 — Bajo (defensa en profundidad)

10. **Verificar propiedad de conversación** en `/api/agents/traces/[conversationId]`
    vía DB lookup antes de retornar traces. Esfuerzo: 0.2 día.

11. **Agregar retry con backoff exponencial** en `callAgent` (3 retries, 500ms
    base). Esfuerzo: 0.5 día.

12. **Migrar `CustomerMemory.embeddingTexto` a `vector(1536)`** en producción PG
    con pgvector index para recall O(log n). Esfuerzo: 1 día + migración DB.

---

## Apéndice A — Verificación de la matriz de cableado

| Servicio | `/api/orchestrate` | `/api/ai-reply` | `/api/agents/[agentName]` |
|---|---|---|---|
| `runGovernor` | ✅ línea 365 | ✅ línea 144 | ✅ línea 208 (skip control-plane) |
| `runSentimentAsync` | ✅ línea 396 | ✅ línea 159 | ❌ no cableado |
| `runQAReview` | ✅ línea 648 | ❌ no cableado | ✅ línea 382 |
| `runMemoryCuratorAsync` | ✅ línea 740 | ✅ línea 289 | ❌ no cableado |
| `agentTracer.startSpan` | ❌ | ❌ | ❌ |
| `budgetManager.checkBudget` | ❌ (usa `checkBudgetBeforeCall` viejo) | ❌ (igual) | ❌ (igual) |
| `budgetManager.recordUsage` | ❌ | ❌ | ❌ |
| `getModelForAgent` | ❌ (no pasa `model` al adapter) | ❌ (igual) | ❌ (igual) |
| `recallCustomerMemory` | ❌ (dead code) | ❌ (dead code) | ❌ (dead code) |
| `checkBudgetBeforeCall` (viejo) | ✅ línea 319 | ✅ línea 113 | ✅ línea 178 |

## Apéndice B — Referencias

- Auditoría original: `public/presentaciones/INVESTIGACION-AGENTES-IA.md` (MR-AGENTS, 2026-07)
- Worklog IA-1: `worklog.md:22521`
- Worklog IA-2: `worklog.md:22471`
- Worklog IA-3: `worklog.md:22552`
- Código verificado: `src/lib/agents/{governor,qa-reviewer,memory-curator,sentiment}.service.ts`,
  `src/lib/agents/{tracing,budget,model-router,evaluation}.ts`,
  `src/app/api/{orchestrate,ai-reply,agents/[agentName]}/route.ts`,
  `src/app/api/agents/{traces,budget}/route.ts`,
  `src/lib/orchestrator/{orchestrator,constants}.ts`,
  `prisma/schema.prisma`, `tests/agent-evaluation/*.ts`
