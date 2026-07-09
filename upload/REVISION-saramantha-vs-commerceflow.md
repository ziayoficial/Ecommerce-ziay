# Revisión cruzada: Documento Saramantha vs CommerceFlow OS (lo construido)

> **Fecha:** Julio 2026
> **Propósito:** revisar al 100% el documento `PROYECTO_saramantha_agentes_whatsapp.md` (Indisutex SAS — Saramantha · Sublimados Majestic · Lovely Pijamas · Sueño de Reina), compararlo contra lo que ya construimos (CommerceFlow OS), identificar brechas críticas, conflictos y complementariedades, y proponer un plan concreto de evolución.

---

## 0. Resumen ejecutivo de la revisión

**Lo que tú documentaste** es la **capa de ejecución de agentes** (backend conversacional): n8n + Postgres+pgvector + 9 agentes especializados + adaptadores de catálogo/logística + multi-tenant desde día 1 + monetización por comisión sobre GMV. Ya validado con 239 pedidos reales (abril–julio 2026).

**Lo que yo construí** (CommerceFlow OS) es la **capa de operación + dashboard + atribución**: Next.js 16 + Prisma + Socket.io + LLM de smart reply + motor CPA/ROAS/ROI + mensajería omnicanal (WhatsApp + Messenger + IG) + estrategia de pago configurable.

**Conclusión clave:** son **complementarias, no contradictorias**. Lo que yo construí cubre tres cosas que pediste explícitamente en tu primer mensaje y que NO estaban en el documento Saramantha:

1. **Mensajería multi-canal** (WhatsApp para CO + Messenger/IG para internacional) — tú lo pediste.
2. **Motor de atribución de pauta a nivel de anuncio** con CPA/ROAS/ROI y detección de canibalización — tú lo pediste.
3. **Estrategia de pago configurable** (anticipado / contra entrega / híbrido) — tú lo pediste.

Pero el documento Saramantha especifica **8 cosas críticas que yo NO construí** y que sí necesitás para que esto sea tu plataforma real. La revisión siguiente las detalla y propone cómo incorporarlas sin tirar lo avanzado.

---

## 1. Lo que SÍ está alineado (construí igual que tu documento)

| Tema | Documento Saramantha | CommerceFlow OS (construido) | Estado |
|---|---|---|---|
| WhatsApp como canal primario CO | §1 stack, §9.1 | `Channel.type='whatsapp'` + webhook `/api/webhooks/whatsapp` | ✅ |
| Memoria conversacional | §3 — últimos N mensajes + búsqueda semántica | `Message` model + historial cargado en `/api/conversations/[id]` | ⚠️ Parcial (sin embeddings/pgvector) |
| Webhook Meta | §9.1 | `/api/webhooks/meta` (verify + inbound stub) | ✅ |
| Atribución publicitaria básica | §2 `atribucion_publicitaria` table | `Order.sourceAdId`, `clickId`, `sourcePlatform` + `Attribution` model | ✅ (y ampliado con motor CPA/ROAS) |
| Pedidos con estado Kanban | §10 (NocoDB) | `Order.status` + workflow en `/api/orders/[id]` PATCH | ⚠️ Sin NocoDB |
| Imagen de referencia por pedido | §2 `pedidos.imagen_referencia_url` | No implementado todavía | ❌ |
| Trazabilidad end-to-end | §12 escenarios | Flujo anuncio → click → conversación → pedido → atribución implementado | ✅ |
| Validación con datos reales | §15 — 239 pedidos | Demo seed con 10 pedidos (no reales) | ❌ (es demo) |

---

## 2. Lo que CONSTRUYO DE MÁS vs tu documento (cosas que tú me pediste agregar)

Estas son las tres piezas que yo añadí por tu instrucción explícita del primer mensaje y que **tu documento Saramantha NO contempla** (porque fue escrito antes de esa instrucción):

