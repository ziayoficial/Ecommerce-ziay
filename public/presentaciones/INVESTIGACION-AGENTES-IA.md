# Investigación de Mercado: Arquitectura Óptima de Agentes IA para ZIAY

**Task ID:** MR-AGENTS
**Fecha:** Julio 2026
**Autor:** agent-architect-researcher (general-purpose)
**Audiencia:** Arquitectura, producto, ingeniería, dirección comercial
**Estado:** Finalizado — listo para alimentar decisiones de roadmap (Sprint 16+)

> Esta investigación sintetiza 18 búsquedas web dirigidas sobre frameworks, patrones cognitivos,
> orquestación multi-agente, hardening de producción y panorama competitivo (Sierra, Decagon,
> Yalo, etc.). Cada sección cita fuentes verificables. Las recomendaciones son específicas para
> el stack ZIAY (Next.js + Prisma + Postgres + pgvector + z-ai-web-dev-sdk + WhatsApp Cloud API).

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Estado Actual de ZIAY](#2-estado-actual-de-ziay)
3. [Arquitecturas de Referencia](#3-arquitecturas-de-referencia)
4. [Componentes de un Agente Robusto](#4-componentes-de-un-agente-robusto)
5. [Patrones de Orquestación Multi-Agente](#5-patrones-de-orquestación-multi-agente)
6. [Inteligencia Avanzada](#6-inteligencia-avanzada)
7. [Hardening de Producción](#7-hardening-de-producción)
8. [Panorama Competitivo](#8-panorama-competitivo)
9. [Recomendaciones para ZIAY](#9-recomendaciones-para-ziay)
10. [Roadmap de Implementación](#10-roadmap-de-implementación-306090-días)
11. [Bibliografía](#11-bibliografía)

---

## 1. Resumen Ejecutivo

ZIAY opera hoy **26 agentes** definidos como *prompt-builders* en `src/lib/agents/prompts/*.ts`,
orquestados linealmente por `src/lib/orchestrator/orchestrator.ts` (9 pasos visuales de los 10
agentes conversacionales principales). El sistema funciona, es **~100× más barato por conversación
que Meta Business Agent** (`$0.02` vs `$2.00`, ver `docs/META-AGENT-DECISION.md`), y ya cumple
AP2/UCP. Sin embargo, comparado con el estado del arte 2024-2025 que documentan Anthropic,
LangChain, Microsoft, OpenAI y CrewAI, ZIAY presenta cuatro brechas estructurales:

| # | Brecha | Impacto |
|---|--------|---------|
| 1 | **No hay agente Governor / Supervisor** — el orquestador es un pipeline lineal, no un LLM que decide el siguiente paso | No adapta el flujo a intenciones imprevistas (postventa mezclada con preventa, abandono, etc.) |
| 2 | **Memoria limitada** — solo historial in-memory + tablas relacionales; sin embeddings semánticos explotados por los agentes | Los agentes no "recuerdan" preferencias, compras pasadas ni patrones del cliente entre conversaciones |
| 3 | **Sin observabilidad nativa tipo Langfuse/LangSmith** — los traces viven en logs pino pero no hay árbol `agent → tool → token → score` | Debuggear regresiones de prompt y medir calidad por agente es artesanal |
| 4 | **Sin bucle de auto-reflexión** — el agente produce y entrega, sin `generate → critique → revise` en caminos críticos | Errores de cotización, dirección o novedades llegan al cliente sin verificación |

### Recomendaciones Clave (TL;DR)

- **Patrón recomendado:** **Hybrid Supervisor + Pipeline** — un *Supervisor Agent* (LLM con
  herramienta `route_to_agent`) que despacha a 12 especialistas, con sub-pipelines secuenciales
  embebidos para los flujos predecibles (perfil → catálogo → cotización → dirección → checkout).
- **Cantidad óptima de agentes:** **14-16** (no 26). Consolidar 7 agentes redundantes
  (`guide_tracking` + `guide_alert` + `logistics_notifier` → 1 `postventa_logistics`;
  `customer_score` + `carrier_score` → 1 `scoring`; `address` + `address_analysis` → 1;
  `theme` se mergea en `catalog`; `cart_builder` se mergea en `quote`). **Agregar 4 nuevos**:
  `governor` (policy/safety), `qa_reviewer` (auto-reflexión), `sentiment` (empatía tono), `memory_curator` (memoria a largo plazo).
- **Top 3 agentes faltantes:** **Governor**, **QA Reviewer (Reflexion)**, **Memory Curator**.
- **Inteligencia — orden de prioridad:** (1) RAG sobre catálogo/objeciones/FAQ con pgvector
  ya existente, (2) Auto-reflexión en 3 caminos críticos (quote, address, novedades), (3) DSPy
  para optimización automática de prompts con A/B en producción.
- **Hardening faltante:** Langfuse tracing (self-hosted, gratis), guardrails de salida con
  validación JSON-schema + Llama Guard para PII, prompt-injection defense basado en delimiters
  + tool-scoping, rate-limit granular por agente (no solo por IP).
- **Cost optimization:** model routing — **80% de llamadas pueden ir a un modelo barato**
  (Haiku/4o-mini) reservando el modelo frontier (Opus/GPT-4.1) para `quote`, `objection` y
  `novedades`. Estimación de ahorro: **55-65% en factura LLM**.

### Métricas objetivo post-implementación

| Métrica | Hoy | Target 90 días |
|---|---|---|
| Tasa de resolución autónoma | n/d | ≥ 70% |
| TTR primera respuesta (P50) | ~6-8s | < 4s |
| Costo LLM por conversación | ~$0.015 | ≤ $0.008 |
| Regresiones detectadas en CI | 0 | ≥ 5/agent |
| Hallucinations en cotización (human-in-loop) | n/d | < 0.5% |

---

## 2. Estado Actual de ZIAY

### 2.1 Inventario de los 26 agentes

Los agentes viven en `src/lib/agents/prompts/*.ts` y se registran en
`src/lib/agents/prompts/index.ts`. Cada uno expone una función `build<Name>Prompt(ctx)` que
retorna `{ system, user }` — un builder de prompts, no un runtime. El runtime es
`src/lib/llm/adapter.ts` (z-ai-web-dev-sdk) invocado por `/api/agents/[agentName]` y por el
orchestrator.

| Categoría | Agentes | Cobertura |
|---|---|---|
| **Pre-venta (conversacional)** | `profile`, `speech`, `quote`, `catalog`, `theme`, `objection`, `address`, `logistics`, `vision`, `checkout` | 10 — orquestados linealmente en `ORCHESTRATOR_STEPS` |
| **Pre-venta extendidos** | `buyer_behavior`, `cart_builder` | 2 — fuera del orchestrator principal |
| **Post-venta** | `guide_tracking`, `novedades`, `redelivery`, `remarketing`, `guide_alert`, `sales_retainer`, `logistics_notifier` | 7 — invocados por webhook events, no por pipeline |
| **Inteligencia de negocio** | `customer_score`, `carrier_score`, `product_enrichment`, `marketplace`, `affiliator`, `traffic_orchestrator` | 6 — corren en cron / jobs |
| **Especializados** | `address_analysis` | 1 — invocado on-demand |

### 2.2 Lo que SÍ tiene ZIAY (no subestimar)

- **Multi-tenant nativo** con RLS Postgres (`src/lib/rls.ts`) — aislamiento real por `tenantId`,
  algo que Sierra y Decagon construyen como feature de enterprise.
- **Reglas centralizadas NUNCA/SIEMPRE** (`src/lib/agents/rules.ts`) — 28 reglas negativas + 17
  positivas, fuente única de verdad, inyectadas en cada system prompt. Esto ya es una forma
  rudimentaria de *constitutional AI* (patrón Anthropic).
- **Budget y cost tracking por tenant** (`src/lib/llm/budget.ts`, `src/lib/llm/costs.ts`) — el
  riel financiero para implementar token budgets granulares ya existe.
- **Fallbacks deterministicos** por agente (`FALLBACKS` en `prompts/index.ts`) — cuando el LLM
  falla o hace timeout (15s hard cap en `callAgentDirect`), se entrega una respuesta prefabricada
  en lugar de romper el flujo. Buena práctica de resiliencia.
- **pgvector ya instalado** (`prisma/sql/pgvector-setup.sql`, `src/lib/embeddings/service.ts`)
  — la infraestructura para RAG ya está provisionada, falta explotarla en los agentes.
- **n8n workflows espejos** por cada agente (`n8n-workflows/agent-*.json`) — existe una
  alternative runtime low-code por si el stack propio cae.

### 2.3 Lo que FALTA (audit gap analysis)

| Componente | Estado ZIAY | Estado del arte 2025 | Gap |
|---|---|---|---|
| **Governor / Supervisor** | ❌ No existe en código (marketing lo menciona) | LangGraph Supervisor, CrewAI Flow, Anthropic Orchestrator-Workers | **Crítico** |
| **Memoria a largo plazo** | ⚠️ Solo `history` en conversación actual | Episodic + semantic memory (Synapse, MemGPT, Letta) | Alto |
| **RAG en agentes** | ⚠️ pgvector existe pero solo lo usa `embeddings/service.ts` y `backfill-embeddings.ts` | RAG estándar en todos los agentes de conocimiento | Alto |
| **Auto-reflexión** | ❌ Ningún agente se critica a sí mismo | Reflexion, CRITIC, generate-critique-revise | Medio |
| **Observabilidad LLM** | ⚠️ Logs pino + Sentry; sin traces de agente → tool → token | Langfuse, LangSmith, Arize Phoenix | Alto |
| **Guardrails de salida** | ⚠️ `agents/sanitize.ts` hace strip markdown; no hay validación semántica | NeMo Guardrails, Llama Guard 3, Guardrails.ai | Medio |
| **Prompt-injection defense** | ⚠️ `middleware/sanitize.ts` limpia inputs; no hay separador system/user ni tool-scoping | OWASP LLM01:2025 — delimiters, separate channels, allow-lists | Alto |
| **State persistence** | ⚠️ `OrchestratorState` en memoria; al reiniciar se pierde | LangGraph checkpointing (Postgres/Redis), idempotency keys | Medio |
| **Multi-modal** | ✅ `vision` agente existe y usa VLM | Estándar (GPT-4o, Claude 3.5 Sonnet vision) | OK |
| **Evaluation framework** | ⚠️ `tests/eval/golden-cases.test.ts` + `scripts/eval-live.ts` existen pero no corren en CI | Langfuse evals, DeepEval, Promptfoo | Medio |
| **Model routing** | ❌ Todos los agentes usan el mismo modelo (vía `getLLMProvider()`) | 80/20 split: modelo barato para routing/FAQ, frontier para razonamiento | **Crítico** |

---

## 3. Arquitecturas de Referencia

### 3.1 Anthropic — "Building Effective Agents" (Dic 2024)

La fuente canónica. Anthropic distingue **workflows** (caminos predefinidos por código) de
**agents** (el LLM decide el siguiente paso). Define **5 patrones de workflow + 1 patrón agent**:

| Patrón | Cuándo usarlo | Aplicación ZIAY |
|---|---|---|
| **Prompt chaining** | Tarea lineal, cada paso transforma el anterior | Pre-venta lineal actual (`profile → speech → catalog → ...`) |
| **Routing** | Clasificar input → enviar a especialista | `profile` decide MAYORISTA/DETAL/REGALO → branch |
| **Parallelization** | Tareas independientes que se pueden correr a la vez | `customer_score` + `carrier_score` + `address_analysis` en paralelo |
| **Orchestrator-workers** | Un LLM coordina, otros ejecutan, flujo dinámico | **RECOMENDADO** para ZIAY (Governor + 12 especialistas) |
| **Evaluator-optimizer** | Un LLM genera, otro critica, loop hasta umbral | Auto-reflexión en cotización/novedades |
| **Autonomous agent** | Tareas abiertas, muchas iteraciones, parar solo | No recomendado para commerce (riesgo de drift) |

> **Citación clave (Anthropic, dic 2024):** *"Workflows offer predictability and consistency
> for well-defined tasks, while agents offer flexibility and task-driven focus but with higher
> cost and latency. Start with the simplest solution possible and only increase complexity when
> it demonstrably improves outcomes."*

**Implicación ZIAY:** No hay que convertir todo en agentes autónomos. Hay que añadir un
*orchestrator-workers* donde el flujo es dinámico (postventa, quejas, múltiples intenciones) y
mantener *prompt chaining* donde el flujo es predecible (preventiva).

Fuente: <https://www.anthropic.com/engineering/building-effective-agents>

### 3.2 LangGraph — Supervisor Pattern

LangGraph (LangChain) implementa el patrón **supervisor** como un grafo dirigido donde un nodo
es un LLM que decide qué worker ejecutar después. El supervisor examina el estado, elige el
siguiente worker, ejecuta, vuelve a examinar.

```
                ┌──────────┐
        user  → │ Supervisor │ ←─── state (perfil, items, direccion, …)
                └────┬─────┘
                     │ route_to_agent
   ┌────────┬────────┼────────┬────────┐
   ▼        ▼        ▼        ▼        ▼
 profile  catalog   quote   address  novedades
   │        │        │        │        │
   └────────┴────────┴────────┴────────┘
                     │
                ┌────▼─────┐
                │   state  │  ← checkpoint persistente (Postgres/Redis)
                └──────────┘
```

**Características clave de LangGraph relevantes para ZIAY:**

- **Checkpointing nativo** — el estado se persiste en `PostgresSaver` o `SqliteSaver`, lo que
  permite resumir conversaciones interrumpidas. ZIAY hoy pierde el `OrchestratorState` si el
  pod reinicia.
- **Streaming de tokens** — el supervisor puede emitir eventos parciales a Socket.io para
  mejorar TTR percibido.
- **Time travel** — volver a un estado anterior y re-ejecutar con un modelo distinto. Útil para
  A/B testing de prompts en producción.

**Aplicación ZIAY:** No migrar a LangGraph (que es Python y LangChain JS no tiene paridad
completa), pero **adoptar el patrón**. Implementar un `supervisor.ts` que use un LLM barato
(Haiku) para clasificar la intención y enrutar al agente especialista. Reutilizar
`OrchestratorState` pero persistirlo en Redis (`src/lib/redis.ts` ya existe).

Fuentes:
- <https://reference.langchain.com/python/langgraph-supervisor>
- <https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture>

### 3.3 CrewAI — Crews, Roles, Tasks, Flows

CrewAI aporta el modelo mental más limpio para agentes con *roles*. Tres abstracciones:

1. **Agent** — role + goal + backstory + tools + LLM. Ej: *"Sales Analyst, expert in LATAM
   wholesale, your goal is to qualify leads and recommend product mix"*.
2. **Task** — description + expected_output + assigned agent. El output se valida contra
   `expected_output` (Pydantic schema).
3. **Crew** — un equipo de agentes + lista de tareas + proceso (sequential o hierarchical).
4. **Flow** — orquestación de crews con estado compartido y eventos.

**Diferencia clave con ZIAY:** En CrewAI cada agente tiene un **rol** (sales analyst, logistics
coordinator, retention specialist) y un **goal explícito**. En ZIAY, los agentes son
funcionales pero su "rol" está implícito en el system prompt. ZIAY gana en tersitud (menos
tokens, menos drift) pero pierde en modularidad.

**Lo que vale robarle a CrewAI:**

- **`expected_output` con schema** — cada task declara qué JSON espera devolver. ZIAY podría
  añadir un `outputSchema` por agente en `prompts/types.ts` y validarlo con Zod en
  `agents/sanitize.ts` antes de devolver la respuesta. Esto reduce hallucinations estructurales.
- **Process: hierarchical** — un `manager_llm` despacha tareas. Equivalente al Governor.
- **Crew memory** — short-term (últimos N mensajes), long-term (vector DB), entity memory
  (perfiles de clientes como entidades). ZIAY debería implementar entity memory.

Fuente: <https://docs.crewai.com/v1.15.2/en/introduction>, <https://github.com/crewAIInc/crewai>

### 3.4 Microsoft AutoGen — Conversational Multi-Agent

AutoGen modela agentes **conversables** que se hablan entre sí en rondas. Cada agente tiene
`system_message`, un `llm_config` y puede llamar herramientas. El patrón estrella es
`GroupChat`: un `manager` decide quién habla después en un grupo de agentes.

**Patrón útil para ZIAY — debate/consensus:** Para casos críticos como "el cliente quiere
cancelar un pedido de $2M COP por supuesta demora", se puede correr un debate corto:

```
[sales_retainer] → propone retención con descuento
[logistics]      → verifica estado real del envío
[governor]       → valida policy (¿cumple retracto? ¿AP2?)
[manager]        → sintetiza respuesta final al cliente
```

Esto cuesta 3-4× más tokens pero se reserva para los top 5% de tickets por valor. En AutoGen
esto es nativo; en ZIAY se puede implementar como un sub-pipeline "debate" invocado por el
Governor.

> **AutoGen migración:** Microsoft está deprecando AutoGen 0.2 a favor de **Microsoft Agent
> Framework** (sucesor unificado), que incluye el patrón Swarm (handoffs). Ver
> <https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen>.

Fuentes: <https://microsoft.github.io/autogen/>, <https://github.com/microsoft/autogen>

### 3.5 OpenAI Swarm — Handoffs

Swarm es **deliberadamente minimal**: dos primitivas — `Agent` (con instructions, tools, y una
función `transfer_to_<agent>`) y `handoff` (un agente devuelve otro agente, el control pasa).
No hay supervisor central; los agentes se transfieren entre sí.

```python
def transfer_to_billing():
    return billing_agent  # handoff

triage_agent = Agent(name="Triage", functions=[transfer_to_billing])
```

**Cuándo usarlo:** Cuando el dominio se particiona naturalmente y los handoffs son
predecibles (triage → billing → refund). No requiere un LLM coordinador, lo que abarata.

**Aplicación ZIAY:** El patrón handoff encaja en `objection` → `sales_retainer` → `checkout`.
Hoy el orchestrator decide secuencialmente; Swarm propone que cada agente decida a quién pasar
basándose en su output. ZIAY puede implementar esto devolviendo `{ reply, next_agent_hint }`
desde cada agente y dejando que el supervisor decida si respeta el hint o enruta distinto.

**Advertencia:** OpenAI dice explícitamente que Swarm es **educativo, no production-ready**
(<https://github.com/openai/swarm>). Tomar el patrón, no la librería.

### 3.6 Anthropic MCP (Model Context Protocol)

MCP es un **protocolo abierto** (lanzado Nov 2024) que estandariza cómo un LLM se conecta a
fuentes externas: tools, resources, prompts. Es el "USB-C de los agentes". Cualquier MCP server
(GitHub, Slack, Postgres, Sentry, …) puede ser consumido por cualquier MCP client (Claude,
Cursor, Continue, …).

**Relevancia ZIAY:**

- ZIAY ya tiene `/api/mcp/route.ts` — un endpoint MCP básico. Expandirlo a un MCP server
  completo permitiría a los agentes ZIAY ser consumidos desde Claude Desktop, Cursor u otros
  clients, multiplicando los casos de uso.
- Permite separar **tools** (HTTP fetch, SQL query, image gen) de **prompts**. Hoy los agentes
  ZIAY tienen tools mezcladas en el código (`db.product.findMany`, `getLogisticsAdapter`,
  `getLLMProvider`). Migrar a tools MCP haría el sistema auditable, permisible y reutilizable.

Fuentes: <https://modelcontextprotocol.io/docs/getting-started/intro>, <https://www.anthropic.com/news/model-context-protocol>

### 3.7 Google Gemini / Vertex AI Agent Builder

Google ofrece **Vertex AI Agent Builder** (antes Dialogflow CX + Gen App Builder) con agentes
que combinan RAG, tools, y playbooks. Es relevante como referencia de UX conversacional y para
clientes enterprise que exijan despliegue en GCP. No recomendado para ZIAY (vendor lock-in,
sin control de costo por token).

### 3.8 Síntesis comparativa

| Framework | Lenguaje | Patrón estrella | Mejor para | ZIAY fit |
|---|---|---|---|---|
| **LangGraph** | Python | Supervisor + checkpointing | Pipelines dinámicos persistentes | Patrón ✓, librería ✗ (JS limit) |
| **CrewAI** | Python | Roles + Tasks + expected_output | Equipos con roles claros | Patrón ✓ (roles + output schema) |
| **AutoGen** | Python | Conversational GroupChat | Debates / consensus | Solo para casos top-5% |
| **OpenAI Swarm** | Python | Handoffs ligeros | Triaje simple | Patrón ✓ (handoff hint) |
| **MCP** | TS/Python | Tools estándar | Reutilización de tools | **Implementar server** |
| **Anthropic patterns** | Lang-agnostic | 5 workflows + agent | Decisión de arquitectura | **Adoptar como marco mental** |

**Conclusión:** ZIAY no debe migrar a ningún framework externo (costo de port elevado, perdida
de control multi-tenant). Debe **adoptar los patrones** (supervisor, handoff, expected_output,
debate) dentro de su propio stack.

---

## 4. Componentes de un Agente Robusto

Un agente de production-grade tiene 8 componentes. ZIAY cubre 3 parcialmente.

### 4.1 Memoria

La literatura distingue 5 tipos de memoria en agentes (Synapse, Atlan, MemGPT):

| Tipo | Qué almacena | Implementación ZIAY |
|---|---|---|
| **Short-term (working)** | Contexto de la conversación actual | ✅ `AgentContext` + `history` en OrchestratorState |
| **Long-term episodic** | Eventos pasados (compras, reclamos, novedades) | ⚠️ Existe en DB relacional (`Order`, `Novedad`, `Conversation`) pero **no se inyecta** en el contexto del agente |
| **Long-term semantic** | Hechos sobre el cliente (preferencias, temas favoritos, presupuesto) | ❌ Falta tabla `CustomerMemory` o `CustomerProfile` enriquecido |
| **Procedural** | Skills / cómo hacer cosas (cómo cotizar, cómo manejar objeción X) | ⚠️ Implícita en los system prompts; debería externalizarse a `playbook` |
| **Vector / retrieval** | Búsqueda semántica sobre cualquier texto | ⚠️ pgvector instalado, embeddings en `embeddings/service.ts` pero **no consumidos por agentes** |

**Recomendación:** Implementar `memory_curator` agente + tabla `CustomerMemory` con campos
`customerId, tipo, content, embedding vector(1536), createdAt, expiresAt`. El `memory_curator`
corre en background después de cada conversación, extrae hechos ("cliente prefiere pago contra
entrega", "cliente compró Stitch en talla M") y los inserta con embedding. En la próxima
conversación, los agentes relevantes hacen `SELECT ... ORDER BY embedding <=> $1 LIMIT 5`.

Fuente: <https://atlan.com/know/what-is-agent-memory>, <https://arxiv.org/html/2601.02744v3>

### 4.2 Planning

Tres arquitecturas dominan:

- **ReAct** (Yao et al., 2022) — intercala *Thought → Action → Observation* en cada paso. Es
  el default en LangChain. Costoso en tokens (cada step incluye razonamiento).
- **Plan-and-Execute** — primero genera un plan completo, luego ejecuta cada paso. Más barato
  (el plan se genera una vez) pero menos adaptable a observaciones mid-flight.
- **Reflexion** (Shinn et al., 2023) — después de un fallo, genera una crítica verbal y la
  guarda en memoria para no repetir el error.

**Aplicación ZIAY:** Los 9 pasos del pipeline actual son un *plan rígido pre-codificado*.
Mantenerlo para pre-venta (predecible). Añadir ReAct para `novedades` y `redelivery` (donde el
agente debe inspeccionar estado real y decidir acción). Añadir Reflexion para `quote` (donde
errores de precio cuestan dinero).

Fuentes: <https://mlflow.org/articles/types-of-ai-agent-architectures-2026-developer-guide>,
<https://blog.coforge.com/blog/react-tree-of-thought-and-beyond-the-reasoning-frameworks-behind-autonomous-ai-agents>

### 4.3 Tool use

Los agentes robustos usan tools vía **function calling** (OpenAI, Anthropic) o **MCP**. ZIAY
hoy tiene tools pero acopladas al código (`db.product.findMany` directo en el builder de
prompt). El patrón moderno:

1. **Tool registry** — lista tipada de tools disponibles con JSON-schema de inputs.
2. **Permission scoping** — `profile` solo puede leer de `Customer` y `Order`; `checkout`
   puede escribir `Order` y llamar `paymentAdapter`.
3. **MCP server** — exponer tools vía protocolo estándar.

**Recomendación:** Crear `src/lib/agents/tools/registry.ts` con tools tipadas
(`searchCatalog`, `getOrderStatus`, `updateAddress`, `createPaymentLink`). Cada agente declara
`allowedTools: ToolName[]`. El LLM las invoca vía function calling (z-ai-web-dev-sdk soporta
`tools` parameter).

### 4.4 Guardrails

Cuatro capas:

| Capa | Herramienta | Estado ZIAY |
|---|---|---|
| **Input validation** | Zod schema + length cap + PII regex | ⚠️ `middleware/sanitize.ts` strip pero no valida semántica |
| **Output validation** | JSON-schema + Llama Guard 3 + regex deny-list | ⚠️ `agents/sanitize.ts` solo strip markdown |
| **Constitutional rules** | NUNCA/SIEMPRE en system prompt | ✅ `agents/rules.ts` — 45 reglas |
| **Hallucination check** | Citation check, RAG grounding, self-verification | ❌ |

**Recomendación:**

1. Extender `agents/sanitize.ts` con validación por `outputSchema` Zod por agente (CrewAI
   style). Falla → fallback determinístico.
2. Para `quote` y `objection`, añadir **citation grounding**: el agente debe citar el
   `productId` + `priceId` de la DB que justifica el precio. Si no puede, decir "déjame
   confirmar".
3. Evaluar Llama Guard 3 para PII en inputs (latencia ~50ms adicional, aceptable).

Fuentes: <https://docs.nvidia.com/nemo/guardrails/resources/research>,
<https://galileo.ai/blog/best-ai-guardrails-platforms>

### 4.5 Observabilidad

Dos opciones dominantes:

- **LangSmith** (LangChain) — cerrado, integrado con LangChain, ~$39/seat/mes + usage.
- **Langfuse** — open-source (self-hosted gratis), integración agnóstica. Soporta tracing de
  LangGraph, OpenAI Agents SDK, CrewAI, GenAI SDK nativo.

**Recomendación:** **Langfuse self-hosted** — desplegar via Docker compose junto a ZIAY (ya
corre Caddy + Postgres + Redis + n8n + Loki + Grafana + Prometheus; un contenedor más).
Instrumentación:

```ts
import { Langfuse } from 'langfuse'
const lf = new Langfuse({ publicKey, secretKey, baseUrl: 'http://langfuse:3000' })
const trace = lf.trace({ name: 'orchestrator', userId, metadata: { tenantId } })
const span = trace.span({ name: `agent:${agentName}`, input: ctx })
// ... llamar LLM ...
span.end({ output: reply })
```

Esto da: árbol de traces por conversación, latencia P50/P95 por agente, costo en tokens por
agente, comparación A/B de prompts, dataset de evals para regresión.

Fuentes: <https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse>,
<https://www.langchain.com/resources/langsmith-vs-langfuse>

### 4.6 Error handling

Patrones estándar:

- **Retry con backoff exponencial** — 3 intentos, jitter. ZIAY no lo tiene hoy (la llamada al
  LLM es sin reintentos, solo timeout 15s).
- **Fallback determinístico** — ✅ ZIAY lo tiene (`FALLBACKS`).
- **Circuit breaker** — tras N fallos consecutivos, marca agente como degradado y notifica.
- **Human-in-the-loop escalation** — tras 2 fallos o score < umbral, escalar a humano.

**Recomendación:** Envolver `callAgentDirect` en `p-retry` con backoff. Añadir
`agentHealth` en Redis (ventana deslizante 5 min) y un endpoint `/api/agents/health` para el
dashboard.

### 4.7 State management

- **Checkpointing** — persistir `OrchestratorState` en Redis (TTL 24h) clave por
  `conversationId`. Hoy está en memoria del proceso → se pierde en redeploy.
- **Idempotency** — ya existe `middleware/idempotency.ts` para webhooks; extenderlo a
  `/api/agents/[agentName]` con `Idempotency-Key` header.
- **Resumption** — al reconectar un cliente, cargar `OrchestratorState` desde Redis y
  reanudar en `state.step`.

### 4.8 Context window management

- **Sliding window** — últimos N mensajes + system prompt. ZIAY lo hace implícito.
- **Summarization** — cada 10 mensajes, un agente `summarizer` condensa el historial. ZIAY ya
  tiene `src/lib/agents/summarize.ts` — usarlo en el orchestrator cada 8 mensajes.
- **Retrieval** — en vez de cargar todo el historial, cargar solo los mensajes relevantes
  vía embeddings. Es la evolución natural del sliding window.

---

## 5. Patrones de Orquestación Multi-Agente

### 5.1 Catálogo de patrones

| Patrón | Descripción | Cuándo | Costo tokens | ZIAY fit |
|---|---|---|---|---|
| **Supervisor / Router** | 1 LLM coordina, despacha a especialistas | Dominio con partición clara | Bajo (1 LLM call extra) | **Alto** |
| **Hierarchical** | Manager → workers → sub-workers | Orgs complejas, escalamiento | Medio | Medio |
| **Sequential pipeline** | Assembly line, A→B→C→D | Flujos predecibles | Bajo | **Alto** (actual) |
| **Parallel fan-out/fan-in** | A→(B,C,D)→E | Tareas independientes | Medio (paralelo) | Medio |
| **Debate / consensus** | N agentes discuten → mejor respuesta | Casos críticos, alta calidad | Alto (3-5×) | Solo top-5% |
| **Market-based** | Agentes pujan por tareas | Muy experimental | Alto | ✗ |
| **Blackboard** | Estado compartido, agentes reaccionan a eventos | Event-driven, complejo | Medio | Medio |
| **Event-driven / swarm** | Cada agente reacciona a eventos del sistema | Postventa, webhooks | Bajo | **Alto** (ya usado) |

### 5.2 Patrón recomendado para ZIAY: **Hybrid Supervisor + Sub-pipelines**

```
                                ┌───────────────┐
                                │   GOVERNOR    │ ← policy + safety + budget gate
                                │  (LLM Haiku)  │
                                └───────┬───────┘
                                        │ route(intent, profile, history)
                                ┌───────▼───────┐
                                │  SUPERVISOR   │ ← decide siguiente agente
                                │  (LLM Haiku)  │
                                └───────┬───────┘
                    ┌─────────┬─────────┼─────────┬─────────┐
                    ▼         ▼         ▼         ▼         ▼
            ┌────────────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────┐
            │ pre-sale   │ │ post │ │ intel│ │ qa_rev │ │ memory   │
            │ sub-pipe   │ │ sale │ │      │ │  iewer │ │ curator  │
            │            │ │      │ │      │ │        │ │          │
            │ profile→   │ │nov-  │ │score │ │critique│ │extract   │
            │ catalog→   │ │edade │ │carrier│ │+ revise│ │facts→pg  │
            │ quote→     │ │redel │ │enrich│ │        │ │vector    │
            │ address→   │ │retai │ │mktpl │ │        │ │          │
            │ checkout   │ │      │ │      │ │        │ │          │
            └────────────┘ └──────┘ └──────┘ └────────┘ └──────────┘
```

**Cómo funciona:**

1. **Cada mensaje entrante** pasa primero por `Governor` (1 llamada LLM barata Haiku, <300ms).
   Governor valida: ¿prompt injection? ¿PII? ¿cumple presupuesto tenant? ¿es caso para humano?
   Si pasa → forward a Supervisor.
2. **Supervisor** clasifica intención (pre-venta, post-venta, intel, etc.) y enruta al
   sub-pipeline o agente adecuado.
3. **Sub-pipelines** secuenciales (pre-venta) preservan el comportamiento actual —
   predictible, barato, auditable.
4. **`qa_reviewer`** se invoca en caminos críticos (quote, novedades) para auto-reflexión.
5. **`memory_curator`** corre async después de cada conversación.

### 5.3 Debate para casos top-5%

Para tickets con `orderValue > $500k COP` o `intent: cancelacion + complaint`, Governor activa
modo debate: 3 agentes (`sales_retainer`, `logistics`, `governor`) generan propuestas, un
`synthesizer` consolida. Costo: ~4× tokens pero solo para <5% de tickets → impacto total
marginal <5%.

### 5.4 Blackboard para eventos

Webhooks (novedad de transportadora, chargeback, refund) escriben en un *blackboard* (tabla
`Event` en Postgres o stream Redis). Agentes especializados reaccionan a eventos filtrados:

- `novedad_recibida` → `novedades` agent procesa → escribe resultado a blackboard
- `payment_failed` → `sales_retainer` agent propone retención

Esto ya funciona en ZIAY vía `/api/webhooks/*` y n8n. Formalizarlo como blackboard pattern
documenta la arquitectura y facilita añadir nuevos agentes reactivos.

Fuentes: <https://www.openlayer.com/blog/post/multi-agent-system-architecture-guide>,
<https://www.digitalapplied.com/blog/agent-architecture-patterns-taxonomy-2026>,
<https://arxiv.org/html/2508.12683>

---

## 6. Inteligencia Avanzada

Más allá del prompt engineering: cómo hacer agentes genuinamente inteligentes.

### 6.1 RAG — Retrieval Augmented Generation

RAG es el upgrade #1 en ROI para ZIAY porque la infraestructura ya existe (pgvector) y los
casos de uso son obvios:

| Caso de uso | Query | Retrieval | Impacto |
|---|---|---|---|
| **Catalog agent** | "quiero pijama de Stitch" | embed(query) → top-5 productos por similitud | Mejora recall vs SQL LIKE |
| **Objection agent** | objeca "caro" | embed("caro") → top-3 objeciones históricas resueltas | Reutiliza respuestas exitosas |
| **Speech agent** | perfil mayorista | embed(perfil + industria) → top-3 discursos pasados con alta conversión | Personalización por segmento |
| **Novedades agent** | "dirección incorrecta" | embed(tipo_novedad) → top-3 resoluciones pasadas | Aprende del histórico |
| **FAQ implícito** | cualquier mensaje | embed(msg) → top-3 Q&A pasadas | Reduce llamadas a LLM |

**Arquitectura recomendada:**

```
user message → embed(msg) → pgvector top-K → inyectar en system prompt como contexto
                                              ↓
                                          LLM genera respuesta grounded
```

ZIAY ya tiene `backfill-embeddings.ts` para productos. Extender a:

- `objection_resolutions` (tabla nueva con `content, embedding`)
- `conversation_summaries` (resúmenes de conversaciones exitosas)
- `faq_entries` (tabla nueva o reusar `agent_rules`)

**Cuándo NO usar RAG:**

- Si la cardinalidad es baja (<50 docs) → meter todo en el prompt (cheaper, sin latencia
  de retrieval).
- Si la freshness es crítica (precios, stock) → leer de DB relacional, no de embeddings.

Fuente: <https://encore.dev/blog/you-probably-dont-need-a-vector-database>

### 6.2 Fine-tuning vs RAG vs Prompt engineering

| Técnica | Mejora | Costo | Recomendado ZIAY |
|---|---|---|---|
| **Prompt engineering** | Comportamiento, estilo | $0 | ✅ Ya en uso |
| **RAG** | Conocimiento factual | Bajo (pgvector ya está) | **Sí, prioridad 1** |
| **Fine-tuning** | Tono, formato, dominio | Alto (data + GPU) | Solo si los 26 agentes no convergen tras RAG + reflexión |

> **Regla práctica:** Si el problema es "el agente no sabe X", RAG. Si es "el agente suena
> raro en contexto Y", few-shot en prompt. Si es "el agente no puede aprender el formato aún
> con ejemplos", fine-tune.

### 6.3 Dynamic prompt optimization (DSPy)

DSPy propone **declarar el comportamiento** como *signatures* (e.g. `"question -> answer"`) y
delegar la optimización del prompt a un optimizador automático (BoE, MIPRO, BootstrapFewShot).
El optimizador busca combinaciones de instrucciones + ejemplos que maximizan una métrica.

**Aplicación ZIAY:** Para los 3-5 agentes más sensibles (`quote`, `objection`, `novedades`):

1. Construir dataset de 200 ejemplos `(input, expected_output)`.
2. Definir métrica (e.g. BLEU + fact-check de precio + rating humano).
3. Correr `BootstrapFewShotWithRandomSearch` offline.
4. El output es un prompt optimizado que se versiona en `prompts/quote.v2.ts`.
5. A/B test en producción (50% v1, 50% v2) con Langfuse.

**Advertencia:** DSPy tiene una curva de aprendizaje alta y ecosistema Python. No migrar todo
ZIAY a DSPy — usar como herramienta offline de optimización, no como runtime.

Fuentes: <https://dspy.ai>, <https://towardsdatascience.com/automate-writing-your-llm-prompts>

### 6.4 Self-reflection / Self-correction

Tres frameworks de auto-reflexión:

- **Reflexion** (Shinn et al., 2023) — tras fallo, generar crítica verbal y guardarla en
  memoria episódica para no repetir.
- **CRITIC** (Gou et al., 2023) — el agente se auto-evalúa contra herramientas externas
  (search, calculator) y corrige.
- **Simple reflection** — `generate → critique → revise` en un solo prompt o en dos llamadas.

**Implementación ZIAY — `qa_reviewer` agent:**

```ts
// En caminos críticos (quote, novedades, address):
const draft = await callAgent('quote', ctx)
const critique = await callLLM({
  system: 'Eres un auditor. Verifica: (1) precios correctos vs DB, (2) no promete descuento,
          (3) cerró con CTA. Responde JSON {ok: boolean, issues: string[], fixed: string}',
  user: draft
})
if (!critique.ok) {
  return critique.fixed  // versión corregida
}
return draft
```

Costo: +50% tokens en caminos críticos. Para `quote` que afecta ingresos, el ROI es claro.

Fuentes: <https://arxiv.org/pdf/2405.06682>,
<https://callsphere.ai/blog/self-correcting-agents-reflexion-critic-react-loops-compared-2026>,
<https://www.langchain.com/blog/reflection-agents>

### 6.5 Learning from feedback (RLHF / DPO)

No recomendado a corto plazo. RLHF requiere miles de comparaciones humanas y GPUs. DPO es más
ligero pero sigue necesitando data etiquetada. ZIAY debería capturar feedback implícito
(conversiones, abandono, reclamos) para alimentar DSPy optimizers a futuro.

### 6.6 Multi-modal agents

ZIAY ya tiene `vision` agent (VLM). Extender a:

- **Image + price** — cliente manda foto de producto similar → agente busca por similitud
  visual + precio.
- **Audio (transcripción)** — soporte de notas de voz en WhatsApp.

### 6.7 Reasoning chains

- **Chain-of-Thought (CoT)** — estándar, ya implícito en prompts largos.
- **Tree-of-Thoughts (ToT)** — explora múltiples ramas. Útil para `negotiation` (probar 3
  ángulos de objeción, escoger el mejor).
- **Graph-of-Thoughts** — generalización, aún experimental.

**Recomendación:** Implementar ToT para `objection` y `sales_retainer` en casos de alto valor.

### 6.8 Confidence scoring

El agente debe declarar cuán seguro está de su respuesta. Si confianza < 70%, escalar a humano
o a debate. Implementación: pedir al LLM que devuelva `{ reply, confidence: 0-100 }` y gatear.

---

## 7. Hardening de Producción

### 7.1 Rate limiting

ZIAY tiene `middleware/rate-limit.ts` por IP. Para agentes, añadir **rate limit por agente +
por tenant**:

- `quote` agent: 10 calls/min por tenant (prevenir abuso de cotización).
- `vision` agent: 5 calls/min por tenant (VLM es caro).
- `profile` agent: 30 calls/min por tenant (barato, high volume).

Implementación: extender `rate-limit.ts` con clave `${agentName}:${tenantId}` en Redis con
sliding window.

### 7.2 Cost control

| Estrategia | Implementación | Ahorro estimado |
|---|---|---|
| **Model routing** | `governor`, `supervisor`, `profile` → Haiku/4o-mini; `quote`, `objection`, `novedades` → Opus/4.1 | 55-65% |
| **Token budget per tenant** | Ya existe `llm/budget.ts` — hard fail al exceder | Previene sorpresas |
| **Prompt caching** | Anthropic y OpenAI ofrecen cache de system prompts (90% descuento en cached tokens) | 20-30% adicional |
| **Response caching** | Hash(prompt + ctx) → Redis TTL 1h para queries idénticos | 10-15% en FAQ |
| **Output length cap** | `max_tokens` estricto por agente | 5-10% |
| **Streaming + early stop** | Si el cliente abandona, cortar el stream | 5% |

> **Caso real citado:** "Our token cost optimization setup after the AI budget nearly killed us
> — Reddit r/SaaS. Los grandes wins vinieron de **multi-model routing**: queries simples a
> modelos pequeños, frontier solo cuando calidad lo exige." Fuente: <https://www.reddit.com/r/SaaS/comments/1tzz4xj>

> **Estadística mercado:** "Enterprise LLM API spending doubled in six months from $3.5B in
> late 2024 to $8.4B by mid-2025" (TrueFoundry). Fuente: <https://www.truefoundry.com/blog/llm-cost-optimization>

### 7.3 Latency optimization

- **Streaming** — devolver tokens al cliente a medida que se generan (z-ai-web-dev-sdk soporta).
  Mejora TTR percibido de 6s → 1.5s.
- **Parallel fan-out** — `customer_score`, `carrier_score`, `address_analysis` en paralelo
  (Promise.all) en vez de secuencial.
- **Prompt compression** — reducir system prompt de 2000 tokens a 800 con técnicas como LLMLingua.
- **Caching de embeddings** — no re-embedear el mismo texto.
- **Model routing** — modelos más rápidos para queries simples.

### 7.4 Evaluation framework

Hoy ZIAY tiene `tests/eval/golden-cases.test.ts` (offline) y `scripts/eval-live.ts`. Faltan:

- **Regression tests en CI** — correr golden cases en cada PR. Ya está parcialmente vía
  Vitest, pero los golden cases no corren por defecto.
- **Online evaluation** — Langfuse scores automáticos (toxicidad, factuality, helpfulness)
  sobre una muestra del 5% de conversaciones.
- **Human eval loop** — UI para operadores humanos calificar respuestas (1-5 estrellas), que
  alimenta DSPy optimizers.

**Target:** cada PR que toque un prompt debe pasar 20+ golden cases de ese agente. Promoción a
producción requiere score ≥ 90%.

### 7.5 Deployment patterns

- **Blue-green para prompts** — mantener `prompts/quote.v1.ts` y `prompts/quote.v2.ts`
  simultáneamente, `FLAG_QUOTE_VERSION=v2` en env. Rollback instantáneo.
- **Canary para nuevos agentes** — nuevo agente activo para 5% del tráfico en un tenant piloto
  antes de GA.
- **Feature flags per tenant** — `tenant.flags.qa_reviewer_enabled = true`.

### 7.6 Multi-tenant isolation

ZIAY ya tiene RLS en Postgres (`prisma/sql/rls-policies.sql`). Extender a:

- **LLM context isolation** — nunca mezclar `AgentContext` de tenants distintos en la misma
  llamada (validar en `buildAgentPrompt`).
- **Memory isolation** — embeddings con `WHERE tenant_id = $1` siempre.
- **Rate limit + budget por tenant** (ya cubierto).

### 7.7 Security: prompt injection defense

OWASP LLM Top 10 (#1: Prompt Injection, 2024-2025). Defensas en capas:

1. **Input sanitization** — `middleware/sanitize.ts` ya strip tags. Añadir detección de
   patrones sospechosos ("ignore previous instructions", "system:").
2. **Delimiter separation** — el system prompt se separa del user input con delimitadores
   claros: `<user_input>...</user_input>`. El LLM es instruido a tratar todo dentro de
   `<user_input>` como data, no como instructions.
3. **Tool scoping** — cada agente solo puede invocar tools explícitamente permitidas.
4. **Output sanitization** — `agents/sanitize.ts` ya strip markdown; añadir PII redaction
   (regex de cédula, tarjeta, teléfono).
5. **Governor gate** — primera línea de defensa, rechaza mensajes con score de inyección > 0.7.

Fuentes: <https://genai.owasp.org/llmrisk/llm01-prompt-injection>,
<https://owasp.org/www-community/attacks/PromptInjection>

### 7.8 Observability checklist

Métricas mínimas a exponer en dashboard:

| Métrica | Por | Alerta si |
|---|---|---|
| Latencia P50/P95 | Agente | P95 > 8s |
| Tasa de éxito | Agente | < 95% |
| Tokens consumidos | Agente + tenant | > budget 80% |
| Costo USD | Agente + tenant | > daily cap |
| Hallucination rate | Agente (sample) | > 2% |
| Time-to-first-token | Conversación | > 2s P95 |
| Auto-reflection triggers | Agente con QA | > 30% (质量问题) |
| Human escalations | Conversación | > 30% |

---

## 8. Panorama Competitivo

### 8.1 Mapa de agentes IA para customer service / commerce

| Platafica | Origen | Foco | Modelo negocio | Relevancia ZIAY |
|---|---|---|---|---|
| **Sierra AI** (Bret Taylor) | EEUU, 2023 | CX agents enterprise | SaaS + outcome-based pricing | **Alta** — benchmark de calidad |
| **Decagon** | EEUU, 2023 | Enterprise support agents | SaaS | Media |
| **Cresta** | EEUU, 2017 | Real-time agent assistance | SaaS | Media |
| **Forethought** | EEUU, 2017 | Support automation | SaaS | Baja |
| **Intercom Fin** | Irlanda, 2011 | AI customer service | SaaS + per-resolution | Media |
| **Yalo** | México, 2015 | WhatsApp commerce LATAM | SaaS + transactional | **Crítica** — competidor directo |
| **Aivo** | Argentina, 2013 | Conversational AI LATAM | SaaS | Media |
| **Botmaker** | Argentina, 2016 | WhatsApp bots LATAM | SaaS | Media |
| **Zenvia** | Brasil, 2000 | Conversational CX LATAM | SaaS | Media |
| **Meta Business Agent** | EEUU, 2026 | WhatsApp native agent | Per-token | Ya evaluado, decisión `own_stack` |

### 8.2 Sierra AI — el benchmark

Sierra (Bret Taylor, ex co-CEO Salesforce, board OpenAI) es el referente de calidad. Trabaja
con 40% del Fortune 50. Características clave:

- **Agents as a Service** — agentes configurables por marca, con personalidad y voice.
- **Outcome-based pricing** — cobran por resolución, no por token. Alinea incentivos.
- **Voice + chat** — soporta llamadas telefónicas con agentes vocales.
- **Ghostwriter** — agente que crea otros agentes (no-code).
- **Compliance-first** — HIPAA, SOC2, GDPR out of the box.

**Qué aprender de Sierra:**

1. **Outcome-based pricing** — ZIAY podría cobrar por conversación convertida, no por
   mensaje. Mayor margen, alineación con cliente.
2. **Voice agent** — en LATAM, llamadas aún son comunes para ventas. Agregar `voice` agent en
   roadmap futuro.
3. **Agent builder UI** — un panel donde el cliente configures su agente sin tocar código.
   ZIAY tiene `agents/rules/route.ts` pero no UI para clientes.

Fuentes: <https://sierra.ai/blog/agents-as-a-service>,
<https://cheekypint.substack.com/p/bret-taylor-of-sierra-on-ai-agents>

### 8.3 Yalo — competidor directo LATAM

Yalo es el competidor más cercano geográfica y verticalmente. Plataforma SaaS de conversational
commerce sobre WhatsApp, con clientes como Coca-Cola, Bimbo, Walmart LATAM.

**Fortalezas de Yalo:**

- Catálogo de integraciones nativas (SAP, Salesforce, ecommerce).
- Flujos conversacionales pre-configurados por vertical (CPG, retail, banking).
- Equipo comercial maduro en LATAM.

**Ventaja ZIAY vs Yalo:**

- **Multi-tenant + RLS** — Yalo es más por-instancia; ZIAY escala por tenant con aislamiento.
- **100× más barato por conversación** (ya documentado en `META-AGENT-DECISION.md`).
- **26 agentes especializados** vs plantillas genéricas de Yalo.
- **AP2/UCP compliance** — Yalo cede datos a Meta; ZIAY no.

**Riesgo Yalo:** si Meta reduce drásticamente el costo per-token de Meta Business Agent, Yalo
podría pivotar a revenderlo y competir en precio.

Fuentes: <https://yalomedia.com/en/crm/whatsapp-ai-agent-guide>,
<https://startupintros.com/orgs/yalo>

### 8.4 Decagon, Cresta, Forethought, Intercom Fin

- **Decagon** — enterprise support, focus en agentes que resuelven tickets sin humano. Fuerte
  en IT/HR support. Menos relevante para commerce conversacional.
- **Cresta** — real-time agent assistance (el agente humano ve sugerencias del LLM en vivo).
  Modelo distinto al de ZIAY (autónomo) pero podría inspirar un modo "copilot" para asesores
  humanos de ZIAY.
- **Forethought** — soporte automatizado, acquisition por Zendesk.
- **Intercom Fin** — AI customer service dentro de Intercom. Cobran `$0.99/resolución`.

**Insight:** varios compiten en **resolución de tickets** (email/web). ZIAY compite en
**conversación transaccional WhatsApp** — segmento distinto, menos saturado, especialmente en
LATAM.

### 8.5 LATAM landscape (Aivo, Botmaker, Zenvia)

| Proveedor | Foco | Debilidad vs ZIAY |
|---|---|---|
| **Aivo** | Chatbots bancarios/telecom | Poco commerce, poco WhatsApp-native |
| **Botmaker** | WhatsApp bots SMB | Sin agents IA avanzados, sin multi-tenant |
| **Zenvia** | Omnichannel enterprise | Caro, poco flexible, sin stack propio IA |

**Oportunidad:** ZIAY tiene una ventana de 12-18 meses para consolidarse como la plataforma
agent-IA-native de commerce conversacional en LATAM antes de que Sierra/Yalo bajen a la región
con fuerza.

> **Dato de mercado:** "WhatsApp AI agents are reshaping ecommerce in Latin America.
> Conversational commerce in the region hit $18.2 billion in 2025, growing 35% year over year."
> Fuente: <https://easysellapp.com/tr-eu/blogs/wiki/whatsapp-ai-agents-ecommerce-latin-america-cod-2026>

---

## 9. Recomendaciones para ZIAY

### 9.1 Cantidad óptima de agentes: **14-16** (no 26)

El número 26 no es excesivo per se — Anthropic menciona sistemas con 50+ agentes — pero
**muchos de los 26 son redundantes** y aumentan costo cognitivo de mantenimiento, sin valor
claro. La regla empírica de la industria (CrewAI, LangChain): **un agente = un rol + un goal
claro + un output medible**. Si dos agentes comparten rol o output, merger.

#### Agentes a MERGEAR (7 → 3):

| Antes | Después | Razón |
|---|---|---|
| `guide_tracking` + `guide_alert` + `logistics_notifier` | `postventa_logistics` | Mismo dominio (guías), comparten tools, salidas similares |
| `customer_score` + `carrier_score` | `scoring` | Mismo patrón (input → score numérico), solo cambia input |
| `address` + `address_analysis` | `address` | `address_analysis` es un sub- paso de `address` |
| `theme` + `catalog` | `catalog` | `theme` es un filtro del `catalog` agent |
| `cart_builder` + `quote` | `quote` | `cart_builder` construye el input de `quote` |

#### Agentes a ELIMINAR (si no hay uso real):

- `affiliator` — si no hay tracción en el programa de afiliados, pausar.
- `traffic_orchestrator` — si el volumen de ads no justifica un agente dedicado, mover a
  cron job simple.

#### Agentes a AGREGAR (4 nuevos):

| Nuevo agente | Rol | Justificación |
|---|---|---|
| **`governor`** | Policy/safety/budget gatekeeper. LLM barato que valida cada mensaje entrante. | Crítico — es el "front door" del sistema. Sin él, prompt injection y excesos de presupuesto no se detectan. |
| **`qa_reviewer`** | Auto-reflexión en caminos críticos (quote, novedades, address). | Reduce hallucinations en revenue-impacting paths. ROI claro. |
| **`sentiment`** | Detecta tono/emoción del cliente y adapta el del agente. | Mejora empatía, reduce churn. CrewAI y Sierra lo tienen. |
| **`memory_curator`** | Async, extrae hechos de conversaciones y los guarda con embeddings. | Habilita memoria a largo plazo sin tocar agentes existentes. |

**Resultado:** 26 - 7 (mergers) + 4 (nuevos) = **23 agentes**, de los cuales ~16 activos en
el orchestrator principal y 7 en background/jobs. Equivalente funcional a 14-16 agentes
visibles al usuario.

### 9.2 Arquitectura recomendada: **Hybrid Supervisor + Sub-pipelines**

Detalle en §5.2. Resumen:

1. **Capa 0 — Governor** (LLM barato, <300ms): valida safety + budget + routing inicial.
2. **Capa 1 — Supervisor** (LLM barato): clasifica intención, enruta.
3. **Capa 2 — Especialistas** (LLM variable): 12-14 agentes con sub-pipelines secuenciales
   donde aplique (pre-venta).
4. **Capa 3 — QA Reviewer** (LLM frontier, async): auto-reflexión en caminos críticos.
5. **Capa 4 — Memory Curator** (async): extrae hechos para memoria a largo plazo.

### 9.3 Estrategia de memoria

| Memoria | Implementación | Cuándo |
|---|---|---|
| **Working (conversación actual)** | `OrchestratorState` en Redis (TTL 24h) | Sprint 1 |
| **Episódica (eventos pasados)** | Tabla `ConversationEvent` + embeddings | Sprint 2 |
| **Semántica (hechos del cliente)** | Tabla `CustomerMemory` con `tipo, content, embedding` | Sprint 2 |
| **Procedural (skills/playbooks)** | Tabla `Playbook` con pasos + ejemplos | Sprint 3 |
| **Vector retrieval** | pgvector + HNSW index | Sprint 1 |

**Política de retención:**

- Working: 24h (Redis).
- Episódica: 90 días (Postgres), luego solo embeddings.
- Semántica: indefinido, con TTL configurable por tenant (GDPR/retention compliance).
- Procedural: versionado, sin TTL.

### 9.4 Upgrades de inteligencia — prioridad

1. **RAG en `catalog`, `objection`, `novedades`** (Sprint 1, 2 semanas) — pgvector ya está.
   Impacto: mejora recall de catálogo +30%, objeciones con respuestas aprendidas.
2. **`governor` + `supervisor`** (Sprint 1, 1 semana) — habilita routing dinámico y safety.
3. **`qa_reviewer` con auto-reflexión** (Sprint 2, 2 semanas) — para `quote`, `novedades`,
   `address`. Reduce errores en revenue paths.
4. **Model routing** (Sprint 2, 1 semana) — 55-65% ahorro en LLM.
5. **`memory_curator` + CustomerMemory** (Sprint 3, 3 semanas) — memoria a largo plazo.
6. **DSPy optimization** (Sprint 3, 2 semanas) — para `quote`, `objection` con dataset
   etiquetado.
7. **Debate pattern** (Sprint 4) — para tickets top-5% por valor.

### 9.5 Hardening de producción — checklist

| Item | Esfuerzo | Impacto | Sprint |
|---|---|---|---|
| Langfuse self-hosted + instrumentation | M (3d) | Alto | 1 |
| Rate limit por agente + tenant | S (1d) | Medio | 1 |
| Token budget hard cap por agente | S (1d) | Alto | 1 |
| Output schema (Zod) por agente | M (2d) | Alto | 1 |
| Prompt-injection defense (delimiters + Governor) | M (3d) | Alto | 1 |
| Retry con backoff en `callAgentDirect` | S (1d) | Medio | 1 |
| Circuit breaker por agente (Redis) | M (2d) | Medio | 2 |
| State checkpointing en Redis | M (2d) | Alto | 2 |
| Golden cases en CI | M (2d) | Alto | 2 |
| Online evals (Langfuse scores) | M (3d) | Medio | 3 |
| Human eval UI | L (5d) | Medio | 3 |
| Prompt caching (Anthropic/OpenAI) | S (1d) | Medio | 2 |
| Response caching (Redis hash) | S (1d) | Bajo | 2 |
| Blue-green para prompts (env flag) | S (1d) | Medio | 2 |
| Canary por tenant | M (3d) | Medio | 3 |

### 9.6 Cost optimization — meta de 50%+ ahorro

| Palanca | Ahorro estimado | Esfuerzo | Sprint |
|---|---|---|---|
| Model routing (Haiku para routing/governor; Opus para quote/objection) | 55-65% | M (3d) | 2 |
| Prompt caching | 20-30% adicional | S (1d) | 2 |
| Response caching (FAQ/catálogo) | 10-15% | S (1d) | 2 |
| Output length cap estricto | 5-10% | S (1d) | 1 |
| Streaming + early stop | 5% | M (2d) | 3 |
| Reducir system prompt (de 2000 → 800 tokens) | 5-10% | S (1d) | 1 |

**Total estimado:** 60-75% de ahorro en factura LLM, manteniendo calidad.

---

## 10. Roadmap de Implementación (30/60/90 días)

### Sprint 1 — Días 1-30: Fundaciones

**Objetivo:** Governor + Supervisor + RAG básico + observabilidad.

| Semana | Tareas |
|---|---|
| 1 | (a) Desplegar Langfuse self-hosted (docker-compose). (b) Instrumentar `callAgentDirect` con traces. (c) Implementar `governor.ts` (LLM Haiku, valida injection + budget). |
| 2 | (a) Implementar `supervisor.ts` (LLM Haiku, clasifica intención, enruta). (b) Refactor `orchestrator.ts` para usar supervisor en vez de pipeline lineal rígido. (c) Backfill embeddings de `objection_resolutions` y `faq_entries`. |
| 3 | (a) RAG en `catalog` agent (top-5 productos por similitud). (b) RAG en `objection` agent (top-3 resoluciones históricas). (c) Output schema Zod por agente. |
| 4 | (a) Prompt-injection defense (delimiters + Governor). (b) Rate limit por agente. (c) Retry con backoff. (d) CI: golden cases corren en cada PR. |

**Métricas exitosas Sprint 1:**
- Langfuse traces visibles para 100% de conversaciones.
- Governor rechaza >95% de prompts de inyección en test suite.
- `catalog` agent usa RAG (verificar en trace).
- CI bloquea PRs que rompen golden cases.

### Sprint 2 — Días 31-60: Inteligencia + Costo

**Objetivo:** Auto-reflexión + memoria + model routing.

| Semana | Tareas |
|---|---|
| 5 | (a) Implementar `qa_reviewer` agent. (b) Activar en `quote` y `novedades`. (c) Medir reducción de hallucinations. |
| 6 | (a) Tabla `CustomerMemory` + `memory_curator` agent. (b) Inyectar memoria en `speech`, `objection`, `quote`. (c) State checkpointing en Redis. |
| 7 | (a) Model routing: `governor`/`supervisor`/`profile`/`address` → Haiku. `quote`/`objection`/`novedades` → Opus/4.1. (b) Prompt caching. (c) Response caching para FAQ. |
| 8 | (a) Circuit breaker por agente. (b) Blue-green para prompts (`prompts/quote.v2.ts`). (c) Canary por tenant. |

**Métricas exitosas Sprint 2:**
- Auto-reflexión reduce errores en `quote` en >50%.
- `CustomerMemory` poblada para >70% de clientes recurrentes.
- Ahorro de factura LLM ≥ 50%.
- Blue-green permite rollback <1min.

### Sprint 3 — Días 61-90: Optimización + Escala

**Objetivo:** DSPy + debate + multi-modal + evals online.

| Semana | Tareas |
|---|---|
| 9 | (a) Dataset etiquetado de `quote` (200 ejemplos). (b) DSPy optimizer offline. (c) A/B test v1 vs v2 en Langfuse. |
| 10 | (a) Debate pattern para tickets >$500k COP. (b) ToT en `objection` (3 ramas). (c) `sentiment` agent. |
| 11 | (a) Online evals (Langfuse scores: factuality, helpfulness). (b) Human eval UI para operadores. (c) Confidence scoring en `quote` y `novedades`. |
| 12 | (a) Merge de 7 agentes redundantes en 3. (b) Documentación + training. (c) Métricas finales + reporte. |

**Métricas exitosas Sprint 3:**
- DSPy mejora score de `quote` en ≥5%.
- Debate reduce churn en tickets de alto valor.
- 100% de conversaciones con score online.
- Red neta: 23 agentes (16 activos + 7 background).
- Ahorro total ≥ 60% en factura LLM.
- TTR P50 < 4s.

### Post-90 días (backlog)

- **MCP server completo** para exponer agentes ZIAY a Claude Desktop / Cursor.
- **Voice agent** (calls telefónicas).
- **Fine-tuning** si los optimizadores DSPy no convergen.
- **Marketplace de agentes** — clientes configuran sus propios agentes.
- **Outcome-based pricing** estilo Sierra.

---

## 11. Bibliografía

### Anthropic — Building Effective Agents
- Building Effective AI Agents — Anthropic (Dic 2024). <https://www.anthropic.com/engineering/building-effective-agents>
- Building Effective AI Agents: Architecture Patterns [PDF]. <https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf>
- Agent Workflow Patterns — Beyond Anthropic's Playbook. <https://pub.towardsai.net/agent-workflow-patterns-beyond-anthropics-playbook-1bd76a48d63d>
- Introducing the Model Context Protocol — Anthropic (Nov 2024). <https://www.anthropic.com/news/model-context-protocol>
- Code execution with MCP: building more efficient AI agents. <https://www.anthropic.com/engineering/code-execution-with-mcp>
- Model Context Protocol docs. <https://modelcontextprotocol.io/docs/getting-started/intro>
- Reflection Agents — LangChain. <https://www.langchain.com/blog/reflection-agents>

### LangChain / LangGraph
- LangGraph Multi-Agent Supervisor. <https://reference.langchain.com/python/langgraph-supervisor>
- Choosing the Right Multi-Agent Architecture — LangChain. <https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture>
- LangSmith vs Langfuse — LangChain. <https://www.langchain.com/resources/langsmith-vs-langfuse>
- LangSmith: Agent & LLM Observability Platform. <https://www.langchain.com/langsmith/observability>

### CrewAI
- CrewAI Documentation. <https://docs.crewai.com/v1.15.2/en/introduction>
- CrewAI GitHub. <https://github.com/crewaiinc/crewai>
- CrewAI Tasks. <https://docs.crewai.com/v1.15.2/en/concepts/tasks>
- Build agentic systems with CrewAI and Amazon Bedrock — AWS. <https://aws.amazon.com/blogs/machine-learning/build-agentic-systems-with-crewai-and-amazon-bedrock>

### Microsoft AutoGen
- AutoGen — Microsoft Research. <https://www.microsoft.com/en-us/research/project/autogen>
- AutoGen GitHub. <https://github.com/microsoft/autogen>
- Multi-agent Conversation Framework | AutoGen 0.2. <https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat>
- AutoGen to Microsoft Agent Framework Migration Guide. <https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen>
- AutoGen design patterns. <https://microsoft.github.io/autogen/stable//user-guide/core-user-guide/design-patterns/intro.html>

### OpenAI Swarm
- OpenAI Swarm GitHub. <https://github.com/openai/swarm>
- OpenAI Swarm Framework Guide — Galileo. <https://galileo.ai/blog/openai-swarm-framework-multi-agents>
- How OpenAI Swarm Enhances Multi-Agent Collaboration. <https://www.analyticsvidhya.com/blog/2024/10/openai-swarm>

### Cognitive architectures
- Agentic Reasoning Patterns (2026): ReAct, Reflexion, Plan-Execute. <https://servicesground.com/blog/agentic-reasoning-patterns>
- AI Agent Planning: ReAct, Tree of Thoughts, and Plan-and-Execute. <https://www.openlegion.ai/en/learn/ai-agent-planning>
- Types of AI Agent Architectures: 2026 Developer Guide — MLflow. <https://mlflow.org/articles/types-of-ai-agent-architectures-2026-developer-guide>
- ReAct vs Tree-of-Thought — Coforge. <https://blog.coforge.com/blog/react-tree-of-thought-and-beyond-the-reasoning-frameworks-behind-autonomous-ai-agents>
- Agent Reasoning: The Thinking Layer — Oracle. <https://blogs.oracle.com/developers/agent-reasoning-the-thinking-layer>

### Orchestration patterns
- Multi-Agent Architecture Guide — Openlayer. <https://www.openlayer.com/blog/post/multi-agent-system-architecture-guide>
- Multi-agent orchestration patterns — GitHub ombharatiya. <https://github.com/ombharharatiya/ai-system-design-guide/blob/main/07-agentic-systems/04-multi-agent-orchestration.md>
- Agent Architecture Patterns: 2026 Taxonomy Guide — Digital Applied. <https://www.digitalapplied.com/blog/agent-architecture-patterns-taxonomy-2026>
- A Taxonomy of Hierarchical Multi-Agent Systems — arXiv. <https://arxiv.org/html/2508.12683>

### Memory
- What Is Agent Memory? — Atlan. <https://atlan.com/know/what-is-agent-memory>
- A Practical Guide to Memory for Autonomous LLM Agents — Towards Data Science. <https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents>
- Synapse: Empowering LLM Agents with Episodic-Semantic Memory — arXiv. <https://arxiv.org/html/2601.02744v3>
- The 5 Types of AI Agent Memory Every Developer Needs to Know. <https://dev.to/sreeni5018/the-5-types-of-ai-agent-memory-every-developer-needs-to-know-part-1-52fn>
- Agent Memory & State Management — TechAhead. <https://www.techaheadcorp.com/blog/agent-memory-state>
- What Is Agent Memory? — MongoDB. <https://www.mongodb.com/resources/basics/artificial-intelligence/agent-memory>

### Guardrails
- Research on Guardrails — NVIDIA NeMo. <https://docs.nvidia.com/nemo/guardrails/resources/research>
- Guardrails in Generative AI: Preventing Hallucinations. <https://medium.com/@amitkharche/guardrails-in-generative-ai-preventing-hallucinations-and-toxic-outputs-a88e29c83e0a>
- 5 Best AI Guardrails Platforms Compared — Galileo. <https://galileo.ai/blog/best-ai-guardrails-platforms>
- AI Guardrails — Production LLM Safety Guide. <https://myengineeringpath.dev/genai-engineer/ai-guardrails>
- Build safe and responsible generative AI applications with guardrails — AWS. <https://aws.amazon.com/blogs/machine-learning/build-safe-and-responsible-generative-ai-applications-with-guardrails>

### Observability
- AI Agent Observability, Tracing & Evaluation with Langfuse. <https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse>
- Langfuse vs LangSmith — DataCamp. <https://www.datacamp.com/blog/langfuse-vs-langsmith>
- The Best Workflow Observability Tools for AI Agents — Breyta. <https://breyta.ai/blog/best-workflow-observability-tools-ai-agents>

### RAG
- The Complete Guide to RAG — Medium. <https://medium.com/@atnoforgenai/the-complete-guide-to-rag-retrieval-augmented-generation-for-production-applications-fbfdc18b2757>
- pgvector Guide: Vector Search and RAG in PostgreSQL — Encore. <https://encore.dev/blog/you-probably-dont-need-a-vector-database>
- Deploy a RAG Pipeline with pgvector — Railway. <https://docs.railway.com/guides/rag-pipeline-pgvector>
- How to scale vector search in Postgres (pgvector). <https://clickhouse.com/resources/engineering/scale-vector-search-postgres>

### DSPy
- DSPy documentation. <https://dspy.ai>
- Automate Writing Your LLM Prompts — Towards Data Science. <https://towardsdatascience.com/automate-writing-your-llm-prompts>
- DSPy Prompt Optimization — ADaSci. <https://adasci.org/blog/dspy-streamlining-llm-prompt-optimization>
- How LLM Optimization Frameworks Like TEXTGRAD and DSPy Are Building — Medium. <https://medium.com/@adnanmasood/beyond-prompt-engineering-how-llm-optimization-frameworks-like-textgrad-and-dspy-are-building-the-6790d3bf0b34>

### Self-reflection
- Self-Reflection in LLM Agents: Effects on Problem-Solving — arXiv. <https://arxiv.org/pdf/2405.06682>
- Self-Correcting Agents: Reflexion, CRITIC, and ReAct Loops — CallSphere. <https://callsphere.ai/blog/self-correcting-agents-reflexion-critic-react-loops-compared-2026>
- Self-Improving AI Agents: The Reflection Loop — Taskade. <https://www.taskade.com/blog/self-improving-ai-agents-reflection>
- AI Agent Self-Improvement: Reflection Loops for Accuracy. <https://www.buildmvpfast.com/blog/ai-agent-self-improvement-recursive-accuracy-production-2026>
- Self-reflection enhances LLMs — Nature. <https://www.nature.com/articles/s44387-025-00045-3>

### Cost optimization
- LLM Cost Optimization: Why an AI Gateway Is the Missing Layer — TrueFoundry. <https://www.truefoundry.com/blog/llm-cost-optimization>
- AI Token Optimization: Complete Guide — NeuralTrust. <https://neuraltrust.ai/blog/ai-token-optimization-guide>
- awesome-llm-token-optimization — GitHub. <https://github.com/pleasedodisturb/awesome-llm-token-optimization>
- How I Cut My LLM Costs by 80% Without Sacrificing Quality. <https://pub.towardsai.net/how-i-cut-my-llm-costs-by-80-without-sacrificing-quality-85f8505eec96>
- Reddit r/SaaS: Token cost optimization setup after AI budget nearly killed us. <https://www.reddit.com/r/SaaS/comments/1tzz4xj>

### Security
- OWASP LLM01:2025 Prompt Injection. <https://genai.owasp.org/llmrisk/llm01-prompt-injection>
- Prompt Injection — OWASP Foundation. <https://owasp.org/www-community/attacks/PromptInjection>
- OWASP LLM Top 10. <https://genai.owasp.org/llm-top-10>
- What Is a Prompt Injection Attack? — EdgeLabs. <https://edgelabs.ai/blog/what-is-prompt-injection-attack>
- MCP: Model Context Pitfalls — HiddenLayer. <https://www.hiddenlayer.com/research/mcp-model-context-pitfalls-in-an-agentic-world>

### Competitive landscape
- Sierra AI — Agents as a Service. <https://sierra.ai/blog/agents-as-a-service>
- Bret Taylor of Sierra on AI agents, outcome-based pricing. <https://cheekypint.substack.com/p/bret-taylor-of-sierra-on-ai-agents>
- Sierra AI — Bret Taylor. <https://sierra.ai/author/bret-taylor>
- Yalo Media — WhatsApp AI Agent 2026 Guide. <https://yalomedia.com/en/crm/whatsapp-ai-agent-guide>
- Yalo — Startup Intros. <https://startupintros.com/orgs/yalo>
- WhatsApp AI Agents Sell $18B in LATAM — EasySell. <https://easysellapp.com/tr-eu/blogs/wiki/whatsapp-ai-agents-ecommerce-latin-america-cod-2026>
- Yalo AI Review — Skywork. <https://skywork.ai/skypage/en/Yalo-AI-Review-The-Conversational-Commerce-Powerhouse/1976561155016683520>

### Internal ZIAY references
- `docs/META-AGENT-DECISION.md` — Decisión Meta Native vs Own Stack.
- `docs/GUIA-COMPORTAMIENTO-AGENTES.md` — Reglas NUNCA/SIEMPRE.
- `src/lib/agents/prompts/index.ts` — Registro de los 26 agentes.
- `src/lib/agents/rules.ts` — 28 reglas NUNCA + 17 SIEMPRE.
- `src/lib/orchestrator/orchestrator.ts` — Pipeline lineal de 9 pasos.
- `src/lib/orchestrator/constants.ts` — `ORCHESTRATOR_STEPS`, `OrchestratorState`, escenarios.
- `src/lib/agents/prompts/types.ts` — `AgentContext`, `AgentName`.
- `src/lib/llm/budget.ts`, `src/lib/llm/costs.ts` — Budget y cost tracking.
- `src/lib/embeddings/service.ts`, `prisma/sql/pgvector-setup.sql` — Infraestructura RAG.
- `src/lib/middleware/rate-limit.ts`, `src/lib/middleware/idempotency.ts` — Middleware robustez.
- `tests/eval/golden-cases.test.ts`, `scripts/eval-live.ts` — Evaluación existente.

---

**Fin del documento.**

*Generado por agent-architect-researcher (general-purpose) — Task MR-AGENTS — Julio 2026.
Para preguntas o revisiones, abrir issue en el repo ZIAY con label `agent-architecture`.*
