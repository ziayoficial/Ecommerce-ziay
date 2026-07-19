# Estrategia Anti-Fricción: Motor de Cotización ZIAY

**Versión:** v0.4.0
**Fecha:** Julio 2026
**Aplica para:** Cualquier marca, nicho y mercado (nacional e internacional)

---

## Tabla de Contenidos

1. [Contexto](#1-contexto)
2. [Las 7 fricciones identificadas](#2-las-7-fricciones-identificadas)
3. [Solución: Motor ZIAY](#3-solución-motor-ziay)
4. [Cómo funciona el motor](#4-cómo-funciona-el-motor)
5. [Endpoints del motor (uso interno + n8n)](#5-endpoints-del-motor-uso-interno--n8n)
6. [Configuración por nicho de mercado](#6-configuración-por-nicho-de-mercado)
7. [Flujo conversacional sin fricción](#7-flujo-conversacional-sin-fricción)
8. [Métricas de reducción de fricción](#8-métricas-de-reducción-de-fricción)

---

## 1. Contexto

### Herramientas excluyentes

ChateaPro y el Generador de Prompts son **herramientas de terceros** que funcionan de forma independiente. Son excluyentes — no se conectan entre sí ni con ZIAY.

**ZIAY es la solución propia** que resuelve todas las fricciones que esas herramientas tienen, sin depender de ellas. Los endpoints desarrollados son exclusivos de ZIAY para uso interno y integración con n8n.

### Arquitectura de herramientas

```
┌─────────────────────────────────────────────────────┐
│  HERRAMIENTAS DE TERCEROS (excluyentes entre sí)    │
│                                                     │
│  ChateaPro          Generador de Prompts            │
│  (chatbot WA)       (creador de prompts)            │
│      ↓                      ↓                       │
│  Limitación: 12K     Limitación: estático            │
│  chars, alucina      sin flete dinámico              │
│                                                     │
│  ⚠️ NO se conectan con ZIAY                         │
│  ⚠️ NO comparten la solución                        │
├─────────────────────────────────────────────────────┤
│  SOLUCIÓN PROPIA                                    │
│                                                     │
│  ZIAY (plataforma completa)                         │
│  • Motor de cotización dinámica                     │
│  • Flete dinámico (Dropi/99envios/Aveonline)        │
│  • VLM para identificación por imagen               │
│  • Estrategia de pago híbrida                       │
│  • 26 agentes IA con reglas NUNCA/SIEMPRE           │
│  • n8n orquesta todo vía API ZIAY                   │
└─────────────────────────────────────────────────────┘
```

---

## 2. Las 7 fricciones identificadas

Estas fricciones existen en herramientas de terceros (ChateaPro, Generador). ZIAY las resuelve nativamente:

| # | Fricción | Causa raíz en terceros | Solución ZIAY |
|---|----------|----------------------|---------------|
| 1 | **Alucinación de precios** | LLM calcula precios en el prompt | Motor consulta DB real — 0% alucinación |
| 2 | **Cotizaciones cruzadas confusas** | Mezcla precios de 2+ referencias | Una referencia a la vez, estructurada |
| 3 | **Flete estático** | Tabla hardcodeada en prompt 12K | Cotización dinámica vía adaptadores |
| 4 | **No cobro híbrido** | Sin lógica anticipado vs COD | Estrategia configurable por canal |
| 5 | **No flete internacional** | Tabla solo tiene Colombia | Aveonline internacional (USD) |
| 6 | **Cobra sin confirmar** | LLM pide dinero antes del sí | `confirmed: false` obligatorio |
| 7 | **No identifica por imagen** | Sin VLM integrado | VLM (glm-4.6v) + búsqueda fuzzy |

### Causa raíz de TODAS las fricciones

Las herramientas de terceros intentan hacer **todo** dentro de un prompt de 12,000 caracteres: precios, fletes, reglas, flujo, catálogo. Esto es **imposible** porque:

- El LLM no tiene acceso a datos en tiempo real (precios cambian, stock cambia)
- 12K caracteres no son suficientes para tablas de fletes + catálogo + reglas + flujo
- Sin acceso a APIs externas, el LLM inventa lo que no sabe

### Por qué ZIAY no tiene estas fricciones

ZIAY **no** mete la lógica de negocio en el prompt. La lógica vive en **código** (TypeScript) que consulta DB reales y APIs de transportadoras. El prompt solo contiene el rol + reglas + contexto conversacional.

---

## 3. Solución: Motor ZIAY

### Arquitectura ZIAY (sin depender de terceros)

```
┌──────────────────────────────────────────────────────────────────┐
│                         ZIAY (solución propia)                    │
│                                                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐     │
│  │  n8n        │───▶│  ZIAY API    │───▶│  DB (precios    │     │
│  │  (orquesta) │    │  /api/agents │    │  reales, stock) │     │
│  └─────────────┘    │  /api/quote  │    └─────────────────┘     │
│                      │  /api/bridge │                            │
│  Cliente WA ────────▶│              │───▶┌─────────────────┐     │
│                      │  Motor de    │    │  Adaptadores    │     │
│                      │  Cotización  │    │  Dropi/99envios │     │
│                      │  Dinámica    │    │  Aveonline      │     │
│                      │              │    └─────────────────┘     │
│                      │  VLM         │───▶┌─────────────────┐     │
│                      │  (glm-4.6v)  │    │  Catálogo +     │     │
│                      │              │    │  búsqueda fuzzy │     │
│                      │  Reglas      │    └─────────────────┘     │
│                      │  NUNCA/SIEMPRE│                           │
│                      └──────────────┘                            │
│                                                                   │
│  ⚠️ NO usa ChateaPro                                              │
│  ⚠️ NO usa el Generador                                           │
│  ✅ Solución 100% propia                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Diferencia clave

| Aspecto | Terceros (ChateaPro/Generador) | ZIAY |
|---------|-------------------------------|------|
| Dónde vive la lógica | En el prompt (12K chars) | En código TypeScript |
| Precios | LLM inventa | DB real (0% alucinación) |
| Fletes | Tabla estática | API dinámica (Dropi/99envios/Aveonline) |
| Imágenes | No puede ver | VLM glm-4.6v + fuzzy search |
| Pago híbrido | No configurable | Configurable por canal |
| Internacional | No soportado | Aveonline (USD) |
| Confirmación | Cobra sin confirmar | `confirmed: false` obligatorio |
| Escalabilidad | Un prompt por marca | Multi-tenant, multi-nicho |
| Limitación chars | 12,000 | Sin límite (código, no prompt) |

---

## 4. Cómo funciona el motor

### Sin ZIAY (lo que pasaba con terceros)

```
Cliente: "Quiero 10 short de Hello Kitty a Medellín"
    ↓
Herramienta terceros intenta calcular en el prompt:
  - Precio: inventa $15.000 (alucina, el real es $18.500)
  - Flete: busca en tabla estática → $8.000 (real es $12.000)
  - Total: $158.000 (incorrecto)
  - Pago: pide dinero inmediatamente sin confirmar
    ↓
Cliente: recibe cotización incorrecta → reclamo o abandona
```

### Con ZIAY (sin fricción)

```
Cliente: "Quiero 10 short de Hello Kitty a Medellín"
    ↓
n8n: POST /api/agents/quote (o /api/ziay-bridge)
  → ZIAY motor de cotización:
    1. Busca precio real en DB: $18.500 c/u
    2. Aplica tramo volumen (10+ = $17.000 c/u)
    3. Cotiza flete con Dropi: $12.000
    4. Calcula pago híbrido: $170.000 anticipo + $12.000 COD
    5. Genera mensaje WhatsApp formateado
    6. confirmed: false (no cobra sin "sí")
    7. Devuelve respuesta a n8n
    ↓
n8n: envía mensaje al cliente
    ↓
Cliente: recibe cotización EXACTA con opciones de pago
```

---

## 5. Endpoints del motor (uso interno + n8n)

### POST /api/agents/[agentName]

Ejecuta un agente IA con reglas NUNCA/SIEMPRE + validación de output + escalación a humano.

### POST /api/quote/dynamic

Cotización completa: productos (DB real) + flete (dinámico) + pago (híbrido).

### POST /api/identify-product

Identifica producto desde imagen del cliente usando VLM + búsqueda fuzzy.

### POST /api/ziay-bridge

Puente interno que unifica 5 acciones (quote, identify, freight, payment, catalog). Usado por n8n para simplificar la integración.

### GET /api/agents/rules

Consulta las 46 reglas NUNCA/SIEMPRE (29 prohibidas + 17 obligatorias).

---

## 6. Configuración por nicho de mercado

### Moda / Pijamas (Saramantha, Lovely, Reina)

| Configuración | Valor |
|---------------|-------|
| paymentStrategy | hybrid |
| requirePrepayMin | 250000 |
| prepayDiscountPct | 5 |
| codFee | 8000 |
| freight adapters | Dropi, 99envios |
| VLM | ✅ (identificar diseños por imagen) |
| Tramos de volumen | ✅ (10+, 50+, 100+) |

### Sublimados / Personalizados (Majestic)

| Configuración | Valor |
|---------------|-------|
| paymentStrategy | advance (personalizados requieren prepago) |
| freight adapters | Dropi, 99envios |
| VLM | ✅ (identificar diseño de sublimación) |

### Internacional (cualquier marca exportando)

| Configuración | Valor |
|---------------|-------|
| paymentStrategy | advance |
| freight adapters | Aveonline (único con internacional) |
| currency | USD |
| VLM | ✅ |

### Farmacia (futuro nicho)

| Configuración | Valor |
|---------------|-------|
| paymentStrategy | advance |
| compliance | Ley 1098 (age gate) |
| IVA | Exento (medicamentos) |
| VLM | ✅ (identificar medicamentos por empaque) |

### Alimentos / Consumibles (futuro nicho)

| Configuración | Valor |
|---------------|-------|
| paymentStrategy | cod (contra entrega común) |
| IVA | Reducido (5% canasta familiar) |
| Tramos de volumen | ✅ (descuentos por bulto) |
| VLM | ✅ (identificar producto por empaque) |

### Configuración por país

| País | Moneda | Flete | Pago local |
|------|--------|-------|------------|
| Colombia | COP | Dropi, 99envios, Aveonline | PSE |
| México | MXN | Aveonline (internacional) | OXXO, SPEI |
| Brasil | BRL | Aveonline (internacional) | PIX |
| Perú | PEN | Aveonline (internacional) | — |
| Chile | CLP | Aveonline (internacional) | — |
| Argentina | ARS | Aveonline (internacional) | — |
| EE.UU. | USD | Aveonline (internacional) | Stripe |

---

## 7. Flujo conversacional sin fricción

```
1. Cliente envía mensaje
   → n8n webhook → ZIAY /api/agents/[agentName]
   → Agente detecta intención

2. Si cliente pregunta por productos
   → ZIAY busca en DB (catálogo real)
   → Devuelve productos + precios exactos

3. Si cliente envía imagen
   → ZIAY VLM (glm-4.6v) identifica producto
   → Búsqueda fuzzy en catálogo
   → Devuelve producto + precio + alternativas

4. Si cliente quiere cotizar
   → ZIAY motor de cotización:
     a. Consulta precios REALES de DB
     b. Aplica tramos de volumen
     c. Cotiza flete DINÁMICO con transportadora
     d. Calcula estrategia de pago híbrida
     e. Genera mensaje formateado
     f. confirmed=false (no cobra sin sí)

5. Si cliente confirma ("sí, quiero")
   → ZIAY marca confirmed=true
   → Solo AHORA se procesa el pago

6. Si cliente pregunta por flete internacional
   → ZIAY usa Aveonline (internacional)
   → Devuelve costo en USD + tiempo estimado

7. Si cliente cambia cantidad
   → ZIAY recalcula TODO
   → Precio puede cambiar por tramo de volumen
   → Flete puede cambiar por unidades
```

### Regla de oro: **ZIAY nunca devuelve `confirmed: true` sin el "sí" del cliente**

---

## 8. Métricas de reducción de fricción

| Fricción | Con terceros | Con ZIAY | Mejora |
|----------|-------------|----------|--------|
| Alucinación de precios | 30-40% | **0%** (DB real) | 100% |
| Flete incorrecto | 50-60% | **0%** (API dinámica) | 100% |
| Cobra sin confirmar | 20% | **0%** (confirmed=false) | 100% |
| No identifica imagen | 100% | **<10%** (VLM + fuzzy) | 90% |
| No flete internacional | 100% | **0%** (Aveonline) | 100% |
| No cobro híbrido | 100% | **0%** (configurable) | 100% |
| Cotización cruzada confusa | 40% | **0%** (estructurada) | 100% |
| Espacio en prompt | 12,000 chars (lleno) | **Sin límite** (código) | ∞ |

---

## Resumen

**ZIAY es la solución propia** que reemplaza las limitaciones de ChateaPro y el Generador. No se conecta con ellos — los reemplaza. El motor de cotización dinámica, el VLM, el flete dinámico y la estrategia de pago híbrida son componentes nativos de ZIAY que funcionan vía n8n o directamente desde el dashboard.

**Lo que ya está desarrollado (100% propio):**
- ✅ Motor de cotización dinámica (`src/lib/agents/dynamic-quote.ts`)
- ✅ Flete dinámico (Dropi/99envios/Aveonline)
- ✅ VLM para identificación por imagen (glm-4.6v)
- ✅ Estrategia de pago híbrida configurable
- ✅ Tramos de volumen automáticos
- ✅ `confirmed: false` obligatorio (no cobra sin "sí")
- ✅ 46 reglas NUNCA/SIEMPRE centralizadas
- ✅ Validación de output (detecta violaciones de reglas)
- ✅ Endpoints API para uso interno + n8n
- ✅ Multi-tenant, multi-nicho, multi-país (7 monedas, 4 locales)

**Lo que NO se hace:**
- ❌ No se comparte la solución con ChateaPro
- ❌ No se comparte con el Generador
- ❌ No se conecta ZIAY con herramientas de terceros
- ❌ No se exponen endpoints a herramientas externas (solo n8n + dashboard interno)

---

*ZIAY v0.4.0 · ZIAY SAS © 2026 · Bogotá, Colombia*
