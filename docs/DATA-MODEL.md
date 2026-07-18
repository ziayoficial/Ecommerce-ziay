# Modelo de Datos — CommerceFlow OS

Documentación de los **31 modelos Prisma** de CommerceFlow OS, organizados por sección funcional, con su propósito, campos clave, relaciones y referencia a la sección del documento Saramantha que implementan.

> 📖 Para la referencia de API que consume estos modelos ver [`API-REFERENCE.md`](./API-REFERENCE.md).
> 📖 Para el archivo de schema completo ver [`../prisma/schema.prisma`](../prisma/schema.prisma) (SQLite dev) y [`../prisma/postgres/schema.postgres.prisma`](../prisma/postgres/schema.postgres.prisma) (Postgres + pgvector prod).

---

## 📋 Tabla de contenidos

1. [Diagrama ER (ASCII)](#diagrama-er-ascii)
2. [Sección 0 — Tenant (multi-tenant core)](#sección-0--tenant-multi-tenant-core)
3. [Sección 1 — Identity & Access](#sección-1--identity--access)
4. [Sección 2 — Channels](#sección-2--channels)
5. [Sección 3 — Customers / Contacts](#sección-3--customers--contacts)
6. [Sección 4 — Conversations & Messages](#sección-4--conversations--messages)
7. [Sección 5 — Catalog & Orders](#sección-5--catalog--orders)
8. [Sección 5.1 — Pricing & Discourse (Saramantha §2)](#sección-51--pricing--discourse-saramantha-2)
9. [Sección 6 — Ad Attribution](#sección-6--ad-attribution)
10. [Sección 7 — Logistics](#sección-7--logistics)
11. [Sección 8 — Monetization](#sección-8--monetization-saramantha-17)
12. [Sección 9 — Automation & Settings](#sección-9--automation--settings)
13. [Decisiones de diseño no obvias](#decisiones-de-diseño-no-obvias)

---

## Diagrama ER (ASCII)

```
                                    ┌─────────────┐
                                    │   Tenant    │  ← clientes_plataforma (§1)
                                    │  (multi-    │
                                    │   tenant    │
                                    │    core)    │
                                    └──────┬──────┘
                                           │
              ┌────────────┬───────────────┼─────────────────┬────────────────┐
              │            │               │                 │                │
              ▼            ▼               ▼                 ▼                ▼
         ┌────────┐  ┌──────────┐   ┌───────────┐     ┌──────────┐    ┌──────────┐
         │  User  │  │ Channel  │   │ Customer  │     │ Product  │    │ Campaign │
         └───┬────┘  └────┬─────┘   └─────┬─────┘     └────┬─────┘    └────┬─────┘
             │            │               │                │               │
             │            │               │                │               │
             │            ▼               │                │               ▼
             │     ┌──────────────┐       │                │         ┌─────────┐
             │     │ Conversation │◀──────┘                │         │   Ad    │
             │     └──────┬───────┘                        │         └────┬────┘
             │            │                                │              │
             │            ▼                                │              ▼
             │     ┌──────────┐                            │       ┌──────────┐
             │     │ Message  │                            │       │ AdSpend  │
             │     └──────────┘                            │       └──────────┘
             │                                              │              │
             │                                              ▼              ▼
             │                                       ┌──────────┐  ┌──────────────┐
             │                                       │ OrderItem│  │ Attribution  │
             │                                       └────┬─────┘  └──────┬───────┘
             │                                            │               │
             │                                            ▼               │
             └───────────────────────────────────────►  Order  ◀──────────┘
                                                          │
                                  ┌───────────────────────┼────────────────────────┐
                                  │                       │                        │
                                  ▼                       ▼                        ▼
                            ┌───────────┐          ┌─────────────┐         ┌─────────────────┐
                            │ OrderEvent│          │  Shipment   │         │ CommissionEntry │
                            └───────────┘          └──────┬──────┘         └─────────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────┐
                                                   │ Carrier  │
                                                   └──────────┘

  Pricing & Discourse (§2):                   Logistics cache (§2):          Audit:
  ┌──────────────┐ ┌────────────┐              ┌────────────────┐           ┌──────────┐
  │ VolumePrice  │ │ SalesSpeech│              │  FreightQuote  │           │ AuditLog │
  └──────────────┘ └────────────┘              └────────────────┘           └──────────┘
  ┌──────────────┐ ┌────────────┐              ┌────────────────┐
  │  Objection   │ │ ThemeDesign│              │   CartSync     │
  └──────────────┘ └────────────┘              └────────────────┘
  ┌──────────────┐ ┌────────────┐
  │ CategoryCombo│ │DeliveryHist│              Vision:
  └──────────────┘ └────────────┘              ┌────────────────────┐
                                               │ImageIdentification │
  Monetization:                                └────────────────────┘
  ┌──────────┐
  │ Invoice  │
  └──────────┘

  Other:
  ┌────────────────┐ ┌──────────┐
  │ AutomationRule │ │ Setting  │
  └────────────────┘ └──────────┘
```

---

## Sección 0 — Tenant (multi-tenant core)

### `Tenant`

**Propósito**: Modelo central del multi-tenant. Cada fila representa una marca/cliente que usa CommerceFlow OS. Implementa `clientes_plataforma` del documento Saramantha §1.

**Saramantha**: §1 (multi-tenant), §2 (configuración de marca)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `id` | String @id | cuid | Identificador único |
| `slug` | String @unique | — | Slug usado en URLs y como `tenantId` FK. Ej: `saramantha` |
| `nombreNegocio` | String | — | Razón social. Ej: "ZIAY SAS" |
| `marca` | String | — | Nombre comercial. Ej: "Saramantha" |
| `plataformaCatalogo` | String | `whatsapp_catalog` | `whatsapp_catalog` \| `woocommerce` \| `shopify` \| `catalogo_propio_cliente` \| `catalogo_nuestro` |
| `bdCatalogo` | String? | `supabase_nuestro` | `supabase_cliente` \| `supabase_nuestro` \| `oracle_nuestro` |
| `credencialesCatalogoRef` | String? | — | Ref al secrets manager (no creds en claro) |
| `proveedorIa` | String | `zai` | `zai` \| `chatgpt` \| `xai` \| `ollama` |
| `credencialesIaRef` | String? | — | Ref al secrets manager |
| `proveedorLogistico` | String | `dropi` | `dropi` \| `99envios` \| `aveonline` \| `otro` |
| `credencialesLogisticaRef` | String? | — | Ref al secrets manager |
| `wabaId` | String? | — | WhatsApp Business Account ID |
| `wabaTokenRef` | String? | — | Ref al token WABA en secrets manager |
| `tonoMarca` | String? | — | Ej: "tutea, certeza total, sin disculpas" |
| `nombreAsesora` | String? | — | Ej: "Sara" |
| `politicaPago` | String? | — | Ej: "híbrido: prepay 5% off > $250k, COD debajo" |
| `preguntaPerfil` | String? | — | Ej: "¿Para ti o para surtir tu negocio?" |
| `planMonetizacion` | String | `conecta` | `conecta` \| `catalogo_incluido` \| `completo` |
| `feeBaseMensual` | Float | 0 | Fee base mensual en COP |
| `comisionPctInicial` | Float | 4.5 | % sobre GMV (tramo 1) |
| `activo` | Boolean | true | Si el tenant está activo |

**Relaciones** (1:N con 18 modelos): `User`, `Channel`, `Customer`, `Conversation`, `Product`, `Order`, `Campaign`, `Carrier`, `SalesSpeech`, `Objection`, `ThemeDesign`, `CategoryCombo`, `VolumePrice`, `DeliveryHistory`, `Shipment`, `CommissionEntry`, `CartSync`, `FreightQuote`, `Invoice`, `AuditLog`.

---

## Sección 1 — Identity & Access

### `User`

**Propósito**: Usuarios del dashboard (agentes, admins, traffickers, finance). Cada usuario pertenece a un tenant.

**Saramantha**: implícito en §1 (multi-tenant RBAC)

**Campos clave**: `id`, `tenantId` (FK Tenant), `email` (@unique), `name`, `role` (`admin` \| `agent` \| `trafficker` \| `finance`), `avatarUrl`, `createdAt`, `updatedAt`.

**Relaciones**: `Tenant` (N:1), `Conversation` (1:N vía `assigneeId` con alias `AgentConvos`), `AuditLog` (1:N).

---

## Sección 2 — Channels

### `Channel`

**Propósito**: Canales de mensajería por tenant. WhatsApp (CO primario), Messenger (intl), Instagram DM. Cada canal tiene su propia estrategia de pago.

**Saramantha**: §1 (canales soportados), §2 (estrategia de pago)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `type` | String | — | `whatsapp` \| `messenger` \| `instagram` \| `telegram` |
| `displayName` | String | — | Ej: "WhatsApp Colombia" |
| `accountId` | String? | — | ID de la cuenta en la plataforma (WABA ID, Page ID, IG Business ID) |
| `verified` | Boolean | false | Si la cuenta está verificada en Meta |
| `country` | String? | — | ISO code del país primario del canal |
| `paymentStrategy` | String | `hybrid` | `advance` \| `cod` \| `hybrid` |
| `requirePrepayMin` | Float? | — | Umbral (COP) sobre el cual se requiere prepay |
| `prepayDiscountPct` | Float? | 0 | % descuento por prepay |
| `codFee` | Float? | 0 | Costo fijo del COD |

**Relaciones**: `Tenant` (N:1), `Conversation` (1:N).

---

## Sección 3 — Customers / Contacts

### `Customer`

**Propósito**: Contactos / leads / clientes. Un customer puede tener conversaciones en múltiples canales.

**Saramantha**: §2 (perfil_detectado), §6.1 (agente de perfilamiento)

**Campos clave**: `id`, `tenantId`, `name`, `phone`, `psid` (Page-Scoped ID para Messenger), `igId` (Instagram ID), `email`, `country`, `city`, `address`, `perfilDetectado` (`mayorista` \| `emprendedor` \| `detal` \| `regalo`), `notes`, `tags`, `lifetimeValue`, `ordersCount`, `createdAt`, `updatedAt`.

**Relaciones**: `Tenant` (N:1), `Conversation` (1:N), `Order` (1:N).

---

## Sección 4 — Conversations & Messages

### `Conversation`

**Propósito**: Conversación unificada entre un customer y un tenant en un canal. Cada conversación tiene atribución (qué anuncio la trajo).

**Saramantha**: §3 (memoria semántica de conversación), §5 (atribución)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `customerId` | String | — | FK Customer |
| `channelId` | String | — | FK Channel |
| `status` | String | `open` | `open` \| `pending` \| `resolved` \| `closed` |
| `priority` | String | `normal` | `low` \| `normal` \| `high` |
| `assigneeId` | String? | — | FK User (agente asignado) |
| `lastMessageAt` | DateTime | now() | Para ordenar la bandeja |
| `unreadCount` | Int | 0 | Contador de mensajes no leídos |
| `sourceAdId` | String? | — | FK Ad (atribución) |
| `sourceCampaign` | String? | — | Nombre de la campaña |
| `utm` | String? | — | String UTM completo |
| `perfilConversacion` | String? | — | Determinado por el agente 6.1 |

**Relaciones**: `Tenant`, `Customer`, `Channel`, `User` (assignee), `Message` (1:N), `Order` (1:N).

### `Message`

**Propósito**: Mensaje individual dentro de una conversación. Incluye embedding para memoria semántica.

**Saramantha**: §3 (memoria semántica — embeddings)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `direction` | String | — | `inbound` \| `outbound` |
| `body` | String | — | Contenido del mensaje |
| `type` | String | `text` | `text` \| `image` \| `audio` \| `template` \| `order_card` \| `payment_link` |
| `mediaUrl` | String? | — | URL del archivo multimedia |
| `status` | String | `sent` | `sent` \| `delivered` \| `read` \| `failed` |
| `aiSuggested` | Boolean | false | Si fue generado por IA |
| `aiConfidence` | Float? | — | Confianza de la IA (0-1) |
| `embedding` | Bytes? | — | Embedding del mensaje (TF-hash en SQLite, `vector(1024)` en Postgres + pgvector) |

**Relaciones**: `Conversation` (N:1, cascade delete).

---

## Sección 5 — Catalog & Orders

### `Product`

**Propósito**: Catálogo de productos por tenant. Sincronizado desde la plataforma de ecommerce del tenant vía `EcommerceAdapter`.

**Saramantha**: §2 (catálogo + diseño + tema), §4 (imagen con franja metadata visible), §8 (adapters)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `sku` | String | — | SKU único por tenant (`@@unique([tenantId, sku])`) |
| `name` | String | — | Nombre del producto |
| `price` | Float | — | Precio unitario base (COP) |
| `cost` | Float | 0 | Costo (para COGS y margen) |
| `imageUrl` | String? | — | URL de la imagen principal |
| `stock` | Int | 0 | Inventario actual |
| `diseno` | String? | — | Diseño/tema. Ej: "Stitch", "Hello Kitty" |
| `categoria` | String? | — | Categoría. Ej: `familia`, `short`, `pantalon`, `batola` |
| `imagenMetadataVisible` | Boolean | true | Si la imagen tiene la franja de metadata (§4) |
| `fuenteSincronizacion` | String? | — | `whatsapp_catalog` \| `woocommerce` \| `shopify` \| `supabase_cliente` \| `supabase_nuestro` \| `oracle_nuestro` |
| `embeddingTexto` | Bytes? | — | Embedding del texto (TF-hash SQLite, `vector(768)` en PG) |
| `embeddingVisual` | Bytes? | — | Embedding visual OpenCLIP (`vector(512)` en PG) |

**Relaciones**: `Tenant` (N:1), `OrderItem` (1:N), `VolumePrice` (1:N).

### `Order`

**Propósito**: Pedido. Centro del embudo §15.1. Atribuido a un Ad y origen tracked para monetización.

**Saramantha**: §2 (imagen_referencia_url, origen), §5 (atribución), §10 (Kanban), §15.1 (embudo), §17.6 (origen para monetización)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `number` | String @unique | — | Número legible. Ej: `CF-100239` |
| `customerId` | String | — | FK Customer |
| `conversationId` | String? | — | FK Conversation (si viene de mensajería) |
| `channelId` | String? | — | FK Channel |
| `status` | String | `new` | Uno de 8 estados del embudo §15.1 |
| `paymentMode` | String | — | `advance` \| `cod` \| `hybrid` |
| `paymentStatus` | String | `unpaid` | `unpaid` \| `paid` \| `refunded` |
| `subtotal` | Float | — | Subtotal antes de descuentos |
| `discount` | Float | 0 | Descuento aplicado |
| `shipping` | Float | 0 | Costo de envío |
| `codFee` | Float | 0 | Costo fijo COD |
| `total` | Float | — | Total final |
| `currency` | String | `COP` | Moneda ISO |
| `country` | String? | — | País de entrega |
| `city` | String? | — | Ciudad de entrega |
| `address` | String? | — | Dirección de entrega |
| `imagenReferenciaUrl` | String? | — | Imagen enviada por el cliente (VLM-detected) |
| `origen` | String | `agente_whatsapp` | `agente_whatsapp` \| `carrito_web` \| `otro` (CRITICAL §17.6) |
| `sourceAdId` | String? | — | FK Ad (atribución) |
| `sourceCampaign` | String? | — | Nombre de la campaña |
| `sourcePlatform` | String? | — | `meta` \| `google` \| `tiktok` |
| `clickId` | String? | — | `fbclid` \| `gclid` \| `ttclid` |
| `attributedAt` | DateTime? | — | Cuándo se atribuyó |
| `paymentGateway` | String? | — | `wompi` \| `mercadopago` \| `stripe` \| ... |
| `paymentRef` | String? | — | ID de transacción en el gateway |
| `paidAt` | DateTime? | — | Cuándo se pagó |

**Relaciones**: `Tenant`, `Customer`, `Conversation`, `Ad` (sourceAd), `OrderItem` (1:N), `OrderEvent` (1:N), `Shipment` (1:N), `CartSync` (1:N), `CommissionEntry` (1:N).

### `OrderItem`

**Propósito**: Items individuales de un pedido. Incluye `diseno` (variante de diseño por item).

**Campos clave**: `orderId`, `productId`, `name` (denormalizado), `unitPrice`, `cost`, `quantity`, `diseno`.

**Relaciones**: `Order` (N:1, cascade delete), `Product` (N:1).

### `OrderEvent`

**Propósito**: Log de eventos del pedido (created, paid, shipped, delivered, cancelled, refunded, cod_pending).

**Campos clave**: `orderId`, `type`, `note`, `createdAt`.

**Relaciones**: `Order` (N:1, cascade delete).

---

## Sección 5.1 — Pricing & Discourse (Saramantha §2)

### `VolumePrice`

**Propósito**: Precios por volumen por tenant. Permite al agente de cotización (§6.3) calcular el precio según `tipoCliente` y `cantidad`.

**Saramantha**: §2 (precios_por_volumen), §6.3 (agente de cotización)

**Campos clave**: `tenantId`, `productId`, `sku` (denormalizado), `tipoCliente` (`mayorista` \| `emprendedor` \| `detal` \| `regalo`), `cantidadMinima`, `cantidadMaxima`, `precioUnitario`.

**Unique**: `@@unique([tenantId, productId, tipoCliente, cantidadMinima])`

**Relaciones**: `Tenant` (N:1), `Product` (N:1).

### `SalesSpeech`

**Propósito**: Discurso de apertura por perfil. El agente 6.2 lo usa para abrir la conversación según el perfil detectado.

**Saramantha**: §2 (discursos_por_perfil), §6.2 (agente de discurso)

**Campos clave**: `tenantId`, `perfil`, `aperturaTexto`, `pruebaSocial`.

**Unique**: `@@unique([tenantId, perfil])`

### `Objection`

**Propósito**: Respuestas a objeciones por tipo. El agente 6.6 lo usa para manejar objeciones comunes con gatillos mentales asociados.

**Saramantha**: §2 (objeciones), §6.6 (agente de objeciones), §18.2 (caso especial tallas S-L)

**Campos clave**: `tenantId`, `tipoObjecion` (`desconfianza` \| `precio` \| `talla` \| `lo_pienso` \| `producto_no_disponible`), `respuestaBase`, `gatilloMentalAsociado`.

**Unique**: `@@unique([tenantId, tipoObjecion])`

### `ThemeDesign`

**Propósito**: Temas de diseño por tenant (Stitch, Hello Kitty, etc.). El agente 6.5 lo usa para encontrar todas las prendas de un tema.

**Saramantha**: §2 (temas_diseño), §6.5 (agente de tema)

**Campos clave**: `tenantId`, `tema`, `nombreDiseno`, `skusAsociados` (comma-separated, SQLite no tiene arrays).

**Unique**: `@@unique([tenantId, tema])`

### `CategoryCombo`

**Propósito**: Combos de categoría. Mínimo 3 prendas distintas por categoría (regla Saramantha §6.4).

**Saramantha**: §2 (combos_categoria), §6.4 (agente de catálogo visual-primero)

**Campos clave**: `tenantId`, `categoria` (`familia`, `short`, etc.), `skusRecomendados` (comma-separated).

**Unique**: `@@unique([tenantId, categoria])`

### `DeliveryHistory`

**Propósito**: Historial de entrega por dirección normalizada. El agente 6.7 lo consulta antes de confirmar el pedido.

**Saramantha**: §2 (historial_entrega_direccion), §6.7 (agente de dirección)

**Campos clave**: `tenantId`, `contactoId`, `direccionNormalizada`, `ciudad`, `departamento`, `resultadoEntregaAnterior` (`ok` \| `rechazo` \| `novedad`).

### `ImageIdentification`

**Propósito**: Identificaciones visuales persistentes. El agente 6.9 guarda aquí cada identificación de producto por imagen.

**Saramantha**: §2 (identificaciones_imagen), §6.9 (agente de visión), §4 (pipeline OCR+CLIP)

**Campos clave**: `tenantId`, `contactoId`, `imagenUrl`, `skuDetectado`, `metodo` (`ocr` \| `openclip` \| `vlm` \| `manual`), `confianza` (0-1), `createdAt`.

---

## Sección 6 — Ad Attribution

### `AdPlatform`

**Propósito**: Plataforma de pauta (Meta, Google, TikTok). NO es multi-tenant — es shared config.

**Campos clave**: `name` @unique (`meta` \| `google` \| `tiktok`), `displayName`, `accountId`, `accessToken`, `active`.

**Relaciones**: `Campaign` (1:N).

### `Campaign`

**Propósito**: Campañas de pauta por tenant y plataforma.

**Campos clave**: `tenantId`, `platformId`, `externalId` (ID en la plataforma), `name`, `objective`, `budgetDaily`, `currency`, `status`, `country`.

**Relaciones**: `Tenant` (N:1), `AdPlatform` (N:1), `Ad` (1:N).

### `Ad`

**Propósito**: Anuncio individual. Centro del motor de atribución y verdicts.

**Saramantha**: §5 (atribución), §5.1 (verdicts + kill-switch)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `campaignId` | String | — | FK Campaign |
| `externalId` | String @unique | — | ID del anuncio en la plataforma |
| `name` | String | — | Nombre del anuncio |
| `creative` | String? | — | URL o ID del creative |
| `status` | String | `active` | `active` \| `paused` \| `killed` |
| `autoKill` | Boolean | false | Si el kill-switch lo marcó |
| `killReason` | String? | — | Motivo del auto-kill |

**Relaciones**: `Campaign` (N:1), `AdSpend` (1:N), `Attribution` (1:N), `Order` (1:N vía `sourceAdId`).

### `AdSpend`

**Propósito**: Métricas diarias de spend/impressions/clicks por anuncio. Una fila por anuncio por día.

**Campos clave**: `adId`, `date`, `spend`, `impressions`, `clicks`, `convReported` (conversiones reportadas por la plataforma).

**Unique**: `@@unique([adId, date])`

### `Attribution`

**Propósito**: Atribución de un pedido a un anuncio. Soporta multi-touch (un pedido puede tener múltiples `Attribution` con diferentes `weight`).

**Saramantha**: §5 (atribución), §5.2 (multi-touch attribution)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `orderId` | String | — | FK Order |
| `adId` | String | — | FK Ad |
| `weight` | Float | 1.0 | Peso del touch (varía por modelo) |
| `model` | String | `last_click` | Modelo de atribución usado |
| `touch` | String? | — | Info del touchpoint (`fbclid`, `gclid`, `ttclid`) |

**Relaciones**: `Ad` (N:1).

---

## Sección 7 — Logistics

### `Carrier`

**Propósito**: Carriers canónicos por tenant. Normaliza las 6 variantes de "Interrapidísimo" (Saramantha §15.2).

**Saramantha**: §15.2 (normalización de carriers)

**Campos clave**: `tenantId`, `nombreCanonico` (ej: "Interrapidísimo"), `variantes` (comma-separated: "Interrapidisimo,interrapidisimo,Interrapidicimo,..."), `cobertura` (`nacional` \| `internacional`).

**Unique**: `@@unique([tenantId, nombreCanonico])`

### `Shipment`

**Propósito**: Envío de un pedido. Generado por el agente 6.8 / 6.10 vía `LogisticsAdapter.generarGuia`.

**Saramantha**: §2 (envíos), §6.8 (agente logística), §6.10 (checkout side-effect)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `orderId` | String | — | FK Order |
| `proveedor` | String | — | `dropi` \| `99envios` \| `aveonline` |
| `numeroGuia` | String? | — | Tracking number real |
| `urlSeguimiento` | String? | — | URL pública de tracking |
| `transportadora` | String? | — | Nombre raw del proveedor |
| `transportadoraCanonica` | String? | — | Normalizada vía `Carrier` |
| `tarifa` | Float | 0 | Costo del envío |
| `tiempoEstimadoDias` | Int? | — | ETA |
| `estado` | String | `generada` | `generada` \| `en_transito` \| `entregada` \| `novedad` \| `devuelta` |
| `novedad` | String? | — | Descripción de la novedad |

### `CartSync`

**Propósito**: Sincronización bidireccional del pedido entre CommerceFlow y la plataforma de ecommerce del tenant.

**Saramantha**: §2 (carrito_sync)

**Campos clave**: `tenantId`, `orderId`, `plataformaDestino` (`woocommerce` \| `shopify` \| `whatsapp_catalog` \| `supabase` \| `oracle`), `orderIdExterno`, `estadoSincronizacion` (`pendiente` \| `sincronizado` \| `error`), `ultimoError`.

### `FreightQuote`

**Propósito**: Caché de cotizaciones reales de flete por proveedor logístico y ciudad.

**Saramantha**: §2 (cotizaciones_flete)

**Campos clave**: `tenantId`, `proveedor`, `ciudad`, `pais`, `cantidadUnidades`, `tarifa`, `tiempoEstimadoDias`, `transportadora`, `fechaActualizacion`.

**Unique**: `@@unique([tenantId, proveedor, ciudad, pais, cantidadUnidades])`

---

## Sección 8 — Monetization (Saramantha §17)

### `CommissionEntry`

**Propósito**: Comisión por pedido con 2 momentos de reconocimiento (50% a `datos_completados`, 100% a `despachado`).

**Saramantha**: §17 (monetización), §17.6 (origen del pedido — solo `agente_whatsapp` y `carrito_web` reconocen comisión)

**Campos clave**:

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `orderId` | String | — | FK Order |
| `gmv` | Float | — | `order.total` al momento de confirmación |
| `comisionPct` | Float | — | % aplicado (ej: 4.5, 3.0, 1.75 según tramo) |
| `comisionTotal` | Float | — | `gmv * pct / 100` |
| `reconocidaPct` | Float | 50 | 50 a `datos_completados`, 100 a `despachado` |
| `reconocidaMonto` | Float | — | `comisionTotal * reconocidaPct / 100` |
| `etapaReconocimiento` | String? | — | `datos_completados` \| `despachado` |
| `reconocidaAt` | DateTime? | — | Cuándo se reconoció |

### `Invoice`

**Propósito**: Facturación mensual por tenant. Generada con tramo aplicado.

**Saramantha**: §17 (monetización)

**Campos clave**: `tenantId`, `periodo` (ej: `2026-07`), `gmvTotal`, `feeBase`, `comisionTotal`, `tramoAplicado` (`0-10M` \| `10-40M` \| `40M+`), `total` (`feeBase + comisionTotal`), `estado` (`borrador` \| `emitida` \| `pagada`), `emitidaAt`, `pagadaAt`.

---

## Sección 9 — Automation & Settings

### `AutomationRule`

**Propósito**: Reglas de automatización por tenant. Trigger + condition + action.

**Campos clave**: `tenantId?`, `name`, `trigger` (`new_conversation` \| `keyword` \| `order_created` \| `ad_underperforming`), `condition`, `action` (`auto_reply` \| `tag` \| `assign` \| `pause_ad` \| `notify`), `active`.

### `Setting`

**Propósito**: Key-value store global para configuraciones como umbrales.

**Campos clave**: `key` @unique, `value`.

**Keys usadas**: `roas_kill_threshold`, `cpa_target`.

### `AuditLog`

**Propósito**: Log de auditoría. Toda acción sensible escribe aquí.

**Saramantha**: §16.4 (audit)

**Campos clave**: `tenantId?`, `userId?`, `action`, `entity`, `entityId?`, `meta`, `createdAt`.

**Actions logueadas**: `ad.kill`, `ad.pause`, `ad.scale`, `webhook.wa.inbound`, `webhook.meta.inbound`, `webhook.nocodb.in`, `shipment.guide.generated`, `catalog.sync`, `commission.recognized.50`, `commission.recognized.100`, `tenant.created`.

---

## Decisiones de diseño no obvias

### 1. SQLite no tiene enums → String + constantes

SQLite (dev) no soporta `enum` nativo. Usamos `String` con valores constantes documentados en comentarios. En Postgres prod, el schema usa también `String` (no enum) para mantener portabilidad — los valores se validan en código TypeScript.

### 2. SQLite no tiene arrays → comma-separated strings

Tablas como `Carrier.variantes`, `ThemeDesign.skusAsociados`, `CategoryCombo.skusRecomendados` usan strings comma-separated. En Postgres prod podríamos migrar a `String[]`, pero decidimos mantener el formato para simplificar.

### 3. Embeddings como `Bytes` (SQLite) → `Unsupported("vector(N)")` (Postgres)

- **SQLite dev**: `embedding Bytes?` (almacenamos el Float32Array serializado).
- **Postgres prod**: `embedding Unsupported("vector(1024)")` — el cliente Prisma no puede leer/escribir directamente, usamos `$queryRaw` con la función SQL `semantic_memory_search_vec`.

### 4. `Tenant.id` vs `Tenant.slug`

`id` es el cuid interno (FK value en otras tablas). `slug` es el identificador público usado en URLs y referencias humanas. Ambos son `@unique`. La convención es `id` = `ten-saramantha`, `slug` = `saramantha`.

### 5. `Order.status` usa los 8 valores del embudo §15.1 (no estados genéricos)

En vez de estados genéricos (`pending` / `shipped` / `delivered`), usamos los 8 estados exactos del embudo Kanban del documento Saramantha §15.1: `llamar_para_confirmar`, `intento_cancelacion`, `datos_completados`, `oficina`, `programado`, `despachado`, `novedad`, `devuelto`. Esto permite que el Kanban sea una vista directa del `Order.status`.

### 6. `Order.origen` es CRITICAL para monetización (§17.6)

Solo los pedidos con `origen='agente_whatsapp'` o `origen='carrito_web'` generan comisión. El campo se setea automáticamente al crear el pedido vía agente (siempre `agente_whatsapp`) o vía webhook del carrito web (siempre `carrito_web`). Esto previene que pedidos importados manualmente generen comisión indebidamente.

### 7. `AdPlatform` no es multi-tenant

A diferencia del resto, `AdPlatform` (Meta, Google, TikTok) y `Setting` son globales. Esto es porque las credenciales de API de plataforma son compartidas (con un system user token), aunque las `Campaign` y `Ad` se filtran por `tenantId`.

### 8. `Customer` desnormaliza `perfilDetectado` y `ordersCount`

Estos campos viven en `Customer` (snapshot) y también se pueden derivar de `Conversation.perfilConversacion` y `Order[]`. La desnormalización es para performance (no hacer JOIN en cada query de la bandeja). El agente 6.1 actualiza ambos al detectar el perfil.

### 9. `Shipment.transportadora` vs `transportadoraCanonica`

`transportadora` es el nombre raw devuelto por el proveedor (puede ser "interrapidicimo" con typos). `transportadoraCanonica` es el nombre normalizado vía `normalizeCarrierName(tenantId, rawName)` consultando la tabla `Carrier`. Ambos se persisten para auditoría.

### 10. `AdSpend.convReported` vs `Order.count` real

`AdSpend.convReported` es lo que Meta/Google/TikTok reportan como conversiones. `Order` con `sourceAdId = X` es la realidad. La diferencia entre ambos es lo que detecta la canibalización (plataforma reporta conversiones que no generaron pedidos reales).

---

## Migración SQLite → Postgres + pgvector

El schema Postgres está en `prisma/postgres/schema.postgres.prisma`. Diferencias clave:

| Campo | SQLite | Postgres |
|-------|--------|----------|
| `Message.embedding` | `Bytes?` | `Unsupported("vector(1024)")` |
| `Product.embeddingTexto` | `Bytes?` | `Unsupported("vector(768)")` |
| `Product.embeddingVisual` | `Bytes?` | `Unsupported("vector(512)")` |
| `datasource provider` | `sqlite` | `postgresql` |
| Extensions | (none) | `["vector", "pgcrypto"]` |

### Setup Postgres

```bash
# 1. Crear DB y extensiones
psql -U commerceflow -d commerceflow -f prisma/sql/pgvector-setup.sql

# 2. Aplicar políticas RLS
psql -U commerceflow -d commerceflow -f prisma/sql/rls-policies.sql

# 3. Migrar el schema
prisma migrate deploy --schema prisma/postgres/schema.postgres.prisma

# 4. Backfill de embeddings (convertir Bytes → vector)
# El script hace INSERT INTO con $queryRaw usando la conversión bytea→vector
```

📖 Ver [`DEVELOPMENT.md`](./DEVELOPMENT.md) y [`PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md) para más detalles de migración.
