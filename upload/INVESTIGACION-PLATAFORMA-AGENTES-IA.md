# 🔬 Investigación Profunda: Mejor Plataforma para Agentes IA en ZIAY

## Resumen Ejecutivo

Después de investigar 30+ plataformas, frameworks y tools, la recomendación para ZIAY es una **arquitectura híbrida de 3 capas**:

1. **LLM Core:** ZAI (glm-4.6) como primario + OpenAI GPT-4 como fallback
2. **Orquestación:** Next.js nativo (actual) + n8n para workflows visuales
3. **Voice agents:** Vapi AI para llamadas telefónicas (fase 2)

---

## 1. Frameworks de Agentes IA comparados

### Tier 1: Frameworks de código (production-grade)

| Framework | Lenguaje | Multi-agente | Estado | Mejor para | Score |
|---|---|---|---|---|---|
| **LangGraph 1.0** | Python/JS | ✅ Sí (GA Oct 2025) | Producción | Pipelines complejos con estado | ⭐⭐⭐⭐⭐ |
| **CrewAI 1.14** | Python | ✅ Sí | Producción | Agentes con roles definidos | ⭐⭐⭐⭐ |
| **Microsoft Agent Framework** | Python/.NET | ✅ Sí (AutoGen + Semantic Kernel merged) | Producción | Enterprise .NET | ⭐⭐⭐⭐ |
| **OpenAI Agents SDK** | Python | ✅ Sí | Beta | Simple, OpenAI-only | ⭐⭐⭐ |
| **Google ADK** | Python | ✅ Sí | Beta | Google ecosystem | ⭐⭐⭐ |

### Tier 2: Plataformas visuales (low-code)

| Plataforma | Tipo | Mejor para | Score |
|---|---|---|---|
| **n8n** | Workflow automation | Orquestar agentes + APIs + DB | ⭐⭐⭐⭐⭐ |
| **Flowise** | Visual LLM builder | Prototipar chatbots rápido | ⭐⭐⭐ |
| **Langflow** | Visual LangChain | RAG pipelines visuales | ⭐⭐⭐ |
| **Make.com** | No-code automation | Integraciones simples | ⭐⭐ |

### Tier 3: Plataformas conversacionales

| Plataforma | Enfoque | Mejor para | Score |
|---|---|---|---|
| **Botpress** | Chatbot platform | Chatbots multi-canal | ⭐⭐⭐ |
| **Voiceflow** | Voice + chat | IVR + voice agents | ⭐⭐⭐ |
| **Visito** | WhatsApp-specific | WhatsApp Business AI | ⭐⭐⭐ |

---

## 2. LLMs comparados para agentes conversacionales

| Modelo | Provider | Latencia | Costo | Contexto | Español | Coding | Agentic |
|---|---|---|---|---|---|---|---|
| **GLM-4.6** | ZAI (actual) | ~2s | Bajo | 128K | ✅ Excelente | ✅ 48.6% vs Claude | ✅ Sí |
| **GPT-4o** | OpenAI | ~1.5s | Medio | 128K | ✅ Excelente | ✅ Top tier | ✅ Sí |
| **Claude 3.5** | Anthropic | ~2s | Medio | 200K | ✅ Excelente | ✅ Top tier | ✅ Sí |
| **Gemini 2.0** | Google | ~1s | Bajo | 1M | ✅ Bueno | ✅ Bueno | ✅ Sí |
| **Llama 3.3** | Meta (open) | Varía | Gratis | 128K | ✅ Bueno | ⚠️ Regular | ⚠️ Limitado |
| **Mixtral** | Mistral (open) | Varía | Gratis | 32K | ⚠️ Regular | ⚠️ Regular | ❌ No |

### Veredicto LLM: **ZAI (GLM-4.6) como primario**

**Por qué:**
- ✅ Ya integrado en ZIAY (z-ai-web-dev-sdk)
- ✅ Costo bajo (importante para LATAM)
- ✅ Calidad casi par con Claude Sonnet (48.6% win rate)
- ✅ Excelente en español
- ✅ Soporta VLM (glm-4.6v para identificación de productos por imagen)
- ✅ Sin restricciones de región (OpenAI no disponible en algunos países LATAM)

**Fallback recomendado:** OpenAI GPT-4o (ya adaptado en `src/lib/llm/adapter.ts`)

---

## 3. Plataformas de orquestación para ZIAY

### Opción A: Next.js nativo (actual) — ⭐⭐⭐⭐

**Lo que ZIAY ya tiene:**
- 26 agentes con prompts especializados en `src/lib/agents/prompts.ts`
- 3 pipelines en `src/lib/orchestrator/constants.ts`
- API `/api/orchestrate` que ejecuta agentes en secuencia
- Fallback determinístico por agente
- Multi-provider LLM (Zai, OpenAI, xAI, Ollama)

