# Proyecto: Plataforma de agentes de venta por WhatsApp — 100% documentado, multi-cliente y multi-plataforma
### Indisutex SAS (Saramantha · Sublimados Majestic · Lovely Pijamas · Sueño de Reina) — versión canónica

Documento maestro único del proyecto. Reúne, sin duplicar entre archivos separados, todo lo necesario para que un ingeniero o una IA puedan construir, operar, vender y escalar el sistema de cero: arquitectura completa, modelo de datos campo por campo, los agentes con sus prompts exactos, contratos API entre agentes y motores, integraciones (WhatsApp, WooCommerce, Shopify, Supabase, Oracle, Dropi), onboarding paso a paso, flujo end-to-end narrado en varios escenarios, arquitectura multi-tenant, y el modelo de monetización recomendado con su justificación numérica.

---

## Índice

0. Fortalezas del proyecto
1. Arquitectura completa (diagrama y stack)
2. Modelo de datos — todas las tablas, campo por campo
3. Memoria conversacional
4. El patrón de metadata visible en la imagen
5. Catálogo — las cuatro rutas posibles
6. Los 9 agentes conversacionales — prompts exactos
7. Contratos API/JSON entre agentes y motores
8. Capa de adaptadores — ecommerce, catálogo y base de datos
9. Integraciones externas en detalle (WhatsApp, WooCommerce, Shopify, Supabase, Oracle, Dropi)
10. Tablero operativo en NocoDB
11. Onboarding — cómo levantar el proyecto de cero
12. Flujo end-to-end (4 escenarios narrados)
13. Plan de implementación por fases
14. Métricas de éxito
15. Lo que ya aprendimos de los 239 pedidos reales
16. Arquitectura multi-tenant y multi-plataforma
17. Modelo de monetización recomendado (comisión escalonada sobre GMV + fee base)
18. Riesgos generales del proyecto y mitigación
19. Glosario

---

## 0. Fortalezas del proyecto

- **Sin cajas cerradas.** Todo el núcleo del sistema — canal, orquestación, base de datos, memoria, tablero operativo — es open source y autoalojado. Nada de esto puede cambiarte las condiciones de un día para otro.
- **Memoria conversacional real.** Cada mensaje se guarda íntegro, con búsqueda semántica sobre el historial completo — no una ventana de contexto limitada ni una plataforma de terceros que no puedes leer.
- **Catálogo completo, no 2-3 opciones fijas.** El agente consulta el catálogo real en cada pregunta del cliente, sin importar si ese catálogo vive en WhatsApp Catalog, WooCommerce, Shopify, la Supabase propia del cliente, o un catálogo que nosotros le desarrollamos.
- **Cero alucinación de producto.** La franja de metadata visible en cada imagen del catálogo, combinada con OCR y comparación visual, traduce una captura de pantalla en un SKU exacto — no en una adivinanza del modelo.
- **Todo pedido termina en el mismo lugar.** Sin importar si nació en WhatsApp o en el carrito web del cliente, cada pedido confirmado es una fila idéntica en la base de datos, con la imagen de referencia adjunta.
- **Costo marginal casi nulo en mensajería.** El tráfico (clic en anuncio → el cliente escribe primero) cae en conversaciones de WhatsApp gratuitas e ilimitadas.
- **Base ya validada con datos reales.** 239 pedidos procesados entre abril y julio de 2026 confirman qué patrones de conversación activan la compra (sección 15) — no es un diseño teórico.
- **Multi-tenant desde el diseño, no como parche.** `tenant_id` y Row-Level Security en cada tabla desde el modelo de datos original (sección 2) — conectar un cliente nuevo no exige reescribir el sistema.
- **El cliente no está obligado a traer nada que no tenga.** Si ya tiene su propia interfaz de catálogo con Supabase, nos conectamos a ella. Si no tiene catálogo propio, le ofrecemos el nuestro, con base de datos en Supabase u Oracle según su preferencia (sección 8 y 16.7).
- **Libertad real de proveedor de IA.** Cada cliente puede conectar su propia cuenta de ChatGPT (OpenAI) o xAI (Grok) con su propia API key y pagar directamente su consumo. Ollama sigue disponible como opción autoalojada que el vendedor habilita si conviene, no como obligación de arquitectura (sección 16.8).
- **El precio sigue al valor entregado, no un número fijo igual para todos.** El modelo de monetización recomendado (sección 17) cobra en función del GMV real que el agente confirma — ganamos más solo cuando el cliente vende más, alineado con cómo este tipo de negocio ya opera con Meta Ads y Dropi.

---

## 1. Arquitectura completa

```
Cliente final (WhatsApp)
      │
      ▼
┌────────────────────────────────────┐
│  WhatsApp Cloud API (Meta)           │  ← 1 WABA verificada por marca/cliente (tenant)
└───────────────┬──────────────────────┘
                │ webhook (tenant_id resuelto por el número de destino)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                                  n8n                                     │
│   9 agentes conversacionales (sección 6) + capa de adaptadores            │
│   de ecommerce, catálogo y BD (sección 8), con memoria completa por tenant │
└───────┬───────────────────────────────────┬─────────────────────┬───────┘
        │                                   │                     │
        ▼                                   ▼                     ▼
┌──────────────────────────┐   ┌────────────────────────────┐  ┌───────────────────────────┐
│  Postgres + pgvector       │   │  Proveedor de IA (por tenant) │  │  BD del catálogo (por tenant) │
│  NÚCLEO del sistema:         │   │  → ChatGPT (OpenAI, API key   │  │  → Supabase del propio cliente │
│  contactos, pedidos,          │   │    propia del cliente)        │  │  → Supabase provista por        │
│  mensajes, embeddings,        │   │  → xAI / Grok (API key        │  │    nosotros                     │
│  multi-tenant con RLS         │   │    propia del cliente)        │  │  → Oracle provista por           │
└──────────────┬────────────────┘   │  → Ollama autoalojado          │  │    nosotros                      │
               │                    │    (opción del vendedor)      │  └───────────────────────────┘
               │                    └────────────────────────────┘
     ┌─────────┼──────────────────────────────┬───────────────────┐
     ▼         ▼                              ▼                   ▼
┌─────────┐ ┌──────────────────────────┐  ┌──────────────────────────┐
│ MinIO    │ │ EcommerceAdapter           │  │ LogisticsAdapter (por tenant) │
│ imágenes │ │ → WhatsApp Catalog          │  │ → Dropi                       │
│          │ │ → WooCommerce               │  │ → 99envios                    │
│          │ │ → Shopify                   │  │ → Aveonline                   │
│          │ │ → Catálogo propio cliente    │  │ (flete, guía y estado real,   │
│          │ │   (su interfaz + su Supabase) │  │  multitransportadora)        │
│          │ │ → Catálogo propio nuestro     │  └──────────────────────────┘
│          │ │   (Supabase u Oracle)         │
└─────────┘ └──────────────────────────┘
               │
               ▼
      ┌─────────────────┐
      │   NocoDB          │  ← tablero Kanban operativo, filtrado por tenant
      └─────────────────┘
```

### 1.1 Stack completo (full-stack, capa por capa)

| Capa | Tecnología | Licencia / modelo de costo | Nota de escalabilidad |
|---|---|---|---|
| Canal de mensajería | WhatsApp Cloud API (Meta) | Acceso gratuito (conversaciones iniciadas por el cliente) | 1 WABA verificada por cliente/marca — trámite manual, no automatizable (sección 16.4) |
| Orquestación de agentes | n8n autoalojado | Open source | Workflows parametrizados por `tenant_id`, no un workflow por cliente |
| LLM conversacional + visión | Elegible por tenant: ChatGPT (OpenAI), xAI (Grok), u Ollama autoalojado (Llama 3.2 Vision / Qwen2-VL) | SaaS de pago por uso (ChatGPT, xAI) / Open source (Ollama) | Cada cliente conecta su propia API key y paga su propio consumo; Ollama es opción adicional del vendedor — sección 16.8 |
| OCR de la franja de metadata | Tesseract | Open source | Sin cambios al escalar |
| Similitud visual (fallback de identificación) | OpenCLIP | Open source | Sin cambios al escalar |
| Base de datos + vectores (núcleo del sistema) | Postgres + pgvector | Open source | `tenant_id` + Row-Level Security en cada tabla |
| Base de datos del catálogo (por tenant) | Elegible por tenant: Supabase del propio cliente, Supabase provista por nosotros, u Oracle provista por nosotros | SaaS (Supabase) / Licencia (Oracle) | Sección 16.7 |
| Almacenamiento de imágenes | MinIO (compatible S3) | Open source | Un bucket o prefijo por tenant |
| Ecommerce / catálogo | Cuatro rutas posibles por tenant: WhatsApp Catalog nativo, WooCommerce/Shopify del cliente, catálogo propio del cliente (Supabase), catálogo propio nuestro (Supabase u Oracle) | Nativo de Meta / Open source / SaaS del cliente / Nuestro desarrollo | Sección 5 y 8 |
| Logística y flete | Elegible por tenant vía `LogisticsAdapter`: Dropi, 99envios, o Aveonline (todas plataformas multitransportadora de Colombia — TCC, Coordinadora, Interrapidísimo, Servientrega, Envía) | SaaS de terceros | Tarifas reales por ciudad y guía real, no tabla fija; sección 8.6 y 9.6 |
| Tablero operativo | NocoDB | Open source | Base compartida con filtro por tenant, o base por cliente si el volumen lo justifica |
| Infraestructura | Docker + Coolify sobre un VPS | Open source | Escalar RAM/CPU antes de escalar clientes; GPU es la pieza que no escala linealmente gratis |
| Monitoreo | Uptime Kuma | Open source | Sin cambios |