### 2.1 Mensajería multi-canal (no solo WhatsApp)
- **Tu documento:** WhatsApp Cloud API únicamente. No menciona Messenger ni Instagram DM.
- **CommerceFlow OS:** WhatsApp (CO primario + MX), Messenger (internacional), Instagram DM. Bandeja unificada con badges por canal.
- **Tu instrucción original:** *"agregar a esta proyecto el messenger, considerando que whatsapp es fuerte en colombia pero para otros paises el messenger es el canal mas activo"*.
- **Veredicto:** ✅ Quedarse. Es un **sumando** al documento Saramantha: extiende el alcance de "plataforma de agentes de venta por WhatsApp" a "plataforma de agentes de venta conversacional omnicanal". Los 9 agentes y los adaptadores siguen siendo válidos; solo se replica el patrón `tenant_id → WABA` a `tenant_id → Channel (WA|Messenger|IG)`.

### 2.2 Motor de atribución de pauta a nivel de anuncio con CPA/ROAS/ROI
- **Tu documento:** solo la tabla `atribucion_publicitaria` (`tenant_id, contacto_id, id_anuncio, id_campaña, plataforma, costo_atribuido`). No hay motor de cálculo ni veredictos.
- **CommerceFlow OS:** tabla `Ad`, `AdSpend` (diario), `Attribution` (multi-touch ready), motor `/api/ads` que calcula CPA, ROAS, ROI, CPL, CVR, AOV por anuncio, y emite veredictos: **escalar / optimizar / vigilar / pausar / apagar / canibaliza**. Kill-switch con audit log.
- **Tu instrucción original:** *"agregar al proyecto la funcionalidad de identificar desde la pauta paga cuales identificadores de anuncios son los que estan generando la venta en cantidad y valor facturado, asi mismos cuales estan generando gasto y se deben apagar o estan canibalizado el presupuesto, cual es el cpa costo por adquisicion de un pedido, roas, roi y demas funcionalidades para el traffiker digital"*.
- **Veredicto:** ✅ Quedarse. **Es la pieza más diferenciadora del proyecto**. El documento Saramantha trata la atribución como un dato; CommerceFlow OS la trata como un motor accionable.

### 2.3 Estrategia de pago configurable (anticipado / COD / híbrido)
- **Tu documento:** campo `politica_pago` en `clientes_plataforma`, sin más detalle.
- **CommerceFlow OS:** `Channel.paymentStrategy ∈ {advance, cod, hybrid}` + `requirePrepayMin` + `prepayDiscountPct` + `codFee`. UI de configuración por canal y país. Recomendaciones contextuales al agente en el panel del cliente.
- **Tu instrucción original:** *"agregar features para determinar si se desea pago anticipado o por contra entrega, los pagos anticipados se recomienda realizarlos por carrito del ecommerce o en su defeto buscar una estrategia hibrida, o por configuracion"*.
- **Veredicto:** ✅ Quedarse. Complementa tu `politica_pago` con lógica operativa real.

---

## 3. Lo que te FALTA (brechas críticas vs tu documento Saramantha)

Estas son las 8 brechas que sí hay que cerrar. Las ordeno por prioridad operativa (no por dificultad técnica).

### 3.1 ❌ Multi-tenant (`tenant_id` + aislamiento) — **CRÍTICO**
- **Tu documento:** §2, §16 — `tenant_id` en TODA tabla + Row-Level Security en Postgres. Es la base del modelo multi-cliente (Indisutex 4 marcas + clientes externos).
- **CommerceFlow OS:** single-tenant. No hay `tenant_id` en ningún modelo.
- **Impacto:** sin esto no se puede aceptar un segundo cliente. Es la base de tu modelo de monetización (§17).
- **Plan:** añadir `tenantId String` a los 18 modelos Prisma + middleware que filtre por sesión/usuario → tenant. SQLite no tiene RLS pero el patrón Prisma `where: { tenantId }` aplica. Al migrar a Postgres, activar RLS nativo.