**Pros:**
- ✅ Sin dependencias externas
- ✅ Control total del código
- ✅ Latencia mínima (sin hops)
- ✅ Debugging fácil
- ✅ Tests automatizados (891 tests)

**Contras:**
- ❌ No visual (cambiar prompts requiere deploy)
- ❌ Sin monitoreo de agentes en tiempo real
- ❌ Difícil para no-developers ajustar flujos

### Opción B: n8n + LangChain — ⭐⭐⭐⭐⭐ (RECOMENDADO)

**Cómo funcionaría:**
```
WhatsApp → n8n webhook → HTTP Request a /api/agents/{agentName} → ZIAY API
                                                              ↓
                                                         GLM-4.6 (ZAI)
                                                              ↓
                                                         Respuesta
                                                              ↓
n8n → WhatsApp Business API → Cliente
```

**Pros:**
- ✅ **Visual** — no-developers pueden ajustar flujos
- ✅ **Self-hosted** (ya en docker-compose.yml)
- ✅ **Integración nativa** con WhatsApp Business API
- ✅ **Monitoreo** visual de ejecuciones
- ✅ **Retry logic** built-in
- ✅ **Webhooks** para cada agente
- ✅ **Schedule** (cron para remarketing automático)
- ✅ Ya documentado en `upload/GUIA-DEPLOY-AGENTES-N8N.md`

**Contras:**
- ⚠️ Un hop extra (n8n → ZIAY API)
- ⚠️ Mantenimiento de 2 sistemas

### Opción C: LangGraph 1.0 — ⭐⭐⭐⭐

**Cómo funcionaría:**
```python
# LangGraph define el grafo de agentes
graph = StateGraph(AgentState)
graph.add_node("buyer_behavior", buyer_behavior_agent)
graph.add_node("profile", profile_agent)
graph.add_edge("buyer_behavior", "profile")
# ... 26 nodos
```

**Pros:**
- ✅ Framework más maduro para multi-agente (GA Oct 2025)
- ✅ Estado persistente entre agentes
- ✅ Human-in-the-loop nativo
- ✅ Streaming de respuestas

**Contras:**
- ❌ Requiere Python (ZIAY es TypeScript)
- ❌ Curva de aprendizaje
- ❌ Otra infraestructura que mantener
- ❌ Overkill para 26 agentes secuenciales

### Opción D: CrewAI — ⭐⭐⭐

**Pros:**
- ✅ Roles definidos (perfecto para 26 agentes con roles)
- ✅ Sintaxis simple

**Contras:**
- ❌ Python only
- ❌ Menos control que LangGraph
- ❌ Menos producción-ready

---

## 4. Voice Agents (Fase 2)

| Plataforma | Latencia | Costo/min | Español | WhatsApp voice | Score |
|---|---|---|---|---|---|
| **Vapi AI** | ~500ms | $0.12 | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| **Retell AI** | ~600ms | $0.15 | ✅ | ❌ | ⭐⭐⭐⭐ |
| **Bland AI** | ~800ms | $0.09 | ⚠️ | ❌ | ⭐⭐⭐ |
| **ElevenLabs** | ~400ms | $0.18 | ✅ | ❌ | ⭐⭐⭐⭐ |

**Recomendación:** **Vapi AI** para fase 2 (voice agents en WhatsApp)
- Menor latencia (500ms)
- Soporta WhatsApp voice calls
- Mejor relación calidad/precio
- API REST simple de integrar

---

## 5. Arquitectura recomendada para ZIAY

### Fase 1 (actual): Next.js + ZAI — ✅ Ya funcionando

```
Cliente → WhatsApp → ZIAY API → 26 agentes (GLM-4.6) → Respuesta
                                ↑
                          Fallback: OpenAI GPT-4o
```

### Fase 2 (Q1 2026): + n8n para workflows visuales

```
Cliente → WhatsApp → n8n webhook → ZIAY /api/agents/{name} → GLM-4.6 → Respuesta
                                ↓
                    n8n monitorea, reintentos, schedule
                                ↓
                    Remarketing automático (cron 8am)
                    Novedades auto-create (webhook transportadora)
                    Lead scoring semanal (schedule)
```

### Fase 3 (Q2 2026): + Vapi para voice agents

```
Cliente llama → Vapi AI → transcribe (ASR) → ZIAY /api/agents/{name} → GLM-4.6
                                                                        ↓
                    Vapi AI ← sintetiza (TTS) ← respuesta ←────────────┘
                                                                        ↓
                                                              Cliente escucha
```

### Fase 4 (Q3 2026): + LangGraph para agentes complejos