### 1.2 Corrección de arquitectura vigente

El catálogo real que hoy usan las 4 marcas de Indisutex vive nativamente en **WhatsApp Business Catalog** (confirmado en pijamaspormayor.com, links `wa.me/c/...`), no en WooCommerce. Para Indisutex, el agente de catálogo (6.4) sincroniza contra ese catálogo nativo. Para clientes externos, el sistema puede hablar con **cualquiera de las cuatro fuentes de catálogo** (sección 5) sin que el agente conversacional sepa cuál está detrás — de ahí la capa de adaptadores (sección 8).

---

## 2. Modelo de datos — todas las tablas, campo por campo

Toda tabla de negocio lleva `tenant_id` como primera columna, con política de Row-Level Security que fuerza `tenant_id = current_setting('app.tenant_id')` en cada consulta — protege incluso si un workflow de n8n olvida filtrar explícitamente.

### `clientes_plataforma` (configuración por tenant — reemplaza cualquier dato de negocio embebido en un prompt)
- `tenant_id` (PK)
- `nombre_negocio`, `marca`
- `plataforma_catalogo` — enum: `whatsapp_catalog` | `woocommerce` | `shopify` | `catalogo_propio_cliente` | `catalogo_nuestro`
- `bd_catalogo` — enum: `supabase_cliente` | `supabase_nuestro` | `oracle_nuestro`
- `credenciales_catalogo_ref` — referencia a la credencial en n8n (nunca la clave en texto plano en esta tabla)
- `proveedor_ia` — enum: `chatgpt` | `xai` | `ollama`
- `credenciales_ia_ref` — referencia a la API key del cliente cuando aplica
- `proveedor_logistico` — enum: `dropi` | `99envios` | `aveonline` | `otro` (sección 8.6 y 9.6)
- `credenciales_logistica_ref` — referencia a la credencial/API key de la plataforma logística en n8n
- `waba_id`, `waba_token_ref`
- `tono_marca`, `nombre_asesora`, `politica_pago`, `pregunta_perfil`
- `plan_monetizacion` — enum: `conecta` | `catalogo_incluido` | `completo` (sección 17)
- `activo` (boolean)

### `contactos`
`tenant_id`, `contacto_id` (PK), `telefono`, `nombre`, `perfil_detectado` (mayorista/emprendedor/detal/regalo), `ciudad`, `departamento`, `fecha_primer_contacto`, `origen_publicitario_ref`

### `productos`
`tenant_id`, `sku` (PK compuesta con tenant_id), `nombre`, `categoria`, `precio_base`, `precio_ref_mercado`, `stock`, `imagen_url`, `imagen_metadata_visible` (boolean), `embedding_texto` (vector), `embedding_visual` (vector), `fuente_sincronizacion` (de qué adaptador vino)

### `precios_por_volumen`
`tenant_id`, `sku`, `tipo_cliente` (mayorista/emprendedor/detal/regalo), `cantidad_minima`, `cantidad_maxima`, `precio_unitario`

### `diseños` / `temas_diseño`
`tenant_id`, `diseño_id`, `nombre_diseño`, `tema` (ej. "Stitch", "Hello Kitty"), `skus_asociados` (array)

### `combos_categoria`
`tenant_id`, `categoria` (ej. "familia"), `skus_recomendados` (array, mínimo 3 referencias distintas por regla del agente 6.4)

### `discursos_por_perfil`
`tenant_id`, `perfil`, `apertura_texto`, `prueba_social`

### `objeciones`
`tenant_id`, `tipo_objecion` (desconfianza/precio/talla/"lo pienso"/producto no disponible), `respuesta_base`, `gatillo_mental_asociado`

### `pedidos`
`tenant_id`, `pedido_id` (PK), `contacto_id`, `skus` (array con cantidades), `valor_de_compra`, `origen` (`agente_whatsapp` | `carrito_web` | `otro` — campo crítico para el modelo de monetización, sección 17.6), `imagen_referencia_url`, `metodo_identificacion` (ocr/openclip/manual), `estado` (mapea a las columnas del Kanban de NocoDB), `fecha_confirmacion`, `fecha_despacho`

### `carrito_sync`
`tenant_id`, `pedido_id`, `plataforma_destino`, `order_id_externo`, `estado_sincronizacion`

### `cotizaciones_flete`
`tenant_id`, `proveedor_logistico` (dropi/99envios/aveonline/otro), `ciudad`, `pais`, `cantidad_unidades`, `tarifa`, `tiempo_estimado`, `transportadora`, `fecha_actualizacion` (alimentada por la API real del proveedor logístico configurado para ese tenant — sección 8.6)

### `transportadoras_canonicas`
`tenant_id`, `nombre_transportadora`, `cobertura` (nacional/internacional)

### `atribucion_publicitaria`
`tenant_id`, `contacto_id`, `id_anuncio`, `id_campaña`, `plataforma` (Meta), `costo_atribuido`

### `historial_entrega_direccion`
`tenant_id`, `contacto_id`, `direccion_normalizada`, `ciudad`, `departamento`, `resultado_entrega_anterior`

### `mensajes` (memoria conversacional)
`tenant_id`, `contacto_id`, `mensaje_id`, `direccion` (entrante/saliente), `texto`, `embedding` (vector, generado por el proveedor de IA del tenant), `timestamp`

### `identificaciones_imagen`
`tenant_id`, `contacto_id`, `imagen_url`, `sku_detectado`, `metodo` (ocr/openclip/llm), `confianza`

**Regla de gobernanza (ya identificada como riesgo real en los datos, sección 15)**: ningún dato de negocio — tono, política de pago, precios, reglas de objeción — vive en el texto de un system prompt. Todo vive en estas tablas, filtrado por `tenant_id`.

---

## 3. Memoria conversacional

1. Los últimos N mensajes literales de la conversación actual (memoria de corto plazo).
2. Búsqueda semántica sobre `mensajes.embedding` de ese contacto, **filtrada primero por `tenant_id` y luego por contacto** — evita que la memoria de un cliente "sangre" hacia otro si comparten infraestructura.
3. El embedding se genera con el mismo proveedor de IA configurado para ese tenant (ChatGPT, xAI, u Ollama) — sección 16.8.

---

## 4. El patrón de metadata visible en la imagen

Cada imagen del catálogo lleva una franja con SKU, diseño y precio de referencia superpuesta de forma estética. El agente de visión (6.9) la lee así:

1. **OCR (Tesseract)** sobre la franja → SKU exacto, sin margen de alucinación.
2. Si la captura recortó la franja: **similitud visual (OpenCLIP)** contra los `embedding_visual` del catálogo de ese tenant → SKU más probable + confianza.
3. Si ninguna vía da confianza suficiente: el agente pregunta explícitamente en vez de asumir.

---

## 5. Catálogo — las cuatro rutas posibles

El agente de catálogo (6.4) nunca necesita saber cuál de las cuatro rutas está detrás — todas sincronizan hacia la misma tabla `productos`, filtrada por `tenant_id`:

1. **Catálogo nativo de WhatsApp Business** — el caso de Indisutex hoy; no requiere infraestructura adicional.
2. **WooCommerce o Shopify del cliente** — sincronización vía el adaptador de esa plataforma (sección 8.2).
3. **Interfaz de catálogo propia del cliente, con su propia Supabase** — el cliente ya construyó su catálogo; solo leemos de su Supabase (sección 8.3), sin migrar ni duplicar nada.
4. **Catálogo propio que nosotros desarrollamos** — cuando el cliente no tiene catálogo propio, con base de datos en Supabase (más rápido y económico) u Oracle (si el cliente ya lo tiene o lo exige por gobernanza corporativa).

---

## 6. Los 9 agentes conversacionales — prompts exactos

Cada agente es un workflow de n8n con un nodo de IA que recibe un system prompt enfocado en una sola responsabilidad — no un guion monolítico. Los datos de negocio se consultan por herramienta/función contra las tablas de la sección 2, filtradas por `{tenant_id}`, nunca se memorizan en el texto del prompt.

### 6.1 Agente de perfilamiento de leads

```
Eres el clasificador de perfil del negocio {tenant_id}. Tu única tarea es
determinar el perfil del lead a partir de su mensaje y el contexto del
anuncio que lo trajo: mayorista (tienda/surtir/vender/negocio), emprendedor
(arrancar/emprender), detal (para mí) o regalo. Si no hay señal clara,
responde exactamente la pregunta_perfil configurada para este tenant y no
avances hasta recibir respuesta. Nunca preguntes el perfil antes de haber
recibido y procesado la imagen o video inicial del anuncio, si lo hay.
Responde solo con el perfil detectado o la pregunta — nada más.
```

### 6.2 Agente de discurso de ventas por perfil

```
Eres la asesora de ventas de {tenant_id} (nombre_asesora configurado en
clientes_plataforma). Tuteas, con certeza total, sin disculpas. Cada
mensaje cierra con una acción. El perfil del lead ya fue determinado:
{perfil}. Consulta discursos_por_perfil para este tenant y ese perfil, y
usa su apertura_texto y prueba_social tal como están, adaptando solo el
tono configurado (tono_marca). No inventes datos de la empresa que no
estén en la tabla clientes_plataforma o contactos. Máximo 20 palabras por
mensaje, máximo 2 emojis, nunca preguntas abiertas después de dar el precio.
```

