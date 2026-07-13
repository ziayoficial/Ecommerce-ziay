# ZIAY — Guía de Onboarding & End-to-End

> **Documento operativo y técnico** para nuevos agentes, traffickers, finanzas y desarrolladores.
> Español LATAM neutral · técnico pero accesible · v1.0
>
> Convención: 💡 = pensamiento ágil (intuición rápida) · ⚠️ = advertencia crítica · ✅ = verificación

---

## Tabla de contenidos

1. [Bienvenida y contexto del producto](#1-bienvenida-y-contexto-del-producto)
2. [Arquitectura en 60 segundos](#2-arquitectura-en-60-segundos-pensamiento-ágil)
3. [Requisitos previos](#3-requisitos-previos)
4. [Instalación paso a paso](#4-instalación-paso-a-paso)
5. [Tour del dashboard (end-to-end por módulo)](#5-tour-del-dashboard-end-to-end-por-cada-módulo)
6. [Configurar tu estrategia de pago (la decisión clave)](#6-configurar-tu-estrategia-de-pago-la-decisión-clave)
7. [Conectar canales de mensajería](#7-conectar-canales-de-mensajería)
8. [Conectar plataformas de pauta](#8-conectar-plataformas-de-pauta)
9. [El motor de atribución explicado](#9-el-motor-de-atribución-explicado-pensamiento-ágil)
10. [Workflows operativos diarios](#10-workflows-operativos-diarios)
11. [IA conversacional: cómo sacarle provecho](#11-ia-conversacional-cómo-sacarle-provecho)
12. [Seguridad y cumplimiento](#12-seguridad-y-cumplimiento)
13. [Troubleshooting](#13-troubleshooting)
14. [Despliegue a producción (estrategia)](#14-despliegue-a-producción-estrategia)
15. [Escalado y monitoreo](#15-escalado-y-monitoreo)
16. [FAQ ágil](#16-faq-ágil)
17. [Glosario técnico completo](#17-glosario-técnico-completo)

---

## 1. Bienvenida y contexto del producto

**ZIAY** es un **Centro de Mando de Comercio Conversacional + Atribución Inteligente**. Es una sola pantalla (una sola ruta `/` conmutada en cliente) que unifica tres mundos que normalmente viven separados en tools desconectadas:

1. **Mensajería conversacional** — WhatsApp Business API (principal en Colombia), Facebook Messenger (internacional) e Instagram DM. Bandeja unificada con atribución de campaña por conversación.
2. **Pedidos y pagos** — con soporte nativo para **pago anticipado** (carrito ecommerce), **contra entrega (COD)** e **híbrido** configurable por canal y país.
3. **Atribución de pauta** — el *killer feature*. Conecta Meta Ads, Google Ads y TikTok Ads, compara las conversiones que reportan las plataformas vs. los pedidos reales cobrados, calcula CPA/ROAS/ROI por anuncio y **detecta canibalización** (cuando una plataforma reporta ventas que no llegaron de verdad).

### Para quién es

| Rol | Qué hace en ZIAY |
|---|---|
| **Agente de chat** | Responde conversaciones en WhatsApp/Messenger/IG, usa IA para sugerir respuestas, cierra pedidos, valida dirección y modo de pago. |
| **Trafficker / Media buyer** | Revisa el módulo Atribución de Pauta diario, identifica anuncios en veredicto `Apagar` o `Canibaliza`, ejecuta kill-switch, escala los ganadores. |
| **Finanzas** | Concilia COD vs. anticipo, marca pedidos `paid` o `cancelled`, gestiona devoluciones. |
| **Admin / DevOps** | Configura canales, plataformas de pauta, webhooks, umbrales globales, despliega y monitorea. |

### La promesa de valor (en una frase)

> **"Una sola pantalla donde ves qué anuncio generó qué conversación que cerró qué pedido que se cobró — y puedes apagar el anuncio que está mintiendo sobre sus conversiones con un solo clic."**

### Glosario mínimo (los términos que necesitas desde el minuto 1)

| Término | Significado práctico |
|---|---|
| **CPA** (Costo por Adquisición) | Cuánto pagaste en pauta por cada pedido **real**. `inversión ÷ pedidos`. |
| **ROAS** (Return on Ad Spend) | Cuánto cobraste por cada peso invertido en pauta. `ingresos cobrados ÷ inversión`. ROAS 2 = por cada $1 invertido cobraste $2. |
| **ROI** (Return on Investment) | Como ROAS pero restando COGS (costo de mercancía). `(utilidad neta) ÷ inversión`. |
| **COD** (Cash on Delivery) | Contra entrega. El cliente paga al recibir el producto en su puerta. |
| **AOV** (Average Order Value) | Ticket promedio. `ingresos totales ÷ número de pedidos`. |
| **Atribución** | Asignar el crédito de una venta al anuncio/campaña que la generó. En ZIAY usamos **last-click** por defecto (`fbclid`/`gclid`/`ttclid` → pedido). |
| **Canibalización** | Cuando una plataforma de pauta reporta conversiones que en realidad llegaron por otro canal. La plataforma "se roba" el crédito. |
| **CPL** (Costo por Lead) | Costo por conversión reportada por la plataforma (no necesariamente real). |
| **CVR** (Conversion Rate) | Tasa de conversión de click a pedido. `pedidos ÷ clicks`. |
| **COGS** (Cost of Goods Sold) | Costo de la mercancía vendida. Restado del revenue para obtener utilidad bruta. |
| **Click ID** | Identificador único que la plataforma de pauta pone en la URL al hacer click: `fbclid` (Meta), `gclid` (Google), `ttclid` (TikTok). Es **la llave de la atribución**. |

💡 **Pensamiento ágil**: imagina que ROAS es "cuántos pesos te devolvió cada peso invertido". Si inviertes $100k y cobraste $300k, ROAS = 3x. Si cobraste $80k, ROAS = 0.8x → **estás perdiendo plata en ese anuncio**.

---

## 2. Arquitectura en 60 segundos (pensamiento ágil)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EL CLIENTE                                      │
│            ve el anuncio en Meta / Google / TikTok                          │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │ click (URL lleva fbclid / gclid / ttclid)
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│   LANDING / WHATSAPP "Click to chat" / Messenger "Send Message"           │
│   El click_id se captura en URL y se guarda en la sesión/conversación    │
└──────────┬───────────────────────────────────────────────────────────────┘
           │ abre conversación
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   COMMERCEFLOW OS (Next.js 16, ruta /)                     │
│                                                                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────┐ │
│  │  Resumen   │  │ Mensajería │  │  Pedidos   │  │ Atribución │  │ Conf │ │
│  └────────────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┘ │
│                        │               │               │                  │
│                        ▼               ▼               ▼                  │
│              ┌──────────────────────────────────────────────────┐         │
│              │           API ROUTES (/api/*)                    │         │
│              │  conversations · orders · ads · overview ·       │         │
│              │  ai-reply · payments/config · webhooks/wa ·      │         │
│              │  webhooks/meta                                    │         │
│              └──────────────────────┬───────────────────────────┘         │
│                                     │                                      │
│              ┌──────────────────────┼───────────────────────────┐         │
│              │                      ▼                           │         │
│              │             ┌─────────────────┐                  │         │
│              │             │  Prisma ORM     │                  │         │
│              │             │  SQLite (dev)   │                  │         │
│              │             │  PostgreSQL     │                  │         │
│              │             │  (producción)   │                  │         │
│              │             └─────────────────┘                  │         │
│              └──────────────────────────────────────────────────┘         │
│                                                                            │
│   Webhooks entrantes:                                                      │
│   POST /api/webhooks/whatsapp  ← WhatsApp Cloud API                       │
│   POST /api/webhooks/meta      ← Messenger + IG + Meta Ads events         │
└────────┬───────────────────────────────────────────────────────────────────┘
         │ socket.io (live messenger)
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│       MINI-SERVICIO CHAT-SERVICE (Node/Bun, puerto 3003)                  │
│       Eventos: message:sent · message:new · agent:typing · status:change │
└────────┬─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│       CADDY GATEWAY (puerto 81)                                           │
│       reverse_proxy con ?XTransformPort=N → localhost:N                   │
│       (default → 3000 Next.js · 3003 chat-service)                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Analogía práctica

> 💡 **Pensamiento ágil**: imagina que cada anuncio es un **vendedor** enviado a la calle. La plataforma te dice "este vendedor cerró 10 ventas" pero cuando miras la caja, solo hay 6 pedidos con su firma. Los otros 4 los cerraron otros vendedores (o el cliente ya venía caminando solo). ZIAY es **el gerente que cruza la caja con la planilla de los vendedores y te dice: "este vendedor está inflando sus números, despídelo"**. El `click_id` es la firma del vendedor en el pedido.

### Componentes (stack final)

| Componente | Tecnología | Versión | Rol |
|---|---|---|---|
| Dashboard | Next.js 16 (App Router) + React 19 + TypeScript 5 | 16.1.1 / 19 / 5 | SPA en ruta `/` con 5 vistas conmutadas |
| UI | Tailwind CSS 4 + shadcn/ui (tema esmeralda) | 4.x | Componentes accesibles |
| ORM | Prisma | 6.11.1 | SQLite dev → PostgreSQL prod |
| Live messenger | Socket.io | 4.7.5 / 4.8.3 (client) | Mini-servicio en puerto 3003 |
| Charts | Recharts | 2.15.4 | KPIs y series temporales |
| LLM | z-ai-web-dev-sdk | 0.0.18 | IA conversacional (chat completions) |
| Tema | next-themes | 0.4.6 | Light/dark |
| Auth | NextAuth.js v4 | 4.24.11 | Disponible (no habilitado en demo) |
| Runtime | Bun (recomendado) o Node 20+ | 1.3+ | Instalación y dev |
| Gateway | Caddy | 2.x | TLS, reverse proxy, websockets |

---

## 3. Requisitos previos

### 3.1 Stack local (obligatorio)

| Herramienta | Versión mínima | Cómo verificar |
|---|---|---|
| **Node.js** | 20.0+ | `node -v` → `v20.x.x` o superior |
| **Bun** (recomendado) | 1.3+ | `bun -v` → `1.3.x` o superior |
| **PostgreSQL** (producción) | 15+ | `psql --version` |
| **SQLite** (desarrollo) | incluido con Prisma | `prisma -v` |
| **Git** | 2.30+ | `git -v` |
| **Caddy** | 2.7+ | `caddy version` |

⚠️ **No uses Node 18 ni inferior** — Next.js 16 requiere Node 20+. Si tienes Bun, **úalo para todo** (`bun install`, `bun run dev`, `bun .next/standalone/server.js`): es ~3x más rápido.

### 3.2 Cuentas externas (para producción)

> En modo demo, **no necesitas ninguna de estas** — el sistema corre con datos seed y webhooks simulados. Pero para producción real necesitas:

| Cuenta | Para qué | URL |
|---|---|---|
| **WhatsApp Business API** | Recibir/enviar mensajes WA | https://developers.facebook.com/apps → "Business" type |
| **Meta for Developers** | App de Meta con Messenger + Ads | https://developers.facebook.com |
| **Facebook Page** | Suscribir Messenger/IG | Necesaria para Messenger |
| **Instagram Professional** | Recibir DMs de IG | Cuenta Business o Creator |
| **Google Ads API** | Importar spend, ad_ids, conversiones | https://developers.google.com/google-ads/api |
| **Google Cloud Console** | OAuth para Google Ads | Crear proyecto + OAuth consent |
| **TikTok Ads API** | Importar spend y ad_ids de TikTok | https://ads.tiktok.com/marketing_api/docs |
| **Gateway de pago** | Cobro anticipado | Mercado Pago (LATAM), Wompi (CO), Stripe (intl), PayU |

### 3.3 Variables de entorno (`.env`)

```bash
# ─── Base de datos ───────────────────────────────────────────
# Dev (SQLite):
DATABASE_URL=file:/home/z/my-project/db/custom.db
# Prod (PostgreSQL):
# DATABASE_URL=postgresql://user:pass@localhost:5432/commerceflow

# ─── Webhook verify tokens ───────────────────────────────────
WA_VERIFY_TOKEN=commerceflow_verify        # WhatsApp Cloud API
META_VERIFY_TOKEN=commerceflow_verify      # Messenger + IG + Meta Ads events

# ─── Meta Ads (placeholders — llenar en prod) ────────────────
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=act_102455
META_APP_ID=
META_APP_SECRET=

# ─── Google Ads ──────────────────────────────────────────────
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=123-456-7890
GOOGLE_ADS_OAUTH_CLIENT_ID=
GOOGLE_ADS_OAUTH_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=

# ─── TikTok Ads ──────────────────────────────────────────────
TIKTOK_ACCESS_TOKEN=
TIKTOK_ADVERTISER_ID=tt_act_9981

# ─── WhatsApp Cloud API ──────────────────────────────────────
WA_PHONE_NUMBER_ID=
WA_ACCESS_TOKEN=

# ─── Messenger ───────────────────────────────────────────────
MESSENGER_PAGE_ID=
MESSENGER_ACCESS_TOKEN=

# ─── Instagram ───────────────────────────────────────────────
IG_ACCOUNT_ID=

# ─── Gateway de pago ─────────────────────────────────────────
MERCADOPAGO_ACCESS_TOKEN=
WOMPI_PRIVATE_KEY=
STRIPE_SECRET_KEY=

# ─── LLM (z-ai-web-dev-sdk) ──────────────────────────────────
# El SDK se inicializa con ZAI.create() — sigue sus instrucciones de env vars

# ─── App ─────────────────────────────────────────────────────
NEXTAUTH_SECRET=cambia-esto-en-prod
NEXTAUTH_URL=https://tu-dominio.com
```

✅ **Verificación rápida**: tras guardar `.env`, ejecuta `bun run db:push`. Si no hay errores, la cadena de conexión está bien.

---

## 4. Instalación paso a paso

### 4.1 Clonar e instalar dependencias

```bash
git clone <repo-url> commerceflow-os
cd commerceflow-os

# Instalar dependencias del dashboard principal
bun install

# Instalar dependencias del mini-servicio chat-service
cd mini-services/chat-service
bun install
cd ../..
```

### 4.2 Configurar `.env`

Copia el template de la sección 3.3 en `.env` en la raíz del proyecto. Como mínimo funcional para demo:

```bash
DATABASE_URL=file:/home/z/my-project/db/custom.db
WA_VERIFY_TOKEN=commerceflow_verify
META_VERIFY_TOKEN=commerceflow_verify
```

### 4.3 Inicializar la base de datos

```bash
# Crear el schema en la DB (idempotente, seguro de re-ejecutar)
bun run db:push

# Generar el cliente Prisma
bun run db:generate

# (Opcional) Crear una migración formal para producción
# bun run db:migrate -- --name init
```

### 4.4 Cargar datos seed (demo)

> ⚠️ **El script seed no está declarado en `package.json`**. Se ejecuta directamente con Bun:

```bash
bun run prisma/seed.ts
```

Esto carga:
- **3 usuarios**: `admin@commerceflow.co` (Valentina Restrepo, admin), `agent@commerceflow.co` (Camila Torres, agent), `traffick@commerceflow.co` (Sebastián Marín, trafficker)
- **4 canales**: WhatsApp CO (híbrido), WhatsApp MX (COD), Messenger INTL (anticipado), Instagram INTL (híbrido)
- **5 productos**: Serum Vitamina C ($89k COP, costo $31k), Crema Hidratante ($72k), Shampoo Keratina ($54k), Perfume Ámbar Noir ($145k), Colágeno ($99k)
- **8 clientes**: 5 CO, 1 DE, 1 ES, 1 MX
- **8 conversaciones** con mensajes
- **10 pedidos** (mix anticipado/COD, atribuidos a distintos anuncios)
- **3 plataformas**: Meta, Google, TikTok
- **8 campañas** y **12 anuncios** con 14 días de AdSpend
- **5 settings globales**: `default_currency=COP`, `default_country=CO`, `roas_kill_threshold=0.8`, `cpa_target=35000`, `cod_max_order_value=250000`
- **3 reglas de automatización**

✅ Al terminar verás: `Users: 3 | Channels: 4 | Products: 5 | Customers: 8 | Conversations: 8 | Orders: 10 | Ads: 12`

### 4.5 Arrancar el dashboard

```bash
bun run dev
# → Next.js 16 arranca en http://localhost:3000
# → Logs en dev.log
```

Abre `http://localhost:3000`. Debes ver:
- Sidebar con 5 ítems: **Resumen · Mensajería · Pedidos & Pagos · Atribución de Pauta · Configuración**
- Topbar con selector de país (ALL/CO/MX/ES/DE), toggle de tema y avatar "VR · Admin · CO"
- KPIs cargados en Resumen (Ingresos, ROAS, Pedidos, Inversión en pauta)

### 4.6 Arrancar el chat-service (live messenger)

En **otra terminal**:

```bash
cd mini-services/chat-service
bun run dev
# → ✅ ZIAY chat-service running on port 3003
```

### 4.7 Arrancar el gateway Caddy

En **otra terminal** (para acceso desde fuera del localhost, webhooks públicos y socket.io):

```bash
caddy run --config Caddyfile
# → Caddy escucha en :81
```

El `Caddyfile` hace dos cosas:
1. Si la URL trae `?XTransformPort=N`, hace reverse proxy a `localhost:N` (así el dashboard llama al chat-service en 3003 sin CORS ni dominio separado).
2. Si no, hace reverse proxy a `localhost:3000` (Next.js).

✅ **Verificación integral**: abre Mensajería en el dashboard. En la barra superior de la lista de conversaciones debe decir **"Tiempo real conectado"** con un punto verde. Si dice "Conectando socket..." → revisa que chat-service (3003) y Caddy (:81) estén corriendo.

### 4.8 Smoke test end-to-end (5 minutos)

1. **Resumen**: KPIs con valores > 0, gráfico de área con dos series (Ingresos esmeralda, Pauta rosa).
2. **Mensajería**: click en una conversación (ej. "Diana Cárdenas") → ver historial → escribir "Hola Diana, ¿te ayudo?" → click **Enviar** → entre 3 y 6 segundos después aparece una respuesta simulada del cliente.
3. **Pedidos & Pagos**: tabla con 10 pedidos, filtros por modo de pago funcionan.
4. **Atribución de Pauta**: tabla con 12 anuncios, al menos 2 en veredicto **Apagar** (rojo) y varios en **Escalar** (verde). Click en **Apagar** en uno → toast "Anuncio apagado".
5. **Configuración**: 4 cards de canal con selectores de estrategia, integraciones listadas.

Si los 5 pasos pasan, el ambiente está sano.

---

## 5. Tour del dashboard (end-to-end por cada módulo)

> El dashboard es **una sola ruta** (`src/app/page.tsx`) con 5 vistas conmutadas por `useState`. El sidebar (`src/components/dashboard/sidebar.tsx`) define los `ViewId`: `overview | messenger | orders | ads | settings`.

### 5.1 Módulo **Resumen** (`overview`)

**Qué ver**: 4 KPI cards arriba, un gráfico de áreas (Ingresos vs. Pauta), dos columnas (Ingresos por canal + Modo de pago pie), y 3 cards de resumen (Conversaciones nuevas, CTR, Utilidad bruta).

**KPIs que muestra** (todos calculados en `GET /api/overview?days=14`):

| KPI | Cómo se calcula (real del código) |
|---|---|
| Ingresos (14d) | Σ `order.total` de los últimos 14 días. Sub: cobrado efectivamente (solo `paymentStatus==='paid'`) + AOV |
| ROAS | `revenuePaid ÷ totalSpend` (solo ingresos cobrados, no pendientes) |
| Pedidos | Conteo de órdenes. Sub: X anticipado · Y contra entrega |
| Inversión en pauta | Σ `adSpend.spend` de los últimos 14 días. Sub: utilidad neta |
| Conversaciones nuevas (14d) | Count de `Conversation` creadas en el rango |
| CTR | `(clicks ÷ impressions) × 100` |
| Utilidad bruta | `revenuePaid − COGS` |

**Flujo de usuario**:
1. Al abrir la app, el dashboard carga automáticamente `GET /api/overview?days=14`.
2. En la topbar, usa el selector de país (🇨🇴 CO, 🇲🇽 MX, 🇪🇸 ES, 🇩🇪 DE, ALL) — el filtrado de país actualmente es a nivel de UI; los KPIs del backend no filtran por país en la v1.
3. Identifica anomalías: si **ROAS < 1.5** el sistema lo marca con flecha roja "Revisar". Si **utilidad neta < 0**, también flecha roja.
4. En el pie "Modo de pago", revisa el balance anticipado vs. COD. Si COD > 70% y tu margen es apretado, considera reforzar el descuento por prepago (ver sección 6).
5. Click en el módulo **Atribución de Pauta** para profundizar en qué anuncios están lastimando el ROAS.

💡 **Pensamiento ágil**: si el ROAS general cae de 2.5x a 1.2x semana a semana, no necesitas saber cuál anuncio — vas directo a **Atribución de Pauta** y buscas los marcados `Apagar`.

### 5.2 Módulo **Mensajería** (`messenger`)

Layout de **3 columnas** (`grid-cols-[320px_1fr_300px]`): lista de conversaciones | thread del chat | panel del cliente.

#### Elementos de UI

**Columna izquierda (lista)**:
- Input **"Buscar cliente..."** (busca por nombre en Customer.name)
- Select de canal: Todos los canales / WhatsApp CO / WhatsApp MX / Messenger / Instagram
- Tabs: **Todas** / **Abiertas**
- Indicador de socket: `● Tiempo real conectado` (verde si socket conectado) o `Conectando socket...`
- Cada item muestra: avatar (iniciales), nombre, badge de canal (color), país, prioridad URGENTE si aplica, último mensaje con prefijo "Tú: " si es outbound, badge de estado (Abierta / Pendiente / Resuelta / Cerrada), contador de no leídos.

**Columna central (thread)**:
- Header con avatar, nombre, badge de canal + displayName, teléfono.
- Select de estado (Abierta / Pendiente / Resuelta / Cerrada) → `PATCH /api/conversations/[id]` con `{status}`.
- Lista de mensajes (burbujas: outbound = esmeralda derecha, inbound = blanco izquierda con avatar de usuario).
- Composer con Textarea (Enter para enviar, Shift+Enter para salto).
- Botón **"Sugerir con IA"** (ícono Sparkles) → llama `POST /api/ai-reply` con `{conversationId}`.
- Botón **"Enviar"** (ícono Send).
- Texto: `Estrategia: <paymentStrategy>` (advance/cod/hybrid).

**Columna derecha (panel cliente)**:
- Avatar + nombre + país · ciudad
- Teléfono, dirección, tags
- Sección **Atribución**: Campaña (o "Orgánico"), Canal, Estrategia de pago
- Sección **Pedidos del cliente**: lista con número (#CF-100040), total, items, badge de estado y modo de pago
- Card esmeralda con tip contextual según estrategia (anticipado: "envía link del carrito"; COD: "confirma dirección"; híbrido: "sugiere prepago si > requirePrepayMin")
- Botón **"Crear pedido desde chat"** (demo — no implementado en v1)

#### Flujo completo: responder una conversación con IA

1. Click en la conversación **"Diana Cárdenas"** (debería estar primera, estado Abierta, prioridad high).
2. El thread carga el historial (`GET /api/conversations/[id]`). Se marcan los mensajes como leídos (`unreadCount` → 0).
3. En el panel derecho verifica la **atribución**: Campaign = `CO · Glow Serum · Sales`, Channel = WhatsApp · CO, Estrategia = `hybrid`.
4. Click en **"Sugerir con IA"**. Verás un toast "Generando..." y a los 2-5 segundos un toast "Sugerencia de IA generada" (o "Respuesta de respaldo generada" si el LLM no está disponible).
5. El texto sugerido aparece en el Textarea. Léelo. Si quieres, edítalo (puedes cambiar precios, agregar emojis, etc.).
6. Click **Enviar**. El mensaje se persiste (`POST /api/conversations` con `{conversationId, body}`), se emite `message:sent` por socket, y entre 3-6 segundos después recibes una respuesta simulada del cliente (`message:new` con direction=inbound).
7. Si necesitas cambiar el estado de la conversación, usa el Select en el header del thread (ej. marcar como "Resuelta").

⚠️ **Limitaciones de la v1**:
- Los mensajes inbound reales de WhatsApp/Messenger/IG no están conectados — el chat-service simula respuestas de cliente para demo. En producción, los webhooks `/api/webhooks/whatsapp` y `/api/webhooks/meta` persisten mensajes reales y emiten `message:new` por socket.
- El botón "Crear pedido desde chat" es visual en v1 — para crear pedidos hay que hacerlo via API/seed.

### 5.3 Módulo **Pedidos & Pagos** (`orders`)

**Qué ver**: 4 KPI cards + tabla de pedidos + 3 cards de estrategia de pago recomendada.

#### KPI strip

| KPI | Cálculo |
|---|---|
| Ingresos totales | Σ `order.total` |
| Cobrado efectivamente | Σ `order.total` donde `paymentStatus==='paid'` |
| COD pendientes de cobro | Count donde `paymentMode==='cod' && paymentStatus==='cod_pending'` |
| Descuentos por prepago | Σ `order.discount` (los aplicados por pago anticipado) |

#### Tabla de pedidos

Columnas: **Pedido** (número CF-100XXX + fecha) · **Cliente** (nombre + ciudad, país) · **Items** (cantidad x nombre) · **Pago** (badge Anticipado/COD + sub-estado Pendiente cobro / Cobrado) · **Total** (con sub: -X prepago si aplica, +Y envío COD) · **Estado** (Nuevo / Pago pendiente / Pagado / Preparando / Enviado / Entregado / Devuelto / Cancelado) · **Atribución** (badge Meta/Google/TikTok/Orgánico + nombre del anuncio) · **Acciones** (Select "Mover a...").

#### Filtros

- **Buscar # pedido...** (por `order.number` contains)
- **Modo de pago**: Todos / Anticipado / Contra entrega
- **Estado**: Todos / Nuevo / Pagado / Preparando / Enviado / Entregado

#### Flujo: avanzar un pedido por el workflow

1. Filtra por **Modo de pago = Contra entrega**. Verás los pedidos COD (ej. CF-100041 Bogotá, CF-100044 Barranquilla, CF-100047 Cali, CF-100049 Bogotá).
2. Los COD `cod_pending` están marcados con texto ámbar "Pendiente cobro" debajo del badge.
3. Cuando el courier confirma entrega y pago, usa el Select **"Mover a..."** en la fila → elegir **"Entregado"**. Esto hace `PATCH /api/orders/[id]` con `{status:'delivered', paymentStatus:'paid', event:'delivered'}`.
4. Se crea un `OrderEvent` con `type='delivered'` y se actualiza la UI.
5. Si el cliente rechazó en puerta → elegir **"Cancelar"**. El pedido queda en estado `cancelled` pero el `paymentStatus` no cambia (queda `cod_pending` o como estuviera).

#### Flujo: detectar pedidos sin atribución

1. Filtra por estado **Nuevo** y revisa la columna **Atribución**.
2. Si ves `Orgánico` o `—`, el pedido no tiene `sourceAdId`. Esto significa que el `click_id` no se capturó al aterrizar (el anuncio no llevaba parámetros o el cliente vino directo).
3. Pedidos sin atribución NO contribuyen al ROAS de ningún anuncio → tu ROAS se sub-reporta. Para corregir, asegúrate de que **todas las URLs de anuncios** lleven `fbclid`/`gclid`/`ttclid` (lo hacen por defecto) y que tu landing los capture en URL/cookie/localStorage.

#### Cards de estrategia (abajo)

Tres cards explicativas: **Anticipado** (recomendado intl + CO > $250k), **Contra entrega** (fuerte CO/MX < $250k, ~12-18% rechazo), **Híbrido** (configurable en módulo Configuración). Estas son informativas — la configuración real se hace en el módulo 5.

### 5.4 Módulo **Atribución de Pauta** (`ads`)

**Este es el killer feature.** Todo el cálculo vive en `GET /api/ads?days=14&platform=<meta|google|tiktok|all>`.

#### KPI strip (4 cards)

| KPI | Cálculo |
|---|---|
| Inversión pauta (14d) | Σ `adSpend.spend` |
| ROAS consolidado | `Σ paidRevenue ÷ Σ spend` · Sub: CPA |
| Ventas atribuidas | Σ `orderCount` · Sub: ingresos cobrados |
| Utilidad neta | `Σ netProfit = Σ (paidRevenue − COGS − spend)` · Sub: ROI |

#### Card "Alertas del trafficker"

- Sub-header: `Umbrales: ROAS kill < 0.8x · CPA objetivo $35.000`
- **X anuncios para apagar** (rojo, ícono Skull) — cuenta de verdicts `kill` o `cannibalize`. Sub: "Queman $<wastedSpend> sin generar ventas reales".
- **Y anuncios para escalar** (verde, ícono Rocket) — cuenta de verdicts `scale`.
- Botón **"Apagar todos los canibalizadores"** (demo — muestra toast).

#### Card "Inversión diaria en pauta"

Área chart (Recharts) con la serie diaria de los últimos 14 días, eje X = fecha corta, eje Y = COP compacto.

#### Tabla de rendimiento por anuncio (12 columnas)

| Columna | Qué muestra |
|---|---|
| **Anuncio (ID plataforma)** | Nombre + `externalId` en monoespaciada (ej. `meta_120201_glow_carousel`) + nombre de campaña |
| **Plataforma** | Badge Meta / Google / TikTok |
| **Inversión** | Σ spend 14d en COP compacto |
| **CTR/CPC** | CTR % + CPC en COP |
| **Conv. rep.** | `convReported` (lo que dice la plataforma). Si `platformGap > 0` se pinta en violeta. |
| **Ventas reales** | `orderCount` (verde si >0, rojo si =0) + sub `units` |
| **Ingresos** | `paidRevenue` (cobrado) + sub `AOV` |
| **CPA** | `spend ÷ orderCount`. Si = `null` (∞) se muestra `∞` rojo. Si > `cpaTarget` se pinta rojo. |
| **ROAS** | Badge colorido: verde ≥2, esmeralda 1-2, rosa 0-1, gris 0. Tooltip con gross profit, net profit, CVR. |
| **ROI** | `(netProfit ÷ spend)` en formato multiplicador (verde si ≥0, rojo si <0) |
| **Veredicto** | Badge con ícono: Escalar / Optimize / Vigilar / Pausar / Apagar / Canibaliza. Tooltip con descripción. |
| **Acción** | Botón contextual según veredicto (ver abajo) |

#### Botones de acción (columna "Acción")

| Veredicto | Botón que aparece | Acción backend |
|---|---|---|
| `kill` o `cannibalize` | **Apagar** (rojo, ícono Skull) | `PATCH /api/ads/[id] {action:'kill', reason}` |
| `pause` | **Pausar** (outline, ícono Pause) | `PATCH /api/ads/[id] {action:'pause'}` |
| `scale` | **Escalar** (default, ícono Rocket) | `PATCH /api/ads/[id] {action:'scale'}` |
| `optimize` o `watch` | **Vigilar** (ghost, ícono Eye) | Toast "Marcado para vigilar" (no backend en v1) |
| (status `paused`) | **Reanudar** (outline, ícono Play) | `PATCH /api/ads/[id] {action:'resume'}` |

El backend (`PATCH /api/ads/[id]`):
1. Actualiza `Ad.status` (active/paused/killed).
2. Si action=kill: marca `autoKill=true` y guarda `killReason`.
3. Crea un `AuditLog` con `action='ad.<action>'`, `entity='Ad'`, `entityId`, `meta={reason, status}`.
4. En producción: aquí se debe llamar la API de la plataforma (Meta/Google/TikTok) para pausar el anuncio real. En v1 es solo DB.

#### Flujo end-to-end: apagar un anuncio canibalizador

1. Abre **Atribución de Pauta**.
2. En el Select de plataforma (arriba derecha), elige **Meta Ads**.
3. La tabla recarga con `GET /api/ads?days=14&platform=meta`. La lista se ordena por spend desc.
4. Busca filas con badge violeta **Canibaliza** (ícono Flame). En el seed, los anuncios `meta_120401_coll_carousel` (Colágeno · Carrusel beneficios) y `meta_120402_coll_static` (Colágeno · Estático precio) son canibalizadores: tienen `convReported > 0` pero `orderCount = 0` y ROAS = 0 < 0.8.
5. Click en el botón **Apagar** (rojo, Skull) en esa fila.
6. Se ejecuta `PATCH /api/ads/[id] {action:'kill', reason:'Canibaliza atribución'}`.
7. Toast "Anuncio apagado".
8. La fila se actualiza: `status='killed'`, `autoKill=true`.
9. **Verificar audit log**: consulta `SELECT * FROM AuditLog WHERE entity='Ad' ORDER BY createdAt DESC LIMIT 5;` en la DB. Debes ver una fila con `action='ad.kill'`, `entityId=<ad.id>`, `meta={"reason":"Canibaliza atribución","status":"killed"}`.

#### Flujo: escalar un ganador

1. En la misma tabla busca filas con badge esmeralda **Escalar** (ícono Rocket). En el seed: `meta_120201_glow_carousel` (Glow · Carrusel UGC) tiene 4 pedidos atribuidos y ROAS > 2.
2. Click en **Escalar**.
3. Toast "Anuncio marcado para escalar".
4. En producción: aquí deberías ir a la plataforma y subir el presupuesto del ad set. El audit log te deja registro.

#### Card "¿Cómo se calcula?" (abajo del todo)

Resumen visual de las fórmulas:
- CPA = inversión ÷ pedidos reales
- ROAS = ingresos cobrados ÷ inversión
- ROI = (utilidad neta) ÷ inversión
- CPL = inversión ÷ conversiones reportadas
- CVR = pedidos ÷ clicks

Y la lógica de detección:
- **Canibalización**: plataforma reporta conversiones pero no llegan pedidos reales (gap > 0).
- **Apagar (kill)**: gasto > CPA objetivo y cero ventas reales.
- **Pausar**: ROAS < umbral y gasto material (> 2x CPA objetivo).
- **Escalar**: ROAS ≥ 2x con ≥ 2 pedidos.
- **Atribución**: last-click por defecto (configurable a first-touch, lineal o time-decay). El `click_id` (fbclid/gclid/ttclid) se captura al aterrizar y se pega al pedido.

### 5.5 Módulo **Configuración** (`settings`)

Tres bloques: estrategia de pago por canal · umbrales del trafficker + integraciones · webhooks.

#### Card 1: "Estrategia de pago por canal"

Por cada canal (4 cards: WhatsApp CO, WhatsApp MX, Messenger INTL, Instagram INTL):
- Header con avatar (bandera país o 🌍), displayName, name + país.
- Select de estrategia: **Anticipado** / **Contra entrega** / **Híbrido**.
- 3 inputs:
  - **Mín. para prepago (híbrido)** — `requirePrepayMin`. Disabled si no es híbrido.
  - **% descuento prepago** — `prepayDiscountPct`. Disabled si es COD.
  - **Recargo envío COD** — `codFee`. Disabled si es anticipado.
- Texto contextual:
  - `🔒 Solo pago anticipado vía carrito. Mejor flujo de caja.`
  - `🚚 Solo contra entrega. Mayor aceptación, ~15% rechazo.`
  - `⚖️ Híbrido: > $X sugiere prepago con Y% off.`
- Botón **Guardar** → `PATCH /api/payments/config {channelId, paymentStrategy, requirePrepayMin, prepayDiscountPct, codFee}`.

#### Card 2: "Umbrales del trafficker" (global)

- **ROAS mínimo (auto-pausa)** — `roas_kill_threshold`. Default 0.8.
- **CPA objetivo (COP)** — `cpa_target`. Default 35000.
- **Valor máx. para COD (COP)** — `cod_max_order_value`. Default 250000.
- **Moneda por defecto** — `default_currency`. COP/MXN/USD/EUR.
- Switch **"Auto-pausar anuncios canibalizadores"** (visual en v1).
- Botón **Guardar umbrales** → `PATCH /api/payments/config {channelId:'global', global:{...}}`.

Cada setting se persiste como fila en la tabla `Setting` (clave-valor) vía `upsert`.

#### Card 3: "Integraciones"

Lista visual (no editable en v1) de:
- WhatsApp Business API · Conectado · "+57 300 111 2233 · verificado"
- Facebook Messenger · Conectado · "Página ZIAY · INTL"
- Instagram DM · Conectado · "@commerceflow.shop"
- Meta Ads API · Conectado · "act_102455 · token válido"
- Google Ads API · Conectado · "123-456-7890 · OAuth ok"
- TikTok Ads API · Conectado · "tt_act_9981"
- Mercado Pago / Wompi · Conectado · "Gateway de cobro anticipado"

Switch **"Respuestas automáticas con IA"** (visual en v1).

#### Card 4: "Webhooks & endpoints"

Lista de URLs que debes configurar en cada plataforma:

| Label | URL |
|---|---|
| WhatsApp inbound | `POST /api/webhooks/whatsapp` |
| Meta (Messenger/IG/Ads) | `POST /api/webhooks/meta` |
| Verify token | `commerceflow_verify` (configurable en `.env` con `WA_VERIFY_TOKEN` / `META_VERIFY_TOKEN`) |
| Atribución por click_id | `fbclid / gclid / ttclid` capturado al aterrizar |

---

## 6. Configurar tu estrategia de pago (la decisión clave)

> Esta es **la decisión más importante** que tomas en ZIAY. Afecta flujo de caja, rechazos, devoluciones y margen.

### 6.1 Las tres estrategias

| Estrategia | Cuándo | Pros | Contras |
|---|---|---|---|
| **Anticipado** (`advance`) | Intl (EU/DE/ES), CO > $250k, productos perecederos | Caja sana, cero rechazos, descuento incentivado | Fricción alta para cliente nuevo; cae conversación |
| **COD** (`cod`) | MX, CO primera compra < $250k, clientes desconfiados | Mayor conversión, cero fricción de pago | ~12-18% rechazo en puerta, flujo de caja negativo |
| **Híbrido** (`hybrid`) | Default en CO, EU | Mejor de los dos: sugiere prepago para tickets altos | Requiere configurar 3 campos bien |

### 6.2 Guía por país

| País | Recomendación | Rationale |
|---|---|---|
| 🇨🇴 **Colombia** | **Híbrido fuerte** | WA es el canal dominante, clientes nuevos desconfían del prepago, pero tickets > $250k justifican descuento. Set `requirePrepayMin: 250000`, `prepayDiscountPct: 5`, `codFee: 8000-12000`. |
| 🇲🇽 **México** | **COD** | Cultura fuerte de contra entrega, logística madura (DHL/FedEx/99Minutos), banca aún con desconfianza. Set `codFee: 60-80 MXN`. |
| 🇪🇸 **España / 🇩🇪 Alemania / 🇪🇺 EU** | **Anticipado obligatorio** | Confianza alta en Stripe/PayPal/SEPA, envíos internacionales caros, aduana. No ofrecer COD. |
| 🇺🇸 **USA / 🇨🇦 Canada** | **Anticipado** | Igual que EU. |
| 🇧🇷 **Brasil** | **Anticipado (Pix)** | Pix es instantáneo y sin fricción — mejor que COD. |

### 6.3 Los campos exactos (tabla `Channel`)

| Campo | Tipo | Significado |
|---|---|---|
| `paymentStrategy` | String | `advance` / `cod` / `hybrid` |
| `requirePrepayMin` | Float? | En híbrido: pedidos > este valor sugieren prepago |
| `prepayDiscountPct` | Float (default 0) | % de descuento si paga anticipado (0-100) |
| `codFee` | Float (default 0) | Recargo en COP/MXN/EUR por envío contra entrega |

### 6.4 Ejemplo numérico: ¿qué `codFee` aplicar?

> 💡 **Pensamiento ágil**: el COD no es "gratis". Cada rechazo en puerta cuesta: envío ida + vuelta + (si la mercancía se daña o no se puede re-vender) el COGS completo. El `codFee` debe cubrir ese riesgo.

**Supuesto**: AOV = $90.000 COP, margen 60% (COGS = $36.000), envío = $8.000 por intento, descuento prepago = 5%.

**Por pedido anticipado**:
```
+ Ingreso        $90.000
− Descuento 5%   $4.500
− COGS           $36.000
− Envío          $8.000
────────────────────────
= Utilidad       $41.500
```

**Por pedido COD exitoso** (85% de los casos):
```
+ Ingreso        $90.000
+ codFee         F
− COGS           $36.000
− Envío          $8.000
────────────────────────
= Utilidad       $46.000 + F
```

**Por pedido COD rechazado** (15% de los casos, asumiendo mercancía no revendible):
```
+ Ingreso        $0
− COGS perdido   $36.000
− Envío ida+vuelta $16.000
────────────────────────
= Utilidad       −$52.000
```

**Utilidad esperada por intento COD** (sin codFee):
```
0.85 × ($46.000) + 0.15 × (−$52.000)
= $39.100 − $7.800
= $31.300
```

Ya es positivo (no pierdes plata). Pero comparado con el anticipo ($41.500), pierdes **$10.200 por pedido** en expectativa.

**Para igualar al anticipo**:
```
$31.300 + 0.85 × F = $41.500
0.85 × F = $10.200
F = $12.000
```

✅ **Conclusión**: configura `codFee: 12000` para que el COD sea tan rentable como el anticipo con 15% de rechazo.

**Si tu rechazo sube a 25%**:
```
0.75 × ($46.000 + F) + 0.25 × (−$52.000) = $41.500
$34.500 + 0.75F − $13.000 = $41.500
0.75F = $20.000
F = $26.667 → redondear a $27.000
```

⚠️ Si necesitas `codFee > $20.000` para cubrir el riesgo, **el cliente lo va a percibir como caro** y se va. En ese caso, mejor bajar el límite `requirePrepayMin` para forzar más prepagos.

### 6.5 Cómo configurarlo en el módulo Configuración

1. Ve a **Configuración → Estrategia de pago por canal**.
2. Para WhatsApp Colombia, selecciona **Híbrido** en el Select.
3. Completa:
   - Mín. para prepago: `250000`
   - % descuento prepago: `5`
   - Recargo envío COD: `12000` (según el cálculo de arriba)
4. Click **Guardar**.
5. Repite para WhatsApp MX (COD, codFee 60), Messenger (Anticipado, descuento 7), Instagram (Híbrido, min 80 EUR, descuento 5, codFee 4).
6. En **Umbrales del trafficker**, ajusta:
   - ROAS mínimo: `0.8` (apagar todo lo que esté por debajo)
   - CPA objetivo: `35000` (COP — pauta que cueste más por pedido enciende alerta)
   - Valor máx. para COD: `250000` (pedidos más grandes no se permiten COD)
7. Click **Guardar umbrales**.

💡 **Pensamiento ágil**: el `cod_max_order_value` es tu red de seguridad — aunque el canal sea híbrido, ningún pedido > $250k debería ir COD porque el riesgo de rechazo con ticket alto te mata el margen.

---

## 7. Conectar canales de mensajería

> En demo los canales ya están "verificados" en la DB. Esta sección explica cómo conectarlos de verdad en producción.

### 7.1 WhatsApp Business API (Cloud API de Meta)

#### Pasos en Meta for Developers

1. Ve a https://developers.facebook.com/apps → **Create App** → tipo **Business**.
2. Agrega el producto **WhatsApp**.
3. En **API Setup**, copia:
   - **Phone Number ID** → `WA_PHONE_NUMBER_ID`
   - **Temporary/Permanent Access Token** → `WA_ACCESS_TOKEN`
4. En **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://tu-dominio.com/api/webhooks/whatsapp`
   - Verify Token: el valor que pongas en `WA_VERIFY_TOKEN` (default `commerceflow_verify`)
   - Suscríbete a los campos: `messages`, `message_status`, `message_template_status_update`

#### Permisos requeridos

- `whatsapp_business_messaging` (enviar mensajes)
- `whatsapp_business_management` (gestionar plantillas)

#### Verificación del webhook

El endpoint `GET /api/webhooks/whatsapp` responde al handshake de Meta:
```ts
// src/app/api/webhooks/whatsapp/route.ts
if (mode === 'subscribe' && token === expected) {
  return new NextResponse(challenge, { status: 200 })
}
return NextResponse.json({ error: 'forbidden' }, { status: 403 })
```

Meta envía `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<tu_token>&hub.challenge=<challenge>`. Si el token coincide, devuelves el `challenge`. ✅

#### Mensajes inbound

Meta envía `POST /api/webhooks/whatsapp` con el payload en `entry[].changes[].value.messages[]`. En v1 el handler solo guarda en `AuditLog`:
```ts
await db.auditLog.create({
  data: { action: 'webhook.wa.inbound', entity: 'Webhook', meta: JSON.stringify(body).slice(0, 1000) },
})
```

**Para producción** debes implementar (TODO):
1. Parsear `entry[0].changes[0].value.messages[0]`.
2. Resolver `customer` por `wa_id` (E.164 phone) → upsert.
3. Upsert `Conversation` en el canal WhatsApp correspondiente (`Channel.type='whatsapp'` y `accountId` match).
4. Crear `Message { direction:'inbound', body, type }`.
5. Emitir `message:new` por socket.io para que el dashboard actualice en vivo.
6. Si la conversación tiene `sourceAdId` null y el cliente trae `utm` o `fbclid` en metadata, atribuir.

### 7.2 Facebook Messenger

#### Pasos

1. En la misma Meta App, agrega el producto **Messenger** (o usa Messenger Settings).
2. En **Messenger → Settings → Webhooks**:
   - Callback URL: `https://tu-dominio.com/api/webhooks/meta`
   - Verify Token: `META_VERIFY_TOKEN`
   - Suscríbete a: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`
3. Genera el **Page Access Token** para tu página → `MESSENGER_PAGE_ID` + `MESSENGER_ACCESS_TOKEN`.
4. En **Webhooks**, suscribe tu página específica al webhook.

#### Permisisos de la App (App Review)

- `pages_messaging` (enviar/recibir mensajes)
- `pages_show_list`
- `pages_manage_metadata`
- `read_page_mailboxes`

⚠️ Estos permisos requieren **App Review** de Meta para uso en producción (puede tardar 2-5 días).

### 7.3 Instagram DM

#### Pasos

1. Necesitas una cuenta de Instagram **Professional** (Business o Creator).
2. Conéctala a una Facebook Page en Meta Business Suite (Settings → Instagram).
3. En la Meta App, agrega producto **Instagram** (o usa el Messenger webhook unificado).
4. Webhook: **mismo endpoint que Messenger** (`/api/webhooks/meta`). Meta envía mensajes IG por el mismo webhook.
5. Permisisos:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `pages_show_list`
6. En `IG_ACCOUNT_ID` guarda el ID de la cuenta IG conectada.

### 7.4 Resumen de webhooks y tokens

| Canal | Webhook URL | Verify Token env var | Permisisos clave |
|---|---|---|---|
| WhatsApp | `POST /api/webhooks/whatsapp` | `WA_VERIFY_TOKEN` | `whatsapp_business_messaging` |
| Messenger | `POST /api/webhooks/meta` | `META_VERIFY_TOKEN` | `pages_messaging` |
| Instagram DM | `POST /api/webhooks/meta` (mismo) | `META_VERIFY_TOKEN` | `instagram_manage_messages` |

✅ **Verificación post-config**: usa `curl` para simular un POST:
```bash
curl -X POST https://tu-dominio.com/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
# → {"received":true}
```
Luego verifica en la DB:
```sql
SELECT * FROM AuditLog WHERE action='webhook.wa.inbound' ORDER BY createdAt DESC LIMIT 1;
```

---

## 8. Conectar plataformas de pauta

### 8.1 Meta Ads API

#### Setup

1. En Meta for Developers, en tu app, ve a **Marketing API**.
2. Genera un **System User access token** con permisos `ads_read` y `ads_management` → `META_ACCESS_TOKEN`.
3. Identifica tu `ad_account_id` (formato `act_XXXXXXXXX`) → `META_AD_ACCOUNT_ID`.
4. Opcional pero recomendado: `META_APP_SECRET` para verificar X-Hub-Signature.

#### Qué importar

ZIAY necesita para cada anuncio:
- `externalId` = el `ad_id` de Meta (ej. `120201000000000`)
- `name` = el nombre del ad
- `campaign` = campaign_id + nombre
- **Diariamente**: `spend`, `impressions`, `clicks`, `convReported` (estas se guardan en `AdSpend` con `@@unique([adId, date])`)

#### Query típica (Meta Insights API)

```http
GET https://graph.facebook.com/v19.0/act_<ACCOUNT_ID>/insights
  ?fields=ad_id,ad_name,spend,impressions,clicks,actions
  &level=ad
  &time_increment=1
  &date_preset=last_14d
  &access_token=<TOKEN>
```

Las "conversiones" reportadas por Meta vienen en `actions[]` donde `action_type='purchase'` o `'offsite_conversion.fb_pixel_purchase'`. Suma esos valores → `convReported`.

#### Webhook de Meta Ads (opcional pero recomendado)

Suscríbete al webhook `leadgen` y `in_app_ad_click` para captura en tiempo real.

### 8.2 Google Ads API

#### Setup

1. Solicita acceso a **Google Ads API** en https://developers.google.com/google-ads/api/docs/start
2. Necesitas:
   - **Developer Token** (lo pides a Google, tarda ~1 semana) → `GOOGLE_ADS_DEVELOPER_TOKEN`
   - **Customer ID** (formato `123-456-7890`) → `GOOGLE_ADS_CUSTOMER_ID`
   - **OAuth 2.0 Refresh Token** (creas un OAuth client en Google Cloud Console, haces el flujo once, guardas el refresh token) → `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`

#### Qué importar

- `externalId` = el `ad_group_ad.resource_name` o `ad_id`
- Para cada día: `metrics.cost_micros`, `metrics.impressions`, `metrics.clicks`, `metrics.conversions` (del campo `metrics.conversions` que reporta Google)

#### GAQL Query típica

```sql
SELECT
  ad_group_ad.ad.id,
  ad_group_ad.ad.name,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions
FROM ad_group_ad
WHERE segments.date DURING LAST_14_DAYS
```

`cost_micros` está en millonésimas de la moneda base — divide entre 1.000.000 para obtener el valor real.

### 8.3 TikTok Ads API

#### Setup

1. Ve a https://ads.tiktok.com/marketing_api/docs → solicita acceso al Marketing API.
2. Obtén:
   - **Access Token** (app-level o advertiser-level) → `TIKTOK_ACCESS_TOKEN`
   - **Advertiser ID** → `TIKTOK_ADVERTISER_ID`

#### Qué importar

- `externalId` = el `ad_id` de TikTok
- Diariamente: `spend`, `impressions`, `clicks`, `conversion` (del reporte)

#### Endpoint típico

```http
GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/
  ?advertiser_id=<ADVERTISER_ID>
  &report_type=BASIC
  &data_level=AD_ID
  &dimensions=["ad_id","stat_time_day"]
  &metrics=["cost","impressions","clicks","conversion"]
  &start_date=2025-01-01
  &end_date=2025-01-14
```

### 8.4 La importancia del click_id

> 💡 **Pensamiento ágil**: el `click_id` es **la firma del anuncio en el cliente**. Sin él, no hay atribución — un pedido sin `click_id` es "orgánico" y ningún anuncio recibe el crédito.

#### Cómo se captura

1. Cuando un usuario hace click en un anuncio de Meta, Google o TikTok, la URL de destino incluye un parámetro: `fbclid`, `gclid`, o `ttclid`.
2. La landing page (o el "Click to WhatsApp" / "Send Message" de Meta) **debe preservar** ese parámetro.
3. Para WhatsApp "Click to Chat" (`https://wa.me/573001112233?text=...`), Meta permite usar plantillas con URL parameters — el `fbclid` viaja en la URL.
4. Cuando el cliente abre conversación, el webhook inbound trae metadata (ej. `context` en WhatsApp Cloud API). El backend debe:
   - Extraer `fbclid`/`gclid`/`ttclid` del contexto o URL.
   - Buscar el `Ad` cuyo `externalId` corresponde (vía el mapeo platform→click_id prefix, o vía una tabla auxiliar).
   - Setear `Conversation.sourceAdId`, `sourceCampaign`, `utm`.
5. Cuando se crea el `Order` desde esa conversación, se copia `sourceAdId`, `sourceCampaign`, `sourcePlatform`, `clickId` al pedido.
6. Se crea un `Attribution { orderId, adId, weight:1.0, model:'last_click', touch:'click' }`.

⚠️ **Sin click_id, no hay atribución**. Si tus anuncios no están parametrizando correctamente, vas a ver muchos pedidos "Orgánico" y tu ROAS se va a ver artificialmente bajo (porque los pedidos existen pero no se le asignan a ningún anuncio).

### 8.5 Tabla resumen

| Plataforma | Click ID | Librería sugerida | Scopes/Permisos |
|---|---|---|---|
| Meta Ads | `fbclid` | `facebook-nodejs-business-sdk` | `ads_read`, `ads_management` |
| Google Ads | `gclid` | `@google-ads/google-ads-node` | `https://www.googleapis.com/auth/adwords` |
| TikTok Ads | `ttclid` | HTTP fetch directo | Marketing API access |

---

## 9. El motor de atribución explicado (pensamiento ágil)

> Todo el motor está en `src/app/api/ads/route.ts`. Lee ese archivo — son 152 líneas que contienen toda la lógica.

### 9.1 Fórmulas reales (del código)

```typescript
const spend         = Σ adSpend.spend                              // inversión total 14d
const impressions   = Σ adSpend.impressions
const clicks        = Σ adSpend.clicks
const convReported  = Σ adSpend.convReported                       // lo que reporta la plataforma

const orderCount    = ad.orders.length                              // pedidos reales atribuidos
const revenue       = Σ order.total                                 // ingresos totales
const paidRevenue   = Σ order.total where paymentStatus='paid'      // SOLO cobrados
const units         = Σ order.items.quantity
const cogs          = Σ item.cost × item.quantity
const grossProfit   = paidRevenue − cogs
const netProfit     = grossProfit − spend

const cpa   = orderCount > 0 ? spend / orderCount : (spend > 0 ? Infinity : 0)
const cpl   = convReported > 0 ? spend / convReported : 0
const roas  = spend > 0 ? paidRevenue / spend : 0
const roi   = spend > 0 ? netProfit / spend : 0
const ctr   = impressions > 0 ? (clicks / impressions) × 100 : 0
const cpc   = clicks > 0 ? spend / clicks : 0
const cvr   = clicks > 0 ? (orderCount / clicks) × 100 : 0
const aov   = orderCount > 0 ? revenue / orderCount : 0
```

💡 **Pensamiento ágil**: nota que el **ROAS se calcula con `paidRevenue`, no con `revenue`**. Esto es a propósito. Si un cliente pidió COD pero aún no paga, no cuentes esa venta como retorno de tu pauta. Solo cuenta lo que **efectivamente entró a tu cuenta bancaria**. Eso te da un ROAS más conservador (y más real) que el que te muestran las plataformas.

### 9.2 Veredicto engine

```typescript
// Thresholds (configurables en Settings)
roasKill  = settings.roas_kill_threshold || 0.8    // default 0.8x
cpaTarget = settings.cpa_target || 35000           // default $35.000 COP

// Lógica
if (orderCount === 0 && spend > cpaTarget)        return 'kill'         // quema sin vender
if (cannibalizing)                                 return 'cannibalize'  //platform miente
if (roas < roasKill && spend > cpaTarget × 2)     return 'pause'        // mal + gasto material
if (roas >= 2)                                     return 'scale'        // escalar
if (roas >= 1)                                     return 'optimize'     // optimizar
return 'watch'                                                            // vigilar

// Canibalización
cannibalizing = spend > 0
  && roas < roasKill
  && orderCount === 0
  && convReported > 0
```

| Veredicto | Color en UI | Cuándo | Acción sugerida |
|---|---|---|---|
| `scale` | Verde (Rocket) | ROAS ≥ 2x | Subir presupuesto 20-30% |
| `optimize` | Sky (Gauge) | ROAS 1-2x | Probar variantes creativas |
| `watch` | Slate (Eye) | Bajo volumen | Esperar más data (7 días) |
| `pause` | Amber (Pause) | ROAS < 0.8x y gasto material | Pausar y revisar creativo/audiencia |
| `kill` | Rose (Skull) | Cero ventas + gasto > CPA target | Apagar YA |
| `cannibalize` | Violet (Flame) | Plataforma reporta conversiones pero 0 pedidos reales | Apagar YA + denunciar atribución falsa |

### 9.3 Modelos de atribución

El campo `Attribution.model` soporta 4 valores. En v1 la asignación es **last-click** (el último anuncio que tocó al cliente recibe 100% del crédito). Para usar otros modelos:

| Modelo | Cómo reparte el crédito | Cuándo usar |
|---|---|---|
| **last_click** (default) | 100% al último click antes del pedido | E-commerce transaccional, ciclos cortos |
| **first_click** | 100% al primer click (el que descubrió la marca) | Brand awareness, lanzamientos |
| **linear** | Reparte equitativamente entre todos los touchpoints | Ciclos largos, B2B |
| **time_decay** | Más peso a los clicks más cercanos al pedido | Ciclos de 7-30 días, retail considerado |

💡 **Pensamiento ágil**: si un cliente ve tu anuncio de Meta el lunes, busca tu marca en Google el miércoles y compra el viernes, **last-click** le da todo el crédito a Google (y Meta se ve "malo"). **first_click** le da todo a Meta. La realidad suele estar en el medio. Para LATAM e-commerce con ciclos cortos (1-3 días), **last-click es lo más práctico** y es lo que viene por defecto.

### 9.4 Canibalización: por qué las plataformas sobre-reportan

Las plataformas de pauta tienen incentivo a inflar sus conversiones:
- **Meta** cuenta como "compra" cualquier evento del pixel que coincida con un usuario que vio el anuncio en los últimos 7 días (view-through) o 1 día (click-through).
- **Google** usa modelos similares con `ga:campaign` y conversiones importadas.
- Si un cliente vio tu anuncio de Meta, pero compró vía WhatsApp directo (sin click), Meta igual se atribuye el crédito.

**ZIAY detecta esto** cuando:
- `convReported > 0` (la plataforma dice "vendí")
- `orderCount === 0` (no hay pedido real con ese `click_id`)
- `roas < roasKill` (el ROAS real está bajo el umbral)

El campo `flags.platformGap = convReported − orderCount` te dice cuántas "conversiones fantasma" reportó la plataforma. Si es > 0 consistentemente → canibalización.

### 9.5 Umbrales configurables (tabla `Setting`)

| Key | Default | Significado |
|---|---|---|
| `roas_kill_threshold` | 0.8 | ROAS por debajo del cual se pausa/kill |
| `cpa_target` | 35000 | CPA objetivo en COP — gasto por encima sin ventas = kill |
| `cod_max_order_value` | 250000 | Valor máx. para permitir COD |
| `default_currency` | COP | Moneda por defecto |
| `default_country` | CO | País por defecto |

Cambia estos valores en **Configuración → Umbrales del trafficker → Guardar umbrales**.

---

## 10. Workflows operativos diarios

### 10.1 Rol: Agente de chat (rutina mañana/tarde)

#### Mañana (8:00-9:00)

| # | Acción | Dónde |
|---|---|---|
| 1 | Abrir **Mensajería** | Sidebar |
| 2 | Filtrar por **Abiertas** | Tabs superior izquierda |
| 3 | Revisar conversaciones con badge **URGENTE** (rojo) primero | Lista |
| 4 | Para cada conversación urgente: abrir → leer historial → revisar panel derecho (atribución, pedidos previos, tags VIP) | Thread + panel |
| 5 | Si el cliente está esperando respuesta: click **Sugerir con IA** → revisar → editar si necesario → **Enviar** | Composer |
| 6 | Si la conversación quedó resuelta: cambiar estado a **Resuelta** (Select en header del thread) | Header thread |
| 7 | Si hay pedidos nuevos asociados: ir a **Pedidos & Pagos** y verificar el modo de pago y dirección | Pedidos |

#### Tarde (14:00-15:00)

| # | Acción |
|---|---|
| 1 | Volver a filtrar por **Abiertas** |
| 2 | Responder conversaciones pendientes de la mañana |
| 3 | Marcar como **Resuelta** las que ya cerraron |
| 4 | Si surgió una conversación con prioridad **urgente** (ej. "no llegó mi pedido"), asignarla a Camila Torres (agent) y notificar por canal externo |

#### Checklist fin de día

- [ ] Cero conversaciones URGENTES sin responder
- [ ] Conversaciones resueltas marcadas como tal
- [ ] Pedidos creados desde el chat con `paymentMode` correcto (anticipado si el canal exige, COD si es híbrido y el ticket es bajo)

### 10.2 Rol: Trafficker (rutina diaria 9am)

> Esta es la rutina más estructurada — el trafficker es quien mueve la aguja de ROAS.

#### 9:00 — Revisión de pauta

| # | Acción | Dónde |
|---|---|---|
| 1 | Abrir **Atribución de Pauta** | Sidebar |
| 2 | Revisar los 4 KPIs del top: ROAS consolidado, CPA, Utilidad neta, ROI | KPI strip |
| 3 | Si ROAS consolidado < 1.5x → revisar urgentemente qué anuncios están bajando el promedio | — |
| 4 | Sin filtro de plataforma: ordenar por ROAS (la tabla viene ordenada por spend desc — usa el sort o filtra) | Tabla |
| 5 | Filtrar por **Meta Ads** primero (suele ser el 60-70% del gasto) | Select plataforma |
| 6 | Identificar todas las filas con veredicto **Apagar** (rojo Skull) o **Canibaliza** (violeta Flame) | Columna Veredicto |
| 7 | Para cada una: revisar que `convReported > 0` y `orderCount = 0` (confirmar canibalización) | Columnas Conv. rep. y Ventas reales |
| 8 | Click **Apagar** en cada una | Columna Acción |
| 9 | Anotar el motivo en el toast (si pide reason) — usar "Canibaliza atribución" o "Sin ventas en 14d" | Modal/toast |
| 10 | Repetir para Google Ads y TikTok | Select plataforma |

#### 9:30 — Identificar ganadores

| # | Acción |
|---|---|
| 1 | Filtrar filas con veredicto **Escalar** (verde Rocket) |
| 2 | Para cada una: click **Escalar** |
| 3 | En la plataforma real (Meta Ads Manager / Google Ads / TikTok Ads), subir el presupuesto del ad set en 20-30% |
| 4 | Volver mañana — si el ROAS se mantiene ≥ 2x después de subir presupuesto, seguir escalando |

#### 10:00 — Vigilar

| # | Acción |
|---|---|
| 1 | Filtrar filas con veredicto **Optimizar** o **Vigilar** |
| 2 | Para cada una: click **Vigilar** |
| 3 | Anotar el ad_id en tu backlog de optimización |
| 4 | En la plataforma, probar nuevas variantes (copy, creativo, audiencia) — NO subir presupuesto |

#### 10:30 — Verificar audit log

```sql
SELECT action, entity, entityId, meta, createdAt
FROM AuditLog
WHERE entity = 'Ad' AND createdAt > datetime('now', '-1 day')
ORDER BY createdAt DESC;
```

Debes ver todas las acciones `ad.kill`, `ad.pause`, `ad.scale` con sus motivos.

#### Checklist fin de jornada trafficker

- [ ] Cero anuncios en veredicto `kill` o `cannibalize` sin accionar
- [ ] Todos los `kill` anotados en audit log
- [ ] Anuncios escalados confirmados en la plataforma real
- [ ] Si surgió un canibalizador nuevo, documento el patrón (creative, audiencia, plataforma) para evitar repetirlo

### 10.3 Rol: Finanzas (conciliación COD vs. anticipo)

#### Diario (10:00)

| # | Acción | Dónde |
|---|---|---|
| 1 | Abrir **Pedidos & Pagos** | Sidebar |
| 2 | Filtrar por **Modo de pago = Contra entrega** y **Estado = Enviado** | Filtros |
| 3 | Para cada pedido enviado hoy: esperar confirmación del courier | — |
| 4 | Cuando el courier confirme entrega y pago: Select **"Mover a..." → Entregado** | Columna Acciones |
| 5 | Si el cliente rechazó: Select **"Mover a..." → Cancelar** | — |
| 6 | Filtrar por **Estado = Nuevo** y **Modo de pago = Anticipado**: verificar que los pagos llegaron al gateway (Mercado Pago / Wompi / Stripe) | — |
| 7 | Si el pago llegó: Select **"Mover a..." → Marcar pagado** → luego **Preparando** → **Enviar** cuando salga | — |

#### Semanal (lunes 8am)

- Conciliar el total de `paidRevenue` del módulo **Atribución de Pauta** vs. el extracto bancario del gateway de pago.
- Calcular la tasa real de rechazo COD = `cancelled COD / total COD` de los últimos 30 días.
- Si el rechazo sube de 18%, ajustar `codFee` hacia arriba (ver sección 6.4).
- Si el rechazo baja de 10%, considerar bajar el `codFee` para ser más competitivo.

---

## 11. IA conversacional: cómo sacarle provecho

### 11.1 Cuándo usar "Sugerir con IA"

El botón **"Sugerir con IA"** (ícono Sparkles, en el composer del thread) llama a `POST /api/ai-reply` con `{conversationId}`.

**Úsalo cuando**:
- El cliente acaba de abrir conversación y necesitas un saludo + propuesta de valor rápida.
- El cliente preguntó por un producto del catálogo y necesitas responder con precio + modo de pago del canal.
- Estás saturado (10+ conversaciones abiertas) y necesitas respuestas base para editar rápido.

**NO lo uses cuando**:
- El cliente está enojado o tiene un reclamo (la IA tiende a ser amable-genérica; mejor personalizar).
- Necesitas dar información específica que no está en el catálogo o la estrategia del canal (la IA no inventa).
- La conversación es muy técnica (problema de envío, devolución) — la IA no tiene contexto operativo.

### 11.2 Qué contexto usa (system prompt real)

El backend (`src/app/api/ai-reply/route.ts`) construye un system prompt con:

1. **Identidad**: "asistente de ventas conversacional experto para una tienda de belleza y cuidado personal en Colombia (y expansión internacional)".
2. **Canal**: `displayName` y `type` (ej. "WhatsApp · CO · whatsapp").
3. **Estrategia de pago del canal**: texto generado según `paymentStrategy`:
   - `advance`: "Este canal exige PAGO ANTICIPADO. Ofrece X% de descuento por pago anticipado y envía link de pago del carrito."
   - `cod`: "Este canal opera solo CONTRA ENTREGA. Costo de envío contra entrega: $Y. Confirma dirección y ciudad antes de cerrar."
   - `hybrid`: "Este canal es HÍBRIDO. Para pedidos > $Z recomienda pago anticipado (X% off). Para pedidos menores permite contra entrega (recargo $Y)."
4. **Cliente**: nombre, país, ciudad.
5. **Atribución**: "vino por campaña 'X'" o "orgánico".
6. **Catálogo activo** (hasta 8 productos): `nombre ($precio COP, sku XXXXX)`.
7. **Historial** (últimos 12 mensajes): `Cliente: ...` / `Agente: ...`.
8. **Reglas**: "Tono friendly, cálido, cercano (LATAM), emojis moderados. Máximo 2 mensajes cortos. Cierra hacia la venta: confirma producto, cantidad, modo de pago y dirección. NO inventes precios fuera del catálogo. Si el cliente pregunta por contra entrega y el canal es solo 'advance', explica amablemente que ese canal requiere pago anticipado pero ofrece descuento."

### 11.3 Cómo editar la sugerencia antes de enviar

1. Click **Sugerir con IA**.
2. Espera 2-5 segundos (toast "Generando...").
3. El texto aparece en el Textarea. **NO se envía automáticamente**.
4. Edita lo que quieras:
   - Personaliza el saludo con el nombre real.
   - Ajusta el precio si hay una promo especial no reflejada en el catálogo.
   - Agrega contexto específico (ej. "vi tu comentario sobre el envío a Medellín").
5. Click **Enviar** (o Enter).

### 11.4 Limitaciones (importante)

⚠️ **La IA NO**:
- Inventa precios que no estén en el catálogo (`Product.price`).
- Conoce el stock real (`Product.stock`).
- Genera links de pago reales (eso lo haces tú con el gateway).
- Habla idiomas distintos al español por defecto (ver sección 16 sobre clientes EU).
- Recuerda pedidos anteriores más allá de los 12 mensajes del historial.

### 11.5 Cómo mejorar el system prompt

El system prompt vive en `src/app/api/ai-reply/route.ts` línea 40-49. Para mejorarlo:

```typescript
// Ejemplo de mejora: agregar info de stock y promos activas
const promos = await db.automationRule.findMany({
  where: { active: true, trigger: 'keyword' }
})

const systemPrompt = `Eres un asistente de ventas conversacional experto...

ESTRATEGIA DE PAGO DEL CANAL: ${strategyText}

CATÁLOGO CON STOCK:
${products.map(p => `- ${p.name} ($${p.price.toLocaleString('es-CO')} COP, sku ${p.sku}, stock ${p.stock} und)`).join('\n')}

PROMOS ACTIVAS:
${promos.map(p => `- ${p.name}: ${p.condition}`).join('\n')}

REGLAS ADICIONALES:
- Si el cliente pregunta por disponibilidad y stock < 10, generar urgencia.
- Si el cliente menciona ciudad con envío gratis activo, mencionarlo.
...`
```

Considera mover el system prompt a la tabla `Setting` (key `ai_system_prompt`) para editarlo sin redeploy.

### 11.6 Fallback determinístico

Si el LLM falla (timeout, API caída), el backend responde con un fallback determinístico (líneas 62-66):

```typescript
const fallback = `¡Hola ${conv.customer.name.split(' ')[0]}! 👋 Gracias por escribir. ¿Te ayudo a confirmar tu pedido? Cuéntame qué producto te interesa y tu ciudad para coordinar el envío.`
return NextResponse.json({ reply: fallback, confidence: 0.3, error: message })
```

La UI detecta `confidence < 0.5` y muestra toast "Respuesta de respaldo generada (IA no disponible en demo)".

✅ **Esto significa que el composer nunca se rompe** — siempre hay una respuesta, incluso si el LLM está caído.

---

## 12. Seguridad y cumplimiento

### 12.1 PII: qué se guarda

| Modelo | PII guardada | Origen |
|---|---|---|
| `Customer` | nombre, phone (E.164), psid, igId, email, country, city, address, notes, tags | Webhooks + agente |
| `Order` | country, city, address, paymentRef (referencia del gateway) | Checkout + agente |
| `Message` | body (texto libre, puede contener datos sensibles del cliente) | Webhooks |
| `AuditLog` | meta (JSON con info de acciones, puede contener identificadores) | Acciones del sistema |

⚠️ **El campo `Message.body` es texto libre** — los clientes pueden escribir datos sensibles (cédula, tarjeta, dirección completa). Debes:
1. No loguear bodies en texto plano fuera de la DB.
2. Implementar PII detection (regex para tarjetas, cédulas) en el webhook handler antes de guardar.
3. Tener retention policy (ver 12.3).

### 12.2 Cifrado

| Capa | Recomendación |
|---|---|
| **En tránsito** | TLS 1.3 obligatorio (Caddy lo hace automáticamente con Let's Encrypt) |
| **En reposo (DB)** | PostgreSQL: habilitar `pgcrypto` y cifrar columnas sensibles (Customer.phone, Customer.email, Order.paymentRef) con `pgp_sym_encrypt` |
| **Secrets** | Nunca en `.env` en producción — usar AWS Secrets Manager, HashiCorp Vault, o GCP Secret Manager |
| **Tokens de plataforma** | Campo `AdPlatform.accessToken` debe ir cifrado (en v1 está en plain text para demo — **NO usar en prod**) |

### 12.3 Retención y derecho al olvido

#### GDPR (EU) y Ley 1581 (Colombia)

Ambas regulaciones exigen:
- **Derecho de acceso**: el cliente puede pedir todos sus datos. Implementar endpoint `GET /api/customers/me/exports` (TODO).
- **Derecho al olvido**: el cliente puede pedir borrado. Implementar `DELETE /api/customers/[id]` que:
  1. Anonimice `Customer` (name="Anonymous", phone=null, email=null).
  2. Soft-delete `Message` bodies (body="[deleted]").
  3. Mantenga `Order` para fines contables pero anonimice `address`.
  4. Log en `AuditLog` con `action='gdpr.forget'`.

#### Retención sugerida

| Dato | Tiempo | Acción |
|---|---|---|
| `Message.body` | 24 meses | Anonimizar body, mantener metadata |
| `Order` completo | 7 años (fiscal) | Mantener, anonimizar PII del customer |
| `Customer` inactivo | 36 meses | Anonimizar |
| `AuditLog` | 7 años | Mantener |

### 12.4 Roles y permisos

El modelo `User.role` soporta 4 valores (string, sin enum nativo en SQLite):

| Rol | Acceso | Restricciones |
|---|---|---|
| `admin` | Todo | — |
| `agent` | Mensajería, Pedidos (lectura + estado), Clientes | No puede cambiar Settings, no puede apagar anuncios |
| `trafficker` | Atribución de Pauta (kill/scale/pause/resume), Settings de umbrales | No puede enviar mensajes, no puede crear pedidos |
| `finance` | Pedidos & Pagos (conciliación), Overview | No puede tocar pauta, no puede enviar mensajes |

⚠️ **En v1 no hay middleware de auth** — todas las rutas son públicas. NextAuth.js v4 está disponible pero no habilitado. **Para producción DEBES**:
1. Configurar NextAuth con un provider (Credentials, Google, etc.).
2. Agregar `middleware.ts` que proteja `/api/*` y `/` salvo `/api/webhooks/*` y `/api/auth/*`.
3. Verificar `session.user.role` en cada handler de API antes de mutar.

### 12.5 Webhook signature verification

⚠️ **En v1 los webhooks no verifican signature**. Para producción:

**WhatsApp Cloud API** envía `X-Hub-Signature-256` (HMAC SHA-256 con tu App Secret). Verificar:
```typescript
import crypto from 'crypto'

const expected = 'sha256=' + crypto
  .createHmac('sha256', process.env.META_APP_SECRET!)
  .update(JSON.stringify(body))
  .digest('hex')

if (req.headers.get('x-hub-signature-256') !== expected) {
  return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
}
```

**Google Ads** usa OAuth + tokens bearer.
**TikTok** usa `X-Tt-Logid` y firma HMAC.

### 12.6 Secrets management

| Secreto | Dónde guardarlo |
|---|---|
| `DATABASE_URL` | Variable de entorno del proceso (gestionada por tu plataforma: Vercel env, Fly secrets, K8s secret) |
| Tokens de plataforma (`META_ACCESS_TOKEN`, etc.) | Secrets manager + rotación cada 60 días |
| `NEXTAUTH_SECRET` | Secrets manager + 32 bytes random |
| Webhook verify tokens | Pueden vivir en env (no son secretos críticos, pero únicos por entorno) |

---

## 13. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| **Socket no conecta** ("Conectando socket..." persistente) | 1) chat-service no está corriendo en :3003 · 2) Caddy no está en :81 · 3) Firewall bloquea 81 | `lsof -i :3003` y `lsof -i :81`. Si no hay proceso: `cd mini-services/chat-service && bun run dev` y `caddy run --config Caddyfile`. Verifica que el cliente socket conecta a `/?XTransformPort=3003` (ver `src/lib/socket.ts`). |
| **Webhook no verifica** (Meta devuelve 403) | 1) Verify token no coincide · 2) URL malformada | Verifica que `WA_VERIFY_TOKEN` / `META_VERIFY_TOKEN` en `.env` matchean exactamente el token que pusiste en Meta. Reinicia `bun run dev` tras cambiar `.env`. |
| **IA no responde** | 1) LLM no disponible en entorno · 2) `z-ai-web-dev-sdk` no inicializado | Verifica que el SDK tiene credenciales. La IA tiene fallback determinístico — si ves toast "Respuesta de respaldo generada", el LLM falló pero el composer sigue funcional. Revisa logs en `dev.log`. |
| **ROAS se ve 0** | 1) No hay `AdSpend` importado · 2) No hay `Order` atribuidos (sin `sourceAdId`) | Revisa `SELECT COUNT(*) FROM AdSpend;` y `SELECT COUNT(*) FROM "Order" WHERE sourceAdId IS NOT NULL;`. Si ambos > 0, revisa que las fechas caen dentro del rango de 14 días del query (`since`). |
| **Pedidos sin atribución** (columna Atribución vacía o "Orgánico") | 1) El anuncio no parametriza `fbclid`/`gclid`/`ttclid` · 2) La landing no captura el click_id · 3) Webhook inbound no parsea el contexto | Verifica en Meta Ads Manager que el URL del anuncio lleva `?fbclid=...`. En tu landing, agrega JS que capture el parámetro y lo guarde en cookie/localStorage. En el webhook handler, extrae `context` del payload de WhatsApp Cloud API. |
| **CPA se ve `∞`** | `orderCount = 0` y `spend > 0` | Es correcto — el anuncio gastó pero no generó pedidos. Si debería tener pedidos, revisa la atribución (ver punto anterior). |
| **Conv. rep. > Ventas reales** siempre | Canibalización real o atribución rota | Si la plataforma reporta 10 y tienes 0 pedidos reales → canibalización. Si la plataforma reporta 10 y tienes 8 pedidos pero 2 sin `click_id` → atribución incompleta, mejora captura de click_id. |
| **Dashboard en blanco / 500** | 1) DB no migrada · 2) Variables de entorno faltantes · 3) Build roto | `bun run db:push` · verifica `.env` · `bun run lint` · revisa `dev.log` |
| **No aparecen nuevos pedidos en tiempo real** | Socket.io no broadcastea `status:change` tras crear pedido | En v1 la creación de pedidos es por API/seed, no por UI. El socket solo broadcastea `message:new` y `status:change` que se emiten explícitamente. |
| **Kill de anuncio no se refleja en la plataforma real** | El backend solo actualiza DB, no llama a Meta/Google/TikTok API | En v1 el kill es solo DB + audit log. Para producción, agregar la llamada a `https://graph.facebook.com/v19.0/{ad_id}` con `{status:'PAUSED'}` (y equivalentes en Google/TikTok) en `PATCH /api/ads/[id]`. |
| **Caddy muestra 502** | Next.js no está corriendo en :3000 | `lsof -i :3000`. Si no hay proceso: `bun run dev`. |
| **`prisma db push` falla** | 1) DATABASE_URL mal formada · 2) SQLite path no existe · 3) Permisos | Verifica el path de `DATABASE_URL=file:/home/z/my-project/db/custom.db`. Crea el dir `db/` si no existe: `mkdir -p db`. |
| **Seed falla con "Unique constraint"** | Ya existe data con el mismo ID | El seed usa `upsert` — debería ser idempotente. Si falla, haz `bun run db:reset` (cuidado: borra todo). |

---

## 14. Despliegue a producción (estrategia)

### 14.1 Orden de despliegue (7 pasos)

#### Paso 1: Provisionar PostgreSQL

```bash
# Opción A: Docker local
docker run -d --name cf-pg \
  -e POSTGRES_USER=commerceflow \
  -e POSTGRES_PASSWORD=<strong-password> \
  -e POSTGRES_DB=commerceflow \
  -p 5432:5432 \
  postgres:16-alpine

# Opción B: Cloud managed (recomendado)
# - AWS RDS PostgreSQL 16 (multi-AZ)
# - GCP Cloud SQL PostgreSQL 16
# - Neon / Supabase / Railway (más simple)
# - DigitalOcean Managed PostgreSQL
```

Cambia `DATABASE_URL`:
```
DATABASE_URL=postgresql://commerceflow:<password>@<host>:5432/commerceflow?schema=public
```

⚠️ Antes de migrar, ajusta el `datasource db` en `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"   // era "sqlite"
  url      = env("DATABASE_URL")
}
```

Algunos campos usan `String` en lugar de enums (comentado en el schema). En Postgres podrías migrar a enums nativos, pero el código actual funciona con strings — no es obligatorio.

#### Paso 2: Migrar Prisma

```bash
# Crear migración inicial desde el schema
bun run db:migrate -- --name init

# En CI/CD o despliegue, usar:
# prisma migrate deploy (no interactivo, aplica migraciones pendientes)
```

#### Paso 3: Desplegar Next.js (standalone build)

`next.config.ts` ya está configurado para standalone output. Build:

```bash
bun run build
# Genera .next/standalone/ (servidor minimal) + .next/static + public
```

Opciones de hosting:

| Plataforma | Pros | Setup |
|---|---|---|
| **Vercel** | Cero config, edge functions, preview deploys | Conecta repo, set env vars, deploy auto |
| **Fly.io** | Multi-región, Docker, barato | `fly launch` + Dockerfile + `fly deploy` |
| **Docker + VPS** | Control total, barato | `docker build -t commerceflow .` + compose |
| **Railway** | Simple, Postgres incluido | Conecta repo, set env vars |
| **AWS ECS/Fargate** | Enterprise, escalado | Task definition + ALB |

**Dockerfile sugerido** (Next.js standalone):
```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install -g bun && bun install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && bun run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

#### Paso 4: Desplegar chat-service (Docker, behind gateway)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY mini-services/chat-service/package.json ./
RUN npm install -g bun && bun install
COPY mini-services/chat-service/index.ts ./
EXPOSE 3003
CMD ["bun", "index.ts"]
```

⚠️ **El chat-service debe estar en el mismo host que Caddy** (o accesible por la red interna), porque el gateway hace `reverse_proxy localhost:3003`. Si los separas, ajusta el `Caddyfile` para apuntar al host correcto.

Para multi-instancia del chat-service (HA), agrega **Redis adapter** de socket.io (ver sección 15).

#### Paso 5: Configurar Caddy + DNS + SSL

```Caddyfile
tu-dominio.com {
    encode gzip zstd

    # Webhooks van directo a Next.js (no necesitan ?XTransformPort)
    @webhooks path /api/webhooks/*
    handle @webhooks {
        reverse_proxy localhost:3000
    }

    # Socket.io via query param (compat con el cliente existente)
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort}
    }

    # Default: Next.js
    handle {
        reverse_proxy localhost:3000
    }
}
```

DNS: apunta `tu-dominio.com` A record al IP del servidor. Caddy gestionará Let's Encrypt automáticamente (`tls` automático).

#### Paso 6: Registrar webhooks en Meta/Google/TikTok

| Plataforma | URL a registrar | Verify token |
|---|---|---|
| WhatsApp | `https://tu-dominio.com/api/webhooks/whatsapp` | `WA_VERIFY_TOKEN` |
| Messenger | `https://tu-dominio.com/api/webhooks/meta` | `META_VERIFY_TOKEN` |
| Meta Ads | `https://tu-dominio.com/api/webhooks/meta` | `META_VERIFY_TOKEN` |
| Google Ads | (no webhook — pull via API) | OAuth |
| TikTok Ads | (no webhook — pull via API) | Access token |

Verifica handshake en cada plataforma (botón "Verify" en Meta Dashboard).

#### Paso 7: Smoke test end-to-end

1. Enviar un mensaje de WhatsApp real al número conectado → debe aparecer en Mensajería en < 5s.
2. Desde el dashboard, responder → debe llegar al cliente real.
3. Crear un pedido manual (via API) → debe aparecer en Pedidos.
4. Verificar que el kill-switch en Atribución actualiza la DB y crea AuditLog.
5. Revisar logs del chat-service (stdout) — verás `[chat-service] agent connected: <socket-id>`.
6. Revisar logs de Caddy (`caddy run --config Caddyfile` stdout) — verás las requests proxied.

### 14.2 Variables de entorno de producción (checklist)

```bash
# DB
DATABASE_URL=postgresql://...                      # ✅ Postgres, no SQLite

# Auth
NEXTAUTH_SECRET=<32-bytes-random>                  # ✅ Generado con `openssl rand -base64 32`
NEXTAUTH_URL=https://tu-dominio.com                # ✅ URL pública

# Webhooks
WA_VERIFY_TOKEN=<unique-strong-token>              # ✅ Cambia el default
META_VERIFY_TOKEN=<unique-strong-token>            # ✅ Cambia el default

# Meta
META_ACCESS_TOKEN=EAAB...                          # ✅ System User token
META_AD_ACCOUNT_ID=act_XXXXXXXXX
META_APP_SECRET=<app-secret>                       # ✅ Para signature verification

# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=123-456-7890
GOOGLE_ADS_OAUTH_CLIENT_ID=...
GOOGLE_ADS_OAUTH_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...

# TikTok
TIKTOK_ACCESS_TOKEN=...
TIKTOK_ADVERTISER_ID=...

# WhatsApp Cloud API
WA_PHONE_NUMBER_ID=...
WA_ACCESS_TOKEN=...

# Messenger
MESSENGER_PAGE_ID=...
MESSENGER_ACCESS_TOKEN=...

# Gateway de pago
MERCADOPAGO_ACCESS_TOKEN=...
WOMPI_PRIVATE_KEY=...
STRIPE_SECRET_KEY=...
```

### 14.3 Health checks

Crea endpoints de health:

```typescript
// src/app/api/health/route.ts
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  } catch (e) {
    return NextResponse.json({ status: 'error', db: 'down', error: String(e) }, { status: 503 })
  }
}
```

Para el chat-service:
```typescript
// agregar en mini-services/chat-service/index.ts
import { createServer } from 'http'
const healthApp = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', sockets: io.engine.clientsCount }))
  }
})
healthApp.listen(3004)  // health port separado
```

Configura uptime monitoring (UptimeRobot, BetterUptime, Datadog) sobre:
- `https://tu-dominio.com/api/health` (cada 30s)
- `https://tu-dominio.com:81/?XTransformPort=3003` (chat-service via gateway, cada 60s)

### 14.4 Rollback plan

1. **DB rollback**: `prisma migrate resolve --rolled-back <migration>` (con cuidado). Mejor: hacer backup antes de cada deploy (`pg_dump commerceflow > backup_$(date +%Y%m%d).sql`).
2. **App rollback**: en Vercel, click "Instant Rollback" al deployment anterior. En Docker, `docker run commerceflow:<previous-tag>`.
3. **Chat-service rollback**: `docker stop cf-chat && docker run -d --name cf-chat commerceflow-chat:<previous-tag>`.
4. **Caddy rollback**: mantener el `Caddyfile` en git, `git checkout HEAD~1 -- Caddyfile && caddy reload`.

⚠️ **Regla de oro**: nunca hagas deploy de un cambio de schema sin migración + backup. Prisma te protege de romper la DB si usas `migrate deploy` (no `db push` en prod).

---

## 15. Escalado y monitoreo

### 15.1 Cuándo pasar de SQLite a Postgres

> 💡 SQLite es genial para dev y demos. En producción con cualquier carga real, **migra a Postgres el día 1**.

| Síntoma de que SQLite ya no da | Acción |
|---|---|
| +1 agente concurrente escribiendo | Migrar YA |
| +50 conversaciones/día | Migrar YA |
| Webhook bursts (Meta envía 10 req/s) | Migrar YA |
| Cualquier carga real de producción | Migrar YA |

SQLite bloquea toda la DB en escritura — con 2 agentes concurrentes y webhooks entrando, vas a ver `SQLITE_BUSY` errors.

### 15.2 Read replicas

Cuando Postgres llega a > 60% CPU o queries > 200ms p95:
- Agrega **read replica** (RDS Read Replica, Cloud SQL Read Replica).
- En Prisma, usa dos clientes: uno para writes (`db.write`) y uno para reads (`db.read`). Las queries de `/api/overview` y `/api/ads` (GET) van al read replica; las mutaciones (`POST`, `PATCH`) al primary.

### 15.3 Socket.io Redis adapter (multi-instancia)

Si corres múltiples instancias del chat-service (HA, balanceo de carga), necesitas el Redis adapter para que un mensaje emitido en una instancia llegue a los sockets conectados a otra:

```typescript
// mini-services/chat-service/index.ts
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

const pubClient = createClient({ url: process.env.REDIS_URL })
const subClient = pubClient.duplicate()
await Promise.all([pubClient.connect(), subClient.connect()])
io.adapter(createAdapter(pubClient, subClient))
```

Sin esto, si el agente 1 está conectado a la instancia A y el agente 2 a la instancia B, los mensajes del agente 1 no le llegarán al agente 2.

### 15.4 Cache de KPIs

Las queries de `/api/overview` y `/api/ads` son pesadas (joins + agregaciones). Cachea con Redis o en memoria:

```typescript
// Ejemplo simple con cache en memoria de 60s
const cache = new Map<string, { data: any, at: number }>()

export async function GET(req: NextRequest) {
  const key = req.nextUrl.search
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < 60_000) {
    return NextResponse.json(cached.data)
  }
  // ... cálculo ...
  cache.set(key, { data: result, at: Date.now() })
  return NextResponse.json(result)
}
```

Para multi-instancia, usa Redis con TTL de 60s.

### 15.5 Queue para webhooks

Meta puede enviar bursts de 50+ webhooks por segundo durante campañas grandes. Procesarlos sincrónicamente va a saturar Next.js. Patrón:

1. Webhook handler solo hace `ack` (devuelve 200 inmediatamente).
2. Encola el body en Redis/SQS/BullMQ.
3. Worker procesa con rate limiting (10/s) y persiste.

```typescript
// /api/webhooks/whatsapp POST
export async function POST(req: NextRequest) {
  const body = await req.json()
  await redis.lpush('wa:inbound', JSON.stringify(body))
  return NextResponse.json({ received: true })
}

// worker.ts (proceso separado)
while (true) {
  const msg = await redis.brpop('wa:inbound', 0)
  const body = JSON.parse(msg[1])
  // ... parse, upsert, emit ...
}
```

### 15.6 Métricas a vigilar

| Métrica | Threshold | Alerta si |
|---|---|---|
| **p95 latencia API** | < 500ms | > 1s |
| **Conexiones socket.io activas** | < 1000 por instancia | > 5000 |
| **Lag de webhooks** (tiempo entre recepción y procesamiento) | < 5s | > 30s |
| **Tasa de atribución** (pedidos con `sourceAdId` / total pedidos) | > 70% | < 50% (algo roto en captura de click_id) |
| **DB connections** | < 80% del pool | > 95% |
| **CPU Postgres** | < 60% | > 80% (agregar replica) |
| **Memory Next.js** | < 70% | > 90% (memory leak) |
| **Tasa de error 5xx** | < 0.5% | > 2% |
| **ROAS consolidado** | > 1.5x | < 1.0x (revisar pauta) |
| **Tasa de rechazo COD** | < 15% | > 20% (subir codFee o limitar COD) |

Herramientas recomendadas:
- **APM**: Sentry (errors + performance), Datadog, New Relic
- **Logs**: Logtail, Logflare, CloudWatch (structurados en JSON)
- **Uptime**: UptimeRobot, BetterUptime
- **DB monitoring**: pgAdmin, Datadog Postgres integration, RDS Performance Insights

---

## 16. FAQ ágil

### 1. ¿Puedo usar solo WhatsApp sin Messenger ni Instagram?

✅ Sí. En **Configuración**, marca los canales Messenger e Instagram como inactivos (`active=false` vía DB). El dashboard seguirá mostrándolos en la lista de canales pero no recibirás webhooks de ellos. El módulo Mensajería te deja filtrar por canal (Select en la lista), así que puedes ocultarlos de tu vista diaria.

### 2. ¿Qué pasa si un cliente paga COD y rechaza en puerta?

El pedido se queda en estado `cod_pending` hasta que lo marques como `cancelled` (Select "Mover a... → Cancelar"). El `paymentStatus` queda `cod_pending` (no se mueve a `paid`). El `paidRevenue` del anuncio que lo trajo NO incluye ese pedido — por eso el ROAS se calcula solo con `paidRevenue`, no con `revenue` total. Tu `codFee` debería cubrir el costo de envío ida+vuelta (ver sección 6.4).

### 3. ¿Cómo se reparte el crédito entre 2 anuncios que tocaron al cliente?

En v1 con modelo **last_click**: el 100% del crédito va al último anuncio (el último `click_id` capturado antes del pedido). Si quieres repartir:
- **Lineal**: 50/50 entre los dos. Requiere crear 2 filas en `Attribution` con `weight=0.5` cada una.
- **Time_decay**: más peso al último (ej. 0.7 / 0.3).
- **First_click**: 100% al primero (el que descubrió la marca).

El schema soporta los 4 modelos en el campo `Attribution.model`. La UI de v1 solo muestra last-click — para otros, debes implementar el cálculo en `GET /api/ads` (sumar `revenue × weight` en lugar de `revenue`).

### 4. ¿La IA habla inglés para clientes EU?

⚠️ El system prompt está en español ("Eres un asistente de ventas conversacional experto..."). El LLM subyacente puede responder en inglés si el cliente escribe en inglés (ver conversación seed de Jessica Müller: la IA responde en inglés), pero no es consistente. Para clientes EU:
- **Cambia el system prompt** por uno multilingüe o uno por canal.
- O agrega un campo `Channel.language` y parameteriza el prompt.

### 5. ¿Puedo pausar todos los anuncios de una campaña?

En v1 el kill-switch es por **anuncio** individual (PATCH `/api/ads/[id]`). Para pausar toda una campaña:
- Filtra por nombre de campaña en el buscador (la tabla muestra `campaign.name` debajo del ad name).
- Apaga cada anuncio de la campaña uno a uno.
- O implementar endpoint `POST /api/campaigns/[id]/pause` que itere y haga `PATCH /api/ads/[id]` por cada ad (TODO).

### 6. ¿Por qué mi ROAS en Meta Ads Manager difiere del ROAS en ZIAY?

Porque Meta cuenta como "venta" cualquier evento del pixel (view-through + click-through), y usa `revenue` (no `paidRevenue`). ZIAY usa:
- `paidRevenue` (solo cobrado, no pendiente)
- `orderCount` real (pedidos con ese `click_id`, no eventos del pixel)
- Solo pedidos atribuidos vía click_id (no view-through)

Por eso ZIAY suele mostrar **ROAS más bajo pero más real** que Meta. La diferencia es la "canibalización" que Meta infla.

### 7. ¿Cómo agrego un nuevo producto al catálogo?

En v1 no hay UI para crear productos. Vía DB:
```sql
INSERT INTO Product (id, sku, name, description, price, cost, stock, active, createdAt, updatedAt)
VALUES (lower(hex(randomblob(8))), 'SKN-NEW-06', 'Nuevo Producto', 'Desc', 75000, 25000, 100, 1, datetime('now'), datetime('now'));
```
El seed (`prisma/seed.ts`) ya carga 5 productos. Para agregar más, edita el seed y re-ejecuta `bun run prisma/seed.ts`.

### 8. ¿Qué pasa si la DB se cae a mitad de una conversación?

El mensaje se intenta persistir con `POST /api/conversations`. Si la DB está caída, el endpoint devuelve 500. El frontend muestra el mensaje en la UI (optimistic update), pero al recargar la página se pierde. El socket.io igual broadcastea `message:new` a otros dashboards conectados, pero no se persiste. Recomendación: agregar retry con exponential backoff en el frontend cuando el POST falle.

### 9. ¿Puedo tener múltiples agentes viendo la misma conversación?

✅ Sí, ese es exactamente el patrón que soporta socket.io. Varios dashboards conectados al chat-service reciben el evento `message:new` simultáneamente. Para evitar que dos agentes respondan a la vez, deberías:
- Asignar la conversación a un agente (`assigneeId` en `Conversation`).
- Mostrar el avatar del assignee en la lista.
- Bloquear el composer si el agente logueado no es el assignee (TODO en v1).

### 10. ¿Cómo exporto los datos de atribución para análisis externo?

Vía API: `GET /api/ads?days=30` devuelve JSON con todos los rows, metrics, verdicts y flags. Para Excel/CSV, agrega un endpoint `/api/ads/export?format=csv` que use `json2csv` o similar. Para BI (Looker/Tableau/Metabase), conecta directo a la DB Postgres — las tablas `Ad`, `AdSpend`, `Order`, `Attribution` están normalizadas y listas para queries SQL.

---

## 17. Glosario técnico completo

### Términos del producto

| Término | Definición |
|---|---|
| **ZIAY** | Plataforma de Comercio Conversacional + Atribución Inteligente. Producto. |
| **Canal** (Channel) | Vía de mensajería con cliente: WhatsApp, Messenger, Instagram, Telegram. Cada canal tiene su propia estrategia de pago. |
| **Conversación** (Conversation) | Thread de mensajes entre un cliente y uno o más agentes. Tiene estado (open/pending/resolved/closed) y prioridad. |
| **Pedido** (Order) | Una orden de compra con items, modo de pago, estado y atribución. |
| **Click ID** | Identificador único de click de plataforma: `fbclid` (Meta), `gclid` (Google), `ttclid` (TikTok). Llave de la atribución. |
| **Veredicto** | Clasificación automática de un anuncio: scale / optimize / watch / pause / kill / cannibalize. |
| **Canibalización** | Cuando una plataforma reporta conversiones que no se materializan en pedidos reales. |
| **Kill-switch** | Acción de apagar (status=killed) un anuncio desde el dashboard, con audit log. |
| **Audit log** | Registro inmutable de acciones críticas (ad.kill, ad.pause, webhook.inbound, etc.). |

### Métricas

| Término | Fórmula |
|---|---|
| **CPA** | `spend ÷ orderCount` |
| **ROAS** | `paidRevenue ÷ spend` |
| **ROI** | `netProfit ÷ spend` = `(paidRevenue − COGS − spend) ÷ spend` |
| **CPL** | `spend ÷ convReported` |
| **CVR** | `(orderCount ÷ clicks) × 100` |
| **CTR** | `(clicks ÷ impressions) × 100` |
| **CPC** | `spend ÷ clicks` |
| **AOV** | `revenue ÷ orderCount` |
| **COGS** | `Σ (item.cost × item.quantity)` |
| **Gross Profit** | `paidRevenue − COGS` |
| **Net Profit** | `grossProfit − spend` |
| **Paid Revenue** | `Σ order.total where paymentStatus='paid'` |
| **Platform Gap** | `convReported − orderCount` |

### Estrategias de pago

| Término | Significado |
|---|---|
| **Anticipado** (advance) | Cliente paga antes de recibir, vía carrito ecommerce. |
| **COD** (Cash on Delivery) | Cliente paga en efectivo al recibir el producto. |
| **Híbrido** (hybrid) | El cliente elige, el sistema sugiere según ticket. |
| `requirePrepayMin` | En híbrido: pedidos > este valor sugieren prepago. |
| `prepayDiscountPct` | % de descuento por pago anticipado. |
| `codFee` | Recargo por envío contra entrega. |

### Modelos de atribución

| Término | Significado |
|---|---|
| **Last-click** | 100% del crédito al último click antes del pedido. Default. |
| **First-click** | 100% al primer click (descubrimiento). |
| **Lineal** | Reparto equitativo entre todos los touchpoints. |
| **Time-decay** | Más peso a los clicks más cercanos al pedido. |
| **View-through** | Atribuir por vista de anuncio (no soportado en ZIAY — solo click). |

### Roles

| Término | Permiso |
|---|---|
| **admin** | Acceso total. |
| **agent** | Mensajería + pedidos lectura/estado. |
| **trafficker** | Atribución (kill/scale/pause) + umbrales. |
| **finance** | Pedidos & conciliación. |

### Stack técnico

| Término | Qué es |
|---|---|
| **Next.js 16** | Framework React full-stack (App Router, RSC). |
| **App Router** | Sistema de rutas de Next.js basado en directorios (`app/`). |
| **Prisma ORM** | ORM para TypeScript con schema declarativo y migraciones. |
| **SQLite** | DB embebida en archivo (dev). |
| **PostgreSQL** | DB relacional open-source (prod). |
| **Socket.io** | Librería de websockets con fallback a polling. |
| **Caddy** | Servidor web con HTTPS automático (Let's Encrypt). |
| **`?XTransformPort=N`** | Convención del Caddyfile para hacer reverse proxy a `localhost:N` dinámicamente vía query param. |
| **z-ai-web-dev-sdk** | SDK de LLM para chat completions, usado en `ai-reply`. |
| **shadcn/ui** | Colección de componentes accesibles sobre Radix UI. |
| **TanStack Query** | Librería de data-fetching con cache (disponible, no usada en v1). |
| **Recharts** | Librería de charts en React. |
| **Bun** | Runtime JavaScript alternativo a Node, compatible, más rápido. |
| **Webhook** | Endpoint HTTP que recibe eventos de una plataforma externa (Meta, Google, TikTok). |
| **Verify Token** | Token compartido entre tú y la plataforma para validar el handshake del webhook. |
| **Click ID** | Ver arriba. |
| **Standalone build** | Output de Next.js que produce un servidor Node minimal sin dependencias de dev. |
| **Redis adapter** | Plugin de socket.io para multi-instancia vía pub/sub Redis. |

### Webhooks y APIs externas

| Término | Significado |
|---|---|
| **WhatsApp Cloud API** | API oficial de Meta para WhatsApp Business (reemplaza a BSPs como Twilio). |
| **PSID** | Page-Scoped ID. Identificador único de un usuario en Messenger para tu Page. |
| **wa_id** | Identificador E.164 del teléfono del cliente en WhatsApp. |
| **Meta App Secret** | Secreto de la app de Meta, usado para verificar firma HMAC de webhooks. |
| **Insights API** | Endpoint de Meta Ads para obtener métricas (spend, impressions, clicks, conversions). |
| **GAQL** | Google Ads Query Language, lenguaje SQL-like para Google Ads API. |
| **Developer Token** | Token de Google Ads API (se pide a Google, tarda ~1 semana). |
| **Marketing API TikTok** | API de TikTok Ads para reportes y gestión. |

---

## Apéndice A: Estructura de archivos relevante

```
/home/z/my-project/
├── prisma/
│   ├── schema.prisma          # 17 modelos
│   └── seed.ts                # Datos demo
├── src/
│   ├── app/
│   │   ├── page.tsx           # Dashboard shell (5 vistas)
│   │   ├── layout.tsx         # Layout raíz
│   │   └── api/
│   │       ├── overview/route.ts        # KPIs
│   │       ├── conversations/           # GET list, POST send
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts        # GET detail, PATCH status
│   │       ├── orders/                  # GET list
│   │       │   ├── route.ts
│   │       │   └── [id]/route.ts        # PATCH status/payment
│   │       ├── ads/                     # GET performance
│   │       │   ├── route.ts             # ⭐ motor de atribución
│   │       │   └── [id]/route.ts        # PATCH kill/pause/resume/scale
│   │       ├── ai-reply/route.ts        # ⭐ LLM smart reply
│   │       ├── payments/config/route.ts # GET/PATCH channel strategy + global
│   │       ├── channels/route.ts        # GET channels
│   │       └── webhooks/
│   │           ├── whatsapp/route.ts    # WA Cloud API
│   │           └── meta/route.ts        # Messenger + IG + Meta Ads
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── sidebar.tsx              # NAV_ITEMS
│   │   │   ├── topbar.tsx               # País, tema, búsqueda
│   │   │   ├── overview-view.tsx        # Módulo Resumen
│   │   │   ├── messenger-view.tsx       # Módulo Mensajería (3 col)
│   │   │   ├── orders-view.tsx          # Módulo Pedidos
│   │   │   ├── ads-view.tsx             # ⭐ Módulo Atribución
│   │   │   └── settings-view.tsx        # Módulo Configuración
│   │   └── ui/                          # shadcn/ui components
│   └── lib/
│       ├── db.ts                        # Prisma client
│       ├── socket.ts                    # Socket.io client (/?XTransformPort=3003)
│       ├── format.ts                    # formatCurrency, timeAgo, etc.
│       └── utils.ts                     # cn(), helpers
├── mini-services/
│   └── chat-service/
│       ├── index.ts                     # ⭐ Socket.io server (port 3003)
│       └── package.json
├── Caddyfile                            # ⭐ Gateway (:81)
├── package.json                         # Next.js + deps
├── next.config.ts                       # Standalone output
└── .env                                 # DATABASE_URL + tokens
```

---

## Apéndice B: Comandos rápidos

```bash
# Dev completo (3 terminales)
bun run dev                                          # Next.js :3000
cd mini-services/chat-service && bun run dev          # chat-service :3003
caddy run --config Caddyfile                          # gateway :81

# DB
bun run db:push                                       # sync schema
bun run db:generate                                   # regenerate client
bun run db:migrate -- --name <nombre>                 # crear migración
bun run prisma/seed.ts                                # cargar datos demo

# Producción
bun run build                                         # standalone build
NODE_ENV=production bun .next/standalone/server.js    # start

# Debug
bun run lint                                          # ESLint
npx prisma studio                                     # GUI para DB
```

---

## Apéndice C: Estado de verificación (worklog)

Según el worklog original, estas son las verificaciones realizadas en la v1:

- ✅ Overview renderiza (VLM-verified): KPIs, charts, channel split, pie, footer sticky
- ✅ Messenger renderiza; socket "Tiempo real conectado" through gateway:81
- ✅ Messenger thread abre; AI smart reply genera respuesta ES contextual
- ✅ Live message send + respuesta simulada del cliente funciona (7 bubbles tras send)
- ✅ Orders renderiza (VLM-verified): KPIs, tabla con modos de pago + atribución, strategy cards
- ✅ Ads renderiza (VLM-verified): per-ad table, ROAS/ROI/veredicto columns, kill candidates flagged
- ✅ Settings renderiza (VLM-verified): per-channel strategy selectors, umbrales, integraciones
- ✅ ESLint pasa (0 errores)
- ✅ Todas las API routes devuelven 200

---

**Fin del documento.** Para soporte, abre un issue en el repo o contacta al equipo de plataforma.

*ZIAY · v1.0 · Bogotá · LATAM+EU · Construido con Next.js 16 · Prisma · Socket.io · LLM*