### 3.2 ❌ Los 9 agentes conversacionales especializados — **CRÍTICO**
- **Tu documento:** §6 — 9 agentes con prompts exactos:
  1. Perfilamiento de leads (mayorista/emprendedor/detal/regalo)
  2. Discurso de ventas por perfil
  3. Ofertas y cotización cruzada
  4. Respuesta visual-primero (catálogo con imágenes)
  5. Oferta por tema/personaje
  6. Objeciones
  7. Confirmación de datos de dirección (10 campos)
  8. Logística de fletes
  9. Visión (identificación de producto por imagen)
  10. Checkout y sincronización
- **CommerceFlow OS:** 1 solo endpoint `/api/ai-reply` con un system prompt genérico.
- **Impacto:** el modelo Saramantha está validado con 239 pedidos; el mío es genérico. Tu arquitectura es **mucho** más rica.
- **Plan:** implementar los 10 prompts como endpoints separados `/api/agents/{profile|speech|quote|catalog|theme|objection|address|logistics|vision|checkout}` con el system prompt exacto de tu §6. Reusar el LLM (z-ai-web-dev-sdk) como motor. El `ai-reply` actual queda como fallback "agente único" para conversaciones fuera de flujo.

### 3.3 ❌ Capa de adaptadores de catálogo (`EcommerceAdapter`) — **ALTO**
- **Tu documento:** §5, §8 — 4 rutas: WhatsApp Catalog, WooCommerce, Shopify, catálogo propio (Supabase del cliente / Supabase nuestra / Oracle nuestra). Interfaz común: `buscarProductos`, `obtenerProducto`, `crearPedido`, `actualizarInventario`, `obtenerEstadoPedido`.
- **CommerceFlow OS:** solo `Product` interno, sin adaptadores.
- **Impacto:** no se puede conectar un cliente con WooCommerce/Shopify/Supabase propia.
- **Plan:** crear `src/lib/adapters/ecommerce-adapter.ts` (interfaz) + 4 implementaciones en `src/lib/adapters/{whatsapp-catalog,woocommerce,shopify,supabase-catalog}.ts`. El `Product` actual pasa a ser la tabla cache local sincronizada desde el adaptador activo del tenant.

### 3.4 ❌ Adaptador de logística (`LogisticsAdapter`) — **ALTO**
- **Tu documento:** §8.6, §9.6 — Dropi / 99envios / Aveonline. Interfaz: `cotizarFlete`, `generarGuia`, `consultarEstadoGuia`, `reportarNovedad`. Tabla `cotizaciones_flete` + `transportadoras_canonicas` (para normalizar las 6 formas de escribir "Interrapidísimo").
- **CommerceFlow OS:** nada de logística.
- **Impacto:** no se puede cotizar flete real ni generar guía. El agente de logística (6.8) no funciona.
- **Plan:** crear `src/lib/adapters/logistics-adapter.ts` + 3 implementaciones. Añadir modelos Prisma `FreightQuote`, `Carrier` (canónico), `Shipment`. Endpoint `/api/shipping/quote` y `/api/shipping/guide`.

### 3.5 ❌ Identificación visual de producto (OCR + CLIP) — **MEDIO**
- **Tu documento:** §4, §6.9 — franja de metadata visible en cada imagen del catálogo (SKU + diseño + precio) → OCR (Tesseract) → si falla, similitud visual (OpenCLIP) → si confidence baja, LLM pregunta. Determinístico, sin alucinación.
- **CommerceFlow OS:** tengo VLM disponible pero no implementé este flujo.
- **Impacto:** no se identifica un producto desde una captura del cliente.
- **Plan:** endpoint `/api/vision/identify` que recibe imagen → VLM (z-ai-web-dev-sdk `chat.completions.createVision`) con prompt específico para extraer SKU de la franja + comparar contra catálogo. El VLM reemplaza a Tesseract+OpenCLIP en este stack (más simple, un solo motor).