### 6.3 Agente de ofertas y cotización cruzada

```
Eres el motor de cotización de {tenant_id}. Recibes uno o más SKU de
interés y la cantidad de cada uno. Consulta precios_por_volumen (filtrado
por tenant_id) por cada SKU según tipo_cliente={perfil} y cantidad. Suma
el total a pagar, la venta estimada usando precio_ref_mercado, y el
margen total. Responde en el formato: "[cantidad] [producto] + [cantidad]
[producto]: pagas $[total] → vendes $[venta] → te sobran $[margen]
limpios". Nunca inventes un precio que no exista en la tabla. Si el SKU
no existe para este tenant, dilo explícitamente.
```

### 6.4 Agente de respuesta visual-primero

```
Eres el agente de catálogo de {tenant_id}. Cuando el lead pregunta por un
producto, tema o categoría, tu respuesta NUNCA puede ser solo texto ni un
enlace genérico. Busca en el catálogo real de este tenant (embedding_texto,
sincronizado desde WhatsApp Catalog, WooCommerce, Shopify, o la Supabase
propia o nuestra) el producto o los productos que mejor coinciden con la
intención del lead, y devuelve sus imágenes reales. Si la intención agrupa
una categoría amplia (ej. "familia"), trae mínimo 3 prendas distintas
disponibles en esa categoría (consulta combos_categoria), no solo el
producto ancla. Acompaña con un máximo de 1-2 líneas de texto. Cierra
siempre con una pregunta binaria, nunca una pregunta abierta.
```

### 6.5 Agente de oferta por tema/personaje

```
Eres el buscador de temas de {tenant_id}. Cuando el lead menciona un
personaje o tema sin mencionar la prenda, busca en temas_diseño (filtrado
por tenant_id) ese tema y trae TODAS las prendas disponibles en él.
Entrega el resultado al agente de respuesta visual-primero para que lo
muestre con imágenes. Nunca respondas "no tenemos eso" sin antes
verificar en temas_diseño.
```

### 6.6 Agente de objeciones

```
Eres el manejador de objeciones de {tenant_id}. Clasifica el mensaje del
lead como un tipo de objeción, consulta la tabla objeciones (filtrada por
tenant_id) para ese tipo, y adapta respuesta_base y gatillo_mental_asociado
al contexto de la conversación. Nunca repitas el mismo argumento dos veces
en la misma conversación — revisa el historial de mensajes antes de
responder.
```

### 6.7 Agente de confirmación de datos de dirección

```
Eres el agente de datos de {tenant_id}. Cuando el lead confirma que quiere
comprar, extrae de la conversación: nombre, apellido, teléfono,
departamento, ciudad, dirección, horario, talla, diseño y cantidad.
Pregunta solo los campos que falten, uno a la vez si es necesario. Al
completar los 10 campos, normaliza la dirección y consulta
historial_entrega_direccion (filtrado por tenant_id) antes de confirmar
el pedido.
```

### 6.8 Agente de logística de fletes

```
Eres el motor de fletes de {tenant_id}. Nunca hables directo con Dropi,
99envios o Aveonline — todo pasa por LogisticsAdapter, que ya sabe cuál
de los tres tiene configurado este tenant (proveedor_logistico en
clientes_plataforma). Si el envío es nacional, consulta cotizaciones_flete
(alimentada con tarifas reales del proveedor logístico de este tenant)
según ciudad y cantidad de unidades. Si es internacional, primero
confirma ciudad y país exactos, y cotiza usando la tarifa real disponible
— nunca inventes un valor de flete. Responde con tarifa, tiempo estimado
y transportadora en una sola frase.
```

### 6.9 Agente de visión (identificación de producto por imagen)

Determinístico, no depende del LLM en su primer intento — es gratuito y sin margen de alucinación:

```
[Webhook: llega imagen del cliente → se resuelve tenant_id por el WABA de destino]
        ▼
[Tesseract OCR sobre la franja de metadata → intenta extraer SKU]
        ▼
[IF: SKU legible y existe en productos de ese tenant?]
   → sí: usar ese SKU (confianza alta, sin LLM)
   → no: [OpenCLIP: comparar embedding_visual contra el catálogo de ese tenant]
         → SKU más cercano + confianza
        ▼
[IF: confianza baja?]
   → [LLM del proveedor configurado para el tenant: "Redacta una pregunta
      breve pidiendo confirmar el diseño, sin asumir cuál es"]
```

### 6.10 Agente de checkout y sincronización

Determinístico, pasa por la capa de adaptadores en vez de hablar directo con una plataforma:

```
[Pedido confirmado — por WhatsApp]
        ▼
[Postgres: crear el pedido con tenant_id, origen="agente_whatsapp",
 e imagen_referencia_url]
        ▼
[EcommerceAdapter.crearPedido() — resuelve en runtime si el tenant usa
 WhatsApp Catalog (solo registro interno), WooCommerce, Shopify, catálogo
 propio del cliente, o catálogo propio nuestro]
        ▼
[Disparar generación de guía en Dropi]
        ▼
[Sync a NocoDB, filtrado por tenant]
        ▼
[Disparar el cálculo de comisión sobre GMV para el modelo de
 monetización — sección 17.6 — usando el mismo valor_de_compra ya
 registrado, sin telemetría adicional]
```

---

## 7. Contratos API/JSON entre agentes y motores

Cada agente conversacional le entrega al siguiente (o al motor funcional correspondiente) un payload estructurado, nunca texto libre sin tipar. Ejemplos concretos:

### 7.1 Salida del agente de perfilamiento (6.1) → entrada del agente de discurso (6.2)

```json
{
  "tenant_id": "saramantha",
  "contacto_id": "573127708641",
  "perfil": "mayorista",
  "fuente_deteccion": "mensaje_explicito"
}
```

### 7.2 Salida del agente de catálogo (6.4) hacia el cliente (y registro en `identificaciones_imagen` si aplica)

```json
{
  "tenant_id": "saramantha",
  "sku_resultado": ["PIJ-SHORT-TIRA-001", "PIJ-PANT-TIRA-002", "PIJ-BATOLA-003"],
  "imagenes": ["https://.../short.jpg", "https://.../pantalon.jpg", "https://.../batola.jpg"],
  "pregunta_cierre": "¿estos tres o prefieres ver otro diseño? 😊"
}
```

### 7.3 Entrada al motor de cotización (6.3)

```json
{
  "tenant_id": "saramantha",
  "perfil": "mayorista",
  "items": [
    {"sku": "PIJ-SHORT-TIRA-001", "cantidad": 6},
    {"sku": "PIJ-PANT-TIRA-002", "cantidad": 6}
  ]
}
```

### 7.4 Salida del motor de cotización (6.3)

```json
{
  "tenant_id": "saramantha",
  "total_a_pagar": 198000,
  "venta_estimada": 468000,
  "margen_total": 270000,
  "texto_respuesta": "6 Short + 6 Pantalón: pagas $198.000 → vendes $468.000 → te sobran $270.000 limpios"
}
```

### 7.5 Entrada al `EcommerceAdapter.crearPedido()` (agente 6.10)

```json
{
  "tenant_id": "saramantha",
  "contacto_id": "573127708641",
  "items": [{"sku": "PIJ-SHORT-TIRA-001", "cantidad": 6}],
  "valor_de_compra": 198000,
  "origen": "agente_whatsapp",
  "direccion": {"ciudad": "Bogotá", "departamento": "Cundinamarca", "direccion": "Cra 10 # 20-30"},
  "imagen_referencia_url": "https://.../short.jpg"
}
```

### 7.6 Salida del `EcommerceAdapter.crearPedido()`

```json
{
  "order_id": "SARA-2026-04321",
  "estado": "confirmado",
  "url_seguimiento": "https://tracking.dropi.co/..."
}
```

---

## 8. Capa de adaptadores — ecommerce, catálogo y base de datos

Ningún agente conversacional debe saber si está hablando con el catálogo nativo de WhatsApp, WooCommerce, Shopify, la Supabase del cliente, o una base Oracle nuestra. Todos llaman a la misma interfaz:

```
EcommerceAdapter:
  buscarProductos(query, filtros)      → [{sku, nombre, precio, imagen_url, stock}]
  obtenerProducto(sku)                 → {sku, nombre, precio, variantes, imagen_url, stock}
  crearPedido(datos_pedido)            → {order_id, estado, url_seguimiento}
  actualizarInventario(sku, cantidad) → {ok, stock_actual}
  obtenerEstadoPedido(order_id)        → {estado, fecha_actualizacion}
```

### 8.1 Adaptador WhatsApp Catalog
Lectura desde el catálogo nativo de Meta por marca; no requiere credenciales adicionales más allá del WABA ya conectado.

### 8.2 Adaptador WooCommerce
Autenticación por `consumer_key`/`consumer_secret` (REST API estándar de WooCommerce), guardadas en n8n Credentials por tenant. Webhooks de WooCommerce (`order.updated`, `product.updated`) alimentan la sincronización inversa.

### 8.3 Adaptador Shopify
Autenticación OAuth 2.0. Dos rutas:
- **App privada por tienda** (recomendada para pilotos): el cliente genera su propio token desde su panel — simple, sin revisión externa.
- **App pública en Shopify App Store**: instalación con un clic, pero exige revisión de Shopify (seguridad, verificación HMAC de webhooks, cumplimiento de políticas de datos).
- API objetivo: **GraphQL Admin API** (no REST, que Shopify está deprecando), con manejo propio de rate-limiting por costo de consulta.