```
Casos complejos → LangGraph (Python microservice)
                → Grafo de agentes con estado
                → Human-in-the-loop (escalar a humano)
                → Volver a ZIAY con resultado
```

---

## 6. Comparación final: ¿Qué plataforma para ZIAY?

| Criterio | Next.js nativo | + n8n | + LangGraph | + CrewAI |
|---|---|---|---|---|
| **Costo** | ✅ $0 extra | ✅ $0 (self-hosted) | ⚠️ Servidor Python | ⚠️ Servidor Python |
| **Visual** | ❌ | ✅ Sí | ❌ | ❌ |
| **Producción** | ✅ Ya funciona | ✅ Maduro | ✅ GA Oct 2025 | ⚠️ |
| **WhatsApp** | ✅ Directo | ✅ Nativo | ❌ Manual | ❌ Manual |
| **Multi-agente** | ✅ 26 agentes | ✅ Orquesta | ✅ Mejor | ✅ |
| **Schedule/Cron** | ❌ Manual | ✅ Built-in | ❌ | ❌ |
| **Retry** | ⚠️ Básico | ✅ Built-in | ✅ | ⚠️ |
| **Monitoreo** | ❌ Logs | ✅ Visual UI | ⚠️ LangSmith | ⚠️ |
| **Learning curve** | ✅ Ya hecho | ✅ Fácil | ❌ Steep | ⚠️ Media |
| **LATAM fit** | ✅ | ✅ | ⚠️ | ⚠️ |

---

## 7. Recomendación final

### 🏆 Ganador: **Next.js nativo + n8n (fase 2)**

**Razón:** ZIAY ya tiene 26 agentes funcionando en Next.js con GLM-4.6. No necesita cambiar. Lo que necesita es **n8n como capa de orquestación visual** encima, para:

1. **Workflows visuales** — no-developers ajustan flujos sin tocar código
2. **Cron jobs** — remarketing automático, lead scoring semanal
3. **Webhooks** — novedades auto-create cuando transportadora reporta
4. **Monitoreo** — ver ejecuciones de agentes en tiempo real
5. **Retry logic** — reintentar agentes que fallan automáticamente
6. **WhatsApp nativo** — n8n tiene nodo nativo de WhatsApp Business API

### ¿Por qué NO LangGraph/CrewAI ahora?

1. **ZIAY ya funciona** — 26 agentes, 3 pipelines, 891 tests. No romper lo que funciona.
2. **Python overhead** — agregar un microservice Python adds complejidad innecesaria
3. **n8n hace lo mismo** — orquestación visual + retry + schedule, sin código
4. **LangGraph es overkill** — para 26 agentes secuenciales, un switch/case es suficiente
5. **Costo** — n8n es self-hosted y ya está en docker-compose

### ¿Cuándo sí considerar LangGraph?

- Cuando los agentes necesiten **estado complejo** entre ellos (memoria compartida)
- Cuando necesites **human-in-the-loop** (pausar pipeline, esperar humano, continuar)
- Cuando los pipelines sean **no-lineales** (if/else, loops, paralelo)
- Para entonces (Q3 2026), LangGraph 1.0 será más maduro

---

## 8. Plan de acción

| Fase | Cuándo | Qué | Esfuerzo |
|---|---|---|---|
| **1. Actual** | ✅ Hecho | 26 agentes en Next.js + GLM-4.6 | 0 |
| **2. n8n** | Q1 2026 | Deploy n8n + crear workflows para cada agente | 2 semanas |
| **3. Vapi** | Q2 2026 | Integrar Vapi AI para voice agents | 2 semanas |
| **4. LangGraph** | Q3 2026 | Solo si necesidad de estado complejo | 4 semanas |

---

## Fuentes

- LangChain: "Best AI Agent Frameworks 2026" (langchain.com/resources)
- Alice Labs: "7 AI Agent Frameworks Compared" (alicelabs.ai)
- Langflow: "Complete Guide to AI Agent Frameworks 2025"
- n8n: "Enterprise AI Agent Development Tools 2025"
- ZAI Blog: "GLM-4.6: Advanced Agentic Capabilities" (z.ai/blog)
- Reddit: "Comprehensive AI Agent Framework Comparison 2026"
- GuruSup: "How to Build AI Agent with n8n"
- Visito: "n8n Alternatives for WhatsApp Business AI"
- Roark: "Top 5 Voice AI Agent Platforms 2025"
- DigitalApplied: "Voice AI Agents: ElevenLabs vs Vapi vs Retell vs Bland"
- EasySell: "WhatsApp AI Agents in LATAM" (easysellapp.com)
- Northflank: "Yavendio scaled AI WhatsApp commerce across LATAM"

---

*Investigación: Julio 2026 · ZIAY · ZIAY SAS*