### 3.6 ❌ NocoDB (tablero Kanban operativo) — **MEDIO**
- **Tu documento:** §10 — NocoDB como tablero operativo con vista Kanban por `estado`, filtrado por tenant, sincronización bidireccional.
- **CommerceFlow OS:** vista de tabla interna en `/orders`. No es Kanban.
- **Impacto:** la operación real (call center, bodega) trabaja mejor en Kanban que en tabla.
- **Plan:** dos opciones: (a) agregar vista Kanban interna al módulo Orders (más rápido, sin dependencia externa); (b) integrar NocoDB via webhook (más fiel a tu doc). Recomiendo (a) primero, (b) cuando quieras desacoplar la operación del dashboard.

### 3.7 ❌ Modelo de monetización (comisión sobre GMV) — **MEDIO**
- **Tu documento:** §17 — fee de implementación + fee base mensual (por plan: Conecta / Catálogo Incluido / Completo) + comisión escalonada decreciente sobre GMV (4-5% / 2.5-3% / 1.5-2%). Reconocimiento en dos momentos (50% en "Datos completados", 50% en "Despachado") por el cuello de botella del 73%.
- **CommerceFlow OS:** nada de monetización.
- **Impacto:** no podés facturar a tus clientes con la lógica del documento.
- **Plan:** añadir modelos Prisma `Tenant.plan_monetizacion`, `CommissionEntry` (con `recognized_pct` y `recognized_at`), `Invoice`. Endpoint `/api/monetization/gmv` y `/api/monetization/commission`. Dashboard de monetización.

### 3.8 ❌ Configuración de marca por tenant (`clientes_plataforma`) — **ALTO**
- **Tu documento:** §2 — tabla con `tono_marca`, `nombre_asesora`, `politica_pago`, `pregunta_perfil`, `proveedor_ia`, `proveedor_logistico`, `plataforma_catalogo`, `bd_catalogo`, etc. **Regla de gobernanza crítica (§15): ningún dato de negocio vive en el prompt — todo en esta tabla.**
- **CommerceFlow OS:** `Setting` key-value genérico + `Channel` con estrategia de pago. No hay "tono de marca" ni "nombre de asesora" ni "pregunta de perfil".
- **Impacto:** el LLM no puede adaptar tono/perfil por tenant. Los prompts quedan duros.
- **Plan:** crear modelo Prisma `Tenant` (o renombrar `Channel` → `Tenant` + `Channel`) con todos los campos de `clientes_plataforma`. Inyectar en los system prompts de los 10 agentes.

---

## 4. Datos reales que tu documento aporta y yo no conocía

Estos hallazgos de tu §15 son oro para calibrar el sistema:

| Hallazgo (de 239 pedidos reales) | Implicación para CommerceFlow OS |
|---|---|
| 73.2% (175/239) varado en "Llamar para confirmar" | Configurar alerta/automation en `Order.status='pending_confirmation'` tras 2h sin mover |
| Solo 1.3% (3/239) llega a "Despachado" | El bottleneck es operativo, no del sistema. Pero el dashboard debe mostrar este embudo visible |
| 91% (217/239) llevan Short Tira | El agente de catálogo debe forzar cross-sell (mínimo 3 prendas en categoría "familia") — ya está en tu §6.4 |
| 43% pedidos son 12+ unidades; AOV $137.014 COP | El pricing por volumen (`precios_por_volumen`) es obligatorio, no opcional |
| 6 formas de escribir "Interrapidísimo" | Tabla `transportadoras_canonicas` con normalización — sin esto, cualquier reporte agregado está mal |
| `conversation_summary` vacío en 100% de los 239 | El log completo de conversación es prioritario — ya lo tengo resuelto (`Message` model + thread completo) |
| Crecimiento de 4 a 47 pedidos/semana en 3 meses | El sistema debe escalar 10x sin rediseño — ya está pensado (§8 del MD maestro) |
| GMV total $32.746.242 COP en 239 pedidos | El seed demo debería usar cifras realistas de este orden |

---

## 5. Conflictos técnicos a resolver