### 8.4 Adaptador Catálogo propio del cliente (Supabase)
Cuando el cliente ya tiene su propia interfaz de catálogo y su propia base de datos en Supabase, el adaptador se conecta directo a esa Supabase (vía su API REST/PostgREST autogenerada, o conexión directa a Postgres) con credenciales de solo lectura sobre las tablas de producto. No se migra ni se duplica el catálogo del cliente — se lee en vivo y se sincronizan embeddings hacia nuestro núcleo (porque la Supabase del cliente normalmente no los tiene).

### 8.5 Adaptador Catálogo propio nuestro (Supabase u Oracle)
Cuando el cliente no tiene catálogo propio, se le provisiona uno construido por nosotros. Con Supabase, el adaptador lee y escribe sobre un proyecto que administramos. Con Oracle, mismo modelo lógico de tablas, adaptador propio hablando con Oracle Database en vez de PostgREST — tiene sentido cuando el cliente ya tiene licenciamiento Oracle corporativo o requisitos de gobernanza que lo exigen.

### 8.6 Adaptador de logística — `LogisticsAdapter` (multiproveedor: Dropi, 99envios, Aveonline)

Igual que `EcommerceAdapter` desacopla al agente de catálogo de la plataforma de ecommerce real, `LogisticsAdapter` desacopla al agente de logística (6.8) y al de checkout (6.10) de cuál plataforma de envíos usa cada tenant. Los tres proveedores soportados hoy son plataformas logísticas **multitransportadora** de Colombia (cotizan y generan guía indistintamente con TCC, Coordinadora, Interrapidísimo, Servientrega y Envía desde un solo panel), por lo que la interfaz común es la misma sin importar cuál esté detrás:

```
LogisticsAdapter:
  cotizarFlete(ciudad, pais, cantidad_unidades)   → {tarifa, tiempo_estimado, transportadora}
  generarGuia(datos_pedido)                       → {numero_guia, url_seguimiento, transportadora}
  consultarEstadoGuia(numero_guia)                → {estado, ultima_actualizacion, novedad}
  reportarNovedad(numero_guia, tipo_novedad)      → {ok, siguiente_accion}
```

- **Dropi**: API externa ya integrada (sección 9.6); fuerte en dropshipping con catálogo propio de +160.000 productos, pago contra entrega, e integración nativa con Shopify/WooCommerce/Tiendanube.
- **99envios**: plataforma multitransportadora colombiana (TCC, Coordinadora, Interrapidísimo, Servientrega, Envía) desde un solo panel, con API REST para integrar tienda o sistema propio, recaudo contra entrega automático, agente propio de IA para resolver novedades de entrega, y carga masiva de guías vía Excel/CSV para operaciones de alto volumen.
- **Aveonline**: ecosistema logístico colombiano con cotización y generación de guía multitransportadora vía API, recaudo protegido, anticipos de cartera antes de que la transportadora liquide, bodegaje/fulfillment en Medellín, Cali y Bogotá, y AveChat (automatización de confirmación y novedades por WhatsApp) — relevante porque se solapa parcialmente con la función del propio agente de confirmación (6.7) y conviene decidir, por tenant, cuál de los dos hace esa tarea para no duplicar mensajes al cliente final.

Cada tenant elige uno en `clientes_plataforma.proveedor_logistico`; el adaptador correspondiente normaliza el nombre de transportadora contra `transportadoras_canonicas` (sección 2) antes de escribir en el núcleo — necesario porque, como ya confirmó la sección 15.2 con datos reales, el mismo transportador puede llegar escrito de varias formas distintas según de dónde venga el dato.

### 8.7 Regla de diseño transversal
El agente de catálogo (6.4) y el resto de agentes conversacionales nunca hablan directo con la Supabase u Oracle del catálogo, ni con la API de Dropi/99envios/Aveonline — siempre pasan por el adaptador correspondiente (`EcommerceAdapter` o `LogisticsAdapter`), que resuelve `tenant_id` → sistema real detrás. Esto permite que un cliente con Oracle y logística en Aveonline, y otro con Supabase y logística en Dropi, convivan en el mismo sistema sin que ningún prompt necesite saberlo.

---

## 9. Integraciones externas en detalle

### 9.1 WhatsApp Cloud API (Meta)
- Requiere cuenta de Meta Business verificada — el trámite puede tardar días; conviene iniciarlo primero, en paralelo a todo lo demás.
- Conversaciones iniciadas por el cliente son gratuitas e ilimitadas — el modelo de tráfico de este proyecto (clic en anuncio → el cliente escribe primero) cae siempre en esta categoría.
- Webhook entrante configurado hacia la URL pública de n8n; `tenant_id` se resuelve por el número (WABA) que recibió el mensaje.
- 1 WABA por marca/cliente — Meta no permite que un solo número atienda identidades de negocio distintas.

### 9.2 WooCommerce
- REST API estándar (`consumer_key`/`consumer_secret`), documentación pública de WooCommerce.
- Endpoints principales usados: `products`, `orders`, `orders/{id}` (actualización de estado), webhooks de `order.updated` y `product.updated`.

### 9.3 Shopify
- GraphQL Admin API — Shopify está deprecando su REST API, por lo que el adaptador se construye directo sobre GraphQL para no heredar deuda técnica.
- Autenticación OAuth 2.0; verificación HMAC obligatoria en cada webhook entrante (a diferencia de WooCommerce, que no lo fuerza de la misma manera).
- Rate limiting por costo de consulta (leaky bucket) — requiere lógica de reintento y backoff propia del adaptador.

### 9.4 Supabase (del cliente o nuestra)
- Acceso vía su API REST autogenerada (PostgREST) o conexión directa a Postgres con rol de solo lectura cuando es la Supabase del cliente.
- Cuando la Supabase es nuestra (provista al cliente), se administra con el mismo modelo de tablas de catálogo definido en la sección 2, y sí se permite escritura desde el adaptador.

### 9.5 Oracle Database (nuestra, para el cliente que la elige)
- Mismo modelo lógico de tablas de catálogo que en Supabase, pero servido desde Oracle.
- Adaptador propio que traduce las llamadas de `EcommerceAdapter` a SQL/PLSQL sobre Oracle — mayor tiempo de puesta en marcha que Supabase, se reserva para clientes que ya tienen licenciamiento Oracle o lo exigen por gobernanza.

### 9.6 Logística y flete — Dropi, 99envios, Aveonline (elegible por tenant)

Las tres son plataformas colombianas de logística **multitransportadora**: cotizan y generan guía con varias transportadoras (TCC, Coordinadora, Interrapidísimo, Servientrega, Envía) desde un solo panel/API, en vez de integrar transportadora por transportadora. El `LogisticsAdapter` (sección 8.6) habla con la que tenga configurada cada tenant.

- **Dropi**: además de logística, opera como marketplace de dropshipping (+160.000 productos de proveedores verificados); es la integración ya construida y en uso con Indisutex. API externa que alimenta `cotizaciones_flete` con tarifas reales por ciudad y cantidad de unidades.
- **99envios**: panel + API REST para cotizar y generar guía con las 5 transportadoras mencionadas, recaudo contra entrega automático, carga masiva de guías por Excel/CSV para alto volumen, e integraciones directas con Shopify/WooCommerce. Trae su propio agente de IA para resolver novedades de entrega — al conectarlo, definir si esa función la sigue haciendo el agente de logística propio (6.8) o se delega a 99envios, para no duplicar mensajes al cliente.
- **Aveonline**: panel + API con cotización multitransportadora, recaudo protegido, anticipos de cartera antes de la liquidación de la transportadora, bodegaje/fulfillment propio (Medellín, Cali, Bogotá), e integración con Shopify/WooCommerce/Tiendanube. Su módulo AveChat automatiza confirmación y novedades por WhatsApp — mismo punto de atención que con 99envios: decidir por tenant cuál sistema posee esa conversación.
- El agente de logística (6.8) nunca inventa un valor de flete — siempre consulta `cotizaciones_flete`, actualizada desde la API real del proveedor configurado para ese tenant.
- Los tres exigen credenciales propias por tenant (API key o token), guardadas en n8n Credentials — no son intercambiables sin reconectar.

### 9.7 Proveedores de IA (ChatGPT, xAI, Ollama)
- ChatGPT y xAI: cada tenant conecta su propia API key, guardada como credential en n8n; el nodo de IA del workflow apunta al endpoint correspondiente según `clientes_plataforma.proveedor_ia`.
- Ollama: servidor autoalojado (`ollama pull llama3.2-vision` u otro modelo con soporte de visión), compartido solo entre los tenants que lo eligieron.

---

## 10. Tablero operativo en NocoDB

- Tabla `Pedidos` con vista Kanban agrupada por `estado`: Llamar para confirmar, Datos completados, Intento de cancelación, Oficina, Programado, Despachado.
- Cada tarjeta trae producto(s), valor, ciudad, semáforo de riesgo de entrega, y la imagen de referencia visible directamente.
- Cada vista se filtra por `tenant_id` — un cliente nunca ve las tarjetas de otro, ni siquiera si comparten la misma base de NocoDB.
- Sincronización bidireccional: Postgres → NocoDB al crear/actualizar un pedido; webhook de NocoDB → Postgres al cambiar el campo `Estado` de una tarjeta.

---

## 11. Onboarding — cómo levantar el proyecto de cero

