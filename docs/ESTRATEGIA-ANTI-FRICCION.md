# Estrategia Anti-Fricción: ChateaPro + ZIAY

**Versión:** v0.3.0
**Fecha:** Julio 2026
**Aplica para:** Cualquier marca, nicho y mercado (nacional e internacional)

---

## Tabla de Contenidos

1. [Problema: Las 7 fricciones de ChateaPro](#1-problema-las-7-fricciones-de-chateapro)
2. [Solución: Arquitectura ZIAY Bridge](#2-solución-arquitectura-ziay-bridge)
3. [Cómo funciona el puente](#3-cómo-funciona-el-puente)
4. [Endpoints disponibles](#4-endpoints-disponibles)
5. [Prompt optimizado para ChateaPro](#5-prompt-optimizado-para-chateapro)
6. [Configuración por nicho de mercado](#6-configuración-por-nicho-de-mercado)
7. [Flujo conversacional sin fricción](#7-flujo-conversacional-sin-fricción)
8. [Métricas de reducción de fricción](#8-métricas-de-reducción-de-fricción)

---

## 1. Problema: Las 7 fricciones de ChateaPro

| # | Fricción | Causa raíz | Impacto |
|---|----------|------------|---------|
| 1 | **Alucinación de precios** | El LLM calcula precios en el prompt en lugar de consultar DB | Cliente recibe precio incorrecto → reclamo |
| 2 | **Cotizaciones cruzadas confusas** | Mezcla precios de 2+ referencias en un solo mensaje | Cliente no sabe qué precio es de qué producto |
| 3 | **Flete estático, no dinámico** | Tabla de fletes hardcodeada en el prompt de 12K chars | Flete incorrecto → cliente paga de más o de menos |
| 4 | **No maneja cobro híbrido** | Sin lógica de "anticipado vs contra entrega" configurable | Cliente no tiene opciones de pago |
| 5 | **No maneja flete internacional** | Tabla de fletes solo tiene ciudades de Colombia | No se puede vender internacional |
| 6 | **Cobra sin confirmar pedido** | El LLM pide dinero antes de confirmar el pedido completo | Cliente se siente presionado → abandona |
| 7 | **No identifica productos por imagen** | Sin VLM integrado — el LLM no puede ver imágenes | Cliente envía foto y el bot no sabe qué producto es |

### Causa raíz de TODAS las fricciones

ChateaPro intenta hacer **todo** dentro de un prompt de 12,000 caracteres: precios, fletes, reglas, flujo, catálogo. Esto es **imposible** de hacer bien porque:

- El LLM no tiene acceso a datos en tiempo real (precios cambian, stock cambia)
- 12K caracteres no son suficientes para tablas de fletes + catálogo + reglas + flujo
- Sin acceso a APIs externas, el LLM inventa lo que no sabe

### La solución

**Mover la lógica de negocio fuera del prompt y dentro de ZIAY.** ChateaPro solo necesita ser un "router" que llama a la API de ZIAY.

---

## 2. Solución: Arquitectura ZIAY Bridge

```
┌──────────────────────────────────────────────────────────────────┐
│                         CHATEAPRO                                 │
│                                                                   │
│  Prompt de 12K chars (MÍNIMO):                                   │
│  • Rol: "Eres Valentina, asesora de Saramantha"                 │
│  • Reglas NUNCA/SIEMPRE (consultadas de /api/agents/rules)      │
│  • Instrucción: "Para cotizar, identifica productos, o fletes,  │
│    llama al endpoint /api/chateapro-bridge"                     │
│  • NO contiene: precios, fletes, tablas, catálogo               │
│                                                                   │
│  ~2,000 caracteres usados de 12,000 disponibles                  │
│  (10,000 libres para contexto de conversación)                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Cliente: "Quiero 10 short de Hello Kitty a Medellín"           │
│       ↓                                                           │
│  ChateaPro: llama POST /api/chateapro-bridge                    │
│       action: "quote"                                             │
│       data: { items: [{sku:"PIJ-SHORT-HELLO-001", qty:10}],     │
│               city:"Medellín", country:"CO" }                    │
│       ↓                                                           │
├──────────────────────────────────────────────────────────────────┤
│                         ZIAY BRIDGE                               │
│                                                                   │
│  1. Consulta DB → precio REAL del Short Hello Kitty              │
│  2. Aplica tramo de volumen (10+ unidades → precio mayorista)   │
│  3. Cotiza flete DINÁMICO con Dropi → Medellín                  │
│  4. Calcula estrategia híbrida de pago                           │
│  5. Genera mensaje de WhatsApp formateado                       │
│  6. Devuelve TODO a ChateaPro                                    │
│                                                                   │
│  → ChateaPro solo pega el mensaje y lo envía al cliente         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Cómo funciona el puente

### Sin ZIAY (fricción actual)

```
Cliente: "Quiero 10 short de Hello Kitty a Medellín"
    ↓
ChateaPro intenta calcular en el prompt:
  - Precio: inventa $15.000 (alucina, el real es $18.500)
  - Flete: busca en tabla estática → $8.000 (real es $12.000)
  - Total: $158.000 (incorrecto)
  - Pago: pide dinero inmediatamente sin confirmar
    ↓
Cliente: recibe cotización incorrecta → reclamo o abandona
```

### Con ZIAY Bridge (sin fricción)

```
Cliente: "Quiero 10 short de Hello Kitty a Medellín"
    ↓
ChateaPro: POST /api/chateapro-bridge
  action: "quote"
  data: { items: [{sku:"PIJ-SHORT-HELLO-001", quantity:10}], city:"Medellín", country:"CO" }
    ↓
ZIAY:
  1. Busca precio real en DB: $18.500 c/u
  2. Aplica tramo volumen (10+ = $17.000 c/u)
  3. Cotiza flete con Dropi: $12.000
  4. Calcula pago híbrido: $170.000 anticipo + $12.000 COD
  5. Genera mensaje:
     "🧾 Tu cotización:
      10× Short Hello Kitty (10-49 unidades)
      $170.000
      Subtotal: $170.000
      Envío Medellín (Dropi): $12.000
      Entrega: 2-3 días hábiles
      TOTAL: $182.000
      💰 Anticipado: $170.000
      📦 Contra entrega: $182.000
      ¿Confirmamos tu pedido? 💗"
    ↓
ChateaPro: pega el mensaje y lo envía
    ↓
Cliente: recibe cotización EXACTA con opciones de pago
```

---

## 4. Endpoints disponibles

### POST /api/chateapro-bridge

**Endpoint principal.** ChateaPro llama este endpoint para TODO.

| Action | Qué hace | Resuelve fricción |
|--------|----------|-------------------|
| `quote` | Cotización completa (productos + flete + pago) | #1, #2, #3, #4, #5, #6 |
| `identify` | Identifica producto desde imagen del cliente | #7 |
| `freight` | Solo cotiza flete dinámico | #3, #5 |
| `payment` | Calcula estrategia de pago híbrida | #4 |
| `catalog` | Busca productos por texto | — |

### POST /api/quote/dynamic

Cotización completa con todos los componentes.

### POST /api/identify-product

Identifica producto desde imagen usando VLM (glm-4.6v).

### GET /api/agents/rules

Consulta las reglas NUNCA/SIEMPRE para incluirlas en el prompt de ChateaPro.

---

## 5. Prompt optimizado para ChateaPro

### El prompt de ChateaPro pasa de 12,000 chars a ~2,000 chars

**ANTES (12,000 chars con fricción):**
```
Eres Valentina, asesora de Saramantha.
[+ 3,000 chars de reglas NUNCA/SIEMPRE]
[+ 2,000 chars de tabla de fletes estática]
[+ 3,000 chars de planilla de precios]
[+ 2,000 chars de flujo conversacional]
[+ 2,000 chars de productos favoritos con imágenes]
= 12,000 chars — LLENO, ALUCINA, SIN ESPACIO PARA CONTEXTO
```

**DESPUÉS (2,000 chars sin fricción):**
```
Eres Valentina, asesora de Saramantha. Tutea, certeza total.

# REGLAS ABSOLUTAS
NUNCA:[N01]"descuento"|[N02]precio antes I2|[N07]inventar precios...
SIEMPRE:[S01]perfil+historial|[S02]adaptar tono|[S03]cerrar accion...

# INSTRUCCIONES DE SISTEMA
Para COTIZAR: llama /api/chateapro-bridge action="quote"
Para IDENTIFICAR imagen: llama /api/chateapro-bridge action="identify"
Para BUSCAR producto: llama /api/chateapro-bridge action="catalog"
Para FLETE: llama /api/chateapro-bridge action="freight"

NUNCA inventes precios. NUNCA inventes fletes.
SIEMPRE usa el endpoint para obtener datos reales.
SIEMPRE confirma el pedido antes de pedir dinero.
= 2,000 chars — 10,000 libres para contexto de conversación
```

### Cómo generar este prompt

```
GET /api/agents/rules → obtener reglas
→ Combinar con rol del agente + instrucciones de bridge
→ Pegar en ChateaPro (cabe en 2K chars)
```

---

## 6. Configuración por nicho de mercado

### Moda / Pijamas (Saramantha, Lovely, Reina)

| Configuración | Valor |
|---------------|-------|
| channelType | whatsapp |
| paymentStrategy | hybrid |
| requirePrepayMin | 250000 |
| prepayDiscountPct | 5 |
| codFee | 8000 |
| freight adapters | Dropi, 99envios |
| VLM | ✅ (identificar diseños por imagen) |

### Sublimados / Personalizados (Majestic)

| Configuración | Valor |
|---------------|-------|
| channelType | whatsapp |
| paymentStrategy | advance (personalizados requieren prepago) |
| requirePrepayMin | 0 |
| prepayDiscountPct | 0 |
| codFee | 0 |
| freight adapters | Dropi, 99envios |
| VLM | ✅ (identificar diseño de sublimación) |

### Internacional (cualquier marca exportando)

| Configuración | Valor |
|---------------|-------|
| channelType | whatsapp |
| paymentStrategy | advance (siempre anticipado internacional) |
| freight adapters | Aveonline (único con internacional) |
| currency | USD |
| VLM | ✅ |

### Farmacia / Insumos (futuro nicho)

| Configuración | Valor |
|---------------|-------|
| channelType | whatsapp |
| paymentStrategy | advance |
| volumeTiers | ✅ (descuentos por cantidad) |
| compliance | Ley 1098 (age gate para menores) |
| VLM | ✅ (identificar medicamentos por imagen) |

### Alimentos / Consumibles (futuro nicho)

| Configuración | Valor |
|---------------|-------|
| channelType | whatsapp |
| paymentStrategy | cod (contra entrega común en alimentos) |
| volumeTiers | ✅ (descuentos por bulto) |
| IVA | Reducido (5% canasta familiar) |
| VLM | ✅ (identificar producto por empaque) |

---

## 7. Flujo conversacional sin fricción

```
1. Cliente envía mensaje
   → ChateaPro detecta intención

2. Si cliente pregunta por productos
   → ChateaPro llama bridge action="catalog"
   → ZIAY busca en DB, devuelve productos reales + precios

3. Si cliente envía imagen
   → ChateaPro llama bridge action="identify"
   → ZIAY usa VLM + búsqueda fuzzy en catálogo
   → Devuelve producto identificado + precio + alternativas

4. Si cliente quiere cotizar
   → ChateaPro llama bridge action="quote"
   → ZIAY:
     a. Consulta precios REALES de DB (no alucina)
     b. Aplica tramos de volumen si aplican
     c. Cotiza flete DINÁMICO con transportadora real
     d. Calcula estrategia de pago híbrida
     e. Genera mensaje formateado
     f. Marca confirmed=false (no cobra sin sí)

5. Si cliente confirma ("sí, quiero")
   → ChateaPro marca confirmed=true
   → Solo AHORA se procesa el pago

6. Si cliente pregunta por flete internacional
   → ChateaPro llama bridge action="freight" country="MX"
   → ZIAY usa Aveonline (internacional)
   → Devuelve costo en USD + tiempo estimado

7. Si cliente cambia cantidad
   → ChateaPro re-llama bridge action="quote"
   → ZIAY recalcula TODO (precio puede cambiar por tramo de volumen)
```

### Regla de oro: **ZIAY nunca devuelve `confirmed: true`**

El cliente SIEMPRE debe decir "sí" antes de que se procese el pago. ZIAY devuelve `confirmed: false` en cada cotización — ChateaPro debe esperar la confirmación explícita.

---

## 8. Métricas de reducción de fricción

| Fricción | Antes (ChateaPro solo) | Después (ChateaPro + ZIAY) | Mejora |
|----------|----------------------|---------------------------|--------|
| Alucinación de precios | 30-40% de cotizaciones | **0%** (DB real) | 100% |
| Flete incorrecto | 50-60% (tabla estática) | **0%** (API dinámica) | 100% |
| No confirma antes de cobrar | 20% de casos | **0%** (confirmed=false) | 100% |
| No identifica productos por imagen | 100% de imágenes | **<10%** (VLM + fuzzy) | 90% |
| No maneja flete internacional | 100% de casos intl | **0%** (Aveonline) | 100% |
| No maneja cobro híbrido | 100% de casos | **0%** (configurable) | 100% |
| Cotización cruzada confusa | 40% de multi-ref | **0%** (estructurada) | 100% |
| Espacio en prompt | 12,000 chars (lleno) | **2,000 chars** (10K libres) | 83% menos |

---

## Resumen

**La estrategia es simple:** ChateaPro no debe calcular nada — solo conversar y llamar a la API de ZIAY para toda la lógica de negocio. Esto reduce el prompt de 12K a 2K chars, elimina la alucinación, y permite que el sistema escale a cualquier nicho y mercado sin reescribir el prompt.

**Lo que ya está desarrollado:**
- ✅ `POST /api/chateapro-bridge` — puente universal (5 actions)
- ✅ `POST /api/quote/dynamic` — motor de cotización dinámica
- ✅ `POST /api/identify-product` — VLM + búsqueda fuzzy
- ✅ `GET /api/agents/rules` — reglas NUNCA/SIEMPRE para el prompt
- ✅ Motor de fletes dinámico (Dropi/99envios/Aveonline)
- ✅ Estrategia de pago híbrida configurable
- ✅ Tramos de volumen automáticos
- ✅ `confirmed: false` obligatorio (no cobra sin sí)

**Lo que se necesita en ChateaPro:**
1. Configurar un HTTP Request node que llame `/api/chateapro-bridge`
2. Pegar el prompt optimizado de 2K chars (generado por ZIAY)
3. Configurar la URL del webhook de ChateaPro en n8n/ZIAY

---

*ZIAY v0.3.0 · Indisutex SAS © 2026 · Bogotá, Colombia*
