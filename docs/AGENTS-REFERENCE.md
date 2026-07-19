# Referencia de Agentes — ZIAY

Documentación de los **agentes conversacionales** de ZIAY, con su nombre, endpoint, system prompt resumido, tablas que consultan, side-effects y cuándo usarlos. Incluye la **secuencia de orquestación de 8 pasos** (v0.4.1 · IA-3 — era 9 en v0.4.0) y los **4 escenarios del §12** del documento Saramantha.

> 📖 Código fuente: [`../src/lib/agents/prompts.ts`](../src/lib/agents/prompts.ts)
> 📖 Orquestador: [`../src/lib/orchestrator/orchestrator.ts`](../src/lib/orchestrator/orchestrator.ts)
> 📖 API: [`POST /api/agents/[agentName]`](./API-REFERENCE.md#5-agents)

> **v0.4.1 update (IA-3 · consolidación)**: El código ahora define **24 agentes
> conversacionales** (20 consolidados + 4 control-plane de IA-1). La consolidación
> fusionó 8 agentes redundantes en 2 merged + 3 enhanced:
> - `guide_tracking` + `guide_alert` + `logistics_notifier` → `postventa_logistics`
> - `customer_score` + `carrier_score` → `scoring`
> - `address_analysis` se integró en `address` (modo `analyze`)
> - `theme` se integró en `catalog` (vía `ctx.theme`)
> - `cart_builder` se integró en `quote` (modo `cart`)
>
> Los 9 agentes documentados aquí (8 originales del §6 + `vision`) son el núcleo
> del orquestador Saramantha. Los 15 agentes restantes cubren: post-venta,
> inteligencia de negocio, especializados y control-plane (governor, qa_reviewer,
> memory_curator, sentiment). Ver `src/lib/agents/prompts.ts` y `AGENT_NAMES` /
> `AGENT_LABELS` para el catálogo completo.

---

## 📋 Tabla de contenidos

- [Regla de oro §2 — Sin datos de negocio en prompts](#regla-de-oro-2--sin-datos-de-negocio-en-prompts)
- [Los 9 agentes del pipeline principal](#los-9-agentes-del-pipeline-principal)
  1. [Profile (§6.1)](#1-profile-61)
  2. [Speech (§6.2)](#2-speech-62)
  3. [Quote (§6.3 · con cart_builder)](#3-quote-63--con-cart_builder)
  4. [Catalog (§6.4 · con theme)](#4-catalog-64--con-theme)
  5. [Objection (§6.6)](#5-objection-66)
  6. [Address (§6.7 · con address_analysis)](#6-address-67--con-address_analysis)
  7. [Logistics (§6.8)](#7-logistics-68)
  8. [Vision (§6.9)](#8-vision-69)
  9. [Checkout (§6.10)](#9-checkout-610)
- [Orquestación de 8 pasos (§12)](#orquestación-de-8-pasos-12)
- [Los 4 escenarios del §12](#los-4-escenarios-del-12)
- [Timeouts y fallbacks](#timeouts-y-fallbacks)
- [Cómo extender con un nuevo agente](#cómo-extender-con-un-nuevo-agente)

---

## Regla de oro §2 — Sin datos de negocio en prompts

> **NUNCA se inyectan datos de negocio en los system prompts.** Los system prompts solo contienen instrucciones de comportamiento. Los datos (catálogo, precios, objeciones, discursos) se inyectan en el `user` message después de consultar la DB filtrada por `tenantId`.

Esto garantiza:

1. **Aislamiento multi-tenant**: un prompt leak no expone datos de otros tenants.
2. **Seguridad ante prompt injection**: un atacante no puede exfiltrar datos que el agente no tenga en su `user` message.
3. **Auditabilidad**: el contexto exacto que el LLM recibió está en código TypeScript visible.

### Ejemplo (agente `quote`)

```typescript
// ❌ MAL — datos de negocio en system prompt
const system = `Eres la cotizadora de Saramantha. Los precios son: Short Tira $13.700, Pantalón $18.500, Batola $22.300. Para mayorista: 6-11 unidades 10% off, 12-35 15% off, 36+ 20% off.`

// ✅ BIEN — datos en user message
const system = `Eres el motor de cotización de ${tenant.slug}. Recibes uno o más SKU de interés y la cantidad de cada uno. Consulta precios_por_volumen (filtrado por tenant_id) por cada SKU según tipo_cliente y cantidad. Suma el total a pagar, la venta estimada, y el margen total. Nunca inventes un precio que no exista en la tabla.`

const user = `Items a cotizar:
- SKU PIJ-SHORT-TIRA-001 (Short Tira) × 6: precio base 13700, precio volumen 12330 (tramo 6-11)
- SKU PIJ-PANTALON-002 (Pantalón) × 6: precio base 18500, precio volumen 16650 (tramo 6-11)`
```

---

## Los 10 agentes

Cada agente es una función async que recibe un `AgentContext` y retorna `{ system: string, user: string }`. El endpoint `POST /api/agents/[agentName]` llama al builder, pasa el system+user al LLM adapter del tenant, y devuelve la respuesta.

### 1. Profile (§6.1)

**Nombre**: `profile`
**Label**: Perfilamiento de leads
**Endpoint**: `POST /api/agents/profile`

**System prompt resumido**: Clasificador de perfil del lead a partir de su mensaje y el contexto del anuncio que lo trajo. Determina: `mayorista` (tienda/surtir/vender/negocio), `emprendedor` (arrancar/emprender), `detal` (para mí) o `regalo`. Si no hay señal clara, responde exactamente la `pregunta_perfil` configurada. **Nunca** pregunta el perfil antes de haber procesado la imagen/video inicial del anuncio, si lo hay.

**Tablas que consulta**:
- `Tenant` (lee `preguntaPerfil`, `slug`)

**Side-effects**:
- El endpoint persiste el perfil detectado en `Conversation.perfilConversacion` y `Customer.perfilDetectado`.

**Cuándo usarlo**: Al inicio de toda conversación nueva. Es el **paso 1 del orquestador**. No avanza hasta recibir respuesta clara del cliente.

---

### 2. Speech (§6.2)

**Nombre**: `speech`
**Label**: Discurso de ventas por perfil
**Endpoint**: `POST /api/agents/speech`

**System prompt resumido**: Asesora de ventas que **tutea, con certeza total, sin disculpas**. Cada mensaje cierra con una acción. Usa `aperturaTexto` y `pruebaSocial` de `SalesSpeech` tal como están, adaptando solo el `tono_marca`. No inventa datos de la empresa. **Máximo 20 palabras por mensaje, máximo 2 emojis, nunca preguntas abiertas después de dar el precio**.

**Tablas que consulta**:
- `Tenant` (lee `nombreAsesora`, `tonoMarca`)
- `SalesSpeech` (lee `aperturaTexto`, `pruebaSocial` filtrado por `tenantId_perfil`)

**Side-effects**: Ninguno (solo genera el discurso).

**Cuándo usarlo**: Inmediatamente después de `profile`. Es el **paso 2 del orquestador**. Abre la conversación con el discurso correcto para el perfil detectado.

---

### 3. Quote (§6.3)

**Nombre**: `quote`
**Label**: Ofertas y cotización cruzada
**Endpoint**: `POST /api/agents/quote`

**System prompt resumido**: Motor de cotización. Recibe SKUs y cantidades, consulta `precios_por_volumen` por cada SKU según `tipo_cliente`. Suma total a pagar, venta estimada (usando precio_ref_mercado), y margen. Responde con el formato exacto: `"[cantidad] [producto] + [cantidad] [producto]: pagas $[total] → vendes $[venta] → te sobran $[margen] limpios"`. **Nunca inventa un precio que no exista en la tabla.**

**Tablas que consulta**:
- `Tenant`
- `Product` (busca por `tenantId_sku`)
- `VolumePrice` (busca por `tenantId_productId_tipoCliente`, ordena por `cantidadMinima`)

**Side-effects**: Ninguno.

**Ejemplo de output**: `"6 Short Tira + 6 Pantalón: pagas $196.080 → vendes $210.000 → te sobran $13.920 limpios. ¿Confirmas?"`

**Cuándo usarlo**: Después de que el cliente confirma interés por productos específicos. Es el **paso 5 del orquestador**.

---

### 4. Catalog (§6.4)

**Nombre**: `catalog`
**Label**: Respuesta visual-primero
**Endpoint**: `POST /api/agents/catalog`

**System prompt resumido**: Cuando el lead pregunta por un producto, tema o categoría, **la respuesta NUNCA puede ser solo texto ni un enlace genérico**. Busca en el catálogo real (sincronizado desde WA Catalog, WooCommerce, Shopify o Supabase) el producto que mejor coincide con la intención. Si la intención agrupa una categoría amplia (ej: "familia"), trae **mínimo 3 prendas distintas** disponibles en esa categoría (consulta `combos_categoria`). Acompaña con **máximo 1-2 líneas de texto**. Cierra con una **pregunta binaria**, nunca abierta.

**Tablas que consulta**:
- `Tenant`
- `Product` (busca por nombre, diseño, categoría, description; o por SKUs de `CategoryCombo`)
- `CategoryCombo` (si el query coincide con una categoría)

**Side-effects**: Ninguno.

**Cuándo usarlo**: Cuando el lead pregunta por productos o categorías. Es el **paso 3 del orquestador**.

---

### 5. Theme (§6.5)

**Nombre**: `theme`
**Label**: Oferta por tema/personaje
**Endpoint**: `POST /api/agents/theme`

**System prompt resumido**: Cuando el lead menciona un personaje o tema sin mencionar la prenda (ej: "tienen de Stitch?", "algo de Hello Kitty?"), busca en `temas_diseño` ese tema y trae **TODAS las prendas disponibles en él**. Entrega el resultado al agente `catalog` para que lo muestre con imágenes. **Nunca responde "no tenemos eso" sin antes verificar en `temas_diseño`**.

**Tablas que consulta**:
- `Tenant`
- `ThemeDesign` (lista todos los temas del tenant con sus SKUs asociados)

**Side-effects**: Ninguno.

**Cuándo usarlo**: Cuando el lead menciona un tema/personaje sin mencionar la prenda específica. Es el **paso 4 del orquestador** (opcional — solo si el lead pregunta por tema).

---

### 6. Objection (§6.6)

**Nombre**: `objection`
**Label**: Manejo de objeciones
**Endpoint**: `POST /api/agents/objection`

**System prompt resumido**: Clasifica el mensaje del lead como un tipo de objeción, consulta la tabla `objeciones` para ese tipo, y adapta `respuesta_base` y `gatillo_mental_asociado` al contexto de la conversación. **Nunca repite el mismo argumento dos veces en la misma conversación** — revisa el historial antes de responder.

**CASO ESPECIAL — TALLA (§18.2)**: Si el lead pregunta por tallas fuera del rango S-L:
1. Confirma que actualmente solo manejamos S, M, L.
2. Ofrece registrar su interés para notificarle cuando amplíemos tallas.
3. **NO derivar a asesor humano automáticamente** — intentar cerrar con las tallas disponibles.
4. Solo derivar si el lead insiste **2+ veces** explícitamente en tallas fuera de rango.

**Tablas que consulta**:
- `Tenant`
- `Objection` (lista todas las objeciones configuradas con `respuestaBase` y `gatilloMentalAsociado`)
- `Message` (implícitamente, vía el contexto de conversación para no repetir argumentos)

**Side-effects**: Ninguno.

**Cuándo usarlo**: Cuando el lead expresa una objeción (precio, desconfianza, talla, lo pienso, producto no disponible). Es el **paso 6 del orquestador**.

---

### 7. Address (§6.7)

**Nombre**: `address`
**Label**: Confirmación de datos (10 campos)
**Endpoint**: `POST /api/agents/address`

**System prompt resumido**: Cuando el lead confirma que quiere comprar, extrae de la conversación **10 campos**: nombre, apellido, teléfono, departamento, ciudad, dirección, horario, talla, diseño y cantidad. Pregunta solo los campos que falten, **uno a la vez** si es necesario. Al completar los 10, normaliza la dirección y consulta `historial_entrega_direccion` antes de confirmar el pedido.

**Tablas que consulta**:
- `Tenant`
- `DeliveryHistory` (filtra por `tenantId_contactoId`, trae últimos 5)

**Side-effects**: Ninguno directamente (el contexto de partialAddress lo mantiene el orquestador).

**Cuándo usarlo**: Cuando el lead acepta el pedido y hay que confirmar datos. Es el **paso 7 del orquestador**.

---

### 8. Logistics (§6.8)

**Nombre**: `logistics`
**Label**: Logística de fletes
**Endpoint**: `POST /api/agents/logistics`

**System prompt resumido**: Motor de fletes. **Nunca habla directo con Dropi, 99envios o Aveonline** — todo pasa por `LogisticsAdapter`, que ya sabe cuál de los tres tiene configurado el tenant (`proveedor_logistico`). Si el envío es nacional, consulta `cotizaciones_flete` (alimentada con tarifas reales del proveedor logístico) según ciudad y cantidad de unidades. Si es internacional, primero confirma ciudad y país exactos, y cotiza usando la tarifa real disponible — **nunca inventa un valor de flete**. Responde con tarifa, tiempo estimado y transportadora en una sola frase.

**Tablas que consulta**:
- `Tenant` (lee `proveedorLogistico`, `politicaPago`)
- `FreightQuote` (caché de cotizaciones por `tenantId_proveedor_ciudad_pais_cantidad`)

**Adapters que usa** (vía `getLogisticsAdapter(tenantId)`):
- `DropiAdapter` | `Envios99Adapter` | `AveonlineAdapter`

**Side-effects**: Ninguno directamente (la cotización real la hace el `LogisticsAdapter`).

**Cuándo usarlo**: Después de confirmar la dirección. Es el **paso 8 del orquestador**.

---

### 9. Vision (§6.9)

**Nombre**: `vision`
**Label**: Visión (identificación por imagen)
**Endpoint**: `POST /api/agents/vision`

**System prompt resumido**: Identifica productos del catálogo real a partir de imágenes enviadas por el cliente.

**Reglas estrictas**:
1. La franja de metadata visible en cada imagen del catálogo contiene SKU, diseño y precio de referencia.
2. Tu **PRIORIDAD** es leer esa franja y devolver el SKU exacto. NO inventes.
3. Si la franja está recortada o ilegible, compara visualmente contra los productos del catálogo y devuelve el SKU más probable con confianza (0-1).
4. Si la confianza es baja (< 0.6), responde pidiendo al cliente que confirme el diseño, sin asumir cuál es.
5. Responde **SOLO** en formato JSON: `{"sku": "...", "confianza": 0.0-1.0, "metodo": "ocr_franja|comparacion_visual|sin_match", "pregunta_confirmacion": "..." | null}`

**Tablas que consulta**:
- `Tenant`
- `Product` (trae 20 productos activos con `sku`, `name`, `diseno`, `price`, `imageUrl` para comparación visual)

**Pipeline determinístico alternativo** (Saramantha §4): además del VLM directo, existe `POST /api/vision-pipeline` que ejecuta Tesseract OCR + OpenCLIP + pregunta al cliente si confianza < 0.6. La UI ofrece ambos botones.

**Side-effects**:
- El endpoint persiste una fila en `ImageIdentification` con `skuDetectado`, `confianza`, `metodo` y `imagenUrl`.

**Cuándo usarlo**: Cuando el cliente envía una imagen de producto (sin SKU o con SKU ambiguo). No está en la secuencia principal del orquestador (es un agente auxiliar invocado on-demand).

---

### 10. Checkout (§6.10)

**Nombre**: `checkout`
**Label**: Checkout y sincronización
**Endpoint**: `POST /api/agents/checkout`

**System prompt resumido**: Cuando el pedido está confirmado (datos completos, flete cotizado), prepara el resumen final para el cliente y dispara el proceso de checkout:

1. Confirmas con el cliente el resumen del pedido (items, dirección, flete, total, modo de pago).
2. Si pago anticipado: generas el link del carrito y lo envías.
3. Si contra entrega: confirmas que el pago se hará al recibir.
4. Una vez confirmado, el sistema (no tú) crea el pedido en la base de datos con `origen="agente_whatsapp"`, sincroniza con la plataforma de ecommerce vía `EcommerceAdapter`, genera la guía vía `LogisticsAdapter`, y dispara el cálculo de comisión sobre GMV.

Tu mensaje al cliente debe ser el resumen + una **pregunta binaria** de confirmación final. **Máximo 30 palabras + lista de items**.

**Tablas que consulta**:
- `Tenant` (lee `politicaPago`)

**Side-effects** (8 acciones reales cuando recibe `tenantId` + `customerId` + `items`):

1. Crea `Order` con `origen='agente_whatsapp'` y todos los campos del contexto.
2. Crea `OrderItem[]` con volume pricing aplicado (consulta `VolumePrice`).
3. Crea `Attribution` con `model='last_click'` al último ad conocido.
4. Llama a `EcommerceAdapter.crearPedido()` → crea `CartSync` con el `orderIdExterno` retornado.
5. Llama a `LogisticsAdapter.generarGuia()` → persiste `Shipment` con `transportadoraCanonica` normalizada vía `Carrier`.
6. Crea `CommissionEntry` al 50% (`reconocidaPct=50`, `etapaReconocimiento='datos_completados'`).
7. Crea `OrderEvent` con `type='created'`.
8. Escribe `AuditLog` con `action='checkout.completed'`.

**Ejemplo de output del endpoint**:

```json
{
  "agent": "checkout",
  "reply": "Resumen: 6 Short Tira, Bogotá, flete $9.500, total $205.580 COD. ¿Confirmas?",
  "sideEffects": {
    "orderId": "ord-CF-100439",
    "orderItemsCount": 6,
    "attributionId": "attr-001",
    "shipmentId": "shp-001",
    "numeroGuia": "DROPI-MRE7JO8N-9681",
    "transportadoraCanonica": "Servientrega",
    "commissionEntryId": "ce-001",
    "commissionRecognizedPct": 50
  }
}
```

**Cuándo usarlo**: Cuando todos los datos están confirmados (perfil + items + dirección + flete). Es el **paso 9 (final) del orquestador**.

---

## Orquestación de 9 pasos (§12)

El orquestador (`src/lib/orchestrator/orchestrator.ts`) ejecuta los 10 agentes en secuencia automática basada en el estado de la conversación. Cada agente alimenta al siguiente.

### Secuencia

| Paso | Agente | Label | Descripción |
|------|--------|-------|-------------|
| 1 | `profile` | Perfilamiento del lead | Detecta mayorista/emprendedor/detal/regalo |
| 2 | `speech` | Discurso de apertura por perfil | Usa SalesSpeech para abrir |
| 3 | `catalog` | Catálogo visual-primero | Trae imágenes reales |
| 4 | `theme` | Búsqueda por tema/personaje | Si el lead menciona Stitch, Hello Kitty, etc. |
| 5 | `quote` | Cotización con volume pricing | Formato "pagas $X → vendes $Y" |
| 6 | `objection` | Manejo de objeciones | Solo si el lead objeta |
| 7 | `address` | Confirmación de datos (10 campos) | Uno a la vez |
| 8 | `logistics` | Cotización de flete real | Vía LogisticsAdapter |
| 9 | `checkout` | Checkout + sincronización | 8 side-effects |

### Estado del orquestador

```typescript
interface OrchestratorState {
  tenantId: string
  conversationId?: string
  customerId?: string
  scenario: OrchestratorScenario
  step: number                  // 0-9
  perfil?: string               // detectado en step 1
  items?: { sku: string; cantidad: number }[]   // seteado en step 5
  partialAddress?: Record<string, string>       // acumulado en step 7
  freightQuote?: { tarifa: number; tiempo_estimado_dias: number; transportadora: string }
  history: { agent: string; reply: string; ts: string }[]
  done: boolean                 // true cuando step >= 9
}
```

### Cómo avanza el estado

- **Step 1 → perfil**: si el reply contiene `mayorista`/`emprendedor`/`detal`/`regalo`, se setea `state.perfil`.
- **Step 5 → items**: si `state.items` está vacío, el orquestador toma los primeros 2 productos del tenant como demo (6 unidades si mayorista, 2 si no).
- **Cada paso**: incrementa `state.step` en 1 y añade el reply al `history`.

### Invocación

```bash
# Un paso a la vez
POST /api/orchestrate
{
  "tenantId": "ten-saramantha",
  "scenario": "ziay_wa_catalog",
  "mode": "step"
}

# Todos los 9 pasos en una sola llamada
POST /api/orchestrate
{
  "tenantId": "ten-saramantha",
  "scenario": "ziay_wa_catalog",
  "mode": "full"
}
```

---

## Los 4 escenarios del §12

El documento Saramantha §12 define 4 escenarios end-to-end que el orquestador debe soportar. Cada uno corresponde a una combinación de `plataformaCatalogo` + `bdCatalogo` + `proveedorLogistico` diferente.

### 1. `ziay_wa_catalog` (§12.1)

**Label**: ZIAY (WhatsApp Catalog)
**Descripción**: Catálogo nativo WhatsApp, logística Dropi.

**Configuración del tenant**:
- `plataformaCatalogo`: `whatsapp_catalog`
- `bdCatalogo`: `supabase_nuestro`
- `proveedorLogistico`: `dropi`
- `proveedorIa`: `zai`

**Flujo**: los productos se sincronizan desde WhatsApp Commerce Manager → DB. Los pedidos se registran en el núcleo (Meta no expone API de pedidos). Las guías se generan con Dropi. Es el escenario por defecto de Saramantha, Majestic, Lovely y Reina.

### 2. `client_woocommerce` (§12.2)

**Label**: Cliente con WooCommerce
**Descripción**: Adaptador Woo, sync de pedidos bidireccional.

**Configuración del tenant**:
- `plataformaCatalogo`: `woocommerce`
- `proveedorLogistico`: `dropi` (o el que el cliente configure)

**Flujo**: los productos se sincronizan desde WooCommerce REST API (`/wp-json/wc/v3/products`) con Basic Auth. Los pedidos creados por el agente se replican en WooCommerce vía `EcommerceAdapter.crearPedido()` → crea `CartSync` con el `orderIdExterno` del pedido en Woo. Las actualizaciones de estado fluyen en ambos sentidos vía webhooks.

### 3. `client_shopify` (§12.3)

**Label**: Cliente con Shopify
**Descripción**: GraphQL Admin API, HMAC webhooks.

**Configuración del tenant**:
- `plataformaCatalogo`: `shopify`

**Flujo**: similar a WooCommerce pero con GraphQL Admin API (`/admin/api/2024-01/graphql.json`) con header `X-Shopify-Access-Token`. Los webhooks de Shopify se firman con HMAC SHA-256 que debe verificarse (igual que los webhooks de Meta).

### 4. `client_supabase_nuestro` (§12.4)

**Label**: Cliente sin catálogo (Supabase nuestro)
**Descripción**: Provisionamos Supabase con catálogo.

**Configuración del tenant**:
- `plataformaCatalogo`: `catalogo_nuestro`
- `bdCatalogo`: `supabase_nuestro`

**Flujo**: cuando un cliente no tiene su propio catálogo, ZIAY provisiona una Supabase dedicada y le carga el catálogo. El cliente puede gestionar su catálogo vía la UI de Supabase o vía el dashboard de ZIAY. El `SupabaseCatalogAdapter` en modo `nuestro` tiene read-write completo.

---

## Timeouts y fallbacks

### Timeout por agente (endpoint individual)

`POST /api/agents/[agentName]` tiene un timeout de **20s** vía `Promise.race`. Si el LLM no responde en 20s, el endpoint devuelve un fallback determinístico por agente:

```typescript
const fallbacks: Record<string, string> = {
  profile: 'pendiente',
  speech: '¡Hola! ¿Qué producto te interesa?',
  quote: '¿Qué cantidades necesitas?',
  catalog: 'Te muestro las opciones disponibles.',
  theme: 'Tenemos varios diseños disponibles.',
  objection: 'Entiendo. ¿Te confirmo el pedido?',
  address: '¿Cuál es tu ciudad y dirección?',
  logistics: 'El envío se cotiza según tu ciudad.',
  vision: '{"sku": null, "confianza": 0, "metodo": "sin_match", "pregunta_confirmacion": "¿Puedes enviarme otra foto?"}',
  checkout: '¿Confirmas el pedido?',
}
```

### Timeout por agente (orquestador)

Cada paso del orquestador tiene un timeout de **15s** vía `Promise.race`. Si un agente timeout, el orquestador continúa con el siguiente paso usando el fallback en `state.history`. Worst case total: 9 × 15s = 135s.

### Por qué 15s y no 20s en el orquestador

El orquestador corre 9 agentes en secuencia. Si cada uno tardara 20s, el total sería 180s — demasiado para una sola petición HTTP. Reduciendo a 15s por agente, garantizamos que el worst case (135s) quede por debajo del timeout típico de reverse proxy (Caddy usa 300s pero preferimos no probarlo).

---

## Cómo extender con un nuevo agente

Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#cómo-añadir-un-nuevo-agente-conversacional) para el paso a paso.

Resumen:

1. Añade el nombre al tipo `AgentName` en `src/lib/agents/prompts.ts`.
2. Implementa `buildXxxPrompt(ctx)` que retorna `{ system, user }` respetando la regla de oro §2.
3. Añádelo al router `buildAgentPrompt`.
4. Añádelo a `AGENT_NAMES` y `AGENT_LABELS`.
5. Si tiene side-effects, añádelos en `src/app/api/agents/[agentName]/route.ts` después del switch.
6. Si entra en el orquestador, actualiza `ORCHESTRATOR_STEPS` en `src/lib/orchestrator/constants.ts` y la lógica de avance de estado en `orchestrator.ts`.
7. Añade un fallback determinístico en el endpoint (timeout).
8. Documenta aquí en `AGENTS-REFERENCE.md` y en `API-REFERENCE.md`.

### Preguntas para diseñar un nuevo agente

- ¿Qué tablas consulta? (deben estar filtradas por `tenantId`)
- ¿Tiene side-effects? (persistencia, llamadas a adapters)
- ¿Cuándo se invoca? (en qué paso del orquestador, o solo on-demand)
- ¿Qué pasa si timeout? (fallback determinístico)
- ¿Respeta la regla de oro §2? (datos en user message, no en system)
- ¿Tiene un caso especial como el de tallas S-L del agente objection?

---

## Verificación de los 10 agentes

Smoke tests para verificar que todos los agentes funcionan:

```bash
# Listar agentes
curl http://localhost:3000/api/agents | jq '.agents | length'
# Esperado: 10

# Llamar a cada agente con un contexto mínimo
for AGENT in profile speech quote catalog theme objection address logistics vision checkout; do
  echo "--- $AGENT ---"
  curl -s -X POST http://localhost:3000/api/agents/$AGENT \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"ten-saramantha\",\"perfil\":\"mayorista\",\"items\":[{\"sku\":\"PIJ-SHORT-TIRA-001\",\"cantidad\":6}],\"query\":\"familia\",\"message\":\"es muy caro\",\"imageUrl\":\"https://example.com/test.jpg\"}" \
    | jq -c '{agent: .agent, reply: (.reply | .[0:80] + "..."), elapsedMs: .elapsedMs}'
done
```

Todos deben devolver 200 OK en <5s con un reply no vacío. Si alguno devuelve un fallback (timeout), verifica el health del LLM provider del tenant.