### 11.1 Requisitos previos
- VPS con al menos 8 GB de RAM (16 GB+ si se corre el modelo de visión de Ollama localmente), idealmente con GPU si algún tenant elegirá Ollama.
- Docker y Docker Compose instalados.
- Cuenta de Meta Business verificada por cada marca/cliente, con acceso a WhatsApp Cloud API.
- Un dominio propio para exponer el webhook de n8n a Meta.
- Si el cliente elige Oracle: licencia y acceso a una instancia Oracle Database ya aprovisionada.

### 11.2 `docker-compose.yml` base

```yaml
version: "3.8"
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: indisutex
      POSTGRES_PASSWORD: cambiar_esta_clave
      POSTGRES_DB: indisutex_agentes
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  n8n:
    image: n8nio/n8n
    environment:
      - N8N_HOST=n8n.tu-dominio.com
      - N8N_PROTOCOL=https
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_DATABASE=indisutex_agentes
      - DB_POSTGRESDB_USER=indisutex
      - DB_POSTGRESDB_PASSWORD=cambiar_esta_clave
    volumes:
      - n8n_data:/home/node/.n8n
    ports:
      - "5678:5678"
    depends_on:
      - postgres

  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"
    # con GPU disponible, agregar aquí deploy.resources.reservations.devices
    # solo necesario para los tenants que elijan Ollama (sección 16.8)

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: indisutex
      MINIO_ROOT_PASSWORD: cambiar_esta_clave
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"
      - "9001:9001"

  nocodb:
    image: nocodb/nocodb
    environment:
      - NC_DB=pg://postgres:5432?u=indisutex&p=cambiar_esta_clave&d=nocodb
    volumes:
      - nocodb_data:/usr/app/data
    ports:
      - "8080:8080"
    depends_on:
      - postgres

volumes:
  postgres_data:
  n8n_data:
  ollama_data:
  minio_data:
  nocodb_data:
```

*(WooCommerce/WordPress no es un servicio obligatorio de este compose base — solo se agrega si un cliente lo necesita como su plataforma real. Shopify, Supabase y Oracle no requieren ningún servicio propio autoalojado, solo credenciales de conexión.)*

### 11.3 Pasos de instalación

1. `docker compose up -d` — levanta Postgres, n8n, MinIO y NocoDB (Ollama solo si algún tenant lo va a usar).
2. Entrar a Postgres y habilitar la extensión: `CREATE EXTENSION vector;`
3. Correr el script SQL de creación de tablas (sección 2), incluida la columna `tenant_id` en cada una y las políticas RLS.
4. Si aplica Ollama: `ollama pull llama3.2-vision` (o el modelo elegido).
5. Configurar credenciales en n8n por tenant: Postgres, MinIO, proveedor de IA (ChatGPT/xAI/Ollama), proveedor logístico (Dropi/99envios/Aveonline — API key o token propio de cada uno), y según su plataforma de catálogo: WooCommerce (consumer key/secret), Shopify (token de app privada u OAuth), Supabase (URL + service role key de solo lectura si es del cliente, o llave completa si es nuestra), u Oracle (cadena de conexión).
6. Importar los 10 workflows de agentes (secciones 6.1 a 6.10), ya parametrizados por `{tenant_id}`.
7. Configurar el webhook de WhatsApp Cloud API de cada marca/cliente apuntando a la URL pública de n8n.
8. Registrar el nuevo tenant en `clientes_plataforma`: nombre del negocio, plataforma de catálogo, BD de catálogo, proveedor de IA, proveedor logístico, tono de marca, política de pago, plan de monetización.
9. Sincronizar el catálogo inicial hacia `productos` — desde la fuente que corresponda (sección 5).
10. Probar el flujo completo con un número de WhatsApp de prueba antes de conectar el número de producción de ese cliente.

### 11.4 Cómo instruir a la IA (resumen operativo)

Cada agente recibe su system prompt (sección 6) más el contexto dinámico del turno: `tenant_id`, perfil del contacto, últimos mensajes, resultado de búsqueda en catálogo o precios. Ningún agente memoriza datos de negocio en su prompt — todos los consultan en vivo, filtrados por tenant. Actualizar un precio, agregar un diseño o cambiar una respuesta de objeción para un cliente específico es una operación de base de datos sobre su `tenant_id`, no una reescritura de texto ni un despliegue nuevo.

---

## 12. Flujo end-to-end (4 escenarios narrados)

### 12.1 Escenario Indisutex (catálogo nativo de WhatsApp)

1. Un cliente hace clic en un anuncio de Meta de "pijama familia" y llega a WhatsApp de Saramantha — `tenant_id` se resuelve por el WABA que recibió el mensaje.
2. El agente de perfilamiento (6.1) pregunta el perfil si hace falta. El cliente responde "para surtir mi tienda" → perfil `mayorista`.
3. El agente de discurso (6.2) abre con el tono mayorista configurado en `clientes_plataforma`.
4. El cliente escribe "quiero ver para toda la familia". El agente de catálogo (6.4) busca en el catálogo real y devuelve 3 imágenes: Short, Pantalón y Batola.
5. El cliente responde "el short lo quiero en Stitch" — el agente de tema/personaje (6.5) confirma disponibilidad.
6. El cliente pide cotización de 6 Short + 6 Pantalón. El agente de ofertas cruzadas (6.3) calcula el total con margen.
7. El cliente objeta "¿y si no llega bien?" — el agente de objeciones (6.6) responde con prueba social sin repetir argumentos.
8. El cliente confirma la compra. El agente de dirección (6.7) recoge los 10 campos.
9. El agente de logística (6.8) cotiza el flete real vía Dropi.
10. El agente de checkout (6.10) crea el pedido con `origen="agente_whatsapp"`, dispara la guía en Dropi, sincroniza NocoDB, y dispara el cálculo de comisión (sección 17.6).

### 12.2 Escenario cliente nuevo con WooCommerce

1. Onboarding: se registra el tenant, se conectan sus credenciales WooCommerce, se sincroniza su catálogo real hacia `productos` vía el adaptador (8.2).
2. El flujo conversacional es idéntico al 12.1 en los agentes 6.1 a 6.9 — el cliente conversacional nunca nota diferencia.
3. Al confirmar, el agente de checkout (6.10) llama a `EcommerceAdapter.crearPedido()`, que esta vez escribe el pedido también en el WooCommerce real del cliente, no solo en nuestro núcleo.

### 12.3 Escenario cliente nuevo con Shopify

1. Igual que 12.2, pero el adaptador (8.3) autentica vía OAuth/app privada y usa GraphQL Admin API.
2. Webhooks de Shopify llegan con verificación HMAC — el adaptador la valida antes de procesar cualquier actualización de inventario u orden.

### 12.4 Escenario cliente sin catálogo propio (le desarrollamos uno en Supabase)

1. En el onboarding, como el cliente no tiene catálogo propio, se aprovisiona un proyecto de Supabase nuestro con el modelo de tablas de catálogo ya definido (sección 2).
2. Se carga el catálogo inicial del cliente a mano (productos, precios, diseños) — trabajo de implementación cobrado en el fee correspondiente (sección 17).
3. El resto del flujo es idéntico — el adaptador (8.5) lee y escribe sobre esa Supabase, y el agente de catálogo (6.4) nunca distingue esto de los otros tres escenarios.

---

## 13. Plan de implementación por fases

**Fase 0** — Modelo de datos con `tenant_id` y RLS desde el inicio; levantar Ollama solo si se anticipa un tenant que lo requiera.
**Fase 1** — Migrar Indisutex (sus 4 marcas) como los primeros 4 tenants, sincronizando cada catálogo desde WhatsApp Catalog.
**Fase 2** — Construir la capa `EcommerceAdapter` y validar con un cliente piloto externo que use WooCommerce.
**Fase 3** — Adaptador Shopify vía app privada, con un segundo cliente piloto.
**Fase 4** — Adaptador de catálogo propio del cliente (Supabase) y catálogo propio nuestro (Supabase, luego Oracle) con un tercer cliente piloto que no tenga WooCommerce ni Shopify.
**Fase 5** — Habilitar el proveedor de IA elegible por tenant (ChatGPT, xAI, Ollama), comparando calidad y latencia con datos reales antes de ofrecerlo como opción estándar. En paralelo, construir el `LogisticsAdapter` (sección 8.6) y validar con datos reales la integración con 99envios y Aveonline, además de la ya existente con Dropi.
**Fase 6** — Wizard de onboarding self-service y evaluación de app pública en Shopify App Store, si el volumen de clientes lo justifica.
**Fase 7** — Activar el modelo de monetización de comisión escalonada (sección 17) con los primeros clientes piloto, calibrando tramos y porcentajes con datos reales de margen.

---

## 14. Métricas de éxito

- Tasa de conversión por etapa del embudo (perfilamiento → catálogo → cotización → cierre → confirmación → despacho).
- % de pedidos estancados en "Llamar para confirmar" (hoy 73% — sección 15, prioridad número uno).
- Tiempo de respuesta del LLM, medido por proveedor: para tenants con Ollama, vigilar latencia bajo carga concurrente (sección 16.10); para tenants con ChatGPT/xAI, vigilar la salud de su propia API key (sección 16.11).
- Precisión y velocidad de la cotización de flete y generación de guía, por proveedor logístico (Dropi/99envios/Aveonline) — cualquier tenant que cambie de proveedor debe mantener el mismo nivel de servicio (sección 16.9 y 16.11).
- % de conversaciones correctamente enrutadas a su tenant — debe ser 100%; cualquier fuga es un incidente de seguridad, no un bug menor.
- GMV mensual confirmado por el agente, por tenant — la métrica base del modelo de monetización (sección 17).
- Margen por tenant (ingreso que paga el cliente frente al costo real de sostenerlo) — sección 17.5.
- % de pedidos que efectivamente llegan a "Despachado" — hoy solo 1.3% en el ciclo observado (sección 15.1), la métrica que más condiciona el momento real de cobro del modelo de monetización (sección 17.7).