### 5.1 n8n vs Next.js API Routes
- **Tu documento:** n8n autoalojado orquesta los 9 agentes.
- **CommerceFlow OS:** Next.js API Routes + LLM SDK directo.
- **Resolución:** Next.js API Routes **reemplazan** a n8n en este stack. Las ventajas: un solo runtime, type-safety end-to-end, sin servicio adicional. La desventaja: perdés el editor visual de n8n. Para tu escala (4 marcas + clientes piloto), API Routes son suficientes; n8n se justifica si querés que un equipo no-técnico edite flujos. **Recomiendo API Routes** y dejar n8n como alternativa documentada.

### 5.2 Postgres+pgvector vs SQLite/Prisma
- **Tu documento:** Postgres + pgvector para embeddings (memoria semántica).
- **CommerceFlow OS:** SQLite + Prisma (portable a Postgres).
- **Resolución:** en prod, migrar a Postgres + `pgvector` (el schema Prisma es el mismo, solo cambia `provider`). Los embeddings (`Message.embedding`) se añaden como `Bytes?` en SQLite y `Unsupported("vector")` en Postgres. La búsqueda semántica se hace con SQL nativo de pgvector en prod; en dev se simula con búsqueda full-text.

### 5.3 Proveedor de IA por tenant (ChatGPT/xAI/Ollama) vs z-ai-web-dev-sdk
- **Tu documento:** cada tenant elige proveedor (BYO API key).
- **CommerceFlow OS:** solo z-ai-web-dev-sdk.
- **Resolución:** mantener z-ai-web-dev-sdk como **default** (ya integrado, gratis para dev) + añadir adapters de OpenAI/xAI/Ollama en `src/lib/llm/`. El `Tenant.proveedor_ia` decide cuál usar. Esto es alineable con tu doc.

### 5.4 NocoDB vs dashboard interno
- **Tu documento:** NocoDB externo, sync bidireccional.
- **CommerceFlow OS:** dashboard interno.
- **Resolución:** mantengo el dashboard interno (más control, mejor UX) **+ añado webhook a NocoDB** para que la operación pueda seguir trabajando en NocoDB si lo prefiere. Las dos verdades coexisten: el dashboard es la fuente de truth operativa, NocoDB es una vista sincronizada.

---

## 6. Plan de evolución propuesto (ordenado por prioridad)

Cada ítem incluye el alcance estimado y los archivos a tocar.

### Sprint 1 — Multi-tenant base (PRIORIDAD 1)
- Añadir `Tenant` model Prisma con todos los campos de tu `clientes_plataforma` (§2).
- Añadir `tenantId` a los 18 modelos existentes.
- Middleware NextAuth + sesión → `tenantId`.
- Seed con tus 4 marcas (Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina).
- UI: switcher de tenant en la topbar (solo rol admin).

### Sprint 2 — Los 10 agentes conversacionales (PRIORIDAD 1)
- 10 endpoints en `/api/agents/{name}` con los system prompts exactos de tu §6.
- Cada uno consulta `Tenant` (tono, nombre_asesora, politica_pago, pregunta_perfil) + tablas de negocio (`precios_por_volumen`, `discursos_por_perfil`, `objeciones`, `combos_categoria`, `temas_diseño`) filtradas por tenant.
- El agente 6.9 (visión) usa VLM con prompt específico para extraer SKU de la franja.
- El `ai-reply` actual queda como fallback.
- Crear los modelos Prisma faltantes: `Profile`, `SalesSpeech`, `VolumePrice`, `Design`, `ThemeDesign`, `CategoryCombo`, `Objection`, `DeliveryHistory`, `ImageIdentification`.

### Sprint 3 — Adaptadores de catálogo + logística (PRIORIDAD 2)
- Interfaz `EcommerceAdapter` + 4 implementaciones (WA Catalog, WooCommerce, Shopify, Supabase).
- Interfaz `LogisticsAdapter` + 3 (Dropi, 99envios, Aveonline).
- Modelos `FreightQuote`, `Carrier`, `Shipment`.
- Endpoints `/api/shipping/quote`, `/api/shipping/guide`, `/api/catalog/sync`.
- Empezar con adaptadores **stub** (mock) y dejar los reales con placeholders de credenciales para que se conecten cuando tengas las APIs.

