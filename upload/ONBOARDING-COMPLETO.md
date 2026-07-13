# Onboarding Completo — ZIAY

> **La guía definitiva para operar, desarrollar y administrar ZIAY** — el centro de mando de commerce conversacional + atribución de pauta para LATAM, construido por y para **Indisutex SAS** (Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina).
>
> **Versión 2.0** — sincronizada con `worklog.md` tras `AUTOFIX-A + REPORT-001`. Reemplaza la versión 1.0.
> **Audiencia:** admin tenant, agente de ventas, operador logístico, trafficker, marketing, desarrolladores, dueños de marca.
> **Idioma:** español LATAM neutral (tuteo, sin regionalismos). Foco Colombia.
> **Tiempo objetivo:** < 1 día para estar productivo.

---

## Tabla de contenidos

1. [Bienvenida](#1-bienvenida)
2. [Arquitectura del producto](#2-arquitectura-del-producto)
3. [Conceptos clave](#3-conceptos-clave)
4. [Onboarding por rol](#4-onboarding-por-rol)
5. [Tour por los 14 módulos del dashboard](#5-tour-por-los-14-módulos-del-dashboard)
6. [Los 26 agentes conversacionales](#6-los-26-agentes-conversacionales)
7. [Los 3 pipelines de orquestación](#7-los-3-pipelines-de-orquestación)
8. [Flujo de un pedido (embudo §15.1)](#8-flujo-de-un-pedido-embudo-151)
9. [Flujo de una novedad](#9-flujo-de-una-novedad)
10. [Flujo de un retiro (2FA)](#10-flujo-de-un-retiro-2fa)
11. [Integraciones disponibles](#11-integraciones-disponibles)
12. [Páginas públicas SSR (SEO)](#12-páginas-públicas-ssr-seo)
13. [FAQ (22 preguntas frecuentes)](#13-faq-22-preguntas-frecuentes)
14. [Glosario (34 términos)](#14-glosario-34-términos)

---

## 1. Bienvenida

Bienvenido al equipo de **ZIAY**. Esta es la plataforma que conecta los chats de WhatsApp, Messenger e Instagram con los anuncios de Meta, Google y TikTok — y te dice, con precisión **pedidos-por-anuncio**, cuál pauta vende de verdad y cuál solo consume presupuesto.

### Por qué existe

Indisutex SAS opera cuatro marcas en Colombia (Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina) y atiende también a clientes externos con catálogos propios. Cada marca vende por WhatsApp y hace pauta en Meta/Google/TikTok. Antes de ZIAY, no había manera de reconciliar las conversiones que reportan las plataformas (Meta cuenta un "lead" como conversión) con la caja real del cliente (el pedido se confirma 2 días después por WhatsApp). El resultado: traffickers escalando anuncios que no vendían, financistas sin visibilidad del GMV real, y operadores ahogados en 3 bandejas de chat distintas.

ZIAY resuelve esto unificando todo en un dashboard multi-tenant, capturando el `fbclid` / `gclid` / `ttclid` en el primer contacto, propagándolo por el embudo conversacional, y escribiendo un `Attribution` row al cerrar el pedido.

### Qué vas a lograr

Al terminar este onboarding vas a ser capaz de:

- Navegar los **14 módulos** del dashboard y saber qué hace cada uno.
- Invocar los **26 agentes** conversacionales en el momento correcto.
- Entender los **3 pipelines** (pre-venta, post-venta, inteligencia) y cuándo dispararlos.
- Operar el Kanban de **8 columnas** del embudo §15.1.
- Crear y resolver una novedad logística.
- Solicitar un retiro de wallet con 2FA TOTP.
- Conectar un canal nuevo (WhatsApp, Messenger, Instagram).
- Conectar una plataforma de pauta (Meta, Google, TikTok).
- Configurar webhooks de pago (MercadoPago, Wompi, Stripe, PayU).
- Resolver los 22 problemas más comunes sin escalar a soporte.

### Tiempo estimado por rol

| Rol | Tiempo | Secciones |
|-----|--------|-----------|
| Agente de ventas | 2 h | 1, 2, 3, 5 (módulos 2,3,6), 6, 7 |
| Operador logístico | 2 h | 1, 2, 3, 5 (módulos 5,10,12), 8, 9 |
| Trafficker | 2 h | 1, 2, 3, 5 (módulos 7,9), 10 |
| Marketing | 1.5 h | 1, 2, 3, 5 (módulos 1,7,8), 11 |
| Admin tenant | 3 h | Todo, foco en 4 (Admin) y 5 (módulo 14) |
| Desarrollador | 4 h | Todo + lectura de `README.md` y `AUDIT-REPORT.md` |

---

## 2. Arquitectura del producto

### 2.1 Diagrama

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL WORLD                                  │
│  Meta Ads (fbclid) · Google Ads (gclid) · TikTok Ads (ttclid)                │
│  WhatsApp · Messenger · Instagram DM                                         │
│  MercadoPago · Wompi · Stripe · PayU                                         │
└─────────────────────────────┬────────────────────────────────────────────────┘
                              │  (click_id en URL wa.me/?text=)
                              │  (webhooks entrantes con HMAC)
                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CADDY  (TLS · WebSocket · HTTP/2)                     │
│                        :80 / :443  →  :3000 + :3003                          │
└─────────────────────────────┬────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│   Next.js 16  (app, :3000)   │  │  chat-service  (:3003)        │
│   ─ 5 SSR pages              │  │  Socket.io + Redis adapter    │
│   ─ 44 API routes            │  │  Rooms por tenantId           │
│   ─ 14 dashboard views (SPA) │◄─┤  Auth: socket.auth.tenantId   │
└─────────────┬────────────────┘  └──────────────┬───────────────┘
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DOMAIN LAYER                                    │
│  26 agents (src/lib/agents/prompts.ts)                                       │
│  3 pipelines × 19 steps (src/lib/orchestrator/constants.ts)                  │
│  18 adapters + 2 registries (src/lib/adapters/)                              │
│  LLM adapter (ZAI/OpenAI/xAI/Ollama) · VLM · pgvector embeddings             │
│  RLS policies (src/lib/rls.ts) · TOTP 2FA (src/lib/totp.ts)                  │
│  Rate limiter + HMAC verifier (src/lib/middleware/)                          │
└─────────────────────────────┬────────────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│   Prisma 6  →  SQLite (dev)  /  PostgreSQL 16 + pgvector (prod)              │
│   62 models · 91 @@index · 13 @@unique · schema de 1442 líneas               │
└──────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│   z-ai-web-dev-sdk  →  LLM (chat) + VLM (image) — provider default           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Explicación

ZIAY es una **aplicación híbrida SSR + SPA** construida sobre Next.js 16. El dashboard principal (`/`) es una SPA que cambia de vista en cliente (14 módulos), pero las páginas públicas de tenant y producto son **SSR** para SEO. El backend expone **44 rutas de API** dentro del mismo proceso Next.js, y un **mini-service Socket.io** separado (puerto 3003) maneja el tiempo real de mensajería.

La base de datos es **SQLite en desarrollo** y **PostgreSQL 16 + pgvector en producción**. El schema Prisma es portable — solo cambia el `DATABASE_URL`. Hay **62 modelos** que cubren desde `Tenant` hasta `NovedadCase` y `RedeliveryRequest`.

La IA conversacional usa **z-ai-web-dev-sdk** por defecto (no requiere API key en dev), pero cada tenant puede configurar su propio `proveedorIa` (`zai`, `openai`, `xai`, `ollama`).

La seguridad se aplica en **3 capas**: guards de tenant en las API routes (16 rutas), RLS en Postgres (políticas SQL por `tenantId`) y rate limiting + HMAC verification en webhooks.

---

## 3. Conceptos clave

Antes de tocar el teclado, estos **9 conceptos** aparecen en cada pantalla. Si los dominas, el 80% del dashboard se vuelve obvio.

| # | Concepto | Definición | Analogía |
|---|----------|-----------|----------|
| 1 | **Tenant** | Marca/empresa aislada con su propio catálogo, canales, usuarios y datos. Identificada por `tenantId` (ej: `ten-saramantha`) y `slug` (ej: `saramantha`). | Cada tenant es un apartamento en el mismo edificio: comparten plomería pero no se cruzan. |
| 2 | **Agente conversacional** | Función IA especializada en un momento de la conversación (perfilamiento, cotización, objeciones…). Hay 26 agentes distribuidos en 3 pipelines. | Un empleado experto en UNA sola tarea. |
| 3 | **Conversación** | Thread de mensajes entre un comprador y la marca, en un canal (WhatsApp, Messenger, IG). Cada conversación tiene `customer`, `channel`, `assignedAgent` y opcionalmente `sourceAdId`. | Una conversación de WhatsApp tal cual la ves en tu teléfono, pero con metadata. |
| 4 | **Pedido (Order)** | Orden de compra con items, total, modo de pago (`advance`, `cod`, `hybrid`), dirección y estado del embudo §15.1 (8 estados). | La orden de compra que firmó el cliente al cerrar la venta. |
| 5 | **Novedad** | Incidencia logística (paquete dañado, no entregado, dirección errada…). Se crea un `NovedadCase` con número `NV-2026-XXXXX`, evidencias y escalación humana obligatoria. | Un ticket de soporte logístico con fotos y trazabilidad. |
| 6 | **Redelivery** | Reintento de entrega de una guía que fue devuelta. Máximo 3 intentos. 7 motivos posibles. Siempre requiere acción humana. | El motero que vuelve a intentar la entrega porque no estaba el cliente. |
| 7 | **Wallet** | Balance del trafficker en COP. Incluye comisiones ganadas, retiros solicitados, ledger completo. Los retiros requieren 2FA TOTP. | La cuenta de ahorros del trafficker dentro de ZIAY. |
| 8 | **Trafficker** | Affiliate que invierte presupuesto en pauta para productos del marketplace. Cobra comisión solo por ventas **confirmadas** (entregadas). Si el vendedor falla, recibe compensación automática. | Un inversor que banca la pauta y cobra si vende. |
| 9 | **Atribución** | Conexión entre un `Order` y el `Ad` que trajo al cliente. Calculada desde el `fbclid` / `gclid` / `ttclid` capturado en el primer mensaje. Alimenta el motor de veredictos (scale / optimize / watch / pause / kill / cannibalize). | El árbitro que decide qué vendedor se lleva la comisión. |

**Comisiones escalonadas por GMV**: plan `conecta` cobra 4.5% sobre GMV en el tramo 1, bajando a 3.5% / 2.5% / 1.5% en tramos superiores. Configurable por tenant en `Tenant.comisionPctInicial`.

---

## 4. Onboarding por rol

### 4.1 Admin Tenant

**Responsabilidad**: configurar la marca, canales, catálogo, agentes y estrategia de pago del tenant.

**Tareas del primer día**:

1. **Configurar marca** (módulo 14 → Configuración):
   - Tono de marca (`Tenant.tonoMarca`): "tutea, certeza total, sin disculpas".
   - Nombre de asesora (`Tenant.nombreAsesora`): "Sara".
   - Política de pago (`Tenant.politicaPago`): "híbrido: prepay 5% off > $250k, COD debajo".
   - Pregunta de perfil (`Tenant.preguntaPerfil`): "¿Para ti o para surtir tu negocio?".
2. **Conectar canales** (módulo 14 → Canales):
   - WhatsApp Business: ingresa WABA ID + token.
   - Messenger: ingresa Page ID + token.
   - Instagram: ingresa Business Account ID + token.
3. **Configurar catálogo** (módulo 14 → Catálogo):
   - Seleccionar `plataformaCatalogo`: `whatsapp_catalog` | `woocommerce` | `shopify` | `catalogo_propio_cliente` | `catalogo_nuestro`.
   - Si es externo (Woo/Shopify/Supabase), ingresar credenciales.
4. **Configurar agentes** (módulo 14 → Agentes):
   - Seleccionar `proveedorIa`: `zai` (default) | `openai` | `xai` | `ollama`.
   - Si es OpenAI/xAI, ingresar API key.
5. **Configurar estrategia de pago** (módulo 14 → Pagos):
   - Por canal y país: `advance` (anticipado) | `cod` (contra entrega) | `hybrid`.
   - Conectar pasarelas: MercadoPago, Wompi, Stripe, PayU.
6. **Crear usuarios** (módulo 14 → Usuarios):
   - Roles: `admin` | `agent` | `trafficker` | `finance`.
7. **Verificar** (módulo 13 → Integraciones): todos los adapters en verde.

### 4.2 Agente de ventas

**Responsabilidad**: responder conversaciones, cerrar pedidos, usar los agentes IA correctos.

**Tareas del primer día**:

1. Abrir módulo **Mensajería** (módulo 2).
2. Seleccionar una conversación sin asignar → click **Asignarme**.
3. Usar el dropdown de agentes (esquina superior derecha del thread) para invocar:
   - `profile` → detectar perfil del cliente (mayorista/detal/regalo).
   - `speech` → generar discurso de apertura por perfil.
   - `catalog` → responder con imagen (visual-primero).
   - `quote` → cotización con precio por volumen.
   - `objection` → manejar objeciones con gatillos mentales.
   - `address` → recolectar 10 campos + validar.
   - `checkout` → cerrar pedido + sync ecommerce + generar guía.
4. Cuando el pedido esté confirmado, moverlo en el **Kanban** (módulo 5) de `pending_confirmation` → `datos_completados`.
5. Usar **Catálogo Visual** (módulo 3) para mostrar productos con chat IA embebido.

### 4.3 Operador logístico

**Responsabilidad**: mover pedidos por el embudo, gestionar novedades, agendar reintentos.

**Tareas del primer día**:

1. Abrir módulo **Kanban operativo** (módulo 5).
2. Para pedidos en `datos_completados`: verificar dirección + generar guía (`POST /api/shipping/guide`).
3. Mover a `despachado` → `en_transito` (webhook de transportadora actualiza automáticamente).
4. Cuando llegue `en_transito`, monitorear `entregado` o `devuelto`.
5. Si `devuelto`: abrir módulo **Novedades** (módulo 12) → tab Reintentos → crear solicitud de redelivery.
6. Para incidencias (daño, no entregado): tab Casos → crear `NovedadCase` → escalar a humano.
7. Usar **Inteligencia Logística** (módulo 10) para ver scores por carrier y recomendación por ciudad.
8. Tab Historial de Guía para trazar un número de guía específico.

### 4.4 Trafficker

**Responsabilidad**: invertir presupuesto en pauta, monitorear ROAS, retirar ganancias.

**Tareas del primer día**:

1. Abrir módulo **Atribución de Pauta** (módulo 7).
2. Revisar la tabla por anuncio: 19 métricas + 6 veredictos.
3. Para anuncios en `scale`: subir presupuesto en Meta/Google/TikTok directamente (ZIAY no ejecuta la subida, solo recomienda).
4. Para anuncios en `kill` o `cannibalize`: ejecutar kill-switch con botón en la fila → audit log automático.
5. Abrir módulo **Wallet** (módulo 9):
   - Ver balance disponible.
   - Ver comisiones ganadas (por GMV de los pedidos atribuidos a tus anuncios).
   - Para retirar: click **Solicitar retiro** → ingresa monto → ingresa código TOTP (de app Authenticator) → confirmar.
6. El retiro queda en estado `pending` hasta que finanzas lo procese.

### 4.5 Marketing

**Responsabilidad**: medir ROAS/CPA/ROI, detectar canibalización, optimizar pauta.

**Tareas del primer día**:

1. Abrir módulo **Resumen** (módulo 1) para KPIs agregados (revenue, ROAS, CPA, ROI, AOV, CTR).
2. Abrir módulo **Atribución de Pauta** (módulo 7) para análisis por anuncio.
3. Comparar `convReported` (lo que dice Meta) vs `orderCount` (pedidos reales atribuidos) → detectar canibalización.
4. Abrir módulo **Monetización** (módulo 8) para GMV por período y comisiones escalonadas.
5. Configurar webhooks de conversión (CAPI) en `/api/conversions` para enviar eventos a Meta/Google/TikTok.

---

## 5. Tour por los 14 módulos del dashboard

Todos los módulos están en una sola ruta (`/`) y se cambian vía el sidebar izquierdo o atajos de teclado (⌘1-14, ⌘K para command palette).

### 5.1 Resumen (overview)

**Qué hace**: dashboard ejecutivo con KPIs agregados.

**Componentes**:
- 6 tarjetas de KPI: revenue, ROAS, CPA, ROI, AOV, CTR.
- Gráfica de área: revenue vs spend (últimos 14/30/90 días).
- Barras: split por canal (WhatsApp / Messenger / IG).
- Pie: distribución por modo de pago (anticipado / COD / híbrido).
- Summary cards: total conversaciones, pedidos, tickets promedio.

**Endpoint**: `GET /api/overview?tenantId=X&days=14`.

### 5.2 Mensajería (messenger)

**Qué hace**: bandeja unificada 3-columnas para WhatsApp, Messenger e Instagram.

**Layout**:
- **Columna izquierda**: lista de conversaciones con badges de canal, avatar, último mensaje, timestamp, indicador de no leído.
- **Columna central**: thread de mensajes con burbujas, soporta texto, imágenes, audio (transcripción pendiente).
- **Columna derecha**: panel del cliente con datos, historial de pedidos, atribución (anuncio que trajo al cliente).

**Features clave**:
- Smart reply con LLM (botón "💡 Sugerir respuesta").
- Dropdown de 26 agentes para invocar manualmente.
- Socket.io live: nuevos mensajes llegan sin refresh.
- Simulated customer auto-reply para demos (sin celular real).

**Endpoint**: `GET /api/conversations?tenantId=X`, `GET /api/conversations/[id]?tenantId=X`.

### 5.3 Catálogo Visual (catalog)

**Qué hace**: navegador de productos con imágenes grandes + chat IA contextual.

**Layout**:
- Grid/list toggle de productos con thumbnails.
- Filtros: búsqueda, diseño, categoría, ordenamiento.
- Click en producto → Dialog con imagen grande + panel derecho de chat IA.

**Chat IA contextual**: la IA sabe qué producto estás viendo. Botones rápidos: Cotizar, Catálogo, Tema, Objeciones, Logística.

**Acción**: "Enviar a chat" → envía el producto a una conversación existente de mensajería.

**Endpoint**: `GET /api/catalog/products?tenantId=X`, `POST /api/catalog/send-to-chat`.

### 5.4 Pedidos & Pagos (orders)

**Qué hace**: tabla de pedidos con modo de pago y estado del workflow.

**Columnas**: ID, cliente, total, modo de pago (`advance`/`cod`/`hybrid`), estado del embudo, atribución (anuncio/campaña), fecha.

**Acciones**: click en fila → detalle. Cambio de estado vía PATCH (tenant-guarded).

**Strategy explainer**: 3 cards que explican la estrategia de pago por canal y país.

**Endpoint**: `GET /api/orders?tenantId=X`, `PATCH /api/orders/[id]`.

### 5.5 Kanban operativo (kanban)

**Qué hace**: tablero drag & drop de 8 columnas según el embudo §15.1.

**Columnas**:
1. `pending_confirmation` — Pendiente confirmación
2. `datos_completados` — Datos completados
3. `intent_cancelacion` — Intento de cancelación
4. `oficina` — En oficina
5. `despachado` — Despachado
6. `en_transito` — En tránsito
7. `entregado` — Entregado
8. `devuelto` — Devuelto

**Comportamiento**: arrastrar una card entre columnas dispara `PATCH /api/orders/[id]` con `{ status: 'nuevo_estado' }`. Mover a `entregado` calcula comisión automáticamente.

### 5.6 Orquestador (orchestrator)

**Qué hace**: visualiza y ejecuta los 3 pipelines (19 pasos totales).

**UI**: 3 tabs (Pre-venta / Post-venta / Inteligencia). Cada pipeline muestra sus pasos en secuencia con emoji + label + descripción.

**Ejecución**: click en un paso → POST `/api/orchestrate` con `{ pipelineId, stepAgent, context }` → output en vivo en panel derecho.

**Endpoint**: `POST /api/orchestrate` (rate-limited 10 req/min).

### 5.7 Atribución de Pauta (ads)

**Qué hace**: el killer feature. Tabla por anuncio con 19 métricas + 6 veredictos.

**Columnas**: externalId, platform, spend, impressions, clicks, CTR, CPC, convReported (lo que dice la plataforma), orderCount (pedidos reales), units, revenue, paidRevenue, AOV, COGS, grossProfit, netProfit, CPA, CPL, CVR, ROAS, ROI.

**Veredictos** (automáticos):
- `scale` — Subir presupuesto. ROAS > 2.5 y orderCount > 5.
- `optimize` — Ajustar creatividad. ROAS 1.5-2.5.
- `watch` — Observar. Pocos datos (< 5 pedidos).
- `pause` — Pausar temporalmente. ROAS < 1.5 con datos suficientes.
- `kill` — Apagar inmediatamente. ROAS < 1.0.
- `cannibalize` — Sospechoso de canibalización. convReported >> orderCount.

**Kill-switch**: botón en cada fila → pausa + audit log + actualiza estado.

**Endpoint**: `GET /api/ads?tenantId=X`, `PATCH /api/ads/[id]` (con `{ action: 'kill', reason: '...' }`).

### 5.8 Monetización (monetization)

**Qué hace**: GMV por período + comisiones escalonadas + facturación.

**Componentes**:
- Card de GMV total del período.
- Tabla de comisiones por tramo (4.5% / 3.5% / 2.5% / 1.5%).
- Lista de facturas emitidas.
- Conciliación: GMV reportado por agentes vs GMV real de la caja.

**Endpoint**: `GET /api/monetization/gmv?tenantId=X`, `GET /api/monetization/commission`.

### 5.9 Wallet (wallet)

**Qué hace**: balance del trafficker + retiros con 2FA TOTP.

**Requiere header**: `X-Trafficker-Id: <id>` en cada request.

**Componentes**:
- Card de balance disponible.
- Ledger completo (entradas y salidas).
- Lista de retiros solicitados con estado (`pending` / `processed` / `completed` / `failed`).
- Botón **Solicitar retiro** → modal pide monto + código TOTP.

**2FA**: el código TOTP se genera con app Authenticator (Google Authenticator, Authy, 1Password). Verificado con `otpauth` en `src/lib/totp.ts`.

**Endpoint**: `GET /api/wallet`, `POST /api/wallet` (con `action: 'request_withdrawal'`).

### 5.10 Inteligencia Logística (logistics)

**Qué hace**: scores por carrier + alertas de guías + recomendación por ciudad.

**Componentes**:
- Tabla de carriers con score (efectividad %, tarifa promedio, días promedio).
- Lista de alertas: guías sin movimiento > 24h.
- Recomendación: "Para envíos a Medellín, usar Interrapidisimo (95% efectividad, $4.500, 1.2 días)".

**Endpoint**: `GET /api/logistics-intelligence?tenantId=X`.

### 5.11 Marketplace (marketplace)

**Qué hace**: listings cross-tenant para lead sharing entre marcas del holding.

**Cross-brand**: Saramantha puede listar productos en Lovely Pijamas y viceversa. Si un cliente de Lovely pregunta por algo que Saramantha tiene, el agente `marketplace` lo sugiere.

**Endpoint**: `GET /api/marketplace`, `POST /api/marketplace` (create listing).

### 5.12 Novedades (novedades)

**Qué hace**: CRM de incidencias logísticas con 3 tabs.

**Tabs**:
1. **Casos**: lista de `NovedadCase` con filtros (estado, carrier, tipo). Detalle con evidencias, timeline, escalación.
2. **Reintentos**: `RedeliveryRequest` con motivo, intentos X/3, dirección original vs confirmada, agendado.
3. **Historial de Guía**: búsqueda por número de guía → timeline visual con 11 tipos de evento.

**Anti-alucinación**: el agente `novedades` valida que la orden pertenece al tenant antes de crear caso. Pide evidencias (foto, video, guía). Requiere escalación humana para reposición/compensación/reembolso.

**Endpoint**: `GET /api/novedades`, `POST /api/novedades`, `PATCH /api/novedades/[id]`.

### 5.13 Integraciones (integrations)

**Qué hace**: estado de los 18 adapters por tenant.

**UI**: grid de cards por adapter. Cada card muestra: nombre, tipo (catálogo/logística/pago/pauta), estado (configurado/pendiente/error), última verificación, botón "Configurar".

**Health check**: `GET /api/health?tenantId=X` retorna 23 checks individuales.

### 5.14 Configuración (settings)

**Qué hace**: configuración del tenant.

**Sub-secciones**:
- **Marca**: tono, nombre de asesora, política de pago, pregunta de perfil.
- **Canales**: WhatsApp, Messenger, Instagram (credenciales, webhooks).
- **Catálogo**: plataforma, credenciales.
- **Agentes**: proveedor IA, API keys.
- **Pagos**: estrategia por canal/país, pasarelas.
- **Usuarios**: CRUD de usuarios con roles.
- **Webhooks**: URLs de callback.

**Endpoint**: `GET /api/payments/config?tenantId=X`, `PATCH /api/payments/config`.

---

## 6. Los 26 agentes conversacionales

Cada agente es una función `build<Name>Prompt(ctx)` en `src/lib/agents/prompts.ts`. Se invocan vía `POST /api/agents/[agentName]` con body `{ tenantId, ...context }`.

### Pipeline A — Pre-venta (10 agentes)

| # | Agente | Propósito | Cuándo usarlo | Ejemplo de output |
|---|--------|-----------|---------------|-------------------|
| 1 | `buyer_behavior` | Detecta malos hábitos del comprador (cross-store ordering, selective return, COD abuse). | Antes de invertir tiempo en una venta. | "Cliente con riskScore 75/100. Patrones: high_return_rate (3 devoluciones en 30 días), COD abuse (2 pedidos COD cancelados). Protocolo: require_prepay." |
| 2 | `profile` | Detecta perfil del cliente. | Primer mensaje del cliente. | "Perfil: mayorista. Señales: pidió catálogo mayorista, preguntó por precio por volumen, mencionó 'surtir mi negocio'." |
| 3 | `speech` | Discurso de apertura por perfil. | Después de `profile`. | "¡Hola! 👋 Soy Sara de Saramantha. Para mayoristas como tú tenemos descuento del 12% en pedidos sobre $500k. ¿Te paso el catálogo mayorista o buscas algo específico?" |
| 4 | `catalog` | Respuesta visual-primero. | Cliente pide ver productos. | (Envía imagen + texto breve: "Esta es nuestra línea Premium. Tallas S-XL. $89.000 c/u, $79.000 desde 6 unidades.") |
| 5 | `cart_builder` | Construye carrito desde el chat. | Cliente describe o envía screenshot. | "Carrito: 4x Pijama Seda Talla M ($89.000 c/u) + 2x Pijama Algodón Talla L ($69.000 c/u). Subtotal: $494.000. Descuento mayoreo (6+): -10% = $444.600. ¿Confirmas?" |
| 6 | `quote` | Cotización con precio por volumen. | Cliente pregunta precio. | "Precio por volumen: 1-5 unid: $89.000 c/u. 6-20 unid: $79.000 c/u. 21-50 unid: $69.000 c/u. 51+ unid: $59.000 c/u. Envío a Bogotá: $7.500." |
| 7 | `objection` | Manejo de objeciones. | Cliente objeta. | "Objeción: 'muy caro'. Gatillo: contraste de valor. Respuesta: 'Entiendo. Una pijama Saramantha dura 3+ años vs 6 meses de una genérica. Anualizado te sale 6x más barato. ¿Te muestro la comparativa?'" |
| 8 | `address` | Recolecta 10 campos + valida. | Antes de generar guía. | "Faltan: barrio, código postal, celular alternativo, franja horaria. ¿Me los pasas? Tu dirección 'Calle 80 #45-23' valida como zona urbana Bogotá, entrega 24-48h." |
| 9 | `logistics` | Cotiza flete real. | Después de `address`. | "Cotización de envío: Interrapidisimo $7.500 (24h), Servientrega $6.800 (48h), Coordinadora $5.900 (72h). Recomendación: Interrapidisimo por relación velocidad/precio." |
| 10 | `checkout` | Cierra pedido + sync + guía + comisión. | Cliente confirma. | "Pedido PED-2026-0157 confirmado. Total: $452.100. Modo: anticipado (link de pago MP enviado). Guía Interrapidisimo #INT-789456. Comisión calculada: $20.344 (4.5% tramo 1)." |

### Pipeline B — Post-venta (4 agentes)

| # | Agente | Propósito | Cuándo usarlo | Ejemplo de output |
|---|--------|-----------|---------------|-------------------|
| 11 | `guide_tracking` | Seguimiento de guías + alertas sin movimiento. | Pedido despachado. | "Guía INT-789456: último movimiento hace 6h (en_transito Bogotá→Medellín). Sin alertas. ETA: 24h." |
| 12 | `novedades` | CRM de incidencias (anti-alucinación). | Cliente reporta problema. | "Caso NV-2026-00042 creado. Orden PED-2026-0157 validada ✅. Tipo: damaged. Evidencia solicitada: foto del producto + foto de la guía. Asignado a: rep@interrapidisimo. Escalación humana requerida para reposición." |
| 13 | `redelivery` | Reintento de entrega. | Paquete devuelto. | "Motivo: not_present (cliente no estaba). Intento 1/3. Dirección confirmada: Calle 80 #45-23. Franja: mañana 9-12. Asignar a humano para agendar." |
| 14 | `remarketing` | Recuperación de ventas perdidas. | Carrito abandonado, cliente desaparece. | "Campaña winback: mensaje 1 a las 24h ('Tu carrito te espera, $452.100'), mensaje 2 a las 72h con 5% off, mensaje 3 a las 7 días con 10% off." |

### Pipeline C — Inteligencia (5 agentes)

| # | Agente | Propósito | Cuándo usarlo | Ejemplo de output |
|---|--------|-----------|---------------|-------------------|
| 15 | `customer_score` | Score de cliente + protocolos. | Análisis continuo. | "Score: 78/100. Comportamiento: recurrente (4 pedidos en 60 días), paga anticipado, sin devoluciones. Recomendación: VIP, ofrecer línea premium." |
| 16 | `carrier_score` | Score por transportadora. | Selección de carrier. | "Interrapidisimo: 95% efectividad, $7.500, 1.2 días. Servientrega: 92%, $6.800, 1.8 días. Para Medellín urbano: Interrapidisimo. Para zonas apartadas: Servientrega." |
| 17 | `product_enrichment` | Tags + keywords desde imágenes. | Producto nuevo sin metadata. | "Tags generados: 'pijama-seda', 'manga-larga', 'estampado-flores', 'colores-pastel', 'premium', 'regalo-mujer'. Keywords SEO: 'pijama seda mujer', 'pijama estampada premium'." |
| 18 | `marketplace` | Cross-brand leads. | Cliente pregunta por algo que no tienes. | "Producto no encontrado en Saramantha. Sugiero: Lovely Pijamas tiene 'Pijama Algodón Premium' similar. ¿Te paso el contacto?" |
| 19 | `affiliator` | Recomienda productos para traffickers. | Trafficker busca dónde invertir. | "Top 3 productos para trafficker: 1) Pijama Seda ($89k, ROAS 3.2, demanda alta), 2) Set Sublime Majestic ($145k, ROAS 2.8), 3) Pijama Lovely Algodón ($69k, ROAS 2.5). Inversión sugerida: $2M split 50/30/20." |

### Agentes adicionales (7)

| # | Agente | Propósito | Cuándo usarlo |
|---|--------|-----------|---------------|
| 20 | `theme` | Oferta por tema/personaje (Halloween, San Valentín). | Cliente busca regalo temático. |
| 21 | `vision` | Identificación por imagen (VLM). | Cliente envía foto de producto. |
| 22 | `guide_alert` | Alertas de guías sin movimiento. | Automático en pipeline post-venta. |
| 23 | `address_analysis` | Análisis avanzado de dirección con VLM. | Dirección ambigua. |
| 24 | `traffic_orchestrator` | Traffic Intelligence (pixel, SEO, AEO). | Optimización de pauta. |
| 25 | `sales_retainer` | Retención de ventas (abandono/cancelación). | Cliente amenaza con cancelar. |
| 26 | `logistics_notifier` | Notificaciones logísticas al comprador. | Automático en cambios de estado. |

---

## 7. Los 3 pipelines de orquestación

Definidos en `src/lib/orchestrator/constants.ts`. Cada pipeline es una secuencia de pasos; el orquestador ejecuta los agentes en orden con contexto acumulado.

### 7.1 Pipeline A — Pre-venta (10 pasos)

Del primer mensaje al checkout.

| Paso | Agente | Emoji | Descripción |
|------|--------|-------|-------------|
| 1 | `buyer_behavior` | 🛡️ | Verificación de comprador (anti-fraude antes de invertir tiempo). |
| 2 | `profile` | 🎯 | Perfilamiento: mayorista / emprendedor / detal / regalo. |
| 3 | `speech` | 💬 | Discurso de apertura + prueba social por perfil. |
| 4 | `catalog` | 🖼️ | Respuesta visual-primero con imágenes. |
| 5 | `cart_builder` | 🛒 | Construye carrito desde el chat. |
| 6 | `quote` | 🧮 | Cotización con precio por volumen + margen. |
| 7 | `objection` | 🛡️ | Clasifica objeción + aplica gatillo mental. |
| 8 | `address` | 📍 | Recolecta 10 campos + valida calidad por país. |
| 9 | `logistics` | 🚚 | Flete real vía LogisticsAdapter. |
| 10 | `checkout` | ✅ | Resumen + confirmación + sync ecommerce + guía + comisión. |

### 7.2 Pipeline B — Post-venta (4 pasos)

Del despacho al cierre de novedades.

| Paso | Agente | Emoji | Descripción |
|------|--------|-------|-------------|
| 1 | `guide_tracking` | 📦 | Seguimiento + alertas de guías sin movimiento. |
| 2 | `novedades` | ⚠️ | CRM de incidencias (anti-alucinación). |
| 3 | `redelivery` | 🔄 | Reintento de entrega (si devolución). |
| 4 | `remarketing` | 💌 | Recuperación de ventas perdidas. |

### 7.3 Pipeline C — Inteligencia (5 pasos)

Análisis continuo en background.

| Paso | Agente | Emoji | Descripción |
|------|--------|-------|-------------|
| 1 | `customer_score` | 📊 | Score + comportamiento + protocolos. |
| 2 | `carrier_score` | 🚚 | Score por transportadora. |
| 3 | `product_enrichment` | 🏷️ | Tags + keywords + BI desde imágenes. |
| 4 | `marketplace` | 🏪 | Cross-brand leads. |
| 5 | `affiliator` | 💰 | Recomendaciones para traffickers. |

---

## 8. Flujo de un pedido (embudo §15.1)

El embudo de pedidos tiene **8 estados** secuenciales. Cada pedido pasa por ellos (algunos saltan estados según el caso). Mover pedidos entre estados se hace en el módulo Kanban (drag & drop) o vía `PATCH /api/orders/[id]`.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EMBUDO §15.1 (8 estados)                       │
└─────────────────────────────────────────────────────────────────────────┘

   1                2                  3                  4
┌──────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────┐
│ pending_ │───▶│ datos_      │───▶│ intent_    │───▶│ oficina  │
│ confirm. │    │ completados │    │ cancelac.  │    │          │
└──────────┘    └─────────────┘    └────────────┘    └──────────┘
   ↑ 73%                              (si el cliente         │
   │ primer estado                     quiere cancelar)      │
   │                                                         ▼
   │                                                  5
   │                                            ┌──────────┐
   │                                            │despachado│
   │                                            └──────────┘
   │                                                  │
   │                                                  ▼
   │                                            6
   │                                            ┌──────────┐
   │                                            │en_transito│
   │                                            └──────────┘
   │                                                  │
   │                                                  ▼
   │                                            7              8
   │                                         ┌─────────┐  ┌──────────┐
   │                                         │entregado│  │ devuelto │
   │                                         └─────────┘  └──────────┘
   │                                              ▲              │
   │                                              │              ▼
   │                                              │       (redelivery
   │                                              │        → volver a 5)
   │                                              │
   └──────────────────────────────────────────────┘
   (si cancelado, vuelve a pending_confirmation
    para re-cualificar)
```

### Detalle de cada estado

| # | Estado | Significado | Acción del operador |
|---|--------|-------------|---------------------|
| 1 | `pending_confirmation` | Pedido creado, esperando confirmación del cliente. | Verificar con cliente por WhatsApp. |
| 2 | `datos_completados` | Cliente confirmó + dirección completa. | Generar guía. |
| 3 | `intent_cancelacion` | Cliente intenta cancelar. | Activar `sales_retainer`. |
| 4 | `oficina` | Pedido en oficina del vendedor, listo para despachar. | Entregar a transportadora. |
| 5 | `despachado` | Transportadora recogió el paquete. | Esperar webhook de `in_transit`. |
| 6 | `en_transito` | Paquete en movimiento. | Monitorear, generar alerta si >24h sin movimiento. |
| 7 | `entregado` | Paquete entregado al cliente. | **Calcular comisión automáticamente.** |
| 8 | `devuelto` | Paquete devuelto (no entregado). | Crear `RedeliveryRequest` o cerrar caso. |

> **Dato real del worklog**: en el sprint inicial de Saramantha, el 73% de los pedidos estaban en `pending_confirmation` — de ahí la importancia de automatizar el seguimiento con `guide_tracking` y `sales_retainer`.

---

## 9. Flujo de una novedad

Una novedad es una incidencia logística (paquete dañado, no entregado, dirección errada, contenido equivocado, etc.). Se gestiona en el módulo Novedades, tab Casos.

### 9.1 Crear

1. Operador recibe reporte del cliente (vía WhatsApp o llamada).
2. Abre módulo Novedades → tab Casos → botón **Nuevo caso**.
3. Llena: número de orden (valida que exista y pertenezca al tenant), tipo (damaged, not_delivered, wrong_address, wrong_content, lost, other), descripción.
4. El sistema genera número `NV-2026-XXXXX` automático.
5. Marca `requiresHuman = true` si el tipo implica compensación/reposición/reembolso.
6. Asigna al representante de la transportadora automáticamente (por `carrierName`).

### 9.2 Asignar

- Caso simple → carrier rep (asignación automática).
- Caso complejo (compensación, reposición) → humano (botón **Asignar a humano**).

### 9.3 Resolver

1. Solicitar evidencias: foto del producto, foto de la guía, video si aplica.
2. Una vez recibidas, **Resolver caso** → elegir tipo de resolución:
   - `reposicion` — enviar producto nuevo.
   - `compensacion` — descuento en próximo pedido.
   - `reembolso` — devolver dinero.
3. Nota interna obligatoria + monto si aplica.
4. Estado pasa a `resolved`.

### 9.4 Escalar

Si el caso no se resuelve en SLA (default 48h) o requiere decisión de gerencia:
- Botón **Escalar** → asigna a `escalatedTo` + audit log.

> **Anti-alucinación**: el agente `novedades` valida con `findUnique({ where: { id: orderId, tenantId } })` que la orden pertenece al tenant antes de crear caso. Si no existe o no coincide, rechaza con error. Esto evita que un agente malintencionado cree casos sobre órdenes ajenas.

---

## 10. Flujo de un retiro (2FA)

Los traffickers acumulan comisiones en su Wallet. Para retirar, deben autenticar con TOTP (Time-based One-Time Password, RFC 6238).

### 10.1 Setup inicial (una sola vez)

1. Trafficker abre módulo Wallet por primera vez.
2. Click **Configurar 2FA**.
3. Sistema genera `secret` aleatorio (base32) y lo guarda cifrado en `Trafficker.totpSecret`.
4. Muestra QR code para escanear con Google Authenticator / Authy / 1Password.
5. Trafficker escanea + ingresa primer código de 6 dígitos → validación → 2FA activado.

### 10.2 Solicitar retiro

1. Trafficker click **Solicitar retiro**.
2. Modal pide: monto (COP), nota opcional.
3. Modal pide: código TOTP actual (6 dígitos, válido 30s).
4. Sistema verifica con `totp.verify({ token, secret, window: 1 })`:
   - Si válido → crea `Withdrawal` con estado `pending` + descuenta del balance disponible.
   - Si inválido → 401 + audit log `wallet.totp_failed`.
5. Trafficker ve el retiro en estado `pending` hasta que finanzas lo procese.

### 10.3 Procesar (rol finanzas)

1. Finanzas abre módulo Wallet (con header `X-Tenant-Id`).
2. Ve retiros `pending`.
3. Ejecuta transferencia bancaria manualmente (SPEI, ACH, etc.).
4. Marca retiro como `processed` → `completed` cuando llegue el dinero a la cuenta del trafficker.
5. Si falla la transferencia → marca como `failed` → devuelve el monto al balance disponible.

### 10.4 Seguridad

- **Rate limit**: máximo 3 retiros `pending` simultáneos por trafficker.
- **Monto mínimo**: $50.000 COP.
- **Monto máximo**: 80% del balance disponible (20% queda como garantía).
- **Audit log**: toda acción (solicitud, validación TOTP, proceso, complete) se registra.
- **Header obligatorio**: `X-Trafficker-Id` o `X-Tenant-Id` en cada request a `/api/wallet`.

---

## 11. Integraciones disponibles

ZIAY tiene **18 adapters** en 4 categorías + 2 registries.

### 11.1 Catálogo (5 adapters)

| Adapter | Plataforma | Cuándo usarlo | Env vars |
|---------|-----------|---------------|----------|
| `woocommerce` | WooCommerce (self-hosted o hosted) | Tenant con tienda Woo. | `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` |
| `shopify` | Shopify | Tenant con tienda Shopify. | `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_SHOP_DOMAIN` |
| `whatsapp-catalog` | WhatsApp Business Catalog | Default para CO (sin e-commerce externo). | Configurado via WABA. |
| `supabase-catalog` | Supabase (cliente o nuestro) | Tenant con catálogo en Supabase. | `SUPABASE_URL`, `SUPABASE_API_KEY` |
| `dropi` | Dropi (marketplace CO) | Tenant vendiendo en Dropi. | `DROPI_API_KEY` |

### 11.2 Logística (3 adapters)

| Adapter | Plataforma | Cuándo usarlo | Env vars |
|---------|-----------|---------------|----------|
| `dropi` | Dropi logística | Envíos dentro de Dropi. | `DROPI_API_KEY` |
| `99envios` | 99envíos | Envíos CO económicos. | `ENVIOS99_API_KEY` |
| `aveonline` | Aveonline | Multi-carrier CO. | `AVEONLINE_API_KEY` |

### 11.3 Pagos (4 adapters)

| Adapter | Plataforma | Cobertura | Env vars |
|---------|-----------|-----------|----------|
| `mercadopago` | MercadoPago | LATAM | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` |
| `wompi` | Wompi (Bancolombia) | CO | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENT_SECRET` |
| `stripe` | Stripe | Internacional | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `payu` | PayU | LATAM | `PAYU_API_KEY`, `PAYU_MERCHANT_ID`, `PAYU_API_LOGIN` |

### 11.4 Pauta (2 adapters + registry)

| Adapter | Plataforma | Env vars |
|---------|-----------|----------|
| `google-ads` | Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_ACCESS_TOKEN` |
| `tiktok-ads` | TikTok Ads | `TIKTOK_ACCESS_TOKEN` |
| (Meta Ads) | Vía webhook + CAPI directo | `META_APP_SECRET`, `META_VERIFY_TOKEN` |

### 11.5 Webhooks (6 entrantes + 1 saliente)

| Webhook | Dirección | Endpoint |
|---------|-----------|----------|
| WhatsApp Cloud API | Entrante | `POST /api/webhooks/whatsapp` |
| Meta Messenger + IG | Entrante | `POST /api/webhooks/meta` |
| MercadoPago | Entrante | `POST /api/webhooks/mercadopago` |
| Wompi | Entrante | `POST /api/webhooks/wompi` |
| Stripe | Entrante | `POST /api/webhooks/stripe` |
| PayU | Entrante | `POST /api/webhooks/payu` |
| n8n → ZIAY | Entrante | (definido por workflow) |
| ZIAY → NocoDB | Saliente | `NOCODB_WEBHOOK_URL` |

### 11.6 Herramientas externas

| Herramienta | Rol |
|-------------|-----|
| **n8n** | Orquestador de workflows externo (11 flujos importables). |
| **NocoDB** | Vista Kanban operativa sobre Postgres. |
| **MinIO** | Object storage S3-compatible para evidencias. |
| **Ollama** | LLM local opcional (`proveedorIa=ollama`). |
| **Uptime Kuma** | Monitoreo de uptime + alertas. |
| **Redis** | Cache + Socket.io adapter para multi-nodo. |

---

## 12. Páginas públicas SSR (SEO)

ZIAY tiene **5 rutas SSR** para SEO y presencia pública. Estas páginas se renderizan en el servidor y se indexan en Google.

### 12.1 Rutas

| Ruta | Propósito | Cache |
|------|-----------|-------|
| `/` | Dashboard SPA (no indexable — requiere auth). | No cache. |
| `/t/[slug]` | Página pública del tenant (catálogo visible). | ISR 60s. |
| `/t/[slug]/p/[sku]` | Página pública de producto (con schema.org Product). | ISR 60s. |
| `/sitemap.xml` | Sitemap dinámico con todos los tenants + productos. | ISR 1h. |
| `/robots.txt` | Robots con allow para `/t/`, disallow para `/api/`. | Estático. |

### 12.2 Ejemplo

- `https://commerceflow.tudominio.com/t/saramantha` → catálogo público de Saramantha.
- `https://commerceflow.tudominio.com/t/saramantha/p/PIJ-SEDA-001` → página de producto con schema.org Product, Open Graph, Twitter Card.

### 12.3 SEO técnico

- **Schema.org Product**: name, image, description, sku, brand, offers (price, currency, availability).
- **Open Graph**: og:title, og:image, og:description, og:url.
- **Twitter Card**: summary_large_image.
- **Canonical**: cada página tiene `<link rel="canonical">`.
- **Sitemap**: incluye última modificación, prioridad, frecuencia de cambio.

---

## 13. FAQ (22 preguntas frecuentes)

### Generales

**1. ¿ZIAY funciona sin internet?** No. Es una aplicación web que requiere conexión permanente. El chat-service Socket.io también requiere WebSocket.

**2. ¿Puedo usarlo en mi celular?** Sí, el dashboard es responsive desde 390px. La navegación móvil usa un menú hamburguesa. Para WhatsApp real, sigue usando la app de WhatsApp del celular.

**3. ¿Cuántos tenants puedo tener?** No hay límite硬. El schema Prisma soporta N tenants. El límite real es la RAM del VPS (cada tenant activo consume ~50 MB en cache).

**4. ¿Puedo exportar mis datos?** Sí. `pg_dump` para la DB, `mc mirror` para MinIO, export CSV desde NocoDB.

### Ventas

**5. ¿Cómo asigno una conversación a otro agente?** En el módulo Mensajería, click en el menú ⋮ de la conversación → **Reasignar** → selecciona el agente.

**6. ¿Puedo usar el agente `vision` sin API key?** Sí, el VLM usa z-ai-web-dev-sdk por defecto (no requiere key en dev). En prod, configura `proveedorIa=zai` para todos los tenants.

**7. ¿El agente `checkout` genera la guía automáticamente?** Sí, si el adapter logístico está configurado. Si no, genera el registro de guía pendiente para que el operador la cree manualmente.

**8. ¿Puedo editar un pedido después de creado?** Sí, vía `PATCH /api/orders/[id]`. El audit log registra quién cambió qué.

### Logística

**9. ¿Qué hago si una guía no se mueve por más de 24h?** El agente `guide_alert` lo detecta automáticamente y crea una alerta. En el módulo Inteligencia Logística verás la lista. Manualmente puedes consultar el historial de guía en Novedades → tab Historial.

**10. ¿Cuántos reintentos de entrega permite el sistema?** Máximo 3 (`maxAttempts=3`). Al 4º intento el sistema bloquea nuevas solicitudes y exige escalar a humano.

**11. ¿Puedo reasignar una novedad a otra transportadora?** Sí. En Novedades → tab Casos → abrir caso → **Asignar a carrier** → selecciona otra. El audit log registra el cambio.

**12. ¿Qué pasa si el cliente quiere cancelar después del despacho?** Mueve el pedido a `intent_cancelacion` en el Kanban. El agente `sales_retainer` intenta retener. Si insiste, se procesa devolución (estado `devuelto`) y se gestiona `RedeliveryRequest` solo si el cliente cambia de opinión.

### Trafficker

**13. ¿Cómo cobro mis comisiones?** Las comisiones se acumulan automáticamente cuando un pedido atribuido a tu anuncio llega a estado `entregado`. Las ves en el módulo Wallet. Para retirar, solicita retiro con 2FA.

**14. ¿En cuánto tiempo llega el retiro a mi cuenta?** SLA: 3-5 días hábiles. El estado pasa `pending` → `processed` → `completed`.

**15. ¿Puedo tener más de un 2FA configurado?** No. Un trafficker = un `totpSecret`. Si pierdes el teléfono, contacta a finanzas para reseteo manual (con verificación de identidad).

**16. ¿Qué pasa si un vendedor falla en mi pauta?** Compensación automática: `seller_no_ship` (100% comisión + costo pauta), `late_ship` (50% comisión), `high_return_rate` (25% comisión). Visible en tu ledger.

### Marketing

**17. ¿Cómo detecto canibalización de anuncios?** En el módulo Atribución de Pauta, busca anuncios con veredicto `cannibalize` (convReported >> orderCount). Ejecuta kill-switch.

**18. ¿Puedo enviar eventos de conversión a Meta (CAPI)?** Sí. `POST /api/conversions` hace el dispatch real a Meta Graph v18.0, Google Measurement Protocol y TikTok Events API.

**19. ¿El ROAS que veo es real o el de Meta?** Es **real**: revenue (de pedidos entregados atribuidos al anuncio) / spend (del anuncio). Meta reporta su propio ROAS inflado; el nuestro es el de la caja.

### Técnico

**20. ¿Cómo cambio de SQLite a Postgres?** Cambia `DATABASE_URL` en `.env` de `file:./db/custom.db` a `postgresql://...`. Ejecuta `bunx prisma migrate deploy`. El schema es portable.

**21. ¿Puedo usar ZIAY sin n8n?** Sí, pero pierdes los 11 workflows externos (orquestación avanzada, integraciones con tools externos). El dashboard y los 26 agentes funcionan sin n8n.

**22. ¿El código es open-source?** Sí, bajo licencia MIT. Los prompts de agentes y la configuración de tenants son propiedad de Indisutex SAS.

---

## 14. Glosario (34 términos)

| # | Término | Definición |
|---|---------|------------|
| 1 | **Tenant** | Marca/empresa aislada. Identificada por `tenantId` y `slug`. |
| 2 | **WABA** | WhatsApp Business Account, cuenta empresarial aprobada por Meta. |
| 3 | **GMV** | Gross Merchandise Value, suma del valor de todos los pedidos en un período. |
| 4 | **CPA** | Costo Por Adquisición, cuánto costó traer un cliente que compró. |
| 5 | **ROAS** | Return On Ad Spend = revenue / spend. 1.0 = break-even. |
| 6 | **ROI** | Return On Investment = netProfit / spend (incluye COGS y comisión). |
| 7 | **AOV** | Average Order Value = GMV / # pedidos. |
| 8 | **CTR** | Click-Through Rate = clicks / impressions. |
| 9 | **CPC** | Costo Por Click = spend / clicks. |
| 10 | **CPL** | Costo Por Lead = spend / leads. |
| 11 | **CVR** | Conversion Rate = conversions / clicks. |
| 12 | **COD** | Cash On Delivery, pago contra entrega. |
| 13 | **CAPI** | Conversions API de Meta, envío server-side de eventos de conversión. |
| 14 | **Atribución** | Conexión entre pedido y anuncio que lo trajo. |
| 15 | **Canibalización** | Anuncio que reporta conversiones pero no hay pedidos reales. |
| 16 | **Kill-switch** | Botón que pausa un anuncio + audit log. |
| 17 | **Veredicto** | Clasificación automática: scale / optimize / watch / pause / kill / cannibalize. |
| 18 | **Agente** | Función IA especializada en un momento de la conversación. |
| 19 | **Pipeline** | Secuencia de agentes (pre-venta 10, post-venta 4, inteligencia 5). |
| 20 | **Adaptador** | Conector a un sistema externo (catálogo, logística, pago, pauta). |
| 21 | **Trafficker** | Affiliate que invierte en pauta y cobra por ventas confirmadas. |
| 22 | **Wallet** | Balance del trafficker con ledger y retiros 2FA. |
| 23 | **TOTP** | Time-based One-Time Password (RFC 6238), código de 6 dígitos cada 30s. |
| 24 | **2FA** | Two-Factor Authentication, segundo factor además del password. |
| 25 | **Novedad** | Incidencia logística con caso, evidencias y escalación. |
| 26 | **Redelivery** | Reintento de entrega (máx 3, 7 motivos). |
| 27 | **RLS** | Row-Level Security en Postgres, aislamiento por `tenantId` a nivel DB. |
| 28 | **pgvector** | Extensión de Postgres para embeddings vectoriales y búsqueda semántica. |
| 29 | **Embeddings** | Vectores numéricos que representan el significado de un texto o imagen. |
| 30 | **HMAC** | Hash-based Message Authentication Code, firma de webhooks. |
| 31 | **HNSW** | Hierarchical Navigable Small World, índice de búsqueda vectorial en pgvector. |
| 32 | **ISR** | Incremental Static Regeneration, revalidación de páginas SSR cada N segundos. |
| 33 | **SSR** | Server-Side Rendering, render en servidor para SEO. |
| 34 | **SPA** | Single Page Application, dashboard que cambia de vista en cliente. |

---

## Recursos adicionales

| Recurso | Ubicación | Para qué |
|---------|-----------|----------|
| README del proyecto | `README.md` | Visión general técnica. |
| Guía de deploy | `upload/GUIA-DEPLOY-PRODUCCION.md` | Deploy a producción. |
| Auditoría completa | `AUDIT-REPORT.md` | Estado de seguridad y calidad. |
| Bitácora de desarrollo | `worklog.md` | Historial de 23+ sprints. |
| Documento Saramantha original | `upload/PROYECTO_saramantha_agentes_whatsapp.md` | Especificación original. |
| Maestro de arquitectura | `upload/MAESTRO-arquitectura.md` | Detalle arquitectónico. |
| Health endpoint | `GET /api/health` | Estado de 23 integraciones. |
| Lista de agentes | `GET /api/agents` | Los 26 agentes con metadata. |
| Capturas de auditoría | `upload/audit-*.png`, `upload/qa-*.png` | 60+ imágenes de verificación. |

---

**Construido con cuidado por y para Indisutex SAS · 2025–2026.**
**Versión del documento:** 2.0 · **Última actualización:** sincronizada con `worklog.md` tras `AUTOFIX-A + REPORT-001`.