---

## 15. Lo que ya aprendimos de los 239 pedidos reales (abril–julio 2026)

- **Producto ancla domina el mix**: Short Tira aparece en 91% de los pedidos (217/239) — el guion lo ofrece primero por defecto; Pantalón y Batola solo aparecen si el cliente insiste. El agente de catálogo (6.4) ya corrige esto para categorías amplias tipo "familia" (mínimo 3 prendas).
- **El negocio es mayoritariamente mayorista y de alto ticket**: 43% de los pedidos son de 12+ unidades, 29% de 6-11 unidades; valor promedio $137.014 COP, mediana $111.000 COP, mínimo $16.500 COP, máximo $468.000 COP.
- **Dispersión geográfica nacional real**: Bogotá (14), Cali (7), Pasto (7), Medellín (6), Neiva (6), Popayán (6), Florencia (4), Apartadó (4) — confirma que el agente de logística (6.8) necesita tarifas reales de flete variable por ciudad, no una tabla fija.
- **Franja horaria de compra**: la mayoría de pedidos se concretan entre 8am y 12pm.
- **Crecimiento real acelerado**: de ~4 pedidos/semana en abril a 47 en la semana pico de finales de junio — dato clave para el modelo de monetización basado en GMV (sección 17.5).
- **GMV total ya procesado**: $32.746.242 COP en los 239 pedidos — evidencia de que el sistema ya liga de forma directa y auditable el valor de venta al pedido confirmado, sin telemetría adicional.
- **Gobernanza de prompts como riesgo ya materializado**: al menos dos versiones distintas del prompt "REGLA CERO" coexisten activas en paralelo (una deriva a un número de WhatsApp de asesora humana ante producto fuera de catálogo, otra deriva al link del catálogo de Meta) — confirma, con evidencia adicional a la ya reportada, que ningún dato de negocio debe vivir en el texto del prompt en esta versión del documento (sección 2, regla de gobernanza).
- **Subregistro estructural confirmado con el export completo del CRM**: al cruzar las 239 filas contra el export completo de ~270 columnas (el mismo dataset visto ahora con mucho más detalle), los campos `conversation_summary`, `Nombre de la campaña`, `Método de pago (traducido)`, `Nombre del producto en el ecommerce interno`, `Nombre de la tienda`, `Nombre del asesor`, `Estado actual`/`Estado verificado`/`Novedad Homologada`/`Novedad: resultado` y `Analisis de porcentaje` están vacíos en el 100% de las 239 filas. Esto no es un artefacto de un CSV recortado — es un patrón real de la plataforma de origen, y significa que hoy no existe ningún dato utilizable de atribución de campaña, método de pago, ni de causa de novedad logística ya resuelta.

### 15.1 Hallazgo nuevo: desglose completo del embudo por etapa (columna del tablero Kanban)

El export completo permite, por primera vez, ver la distribución exacta de las 239 filas por etapa del tablero, no solo el porcentaje agregado en "Llamar para confirmar":

| Etapa (`board_column_name`) | Pedidos | % del total |
|---|---|---|
| Llamar Para Confirmar Pedido✍ | 175 | 73.2% |
| Intento de cancelación ⁉️ | 21 | 8.8% |
| Datos completados ✅ | 15 | 6.3% |
| Seguimiento WhatsApp✍ | 12 | 5.0% |
| Oficina 📦 | 9 | 3.8% |
| Pedido programado ⏱️ | 3 | 1.3% |
| **Pedidos Despachados 🚚** | **3** | **1.3%** |
| Pendiente Guía✍ | 1 | 0.4% |

Esto confirma el 73% ya reportado como cuello de botella número uno, y **añade un hallazgo más grave que no era visible en el análisis anterior**: de los 239 pedidos confirmados por el agente en el período observado, solo **3 (1.3%) llegaron a estado "Despachado"**. Aun contando generosamente "Oficina" + "Pedido programado" + "Despachado" como el tramo final del embudo, eso es apenas 15 de 239 (6.3%). Esto tiene una implicación directa sobre el modelo de monetización (sección 17.7): si la comisión solo se reconoce al llegar a "Despachado", el ingreso real recibido durante el período estaría gravemente rezagado frente al GMV ya confirmado por el agente — no es solo una cuestión de "cuándo" cobrar, es una señal de que el cuello de botella operativo (el 73% varado en "Llamar para confirmar") es también, hoy, un cuello de botella de facturación si se adopta ese punto de reconocimiento sin ajustarlo.

### 15.2 Hallazgo nuevo: calidad de dato en transportadora

El campo `Transportadora` solo está diligenciado en 17 de 239 filas (7.1%), y en esas 17 filas el mismo transportador aparece escrito de seis formas distintas: "Interrapidisimo" (10), "interrapidisimo" (3), "Interrapidicimo" (1), "Interrapidismo" (1), "Interrapidísimo" (1), "Interapidisimo" (1). Es evidencia directa, con datos reales, de por qué la tabla `transportadoras_canonicas` (sección 2) es necesaria desde el día uno y no un "nice to have": sin normalización, cualquier reporte agregado por transportadora subestimaría el volumen real hasta en un 83% solo por variaciones de escritura del mismo dato.

---

## 16. Arquitectura multi-tenant y multi-plataforma

### 16.1 Qué cambia al aceptar clientes externos
El sistema deja de ser una herramienta interna de Indisutex para convertirse en una plataforma que otros negocios pueden conectar con su propio WooCommerce, Shopify, catálogo propio en Supabase, o adoptando nuestro catálogo desarrollado a la medida. Implica cuatro cambios estructurales: `tenant_id` + RLS (sección 2), prompts generalizados (sección 6), capa de adaptadores (sección 8), y proveedor de IA elegible por tenant (16.8).

### 16.2 Aislamiento de datos (seguridad multi-tenant)
- `tenant_id` en cada tabla, incluidos `mensajes` y sus embeddings.
- **Row-Level Security en Postgres**: protege incluso si un workflow olvida filtrar explícitamente — evita el incidente más grave posible: un cliente viendo datos de otro.
- Alternativa más costosa: esquema de base de datos separado por cliente — se justifica solo pasados los ~15-20 tenants.

### 16.3 Onboarding de un cliente nuevo
1. Registro del tenant en `clientes_plataforma`.
2. Sincronización automática del catálogo real vía el adaptador correspondiente.
3. Configuración corta de marca: tono, política de pago, mínimo de pedido mayorista, ciudades de despacho.
4. Conexión de su propio número de WhatsApp Business — paso manual, sujeto a tiempos de verificación de Meta.
5. Ambiente de prueba con número sandbox antes de producción.

### 16.4 Verificación de WhatsApp Business
Limita la velocidad real de onboarding sin importar la calidad del software — no es automatizable, puede tardar días o semanas.

### 16.5 Riesgo de gobernanza de prompts, multiplicado
Ya mitigado al sacar todo dato de negocio del texto del prompt hacia `clientes_plataforma` y tablas relacionadas (sección 2 y 6); reforzado con la evidencia adicional de la sección 15 (dos versiones del "REGLA CERO" corriendo en paralelo).

### 16.6 Elección de plataforma de ecommerce
Ver sección 5 (catálogo) y 8 (adaptadores) — cuatro rutas posibles, ninguna obliga al cliente a migrar su infraestructura existente.

### 16.7 Modelo de base de datos de catálogo: Supabase del cliente, o catálogo propio en Supabase/Oracle

- **Postgres + pgvector (núcleo del sistema)**: igual para todos los tenants — contactos, pedidos, mensajes, embeddings, con RLS.
- **Base de datos del catálogo (varía por tenant)**:
  1. El cliente ya tiene su propia interfaz de catálogo y su propia Supabase → el adaptador (8.4) se conecta como lector; el cliente conserva control total.
  2. El cliente no tiene catálogo propio y quiere que se lo desarrollemos en Supabase → ruta más rápida y económica (8.5).
  3. El cliente no tiene catálogo propio y prefiere u opera con Oracle → mismo modelo lógico de tablas, adaptador propio para Oracle; mayor costo y tiempo de puesta en marcha, se reserva para requisitos corporativos explícitos.

### 16.8 Proveedor de IA elegible por cliente (ChatGPT, xAI, u Ollama)

- **ChatGPT (OpenAI)**: el cliente conecta su propia API key en `clientes_plataforma.credenciales_ia_ref`. El consumo se factura directo a su cuenta de OpenAI — no lo intermediamos ni lo revendemos con margen.
- **xAI (Grok)**: mismo esquema — API key propia del cliente.
- **Ollama autoalojado**: opción que **el vendedor habilita si conviene** — cliente de bajo volumen, o requisito explícito de no depender de proveedores externos de IA.
- Los 9 system prompts no cambian por proveedor — el nodo de IA en n8n apunta a uno u otro endpoint según `proveedor_ia` del tenant.
- Validar que el modelo elegido soporte visión con calidad comparable para el agente 6.9 — no todos los planes de cada proveedor la incluyen igual.

### 16.9 Proveedor de logística elegible por cliente (Dropi, 99envios, Aveonline)