### Sprint 4 — Monetización + NocoDB sync (PRIORIDAD 3)
- Modelos `CommissionEntry`, `Invoice`, `MonetizationPlan`.
- Endpoint `/api/monetization/gmv` y `/api/monetization/commission`.
- Vista Kanban en `/orders` (alternativa interna a NocoDB).
- Webhook saliente a NocoDB para sync bidireccional.

### Sprint 5 — Datos reales + calibración (PRIORIDAD 3)
- Cargar catálogo real de Saramantha (Short Tira, Pantalón, Batola + diseños Stitch/Hello Kitty).
- Cargar los 239 pedidos históricos como seed (anonimizados) para que el dashboard muestre el embudo real (73% en "Llamar para confirmar").
- Calibrar `roas_kill_threshold` y `cpa_target` con tus números reales de Meta Ads.

---

## 7. Recomendación ejecutiva

**No tires nada de lo construido.** CommerceFlow OS te da tres cosas que tu documento Saramantha no tenía (multi-canal, motor de atribución, estrategia de pago configurable) y que vos me pediste explícitamente. Lo que hay que hacer es **evolucionar el núcleo** para incorporar las 8 brechas críticas del documento Saramantha, en el orden del plan de Sprint 1-5.

El resultado final sería una plataforma que combina:

- **Capa de operación (CommerceFlow OS)** — dashboard omnicanal, motor de atribución, estrategia de pago, kill-switch de pauta.
- **Capa de ejecución de agentes (Saramantha)** — 10 agentes especializados, adaptadores de catálogo y logística, multi-tenant, monetización por comisión sobre GMV.

**Próximo paso recomendado:** ¿Querés que ejecute el **Sprint 1 + Sprint 2** ahora (multi-tenant + los 10 agentes con tus prompts exactos)? Es lo que más transforma lo construido hacia tu documento. O si preferís, puedo empezar por otra pieza.

---

## Anexo — Mapa rápido de lo que ya está listo y lo que falta

```
┌─────────────────────────────────────────────────────────────────┐
│  COMMERCEFLOW OS (construido) — CAPA DE OPERACIÓN              │
│  ✅ Dashboard omnicanal (5 módulos)                              │
│  ✅ WhatsApp + Messenger + IG                                   │
│  ✅ Motor de atribución CPA/ROAS/ROI por ad_id                  │
│  ✅ Kill-switch + detección de canibalización                   │
│  ✅ Estrategia de pago configurable (advance/COD/híbrido)       │
│  ✅ Socket.io live messenger                                    │
│  ✅ LLM smart reply (1 agente genérico)                         │
│  ⚠️ Single-tenant                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  EVOLUCIÓN (Sprints 1-5)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SARAMANTHA (tu documento) — CAPA DE EJECUCIÓN DE AGENTES      │
│  ❌ Multi-tenant con tenant_id + RLS                            │
│  ❌ 10 agentes especializados (perfil, discurso, cotización,    │
│     catálogo visual, tema, objeciones, dirección, logística,    │
│     visión, checkout)                                           │
│  ❌ EcommerceAdapter (WA Catalog, Woo, Shopify, Supabase/Oracle)│
│  ❌ LogisticsAdapter (Dropi, 99envios, Aveonline)               │
│  ❌ Identificación visual (OCR/CLIP → VLM en este stack)        │
│  ❌ NocoDB sync (Kanban operativo)                              │
│  ❌ Monetización (comisión escalonada sobre GMV)                │
│  ❌ Tenant config (tono, asesora, politica_pago, pregunta_perfil)│
│  ✅ Validado con 239 pedidos reales (cuello botella 73%         │
│     identificado, GMV $32.7M COP, AOV $137k)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

*Documento de revisión generado tras lectura al 100% de `PROYECTO_saramantha_agentes_whatsapp.md` (922 líneas) y comparación contra el estado actual de CommerceFlow OS.*