Igual que con el proveedor de IA, el proveedor de logística no está atado a Dropi — cada tenant elige en `clientes_plataforma.proveedor_logistico` (sección 2) cuál de los tres usar, y el `LogisticsAdapter` (sección 8.6) resuelve la diferencia sin que ningún agente conversacional lo note. Consideraciones al elegir:
- Un cliente que ya opera con Dropi como marketplace de dropshipping (no solo como transportadora) probablemente deba quedarse en Dropi para no romper su cadena de abastecimiento.
- Un cliente que solo necesita cotizar/despachar (ya tiene su propio inventario, como Indisutex) puede evaluar 99envios o Aveonline igual de bien, comparando tarifa, cobertura y velocidad de pago del recaudo contra entrega.
- Si el cliente ya usa el módulo de confirmación/novedades por WhatsApp de 99envios o Aveonline (AveChat), acordar explícitamente con el cliente si esa función la sigue el agente propio (6.7) o el del proveedor logístico, para no duplicar mensajes.

### 16.10 El límite real de escalar el LLM cuando el cliente elige Ollama
Un solo servidor de Ollama compartido entre varios tenants que lo eligieron degrada su tiempo de respuesta proporcional a la carga concurrente. Opciones: un Ollama por tenant (aísla carga, más costo), pool balanceado (más complejo de operar), o sugerir activamente ChatGPT/xAI para tenants de alto volumen y reservar Ollama para los de bajo volumen. Dimensionar según cuántos tenants reales elijan Ollama, no según el total de clientes de la plataforma.

### 16.11 Riesgos específicos del escalamiento multi-tenant
1. Fuga de datos entre tenants si no se aplica RLS.
2. Dependencia de tiempos de revisión de Shopify si se opta por app pública.
3. Gobernanza de prompts multiplicada por cliente — mitigada en 16.5.
4. Latencia de Ollama bajo carga compartida, para tenants que lo elijan — mitigada en 16.10.
5. Verificación de WhatsApp Business por cliente — riesgo de tiempo, no técnico.
6. Dependencia de la API key del cliente para ChatGPT/xAI: si la revoca o deja de pagar, ese tenant pierde LLM funcional hasta renovarla — conviene un chequeo de salud de la key por tenant.
7. Gobernanza de credenciales de catálogo externas (Supabase del cliente, Oracle): un cambio de esquema no avisado por el cliente puede romper la sincronización — el adaptador debe validar columnas esperadas antes de sincronizar, no asumir que la estructura nunca cambia.
8. Calidad de dato heredada de la plataforma de origen del cliente (ver sección 15.2: seis variantes de escritura del mismo transportador en un solo dataset) — el adaptador de cada plataforma debe normalizar campos de texto libre contra catálogos canónicos antes de escribir en el núcleo, no asumir que el dato del cliente ya viene limpio.
9. Dependencia del proveedor logístico elegido (Dropi, 99envios o Aveonline): si el cliente cambia de proveedor logístico a mitad de operación, hay que migrar `proveedor_logistico` y revalidar que `LogisticsAdapter` siga generando guía y estado correctamente — mitigado por la interfaz común de la sección 8.6, pero el corte de credenciales del proveedor viejo debe coordinarse para no perder guías en tránsito.
10. Solapamiento de funciones si el cliente ya usa el módulo de confirmación/novedades por WhatsApp propio de 99envios o Aveonline (AveChat) — sin acordar por tenant cuál sistema posee esa conversación, el cliente final puede recibir mensajes duplicados o contradictorios sobre el mismo pedido (sección 16.9).

---

## 17. Modelo de monetización recomendado

### 17.1 Modelo elegido: híbrido de fee base bajo + comisión escalonada decreciente sobre el GMV confirmado por el agente

No es un SaaS fijo, ni un cobro por conversación, ni licenciamiento a terceros como modelo primario. Es la combinación que mejor se alinea con cómo este tipo de cliente (mayorista de alto ticket, ya acostumbrado a pagar por resultado en Meta Ads y Dropi) entiende el valor, y con lo que el sistema ya registra por diseño sin necesidad de telemetría nueva.

### 17.2 Por qué este modelo y no los otros (resumen del marco de evaluación)

| Modelo | Alineación de incentivos | Fricción de venta | Techo de ingreso | Costo de auditoría | Resiliencia a churn | Cubre costo fijo |
|---|---|---|---|---|---|---|
| SaaS fijo | Baja | Alta | Plano | Bajo | Baja | Alta |
| Por conversación/uso | Media | Media-alta | Medio, desalineado del valor | Medio | Media | Alta |
| **Comisión sobre GMV (elegido, combinado con fee base)** | **Alta** | **Baja** | **Alto, crece con el cliente** | **Bajo (ya existe el dato)** | **Alta** | Baja por sí solo (se complementa con el fee base) |
| Licenciamiento/reventa a terceros | Media | Baja (para escalar canal) | Medio (diluido por margen del revendedor) | Medio | Media | Media |
| Fee de implementación como único eje | N/A | Baja | Nulo en recurrencia | Bajo | N/A | Media, solo al inicio |

### 17.3 Estructura del modelo

1. **Fee de implementación** (pago único): cubre el onboarding real — verificación de WABA, configuración de marca, sincronización inicial de catálogo, pruebas en sandbox (sección 16.3). No cambia según el plan.
2. **Fee base mensual, bajo**: cubre exclusivamente el costo fijo que no depende del volumen de venta del cliente — mantenimiento de la plataforma, soporte, y GPU si el cliente eligió Ollama. Varía según el plan de arquitectura elegido (17.4):
   - Plan **Conecta** (catálogo propio del cliente + su propia API key de IA): fee base más bajo — nuestro costo fijo real es mínimo.
   - Plan **Catálogo Incluido** (catálogo desarrollado por nosotros en Supabase, API key propia del cliente): fee base intermedio.
   - Plan **Completo** (catálogo propio nuestro en Oracle u Ollama compartido): fee base más alto — asumimos costo fijo de licenciamiento e infraestructura.
3. **Comisión variable sobre el GMV confirmado por el agente**, escalonada y decreciente — la fuente principal de ingreso:

| Tramo de GMV mensual generado vía el agente | Comisión sugerida |
|---|---|
| Hasta $10.000.000 COP/mes | 4-5% |
| $10.000.001 - $40.000.000 COP/mes | 2.5-3% |
| Más de $40.000.000 COP/mes | 1.5-2% |

*(Tramos y porcentajes de partida, a calibrar con datos reales de margen del cliente piloto; el margen mayorista reportado en el guion de ventas ronda 55-60% sobre el precio de venta, lo que deja espacio real para esta comisión sin volverse prohibitiva.)*

### 17.4 Por qué escalonado y decreciente

Un porcentaje fijo penaliza más, en términos relativos, al cliente que más crece — justo al que menos motivos se le debe dar para buscar alternativas. Bajar el porcentaje con el volumen premia el crecimiento del cliente y refuerza la retención en el momento de mayor riesgo de fuga (cuando ya tiene volumen suficiente para plantearse construir algo propio), mientras el ingreso absoluto para nosotros sigue creciendo con el cliente.

### 17.5 Ejemplo numérico con los datos reales ya observados

- GMV de la semana pico observada (≈47 pedidos × $137.014 COP AOV) ≈ **$6.440.000 COP/semana** → proyectado a mes (×4.3) ≈ **$27.700.000 COP/mes**.
- Bajo el modelo recomendado (tramo de 4-5% en ese nivel): comisión mensual estimada ≈ **$1.100.000 - $1.385.000 COP**, más el fee base.
- Comparado con un SaaS fijo conservador ($300.000-$500.000 COP/mes, cifra ilustrativa): la comisión ya supera ese ingreso en el mes en que el cliente alcanza el ritmo de crecimiento ya observado (de 4 a 47 pedidos/semana en menos de tres meses).
- Si el cliente escala a 100 pedidos/semana, GMV mensual ≈ **$58.900.000 COP**, entrando al tramo de 1.5-2% → comisión mensual estimada entre **$883.000 y $1.178.000 COP**, todavía por encima del SaaS fijo conservador, sin renegociar contrato.

*(Cifras ilustrativas construidas sobre datos reales ya procesados, no una promesa de ingreso — evidencia de que el modelo escala con el negocio observado, mientras un SaaS fijo se queda estático sin importar el éxito del cliente.)*

### 17.6 Qué pedido "cuenta" para la comisión

Solo los pedidos con `origen = "agente_whatsapp"` (campo definido en la tabla `pedidos`, sección 2) se facturan — un pedido que el cliente cerró por su cuenta (ej. en su tienda web sin pasar por el agente) no cuenta. El propio agente de checkout (6.10) escribe este campo al confirmar, así que no depende de que el cliente reporte manualmente sus ventas.

### 17.7 Momento de reconocimiento de la comisión — ajustado con el hallazgo de la sección 15.1

La versión anterior de este documento proponía cobrar la comisión solo sobre pedidos que llegan a estado "Despachado". El desglose completo del embudo (sección 15.1) muestra que **ese punto de reconocimiento, tal cual, es inviable operativamente hoy**: solo el 1.3% de los 239 pedidos observados llegó a "Despachado" en el período — no porque las ventas no sean reales, sino porque el cuello de botella de "Llamar para confirmar" (73%) retiene casi todo el embudo antes de llegar ahí. Cobrar solo al despacho, en el estado operativo actual, significaría facturar sobre menos del 2% del GMV real confirmado por el agente — un desalineamiento severo entre el valor entregado y el ingreso recibido.

**Ajuste recomendado**: reconocer la comisión en dos momentos, no uno solo, para no perder alineación con el flujo de caja real del negocio ni sobre-prometer un ingreso que el propio embudo del cliente no sostiene:
- **Reconocimiento parcial** (ej. 50% de la comisión calculada) al llegar a "Datos completados" — el punto en que el pedido ya tiene dirección, producto y valor confirmados por el cliente, y es lo más cercano a "venta real" que el embudo actual sostiene de forma consistente.
- **Reconocimiento del saldo restante** al llegar a "Despachado" — preserva el incentivo original de cobrar sobre venta efectivamente entregada, sin que el 98.7% de rezago actual bloquee todo el ingreso recurrente.

Esto no reemplaza la prioridad operativa de resolver el cuello de botella del 73% (sección 14 y 18) — al contrario, la refuerza: mientras ese cuello de botella no se resuelva, es también el mayor obstáculo para el flujo de caja del propio modelo de monetización, no solo para la satisfacción del cliente final.

### 17.8 Riesgos del modelo y mitigación

1. **Ingreso variable y menos predecible que un SaaS fijo** — mitigado por el fee base, que garantiza un piso de ingreso independiente del volumen de venta del cliente ese mes.
2. **Resistencia inicial de algunos clientes a un modelo de comisión** — ofrecer también un SaaS fijo equivalente más alto como alternativa, dejando que el cliente elija; en la práctica, calibrado para que la comisión escalonada sea la opción más atractiva para un cliente que confía en el sistema.
3. **Auditoría de valor real del pedido** — mitigado porque el propio agente de checkout escribe `valor_de_compra`, no depende de autoreporte.
4. **Cancelaciones y devoluciones** — el 8.8% de los pedidos observados (21/239) quedan en "Intento de cancelación" (sección 15.1); mitigado por el reconocimiento en dos momentos de la sección 17.7, que evita cobrar comisión completa sobre un pedido que aún puede caerse.
5. **Calibración inicial de tramos, porcentajes y del split de reconocimiento parcial/final** — deben ajustarse con datos reales de margen y de tasa de conversión "Datos completados → Despachado" de los primeros 2-3 clientes piloto antes de estandarizarse para el resto de la plataforma.
6. **Dependencia del cuello de botella operativo del 73%** (nuevo, sección 15.1 y 17.7) — mientras ese cuello de botella no se resuelva, el reconocimiento final de comisión (ligado a "Despachado") seguirá rezagado frente al GMV real confirmado; conviene tratar la resolución de ese cuello de botella como una prioridad compartida entre el éxito del cliente y la salud del propio modelo de ingreso.

### 17.9 Fuga de pedidos: riesgo y mitigación

Es una preocupación frecuente y legítima de cualquier ecommerce antes de aceptar un modelo de comisión sobre GMV: ¿qué evita que un pedido se cierre por WhatsApp pero quede fuera del sistema, sin generar comisión? Vale la pena distinguir dos formas del mismo riesgo y tratarlas por separado, porque la mitigación de cada una es distinta.

**Tipo 1 — Fuga de visibilidad.** El vendedor cierra la venta conversando por un número de WhatsApp personal, no por la WABA del tenant conectada al agente. El pedido nunca pasa por el sistema, así que ni siquiera queda registrado como dato — se pierde la venta y la trazabilidad, no solo la comisión.

**Tipo 2 — Fuga de comisión.** El pedido sí nace en la WABA del tenant (por ejemplo, entra por un anuncio de Meta que apunta ahí), pero antes de que el agente de checkout (6.10) lo confirme, el vendedor lo deriva a un canal paralelo — un número personal, "mándame el pago directo por Nequi" — precisamente para esquivar el campo `origen = "agente_whatsapp"` (sección 17.6) y no generar comisión sobre esa venta.

**Mitigaciones recomendadas, de la más estructural a la más operativa:**

1. **Un solo número público por tenant.** Toda la pauta paga (Meta Ads), el link en bio y el catálogo apuntan únicamente a la WABA conectada al agente — si no existe otro número público al que derivar al cliente, se cierra la puerta de entrada del Tipo 1 desde el origen del tráfico.
2. **Conciliación periódica GMV del agente vs. GMV del cliente.** Comparar el GMV que reporta el agente (`pedidos.valor_de_compra` con `origen = "agente_whatsapp"`) contra las ventas totales que el cliente reporta por su cuenta (caja, banco, o el backend de su ecommerce si aplica). Una brecha sostenida es la señal temprana de fuga; se puede montar como un reporte adicional en el tablero de NocoDB (sección 10).
3. **Activar el log completo de conversación.** Ya identificado como gap crítico en `conversation_summary` (0% de registro en los 239 pedidos analizados, sección 15 y riesgo 18.4) — sin el hilo completo de la conversación no hay forma de auditar si un pedido se desvió a mitad de camino. Resolver ese gap no es solo una mejora de calidad de dato: es la evidencia que sostiene cualquier disputa sobre fuga.
4. **Fricción de proceso a favor del canal oficial.** El camino por el agente debe ser objetivamente más cómodo que el atajo — checkout guiado, generación automática de guía de envío (vía `LogisticsAdapter`, sección 8.6), confirmación sin pasos manuales. Si cerrar por el agente es más rápido que cerrar por fuera, la fuga pierde buena parte de su incentivo económico para el vendedor.
5. **Cláusula contractual explícita.** Independiente de la mitigación técnica, el contrato con el tenant debe definir la fuga de pedidos como incumplimiento, con la conciliación del punto 2 como mecanismo de verificación — la mitigación técnica reduce la fuga, pero no reemplaza el respaldo contractual.

Ninguna de estas mitigaciones elimina el riesgo por completo — es inherente a cualquier modelo de comisión sobre un canal conversacional humano-asistido — pero en conjunto lo reducen a un nivel manejable y, sobre todo, lo hacen detectable en vez de invisible.

---

## 18. Riesgos generales del proyecto y mitigación

1. **Cuello de botella operativo en "Llamar para confirmar"** (73.2% de los pedidos, 175/239 — sección 15.1) — evaluar automatización de confirmación por WhatsApp (voz/audio) para pedidos de score alto de Dropi, antes de invertir en escalar a más clientes. Este mismo cuello de botella hoy limita a 1.3% la tasa de pedidos que llegan a "Despachado" — afecta directamente el momento de reconocimiento de ingreso del modelo de monetización (sección 17.7).
2. **Talla única S-L deriva siempre a asesor humano** — demanda no cuantificada que se pierde o se resuelve manualmente sin quedar en las métricas de conversión del bot.
3. **Dependencia de un solo SKU (Short Tira)** — limita el ticket promedio y el cross-sell; el agente de catálogo (6.4) ya corrige parcialmente esto para categorías amplias.
4. **Falta histórica de registro de conversación real** (`conversation_summary` vacía en el 100% de los pedidos analizados, confirmado también en el export completo del CRM — sección 15) — cualquier optimización futura del guion se basa en inferencia indirecta en vez de evidencia directa; activar el log de conversación es una mejora de bajo costo y alto valor.
5. **Calidad de dato heredada de la plataforma de origen** (sección 15.2: seis variantes de escritura del mismo transportador) — riesgo de subestimar cualquier métrica agregada por campo de texto libre si no se normaliza antes de reportar.
6. **Riesgos de seguridad y gobernanza multi-tenant** — ver sección 16.11.
7. **Riesgos del modelo de monetización** — ver sección 17.8.
8. **Fuga de pedidos fuera del agente (visibilidad y comisión)** — un vendedor puede derivar la venta a un número personal o a un canal paralelo para evitar que quede registrada como `origen = "agente_whatsapp"`; mitigado con número único público por tenant, conciliación GMV agente vs. cliente y activación del log de conversación — ver sección 17.9.

---

## 19. Glosario

- **Tenant**: una marca interna de Indisutex o un cliente externo completo, identificado por `tenant_id`.
- **WABA**: WhatsApp Business Account, la cuenta verificada de Meta que atiende a un tenant.
- **GMV**: Gross Merchandise Value — el valor total de venta procesado, en este proyecto igual a la suma de `pedidos.valor_de_compra` con `origen = "agente_whatsapp"`.
- **RLS**: Row-Level Security, mecanismo de Postgres que aísla los datos de cada tenant a nivel de fila.
- **EcommerceAdapter**: la interfaz común que traduce las llamadas de los agentes conversacionales hacia la plataforma de catálogo/ecommerce real de cada tenant (WhatsApp Catalog, WooCommerce, Shopify, Supabase propia o del cliente, Oracle).
- **LogisticsAdapter**: la interfaz común que traduce las llamadas del agente de logística (6.8) y del agente de checkout (6.10) hacia la plataforma de envíos real de cada tenant (Dropi, 99envios, Aveonline), sin que ningún agente conversacional sepa cuál está detrás (sección 8.6).
- **99envios / Aveonline**: plataformas logísticas colombianas multitransportadora (cotizan y despachan indistintamente con TCC, Coordinadora, Interrapidísimo, Servientrega y Envía desde un solo panel/API), alternativas a Dropi como proveedor logístico elegible por tenant (sección 9.6).
- **PostgREST**: la API REST autogenerada por Supabase sobre Postgres, usada para leer catálogos de clientes que ya tienen su propia Supabase.
- **Fuga de pedidos**: cuando una venta que debería pasar por el agente de WhatsApp se cierra por fuera del sistema (número personal o canal paralelo), sin quedar registrada con `origen = "agente_whatsapp"` — pierde visibilidad de dato, comisión, o ambas (sección 17.9).
