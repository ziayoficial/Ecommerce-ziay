# ONBOARDING COMPLETO — CommerceFlow OS

> **La guía definitiva, única y exhaustiva** para operar, desarrollar y administrar CommerceFlow OS — el centro de mando de commerce conversacional + atribución de pauta para LATAM (ZIAY SAS: Saramantha, Sublimados Majestic, Lovely Pijamas, Sueño de Reina).
>
> **Este documento es la única fuente de verdad de onboarding.** Si estás leyendo otros docs al mismo tiempo, estás haciendo doble trabajo. Lee este de principio a fin y estarás listo para operar el sistema en producción.

**Versión del documento:** 1.0 (sincronizada con el `worklog.md` tras el sprint `UX-UI-VERIFICACION`).
**Audiencia:** operadores de chat, traffickers, finanzas, desarrolladores, admins de tenant, dueños de marca.
**Idioma:** español LATAM neutral (tuteo, sin regionalismos).

---

## Tabla de contenidos

1. [Bienvenida](#1-bienvenida)
2. [Conceptos clave (glosario visual)](#2-conceptos-clave-glosario-visual)
3. [Arquitectura en 60 segundos](#3-arquitectura-en-60-segundos)
4. [Requisitos previos](#4-requisitos-previos)
5. [Instalación paso a paso (3 escenarios)](#5-instalación-paso-a-paso-3-escenarios)
6. [Tour del dashboard — los 9 módulos](#6-tour-del-dashboard--los-9-módulos)
7. [Los 10 agentes conversacionales](#7-los-10-agentes-conversacionales--cuándo-y-cómo-usarlos)
8. [Configurar tu estrategia de pago](#8-configurar-tu-estrategia-de-pago)
9. [Conectar canales (WhatsApp, Messenger, Instagram)](#9-conectar-canales-whatsapp-messenger-instagram)
10. [Conectar plataformas de pauta (Meta, Google, TikTok)](#10-conectar-plataformas-de-pauta-meta-google-tiktok)
11. [El motor de atribución explicado](#11-el-motor-de-atribución-explicado)
12. [Workflows operativos diarios](#12-workflows-operativos-diarios)
13. [IA conversacional — cómo sacarle provecho](#13-ia-conversacional--cómo-sacarle-provecho)
14. [Kanban operativo — gestión de pedidos](#14-kanban-operativo--gestión-de-pedidos)
15. [Monetización — cómo se cobra](#15-monetización--cómo-se-cobra)
16. [Seguridad y cumplimiento](#16-seguridad-y-cumplimiento)
17. [Troubleshooting (20 problemas comunes)](#17-troubleshooting-20-problemas-comunes)
18. [Próximos pasos](#18-próximos-pasos)
19. [Glosario técnico completo](#19-glosario-técnico-completo)
20. [Soporte y recursos](#20-soporte-y-recursos)

---

## 1. Bienvenida

### Qué es CommerceFlow OS

CommerceFlow OS es un **centro de mando de commerce conversacional + atribución de pauta** construido por y para ZIAY SAS, que opera cuatro marcas (Saramantha, Sublimados Majestic, Lovely Pijamas y Sueño de Reina) y atiende también a clientes externos con sus propios catálogos. Unifica en un solo dashboard las tres conversaciones que te hacen dinero en LATAM — WhatsApp, Messenger e Instagram DM — y las conecta con los anuncios que trajeron a cada cliente (Meta, Google, TikTok), de modo que por primera vez sabes **con precisión pedidos-por-anuncio** cuál anuncio vende de verdad y cuál solo consume presupuesto.

### Para quién es

- **Marcas de commerce conversacional en LATAM** que venden por WhatsApp/Messenger/Instagram y usan pauta paga en Meta, Google o TikTok.
- **Operadores de chat** (asesores, community managers, agentes) que responden conversaciones y cierran pedidos.
- **Traffickers** que suben y bajan presupuesto de anuncios y necesitan saber cuál escalar y cuál apagar — sin esperar 48 horas a que Meta reconcilie.
- **Finanzas** que necesita conciliar el GMV reportado por el agente contra la caja real del cliente (anti-fuga).
- **Desarrolladores** que quieren extender el sistema con un nuevo adaptador (WooCommerce, Shopify, Supabase, Oracle), un nuevo agente conversacional o un nuevo canal.
- **Dueños de marca** que quieren ver en una pantalla si la operación está sana.

### Qué vas a lograr con esta guía

Al terminar este onboarding vas a ser capaz de:

- [ ] Levantar el sistema en 5 minutos (demo), 15 minutos (datos reales) o 45 minutos (producción).
- [ ] Navegar los 9 módulos del dashboard con atajos de teclado (⌘1-9, ⌘K para command palette).
- [ ] Usar los 10 agentes conversacionales en el momento correcto de la conversación.
- [ ] Configurar la estrategia de pago por canal (anticipado / contra-entrega / híbrido) por país.
- [ ] Conectar WhatsApp, Messenger e Instagram a tus webhooks.
- [ ] Conectar Meta Ads, Google Ads y TikTok Ads para capturar `fbclid` / `gclid` / `ttclid` y atribuir pedidos.
- [ ] Leer las 19 métricas de cada anuncio y entender los 6 veredictos del motor (scale / optimize / watch / pause / kill / cannibalize).
- [ ] Detectar canibalización de anuncios y ejecutar el kill-switch con audit log.
- [ ] Operar el Kanban de 8 columnas del embudo §15.1 y disparar comisión al mover cards.
- [ ] Conciliar el GMV del agente vs el GMV de la caja del cliente.
- [ ] Cumplir GDPR (UE) y Ley 1581 (CO) en el manejo de PII.
- [ ] Resolver los 20 problemas más comunes sin escalar a soporte.

### Tiempo estimado de onboarding

| Rol | Tiempo | Qué cubre |
|-----|--------|-----------|
| **Operador de chat** | 2 horas | Secciones 1-7, 12, 13, 14 |
| **Trafficker** | 2 horas | Secciones 1-4, 6, 11, 12 |
| **Finanzas** | 1.5 horas | Secciones 1-4, 6, 12, 15 |
| **Desarrollador** | 4 horas | Todas, especialmente 3-6, 9-11, 16-17 |
| **Admin de tenant** | 3 horas | Secciones 1-10, 16 |
| **Dueño de marca** | 45 min | Secciones 1, 3, 6, 11, 15 |

> 💡 **Tip ágil**: si solo tienes 20 minutos, lee las secciones 1, 3, 6 (solo Resumen y Atribución) y 11. Con eso entiendes el modelo de negocio y cómo leer el dashboard.

---

## 2. Conceptos clave (glosario visual)

Antes de tocar el teclado, estos 20 términos aparecen en cada pantalla y en cada conversación. Si los dominas, el 80% del dashboard se vuelve obvio.

| # | Término | Definición (1 línea) | Analogía "pensamiento ágil" |
|---|---------|----------------------|-----------------------------|
| 1 | **Tenant** | Una marca/empresa aislada con su propio catálogo, config y datos. | Cada tenant es un apartamento en el mismo edificio: comparten plomería, pero no se cruzan. |
| 2 | **WABA** | WhatsApp Business Account, la cuenta empresarial que Meta aprueba para enviar mensajes a escala. | Tu línea telefónica corporativa, pero aprobada por Meta. |
| 3 | **GMV** | Gross Merchandise Value: suma del valor de todos los pedidos en un período. | La torta entera antes de partir rebanadas. |
| 4 | **CPA** | Costo Por Adquisición: cuánto te costó traer un cliente que compró. | El peaje que pagaste por cada comprador que entró. |
| 5 | **ROAS** | Return On Ad Spend: revenue / spend (1.0 = break-even, 2.0 = duplicaste). | Por cada billete que metiste a la máquina, cuántos escupió. |
| 6 | **ROI** | Return On Investment: netProfit / spend (incluye COGS y comisión). | Lo que te quedó limpio, comparado con lo que invertiste. |
| 7 | **COD** | Cash On Delivery: pago contra entrega. | El cliente paga cuando el motero le deja el paquete en la mano. |
| 8 | **AOV** | Average Order Value: GMV / # pedidos. | El ticket promedio por compra. |
| 9 | **Atribución** | Asignar el crédito de un pedido al anuncio/campaña que lo trajo. | El árbitro que decide qué vendedor se lleva la comisión. |
| 10 | **Canibalización** | Cuando un anuncio reporta conversiones pero no hay pedidos reales asociados (te está robando crédito). | El compañero que se anota ventas que no hizo. |
| 11 | **Kill-switch** | Botón que pausa un anuncio y escribe audit log + actualiza estado. | El botón rojo del gerente: "ya no le metas más plata a este". |
| 12 | **Agente** | Función IA especializada en un momento de la conversación (perfil, cotización, checkout…). | Un empleado experto en UNA sola tarea. |
| 13 | **Adaptador** | Conector a un sistema externo (WooCommerce, Shopify, Dropi, OpenAI…). | El traductor que habla el idioma de cada plataforma. |
| 14 | **RLS** | Row Level Security: aislamiento de datos por `tenantId` a nivel Postgres. | Cada tenant solo ve sus filas, aunque compartan la misma tabla. |
| 15 | **pgvector** | Extensión de Postgres para embeddings vectoriales y búsqueda semántica. | Un índice que encuentra "textos parecidos" sin buscar palabras exactas. |
| 16 | **NocoDB** | Airtable open-source que se conecta a Postgres; aquí se usa como vista operativa Kanban. | Excel con superpoderes, conectado directo a tu DB. |
| 17 | **n8n** | Orquestador de workflows externo (alternativa a Zapier) self-hosted. | El conductor de orquesta que coordina los 10 agentes. |
| 18 | **Multi-touch** | Modelo de atribución que reparte el crédito entre varios touchpoints. | Varios vendedores tocaron la venta → se reparte la comisión. |
| 19 | **Embeddings** | Vectores numéricos que representan el significado de un texto o imagen. | El "ADN semántico" de un mensaje, para buscar por intención. |
| 20 | **Veredicto** | Clasificación automática del anuncio: scale / optimize / watch / pause / kill / cannibalize. | El semáforo del trafficker: verde, amarillo o rojo. |

> ✅ **Best practice**: imprime esta tabla y tenla al lado del escritorio las primeras dos semanas.

---

## 3. Arquitectura en 60 segundos

```
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │  Meta Ads   │    │ Google Ads  │    │ TikTok Ads  │
   │  (fbclid)   │    │  (gclid)    │    │  (ttclid)   │
   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
          │                  │                  │
          └──────────┬───────┴──────────┬───────┘
                     ▼                  ▼
              ┌──────────────────────────────────┐
              │   Click → URL con click_id       │
              │   https://wa.me/57…?text=…       │
              │   o wa.me link con ref param     │
              └─────────────────┬────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  WhatsApp / Messenger / IG DM    │
              │  (cliente abre chat con asesor)  │
              └─────────────────┬────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  Webhook Meta → CommerceFlow     │
              │  POST /api/webhooks/whatsapp     │
              │  POST /api/webhooks/meta         │
              │  (con HMAC X-Hub-Signature-256)  │
              └─────────────────┬────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  10 agentes conversacionales     │
              │  profile→speech→catalog→theme→   │
              │  quote→objection→address→        │
              │  logistics→vision→checkout       │
              └─────────────────┬────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  Order + OrderItem + Attribution │
              │  + Shipment + CommissionEntry    │
              │  + AuditLog + EcommerceAdapter   │
              └─────────────────┬────────────────┘
                                ▼
              ┌──────────────────────────────────┐
              │  Dashboard / 9 módulos           │
              │  - Atribución: ROAS, ROI, CPA    │
              │  - Kanban: 8 columnas embudo     │
              │  - Monetización: comisión GMV    │
              └──────────────────────────────────┘
```

### Analogía del gerente

> 📊 **Cada anuncio es un vendedor.** Meta, Google y TikTok son las agencias que te los mandan. El cliente que llega por WhatsApp es el prospecto que el vendedor trajo a la tienda. La venta efectiva es el pedido confirmado.
>
> **CommerceFlow OS es el gerente que mide cuál vendedor vende de verdad.** No se queda con la versión de la agencia ("¡te traje 10 clientes!"), sino que abre la caja, cuenta los billetes y le dice: "Vendedor A trajo 10 prospectos y cerraste 4; vendedor B trajo 8 y cerraste 6. Voy a subirle la comisión a B y a sacarte a ti, A, porque me estás costando $200 por venta y el promedio es $50".

---

## 4. Requisitos previos

### Para operadores (chat, trafficker, finanzas)

| Requisito | Detalle |
|-----------|---------|
| Navegador moderno | Chrome 120+, Firefox 120+, Safari 17+, Edge 120+. Soporta WebSocket y CSS variables. |
| Cuenta Meta Business | Con acceso a WhatsApp Business API + página de Facebook + cuenta de Instagram Business. |
| WhatsApp Business | App instalada en móvil (para verificar identidad 2-step en Meta). |
| Resolución mínima | 1280×720 (desktop). Mobile soportado desde 390px (responsive). |
| Atajos de teclado | ⌘1-9 navega módulos, ⌘K abre command palette. |

### Para desarrolladores

| Requisito | Versión mínima | Por qué |
|-----------|----------------|---------|
| **Bun** | 1.3+ | Runtime recomendado + package manager. `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | 20+ | Alternativa a Bun. |
| **Docker** | 24+ + Compose v2 | Stack completo (Postgres, n8n, NocoDB, MinIO, Ollama, Redis, Caddy). |
| **Git** | 2.40+ | Flujo de trabajo estándar. |
| **Caddy** | 2.7+ | Gateway opcional pero recomendado para socket.io realista. |
| **VPS** | 4 vCPU, 8 GB RAM, 50 GB SSD | Para producción. Ubuntu 22.04+ o Debian 12+. |
| **OS** | Linux / macOS / WSL2 | Windows nativo NO soportado (paths, scripts bash, hot reload). |

### Para admins de tenant

| Requisito | Detalle |
|-----------|---------|
| Credenciales Meta Ads | `ads_management`, `ads_read`, `business_management` (App Review aprobado). |
| Credenciales Google Ads | Developer token + OAuth2 refresh token con scope `https://www.googleapis.com/auth/adwords`. |
| Credenciales TikTok Ads | Access token del Sandbox o Production + `advertiser_id`. |
| Gateway de pago | Wompi, ePayco, MercadoPago o Stripe (según país). Se usa para pagos anticipados. |
| API key Dropi / 99envios / Aveonline | Si tu tenant usa uno de estos proveedores logísticos. |
| API key OpenAI / xAI | Solo si configuras `proveedorIa != 'zai'`. |

> ⚠️ **Warning**: NO comiences a configurar credenciales reales en `.env` hasta haber leído la [sección 16 (Seguridad)](#16-seguridad-y-cumplimiento). Un `.env` commiteado con `OPENAI_API_KEY` real es el incidente de seguridad #1 de este tipo de proyectos.

---

## 5. Instalación paso a paso (3 escenarios)

Tres caminos, dependiendo de qué tan profundo quieres ir:

- **5A. Demo local** (5 minutos) — ver el dashboard con datos sintéticos.
- **5B. Con datos reales** (15 minutos) — cargar los 239 pedidos del CRM Saramantha.
- **5C. Producción con Docker** (45 minutos) — desplegar en VPS con Postgres+pgvector+n8n+NocoDB.

### 5A. Demo local (5 minutos)

```bash
# 1. Clonar el repo
git clone https://github.com/ziay/commerceflow-os.git
cd commerceflow-os

# 2. Instalar dependencias (85+ paquetes)
bun install

# 3. Configurar variables de entorno (mínimo viable)
cp .env.example .env
# Para demo local, .env solo necesita:
#   DATABASE_URL="file:./dev.db"
#   WA_VERIFY_TOKEN=commerceflow_verify_dev
#   META_VERIFY_TOKEN=commerceflow_verify_dev

# 4. Crear la base SQLite + generar el cliente Prisma
bun run db:push
bun run db:generate

# 5. Sembrar datos demo (5 tenants + catálogo + 15 pedidos)
bun run prisma/seed.ts

# 6. Levantar el dev server
bun run dev
# → http://localhost:3000

# 7. (Opcional pero recomendado) Levantar el chat-service en otra terminal
cd mini-services/chat-service && bun install && bun run index.ts
# → ws://localhost:3003
```

#### Qué esperar ver

Abre `http://localhost:3000`. Debes ver:

1. **Sidebar agrupado** en 3 secciones: OPERACIÓN (Resumen, Mensajería, Pedidos & Pagos, Kanban, Orquestador), INTELIGENCIA (Atribución de Pauta, Monetización), SISTEMA (Catálogo e Integraciones, Configuración).
2. **Topbar** con tenant switcher (avatar con iniciales del brand), command palette `⌘K`, breadcrumb, botón "Nuevo", campana de notificaciones, toggle de tema claro/oscuro.
3. **Vista Resumen** con 4 KPI cards (revenue, ROAS, orders, spend) cada uno con sparkline y delta vs período anterior.
4. **Footer** con texto "API · DB · Socket.io" + estado "live" + marca del tenant activo + versión.

> ✅ **Best practice**: abre también `http://localhost:81` (Caddy gateway) si quieres probar el mismo routing que en producción. Caddy rutea `/` a `:3000` y `?XTransformPort=3003` al chat-service.

> ⚠️ Si ves "Desconectado" en Mensajería, olvida levantar el chat-service (paso 7).

#### Verificación rápida

```bash
curl http://localhost:3000/api/health | jq '.summary'
# Esperado: { "ok": 6, "warning": 4, "error": 0, "not_configured": 13 }

curl http://localhost:3000/api/agents | jq '.agents | length'
# Esperado: 10
```

Las 4 warnings en dev son esperadas: SQLite en vez de Postgres, pgvector no configurado, RLS no soportado en SQLite, n8n no levantado. En producción desaparecen.

---

### 5B. Con datos reales (15 minutos)

Si quieres ver el dashboard con los 239 pedidos reales del CRM Saramantha (GMV $32,647,242 COP, AOV $137,173 COP):

#### Prerequisito

Tienes que tener los 4 CSV exportados desde chateapro.app en `upload/`:
- `users (28).csv`
- `users (29).csv`
- `users (30).csv`
- `users (31).csv`

Si no los tienes, sigue usando 5A. La carga real reemplaza la data sintética.

#### Pasos

```bash
# Asumiendo que ya hiciste 5A (dev server corriendo)

# 1. Cargar 239 pedidos reales del CRM Saramantha
bun run scripts/load-real-orders.ts
# → Lee los 4 CSV, deduplica por phone+fecha, inserta 238 pedidos únicos
# → GMV $32,647,242 COP, AOV $137,173 COP, embudo 174/21/15/3

# 2. Crear conversaciones + mensajes con franja de metadata visible (Saramantha §4)
bun run scripts/fix-saramantha-messages.ts
# → Repara mensajes para que las imágenes de productos muestren la franja de metadata
# → Crea conversaciones artificiales asociadas a cada pedido real

# 3. Generar embeddings para memoria semántica
bun run scripts/backfill-embeddings.ts
# → Genera embeddings TF-hash (1024 dims) para todos los Message sin embedding
# → Habilita búsqueda semántica: GET /api/conversations/search?q=familia

# 4. Cargar 5 pedidos con multi-touch (2-3 Attribution por pedido)
bun run scripts/seed-multitouch.ts
# → Crea 5 pedidos de prueba con 2-3 touchpoints
# → Habilita comparar los 4 modelos de atribución (last_click, first_click, linear, time_decay)

# 5. (Opcional) Sembrar 239 pedidos sintéticos calibrados al §15.1
# Solo si NO tienes los CSV reales pero quieres carga realista
# bun run scripts/seed-239-pedidos.ts
```

#### Verificación

```bash
# GMV total debe ser ~$32,647,242 COP
curl "http://localhost:3000/api/monetization/gmv?tenantId=ten-saramantha" | jq '.'
# Esperado: { "gmv": 32647242, "ordenes": 238, "ao": 137173 }

# Atribución multi-touch disponible
curl "http://localhost:3000/api/attribution?tenantId=ten-saramantha&model=time_decay" | jq '.ads[0].creditedRevenue'

# Conciliación anti-fuga
curl "http://localhost:3000/api/conciliation?tenantId=ten-saramantha" | jq '.riskLevel'
# Esperado: "low" o "medium"
```

#### Métricas que debes poder ver

| Métrica | Valor esperado | Dónde verla |
|---------|----------------|-------------|
| Total pedidos | 243 (238 reales + 5 multi-touch) | Kanban (suma de cards) |
| GMV | $32.6M COP | Resumen + Monetización |
| AOV | ~$145k COP | Resumen |
| Embudo §15.1 | 174 / 21 / 15 / 3 | Kanban columnas + Monetización |
| Ciudades | 8 con conteos reales | Kanban filter "ciudad" |
| Carriers | 6 variantes Interrapidísimo | Pedidos & Pagos + Integraciones |
| Conversaciones | ~238 con embeddings | Mensajería + búsqueda semántica |

> 💡 Si los números están muy lejos (más de 5% de diferencia), revisa que corriste los scripts en orden y que no hay errores en `dev.log`.

---

### 5C. Producción con Docker (45 minutos)

Para despliegue completo en VPS con Postgres+pgvector, n8n, NocoDB, MinIO, Redis, Caddy (HTTPS automático) y uptime-kuma.

> 📖 **Referencia completa**: [`upload/GUIA-DEPLOY-PRODUCCION.md`](GUIA-DEPLOY-PRODUCCION.md). Aquí un resumen de los 10 pasos:

#### Resumen de los 10 pasos

| # | Paso | Tiempo | Comando clave |
|---|------|--------|---------------|
| 1 | Pre-requisitos | 5 min | `curl -fsSL https://get.docker.com \| sh` + `git clone` + DNS apuntando al VPS |
| 2 | Configurar `.env` | 5 min | `cp .env.example .env && nano .env` (DOMAIN, POSTGRES_PASSWORD, NEXTAUTH_SECRET, N8N_ENCRYPTION_KEY, verify tokens) |
| 3 | Levantar stack Docker | 10-15 min | `docker compose up -d --build` (9 servicios) |
| 4 | Migrar DB + activar pgvector + RLS | 3 min | `docker compose exec app bun run db:migrate` + 2 scripts SQL |
| 5 | Cargar datos (239 pedidos + embeddings) | 2 min | `prisma/seed.ts` + `load-real-orders.ts` + `fix-saramantha-messages.ts` + `backfill-embeddings.ts` |
| 6 | Importar 11 workflows n8n | 5 min | UI n8n → Import from File → 11 archivos |
| 7 | Configurar NocoDB | 3 min | UI NocoDB → setup admin → vista Kanban → webhook secret |
| 8 | Configurar webhooks Meta | 5 min | Meta Business → WhatsApp + Messenger/IG webhooks |
| 9 | Verificación final | 2 min | `curl /api/health` → 23 ok, 0 error |
| 10 | SSL automático | 0 min (auto) | Caddy obtiene cert Let's Encrypt automáticamente |

#### Checklist rápido (antes de cerrar navegador)

- [ ] `docker compose ps` muestra 8 servicios `Up` (uptime-kuma opcional).
- [ ] `curl https://TU_DOMINIO/api/health` → `{ "status": "ok", "summary": { "ok": 23, "warning": 0, "error": 0 } }`.
- [ ] `curl https://TU_DOMINIO/api/monetization/gmv?tenantId=ten-saramantha` → GMV $32.6M+.
- [ ] n8n accesible en `/n8n/` con 11 workflows activos.
- [ ] NocoDB accesible en `/nocodb/` con vista Kanban sobre `Order`.
- [ ] Backup diario en cron: `0 3 * * * docker compose exec -T postgres pg_dump …`.
- [ ] Uptime Kuma monitoreando `/api/health/uptime` cada 60s.

> ⚠️ **Warning crítico**: NO cambies `META_APP_SECRET` después del cutover sin re-suscribir los webhooks en Meta. Si lo cambias, los webhooks se caen silenciosamente y pierdes todos los mensajes entrantes hasta que te das cuenta.

---

## 6. Tour del dashboard — los 9 módulos

El dashboard vive en **una sola ruta** (`/`) y las vistas se intercambian client-side vía Zustand. Esto significa: cero reloads al cambiar de módulo, atajos de teclado instantáneos, y estado preservado al navegar.

### Atajos globales

| Atajo | Acción |
|-------|--------|
| `⌘1` (o `Ctrl+1`) | Ir a Resumen |
| `⌘2` | Ir a Mensajería |
| `⌘3` | Ir a Pedidos & Pagos |
| `⌘4` | Ir a Kanban |
| `⌘5` | Ir a Orquestador |
| `⌘6` | Ir a Atribución de Pauta |
| `⌘7` | Ir a Monetización |
| `⌘8` | Ir a Catálogo e Integraciones |
| `⌘9` | Ir a Configuración |
| `⌘K` | Abrir command palette (navegación + acciones rápidas) |

### Estructura común a todos los módulos

Cada módulo tiene:
- **Header** con título + breadcrumb ("Sección > Vista actual").
- **Filtros** (selector de rango de tiempo, filtro de canal, filtro de tenant en topbar).
- **Contenido** principal.
- **Empty state** cuando no hay datos (con CTA "Limpiar filtros" o similar).
- **Skeletons** durante la carga.

---

### Módulo 1 — Resumen (`⌘1`)

**Qué ver al abrirlo**: 4 KPI cards (revenue, ROAS, orders, spend) con sparkline mini-chart y delta vs período anterior; gráfico de área revenue-vs-spend; split por canal (clickeable para filtrar); pie de modo de pago; banner de bienvenida colapsable con checklist de setup.

**3 acciones clave**:

1. **Cambiar el rango de tiempo**: segmented control 7d / 14d / 30d / 90d → llama a `/api/overview?days=N`.
2. **Filtrar por canal**: click en cualquier barra del canal split → otros se atenúan al 40%, click en "Limpiar filtro canal" para reset.
3. **Comparar período anterior**: cada KPI muestra ↑/↓ + % "vs. período anterior" — útil para ver tendencia sin abrir Atribución.

**Flujo de usuario completo (paso a paso)**:

1. Abre el dashboard (ya estás en Resumen por defecto).
2. Verifica que el tenant activo en el topbar es el correcto (ej: "Saramantha"). Si no, click en el tenant switcher y selecciona.
3. Click en "30d" para ver un mes completo.
4. Observa el ROAS general — si es < 1.5, ve a Atribución (`⌘6`) a investigar.
5. Click en la barra "WhatsApp" del canal split — los demás canales se atenúan.
6. Click en "Limpiar filtro canal" para volver a la vista completa.
7. Click en la "X" del banner de bienvenida si ya completaste el setup (se queda colapsado en localStorage).

**Errores comunes y cómo resolverlos**:

- **Sparklines vacías**: probablemente no hay datos del período anterior (sintético en demo). En producción con +30 días de datos se llenan solas.
- **KPIs en 0**: verifica que el tenant activo tenga pedidos en el rango. `curl /api/overview?days=30&tenantId=ten-saramantha`.
- **Delta "vs. período anterior" muestra siempre 0%**: es sintético en demo. En producción se calcula con los datos reales del período N-1.

**Cuándo usar este módulo vs otro**:

- Resumen = "¿cómo vamos?" (alto nivel, todos los días).
- Atribución = "¿qué anuncio escalar / apagar?" (drill-down, cuando Resumen muestra ROAS bajo).
- Monetización = "¿cuánto cobramos?" (fin de mes).

---

### Módulo 2 — Mensajería (`⌘2`)

**Qué ver al abrirlo**: bandeja unificada de 3 columnas: lista de conversaciones (izquierda), thread activo (centro), panel de cliente con secciones colapsables (derecha). Badges de canal (WA/Messenger/IG), info bar con campaña source + ad ID + "Inició hace X". Chips de quick reply encima del composer. Indicador de typing animado. Estado de socket en el footer ("Tiempo real conectado" o "Desconectado").

**3 acciones clave**:

1. **Enviar un mensaje outbound**: click en una conversación → escribir en el composer → Enter (o click en "Enviar"). El mensaje aparece con tick azul (`CheckCheck` sky-500) cuando se confirma.
2. **Sugerir con IA**: click en el botón "✨ Sugerir con IA" → dropdown con los 10 agentes → selecciona → la IA genera una respuesta basada en el contexto → puedes editarla antes de enviar.
3. **Buscar conversación semántica**: barra de búsqueda arriba → escribe "familia" o "Stitch" → devuelve conversaciones con score > 0 (requiere embeddings generados).

**Flujo de usuario completo (paso a paso)**:

1. `⌘2` para abrir Mensajería.
2. Click en la conversación con badge "WhatsApp" y tag "Campaña: Glow Carousel".
3. En el panel derecho, expande "Atribución" para ver qué anuncio trajo a este cliente.
4. Expandes "Memoria semántica" — verás los últimos 5 mensajes con score de similitud (memoria a largo plazo del cliente).
5. Lee el último mensaje inbound (cliente pregunta por talla).
6. Click en "✨ Sugerir con IA" → selecciona "Objection (objeciones)".
7. La IA genera: "Te entiendo. Actualmente trabajamos tallas S, M, L. ¿Te anoto para avisarte cuando amplíemos?"
8. Edita si quieres, click en "Enviar".
9. Aparece tu mensaje con tick azul, y tras 3-6s llega una respuesta simulada del cliente (en dev).

**Errores comunes**:

- **"Desconectado" en el footer**: el chat-service no está corriendo. `cd mini-services/chat-service && bun run index.ts`.
- **IA no responde**: revisa el health del LLM provider del tenant (`curl /api/health?tenantId=ten-saramantha | jq '.checks[] | select(.name | startswith("llm"))'`).
- **Búsqueda semántica devuelve score 0**: falta backfill de embeddings. `bun run scripts/backfill-embeddings.ts`.
- **Webhook Meta no llega**: verifica HMAC signature con `META_APP_SECRET` configurado (en dev es opcional, en prod obligatorio).

**Cuándo usar este módulo vs otro**:

- Mensajería = conversación en vivo, tiempo real.
- Kanban = gestión de pedidos post-confirmación (cuándo mover de estado).
- Pedidos & Pagos = vista tabular para filtros y búsqueda por ID.

---

### Módulo 3 — Pedidos & Pagos (`⌘3`)

**Qué ver al abrirlo**: tabla con todos los pedidos del tenant. Columnas: número, cliente, items (1 línea truncada), total, modo de pago (anticipado / COD / híbrido), estado, atribución (campaña + ad), fecha. KPIs arriba: total pedidos, GMV, AOV, % COD. 3 cards de estrategia explicando los modos de pago.

**3 acciones clave**:

1. **Filtrar por modo de pago**: select arriba → "Anticipado", "Contra entrega", "Híbrido" → tabla se filtra.
2. **Cambiar estado de un pedido**: click en el menú `⋯` al final de la row → "Cambiar estado" → selecciona uno de los 8 estados del embudo.
3. **Ver atribución**: click en el badge de campaña/ad → abre detalle con spend, revenue, ROAS de ese anuncio específico.

**Flujo de usuario completo (paso a paso)**:

1. `⌘3` para abrir Pedidos & Pagos.
2. Click en el select "Modo de pago" → "Contra entrega".
3. La tabla se filtra a solo pedidos COD.
4. Click en el menú `⋯` del primer pedido → "Cambiar estado" → "Datos completados".
5. El badge de estado cambia, y se crea una `CommissionEntry` al 50% (reconocidaPct=50, etapaReconocimiento='datos_completados').
6. Click en el badge de campaña "Glow Carousel" → se abre el detalle del anuncio con ROAS 2.4.

**Errores comunes**:

- **PATCH falla con 422**: el status no es uno de los 8 válidos. Verifica: `llamar_para_confirmar`, `intento_cancelacion`, `datos_completados`, `oficina`, `programado`, `despachado`, `novedad`, `devuelto`.
- **Tabla vacía**: tenant sin pedidos en el rango. Verifica con `curl /api/orders?tenantId=ten-saramantha`.

**Cuándo usar este módulo vs otro**:

- Pedidos & Pagos = búsqueda por ID, filtros, edición rápida.
- Kanban = vista visual del embudo para mover cards en masa.
- Monetización = cuánto cobraste por esos pedidos.

---

### Módulo 4 — Kanban (`⌘4`)

**Qué ver al abrirlo**: 8 columnas con el embudo §15.1. Cada columna tiene header coloreado con emoji + label + count badge + suma de totales + botón colapsar. Cards con avatar del cliente (iniciales, color por modo de pago), dot de prioridad, ciudad/país, items truncados, total, timeAgo. Filtros arriba: modo de pago, ciudad.

**3 acciones clave**:

1. **Drag & drop**: arrastra una card de una columna a otra → PATCH automático al backend → si el movimiento activa comisión (ej: a `datos_completados`), se crea `CommissionEntry` al 50%.
2. **Filtrar por ciudad**: select de ciudad (dinámico, extraído de orders) → solo cards de esa ciudad visibles.
3. **Colapsar columnas**: click en el chevron del header → la columna se contrae a 60px de ancho, persistente en sesión.

**Flujo de usuario completo (paso a paso)**:

1. `⌘4` para abrir Kanban.
2. Verás 243 cards distribuidas en 8 columnas.
3. Filtra por ciudad "Bogotá" → quedan ~80 cards.
4. Toma una card de "Llamar para confirmar" y arrástrala a "Datos completados".
5. Aparece toast "Comisión reconocida al 50%" → se creó `CommissionEntry`.
6. Verifica en el panel derecho (si lo abres) que el pedido tiene ahora un evento de comisión.
7. Arrastra otra card a "Despachado" → comisión sube a 100%.
8. Click en "Limpiar" para quitar el filtro de ciudad.

**Errores comunes**:

- **Card desaparece al arrastrar**: el PATCH falló. Abre DevTools → Network → busca el PATCH → revisa status code (404 = orderId no existe, 422 = status inválido).
- **Columna vacía cuando debería tener cards**: tienes un filtro activo. Click en "Limpiar".
- **Cards duplicadas**: el estado local se desincronizó. Refresca la página (F5).

**Cuándo usar este módulo vs otro**:

- Kanban = trabajo operativo diario, mover pedidos por el embudo.
- Pedidos & Pagos = búsqueda/edición puntual.
- Monetización = ver cuánto cobraste según en qué columna quedó cada pedido.

---

### Módulo 5 — Orquestador (`⌘5`)

**Qué ver al abrirlo**: stepper visual de 9 pasos (profile → speech → catalog → theme → quote → objection → address → logistics → checkout). Cada paso muestra: agente, estado (pending / running / done / fallback), reply recibido, timestamp. Selector de escenario (`ziay_wa_catalog`, `client_woocommerce`, `client_shopify`, `client_supabase_nuestro`). Botones "Step siguiente" y "Ejecutar full".

**3 acciones clave**:

1. **Ejecutar paso a paso**: selecciona escenario + click "Step siguiente" → el orquestador llama al siguiente agente en secuencia, muestra el reply, avanza el stepper.
2. **Ejecutar full**: click "Ejecutar full" → corre los 9 pasos en secuencia con timeout 15s cada uno. Worst case: 135s.
3. **Ver línea de tiempo**: cada reply se añade al `history` con timestamp — útil para auditar qué respondió cada agente.

**Flujo de usuario completo (paso a paso)**:

1. `⌘5` para abrir Orquestador.
2. Selecciona escenario "ZIAY (WhatsApp Catalog)".
3. Click "Ejecutar full".
4. Observa cómo cada paso se va completando: perfil detectado como "mayorista", discurso generado, catálogo traído, cotización con volume pricing, etc.
5. Al final (step 9), el agente `checkout` crea el pedido + OrderItem + Attribution + Shipment + CommissionEntry + AuditLog (8 side-effects).
6. Verifica el resultado en el panel derecho con los 8 IDs generados (orderId, orderItemsCount, attributionId, shipmentId, etc.).

**Errores comunes**:

- **Step se queda en "fallback"**: el agente tardó >15s. Verifica el LLM provider del tenant. Si es Zai (default), no deberías ver esto.
- **Step 5 (quote) falla**: faltan `VolumePrice` en la DB. `bun run prisma/seed.ts` para recargar.
- **Step 9 (checkout) crea el pedido pero no la guía**: el `LogisticsAdapter` está en modo stub. Configura `DROPI_API_KEY` real para HTTP real.

**Cuándo usar este módulo vs otro**:

- Orquestador = debug del flujo completo, demostración a stakeholders, validar que los 10 agentes responden.
- Mensajería = uso real en conversación con cliente (donde el orquestador corre por behind the scenes).

---

### Módulo 6 — Atribución de Pauta (`⌘6`)

**Qué ver al abrirlo**: tabla por anuncio con 19 métricas (externalId, spend, impressions, clicks, CTR, CPC, convReported, orderCount, units, revenue, paidRevenue, AOV, COGS, grossProfit, netProfit, CPA, CPL, CVR, ROAS, ROI). Badges de veredicto (scale / optimize / watch / pause / kill / cannibalize) con color. Summary bar arriba con chips: "X para apagar", "X para escalar · $Y revenue", "X canibalizadores", "Gastado sin ventas: $X". Primera columna sticky al hacer scroll horizontal.

**3 acciones clave**:

1. **Filtrar por veredicto**: click en chip "X para apagar" → tabla se filtra a solo `kill` y `cannibalize`.
2. **Ejecutar kill-switch**: click en el botón "Apagar" en la row de un anuncio con veredicto `kill` → PATCH `/api/ads/[id]` con `status=paused` → audit log escrito → toast de confirmación.
3. **Cambiar modelo de atribución**: select arriba → `last_click`, `first_click`, `linear`, `time_decay` → las columnas creditedRevenue y ROAS se recalculan.

**Flujo de usuario completo (paso a paso)**:

1. `⌘6` para abrir Atribución.
2. Click en chip "Canibalizadores" (violeta, icon Flame).
3. Tabla filtra a anuncios con `verdict=cannibalize` (plataforma reporta conv pero hay 0 pedidos reales + ROAS bajo).
4. Selecciona el primer anuncio "Colágeno video".
5. Click en "Apagar" → toast "Anuncio pausado + audit log creado".
6. Click en chip "Escalar" (emerald, icon Rocket) → ves los anuncios con veredicto `scale`.
7. Selecciona "Glow carousel" → revisa ROAS 2.4, CPA $14k, ROI 1.8.
8. Click en "Escalar" en el menú `⋯` → cambia status a `scaled` + audit log.

**Errores comunes**:

- **ROAS se ve 0**: el anuncio tiene spend pero 0 pedidos asociados. Verifica `Attribution` con `curl /api/attribution?tenantId=ten-saramantha`.
- **Veredicto `watch` para todo**: los umbrales son muy altos. Configúralos en `⌘9` Configuración → `roas_kill_threshold`, `cpa_target`.
- **Kill-switch falla con 403**: no tienes rol `trafficker` o `admin`. Verifica tu rol en `User.role`.

**Cuándo usar este módulo vs otro**:

- Atribución = decisión de pauta (apagar / escalar / optimizar).
- Monetización = cuánto dinero generó el sistema.
- Resumen = visión general diaria.

---

### Módulo 7 — Monetización (`⌘7`)

**Qué ver al abrirlo**: GMV total del tenant, comisión reconocida (50% + 100% por pedido), embudo §15.1 con 8 columnas y conteos, tramos escalonados (4.5% / 3% / 1.75%) con visualización, invoice del período con desglose. Botón "Conciliar" que abre el panel anti-fuga (GMV agente vs GMV caja).

**3 acciones clave**:

1. **Ver el embudo de cobro**: la sección "Embudo §15.1" muestra cuántos pedidos hay en cada etapa — el cuello de botella (usualmente "Llamar para confirmar" con ~73% de los pedidos) te dice dónde estás perdiendo plata.
2. **Conciliar GMV**: click en "Conciliar" → abre modal con GMV del agente vs GMV externo del tenant → `riskLevel` (low/medium/high) + `gapPct`.
3. **Emitir invoice del período**: click en "Generar invoice" → crea `Invoice` con todos los `CommissionEntry` del período → descarga PDF.

**Flujo de usuario completo (paso a paso)**:

1. `⌘7` para abrir Monetización.
2. Ve GMV $32.6M, comisión reconocida $1.2M aprox (3.7% efectivo).
3. Click en "Embudo §15.1" → ves 174/21/15/3.
4. Observa que 174 pedidos (73%) están en "Llamar para confirmar" → cuello de botella.
5. Click en "Conciliar" → modal muestra GMV agente $32.6M vs GMV caja cliente $31.2M → gap 4.3% → "low risk".
6. Si el gap fuera > 15%, notificar a finanzas.
7. Click en "Generar invoice" → PDF descargado con 238 commission entries detalladas.

**Errores comunes**:

- **Comisión reconocida en 0**: ningún pedido llegó a `datos_completados` o `despachado`. Revisa Kanban.
- **Gap > 15% sin alerta**: el endpoint `/api/conciliation` no está retornando `riskLevel`. Verifica que existan `Order` con `estado` actualizado y `Invoice` del tenant.
- **Invoice no genera PDF**: revisa logs del app, puede ser un error en la librería de PDF.

**Cuándo usar este módulo vs otro**:

- Monetización = fin de mes, conciliación, facturación.
- Kanban = mover pedidos para subir la comisión reconocida.
- Atribución = entender de qué anuncio viene el revenue.

---

### Módulo 8 — Catálogo e Integraciones (`⌘8`)

**Qué ver al abrirlo**: panel con el adaptador de catálogo activo (WhatsApp Catalog / WooCommerce / Shopify / Supabase / Oracle) con status, último sync, # productos sincronizados. Cotizador de flete en vivo (input ciudad → tarifa + tiempo + transportadora). Identificación visual VLM con historial (últimas 5 imágenes identificadas con sku + confianza + metodo).

**3 acciones clave**:

1. **Sincronizar catálogo**: click en "Sync catálogo" → llama a `EcommerceAdapter.syncCatalog()` → muestra "Synced: N productos, adapter: WooCommerceAdapter".
2. **Cotizar flete**: input ciudad → cantidad de unidades → click "Cotizar" → devuelve tarifa, tiempo estimado y transportadora (vía `LogisticsAdapter`).
3. **Identificar producto por imagen**: pega URL de imagen → click "Identificar" → VLM devuelve `{sku, confianza, metodo}`. Si confianza < 0.6, te pide confirmación.

**Flujo de usuario completo (paso a paso)**:

1. `⌘8` para abrir Catálogo e Integraciones.
2. Click en "Sync catálogo" → synced: 7 productos, adapter: WhatsappCatalogAdapter.
3. Baja a "Cotizador de flete" → input "Bogotá", cantidad 1 → click "Cotizar".
4. Resultado: tarifa $9.500, tiempo 1 día, transportadora "Coordinadora".
5. Sube a "Identificación visual" → pega URL de imagen de producto → click "Identificar".
6. Resultado: `{sku: "PIJ-SHORT-TIRA-001", confianza: 0.92, metodo: "ocr_franja"}`.
7. La identificación se guarda en `ImageIdentification` y aparece en el historial.

**Errores comunes**:

- **"Synced: 0 productos"**: el tenant no tiene `Product` con `fuenteSincronizacion` del adapter correcto. Verifica en DB.
- **Tarifa 0**: el adapter está en modo stub. Configura `DROPI_API_KEY` real en `.env`.
- **VLM devuelve confianza 0**: la imagen no tiene franja de metadata visible. Ejecuta `bun run scripts/fix-saramantha-messages.ts` para reparar.

**Cuándo usar este módulo vs otro**:

- Catálogo e Integraciones = setup de adaptadores, cotización puntual, identificación visual.
- Mensajería = dónde se usan estas integraciones en conversación real.

---

### Módulo 9 — Configuración (`⌘9`)

**Qué ver al abrirlo**: secciones colapsables. (1) Estrategia de pago por canal (anticipado/COD/híbrido, requirePrepayMin, prepayDiscountPct, codFee). (2) Umbrales de trafficker (roas_kill_threshold, cpa_target). (3) Integraciones activas (con status). (4) Webhooks URLs (WhatsApp, Meta, NocoDB). (5) Switch de tenant (alternativa al tenant switcher del topbar). (6) Personalización de marca (tonoMarca, nombreAsesora).

**3 acciones clave**:

1. **Cambiar estrategia de pago**: select "WhatsApp CO" → "Contra entrega" → guardar. Los nuevos pedidos por WhatsApp CO usan COD por defecto.
2. **Ajustar umbrales**: cambia `roas_kill_threshold` de 1.5 a 2.0 → guarda → vuelve a Atribución y verás más anuncios con veredicto `kill`.
3. **Ver webhooks URLs**: copia la URL `https://tu-dominio/api/webhooks/whatsapp` y úsala en Meta Business para configurar el webhook.

**Flujo de usuario completo (paso a paso)**:

1. `⌘9` para abrir Configuración.
2. Expandes "Estrategia de pago por canal".
3. Para "WhatsApp CO": selecciona "Híbrido", `requirePrepayMin` = $100.000, `prepayDiscountPct` = 5, `codFee` = $5.000.
4. Click en "Guardar".
5. Expandes "Umbrales de trafficker".
6. Cambia `roas_kill_threshold` a 1.8, `cpa_target` a $20.000.
7. Click en "Guardar".
8. Ve a Atribución (`⌘6`) → verás más anuncios marcados como `kill` (porque el umbral subió).

**Errores comunes**:

- **Cambios no se aplican**: el frontend cachea. Refresca la página o espera 30s.
- **"No tienes permisos"**: necesitas rol `admin` para cambiar configuración del tenant.

**Cuándo usar este módulo vs otro**:

- Configuración = setup inicial, ajuste fino de umbrales, onboarding de nuevo tenant.
- Todos los demás = uso operativo diario.

---

## 7. Los 10 agentes conversacionales — cuándo y cómo usarlos

Los 10 agentes son la columna vertebral del commerce conversacional. Cada uno es una función TypeScript que recibe un `AgentContext` y retorna `{ system, user }` para pasar al LLM. **Siguen la regla de oro §2**: los system prompts NUNCA contienen datos de negocio (precios, catálogo, objeciones) — esos se inyectan en el `user` message después de consultar la DB filtrada por `tenantId`. Esto garantiza aislamiento multi-tenant y seguridad ante prompt injection.

### Tabla maestra

| # | Agente | Label | Qué hace | Cuándo invocarlo | Input requerido | Output esperado |
|---|--------|-------|----------|------------------|-----------------|-----------------|
| 1 | `profile` | Perfilamiento de leads | Clasifica al lead en `mayorista` / `emprendedor` / `detal` / `regalo` | Inicio de toda conversación nueva | `message`, `tenantId` | Perfil + persistencia en `Conversation.perfilConversacion` y `Customer.perfilDetectado` |
| 2 | `speech` | Discurso de ventas por perfil | Genera apertura adaptada al perfil con `aperturaTexto` y `pruebaSocial` de `SalesSpeech` | Después de `profile` | `tenantId`, `perfil` | Mensaje máx 20 palabras, 2 emojis, cierra con acción |
| 3 | `quote` | Ofertas y cotización cruzada | Calcula total a pagar, venta estimada y margen con volume pricing | Cuando el cliente confirma interés por SKUs específicos | `tenantId`, `items[]` (sku + cantidad), `perfil` | `"6 Short Tira + 6 Pantalón: pagas $196.080 → vendes $210.000 → te sobran $13.920 limpios. ¿Confirmas?"` |
| 4 | `catalog` | Respuesta visual-primero | Trae productos reales con imágenes, máx 1-2 líneas de texto, pregunta binaria | Cuando el lead pregunta por producto o categoría | `tenantId`, `query` | Mensaje + lista de productos con imagen |
| 5 | `theme` | Oferta por tema/personaje | Busca todos los productos de un tema (Stitch, Hello Kitty…) | Cuando el lead menciona tema sin prenda específica | `tenantId`, `query` (tema) | Lista de SKUs del tema → se pasa a `catalog` |
| 6 | `objection` | Manejo de objeciones | Clasifica objeción, consulta `Objection` tabla, adapta `respuestaBase` + `gatilloMentalAsociado` | Cuando el lead objecciona (precio, talla, desconfianza, lo pienso) | `tenantId`, `message` | Argumento adaptado, no repetido en la conversación |
| 7 | `address` | Confirmación de datos (10 campos) | Extrae y confirma: nombre, apellido, teléfono, departamento, ciudad, dirección, horario, talla, diseño, cantidad | Cuando el lead acepta el pedido | `tenantId`, `conversationId` | Pregunta del campo faltante (uno a la vez) |
| 8 | `logistics` | Logística de fletes | Cotiza flete real vía `LogisticsAdapter` (Dropi/99envios/Aveonline) | Después de confirmar dirección | `tenantId`, `ciudad`, `pais`, `cantidad_unidades` | `"Envío a Bogotá: $9.500, 1 día hábil, Coordinadora."` |
| 9 | `vision` | Visión (identificación por imagen) | Identifica producto por imagen: lee franja metadata o compara visualmente | Cuando el cliente envía foto de producto | `tenantId`, `imageUrl` | `{sku, confianza, metodo, pregunta_confirmacion?}` |
| 10 | `checkout` | Checkout y sincronización | Resumen final + 8 side-effects (crea Order, OrderItem, Attribution, CartSync, Shipment, CommissionEntry, OrderEvent, AuditLog) | Cuando todos los datos están confirmados | `tenantId`, `customerId`, `items[]`, `address`, `freightQuote` | Mensaje de confirmación + IDs generados (orderId, shipmentId, commissionEntryId…) |

> ✅ **Best practice**: en el día a día, NO llamas agentes individualmente. El orquestador los encadena en 9 pasos. Solo los llamas individuales para debug, demo o casos especiales (ej: cliente envía imagen antes de perfilarse → llamas `vision` on-demand).

### 3 ejemplos prácticos conversacionales completos

#### Ejemplo 1 — Cliente mayorista pide cotización

```
👤 Cliente (WA):  "Hola, vi el anuncio del Short Tira. Tengo tienda en Bogotá, quiero surtir."
🤖 Sistema:       → profile detecta "mayorista"
🤖 Sistema:       → speech genera apertura para mayorista
🤖 Agente:        "¡Hola! Short Tira tiene descuento por volumen desde 6 unidades. ¿Cuántas quieres?"
👤 Cliente:       "12 short y 12 pantalones"
🤖 Sistema:       → quote consulta VolumePrice (tramo 12-35 = 15% off)
🤖 Agente:        "12 Short Tira + 12 Pantalón: pagas $392.160 → vendes $420.000 → te sobran $27.840 limpios. ¿Confirmas?"
👤 Cliente:       "Sí, confirmo"
🤖 Sistema:       → address pide los 10 campos uno a la vez
🤖 Agente:        "Perfecto. ¿Cuál es tu nombre completo?"
👤 Cliente:       "María González"
🤖 Agente:        "¿Tu teléfono es este mismo o necesito otro?"
👤 Cliente:       "El mismo"
🤖 (…continúa con apellido, dirección, ciudad…)
🤖 Sistema:       → logistics cotiza con Dropi
🤖 Agente:        "Envío a Bogotá: $9.500, 1 día hábil, Coordinadora. Total: $401.660. ¿Pago anticipado o contra entrega?"
👤 Cliente:       "Anticipado"
🤖 Sistema:       → checkout crea pedido + 8 side-effects
🤖 Agente:        "¡Listo! Pedido #ord-CF-100439. Te envío el link de pago: https://wompi.co/l/abc123. Guía: DROPI-MRE7JO8N-9681."
```

**Resultado**: 1 pedido creado, 24 OrderItems, 1 Attribution (last_click al último ad), 1 Shipment, 1 CommissionEntry al 50% (datos_completados), 1 OrderEvent, 1 AuditLog.

---

#### Ejemplo 2 — Cliente objecciona precio

```
👤 Cliente (WA):  "Hola, vi el anuncio del Batola. Cuánto está?"
🤖 Sistema:       → profile detecta "detal"
🤖 Sistema:       → speech abre para detal
🤖 Agente:        "¡Hola! Batola $22.300. Te muestro los diseños disponibles 👇"
🤖 Sistema:       → catalog trae 3 batolas con imagen
👤 Cliente:       "$22.300 me parece caro"
🤖 Sistema:       → objection clasifica "precio"
🤖 Agente:        "Te entiendo. La Batola es tela 100% algodón peruano, una sola te dura 2 años. ¿La quieres en set de 2 con 10% off?"
👤 Cliente:       "Mmm déjame pensarlo"
🤖 Sistema:       → objection clasifica "lo pienso"
🤖 Agente:        "Claro. La promo de set de 2 termina hoy. Si confirmas ahora te lo dejo a $40.140. ¿Te anoto?"
👤 Cliente:       "Bueno, sí"
🤖 (…continúa con address → logistics → checkout…)
```

**Resultado**: objection no repite el mismo argumento (revisa historial). Si el cliente dijera "no tengo esa talla" (S-L), el agente confirma que solo manejamos S/M/L y ofrece registrar interés (§18.2 caso especial).

---

#### Ejemplo 3 — Cliente envía imagen sin SKU

```
👤 Cliente (IG):  [envía foto de un pijama Stitch]
🤖 Agente:        "¡Bonito diseño! Déjame identificar cuál es 🔍"
🤖 Sistema:       → vision ejecuta: lee franja metadata con OCR
🤖 Sistema:       → confidence 0.92, sku PIJ-STITCH-002
🤖 Agente:        "Es el Pijama Stitch Adulto, talla M, $32.000. ¿Lo quieres?"
👤 Cliente:       "Sí pero en talla XL"
🤖 Sistema:       → objection caso especial tallas S-L §18.2
🤖 Agente:        "Actualmente trabajamos S, M y L. ¿Te anoto para avisarte cuando amplíemos a XL?"
👤 Cliente:       "No, déjame L entonces"
🤖 (…continúa con address → logistics → checkout…)
```

**Resultado**: vision identifica correctamente por OCR de la franja (no inventa SKU). objection maneja el caso especial de tallas sin derivar a asesor humano.

---

## 8. Configurar tu estrategia de pago

CommerceFlow OS soporta 3 modos de pago por canal, configurables en `⌘9` Configuración → "Estrategia de pago por canal":

- **Anticipado** (`advance`): el cliente paga antes de despachar. Recomendado para clientes nuevos, valores altos, y mercados con baja confianza en COD.
- **Contra entrega** (`cod`): el cliente paga al recibir. Recomendado para clientes recurrentes, valores bajos, y mercados donde COD es cultural (Colombia, México).
- **Híbrido** (`hybrid`): el cliente paga un % anticipado y el resto contra entrega. Recomendado para valores intermedios y mercados mixtos.

### Guía de decisión por país

| País | Modo recomendado | `requirePrepayMin` | `prepayDiscountPct` | `codFee` | Justificación |
|------|------------------|---------------------|----------------------|----------|---------------|
| **CO** (Colombia) | Híbrido | $100.000 COP | 5% | $5.000 COP | COD es cultural pero el fraude sube > $100k. El descuento incentiva anticipo. |
| **MX** (México) | Híbrido | $500 MXN | 5% | $30 MXN | Similar a CO, ajustado a tickets más bajos. |
| **ES** (España) | Anticipado | €0 | 0% | €0 | COD casi no existe en EU. Anticipo por tarjeta o Bizum. |
| **DE** (Alemania) | Anticipado | €0 | 0% | €0 | Igual que ES. GDPR estricto → no almacenar datos de pago innecesarios. |

### Cómo configurar cada canal

En `⌘9` Configuración → "Estrategia de pago por canal":

1. Selecciona el canal (ej: "WhatsApp CO").
2. Modo de pago: "Híbrido".
3. `requirePrepayMin`: 100000 (en COP).
4. `prepayDiscountPct`: 5.
5. `codFee`: 5000.
6. Click "Guardar".

El backend persiste estos valores en la tabla `Setting` con `tenantId` + `key='payments.config.whatsapp_co'`. El agente `checkout` los lee al momento de generar el resumen.

### Ejemplo numérico — AOV $90k, margen 60%, ¿qué recargo COD aplicar?

Supongamos:
- AOV: $90.000 COP
- Margen: 60% → COGS $36.000, grossProfit $54.000
- Costo de flete promedio: $9.500
- Tasa de devolución COD: 15% (en LATAM)

**Cálculo del recargo COD**:

```
Costo real de un pedido COD = flete + (probabilidad_devolución × (flete_ida + flete_retorno))
                            = $9.500 + (0.15 × ($9.500 + $9.500))
                            = $9.500 + $2.850
                            = $12.350

Costo real de un pedido anticipado = $9.500 (solo ida, no hay devolución)

Diferencia = $12.350 - $9.500 = $2.850

Recargo COD recomendado = diferencia / (1 - tasa_devolución)
                        = $2.850 / 0.85
                        = $3.353 ≈ $3.500

Verificación con margen: $3.500 / $90.000 = 3.9% (cubre el costo de devoluciones)
```

**Resultado**: configura `codFee` = $3.500 para este escenario. Si tu tasa de devolución es 25%, sube a $6.333.

> ⚠️ **Warning**: NO configure `codFee` > 10% del AOV. El cliente lo percibe como abuso y abandona el carrito. Si necesitas más, sube el precio base en su lugar.

> ✅ **Best practice**: revisa la tasa de devolución real de tu tenant cada mes en Monetización (`⌘7` → "Embudo §15.1" → columna "Devuelto"). Si sube > 20%, ajusta `codFee` o cambia a modo "Híbrido" para ese canal.

---

## 9. Conectar canales (WhatsApp, Messenger, Instagram)

Para cada canal necesitas: (1) cuenta Meta Business verificada, (2) página de Facebook, (3) app de Meta developers con permisos aprobados, (4) webhook URL accesible públicamente con HTTPS, (5) verify token, (6) app secret (para HMAC).

### WhatsApp Cloud API

#### Pasos en Meta Business

1. Ve a [developers.facebook.com](https://developers.facebook.com) → My Apps → Create App → Business.
2. Agrega el producto "WhatsApp" → Cloud API.
3. En "WhatsApp → Configuration":
   - **Callback URL**: `https://tu-dominio.com/api/webhooks/whatsapp`
   - **Verify Token**: el valor de `WA_VERIFY_TOKEN` en tu `.env` (debe ser idéntico).
4. Click "Verify and Save" → Meta hace un GET a tu URL con `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → tu endpoint responde con `hub.challenge`.
5. Suscríbete al campo `messages`.
6. En "WhatsApp → Phone Numbers", agrega tu número Business y completa el flow de verificación (subir documentos de empresa).

#### Permisos a solicitar

- `whatsapp_business_messaging` (enviar mensajes)
- `whatsapp_business_management` (gestionar plantillas, números)

#### Variables de entorno

```env
WA_VERIFY_TOKEN=tu_token_unico_y_largo
META_APP_SECRET=abc123def456...  # App Secret de tu app de Meta
```

#### Verificación

```bash
# Test del handshake (debe devolver el challenge)
curl "https://tu-dominio.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=tu_token&hub.challenge=test123"
# Esperado: test123 con status 200

# Test de HMAC (enviar webhook sin X-Hub-Signature-256 → debe 403)
curl -X POST https://tu-dominio.com/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"573000000000","text":{"body":"hola"}}]}}]}]}'
# Esperado: 403 Forbidden
```

---

### Messenger

#### Pasos en Meta Business

1. En la misma app de Meta developers, agrega el producto "Messenger".
2. En "Messenger → Settings":
   - **Callback URL**: `https://tu-dominio.com/api/webhooks/meta`
   - **Verify Token**: el valor de `META_VERIFY_TOKEN`.
3. Suscríbete a: `messages`, `messaging_postbacks`, `messaging_deliveries`, `messaging_reads`.
4. Genera el Page Access Token de tu página de Facebook.
5. (Opcional) App Review para `pages_messaging` (requerido para usuarios fuera de tu rol de la app).

#### Permisos

- `pages_messaging` (enviar y recibir mensajes)
- `pages_show_list` (listar páginas del usuario)
- `pages_manage_metadata` (acceso a metadata avanzada)

---

### Instagram DM

#### Pasos en Meta Business

1. Convierte tu cuenta de Instagram en cuenta Business (Settings → Account → Switch to Business).
2. Vincula tu cuenta de Instagram a una página de Facebook.
3. En la app de Meta developers → Instagram Graph API:
   - **Callback URL**: `https://tu-dominio.com/api/webhooks/meta` (la MISMA que Messenger).
   - **Verify Token**: `META_VERIFY_TOKEN`.
4. Suscríbete a `messages` (Instagram DM usa el mismo webhook que Messenger).
5. App Review para `instagram_manage_messages`.

#### Permisos

- `instagram_basic`
- `instagram_manage_messages`
- `pages_show_list`

---

### Troubleshooting — los 5 errores más comunes

| # | Problema | Causa | Solución |
|---|----------|-------|----------|
| 1 | Meta devuelve "Couldn't validate URL. Callback verification failed" al suscribir webhook | `WA_VERIFY_TOKEN` o `META_VERIFY_TOKEN` no coincide entre `.env` y Meta dashboard | Verifica que sean EXACTAMENTE iguales. Reinicia el dev server. Prueba manualmente con el curl de handshake. |
| 2 | Webhook handshake OK pero no llegan mensajes entrantes | No te suscribiste al campo `messages` en Meta dashboard | Ve a Meta → Webhooks → selecciona tu app → suscríbete a `messages`. |
| 3 | Llegan mensajes pero el agente IA no responde | `META_APP_SECRET` no configurado → HMAC verification falla silenciosamente | Configura `META_APP_SECRET` en `.env`. Reinicia el app. |
| 4 | Mensajes salientes fallan con "Recipient phone number not in allowed list" | Tu número Business está en modo sandbox (solo permite números testeados) | Agrega el número del cliente como test recipient, O completa el App Review para producción. |
| 5 | En Messenger/IG, los mensajes salen como "no enviados" | Falta `pages_messaging` App Review, o Page Access Token expiró | Completa App Review. Regenera el Page Access Token. |

> ⚠️ **Warning crítico**: SIEMPRE configura `META_APP_SECRET` en producción. Sin esto, un atacante puede enviar webhooks falsos a tu endpoint y disparar respuestas automáticas a clientes inventados. Es el vector de ataque #1 de este tipo de sistemas.

---

## 10. Conectar plataformas de pauta (Meta, Google, TikTok)

Para atribuir pedidos a anuncios necesitas: (1) access token de cada plataforma, (2) registrar webhook o polling diario, (3) capturar `click_id` (fbclid/gclid/ttclid) en el momento del click, (4) persistirlo en `Conversation.attribution` cuando el cliente escribe, (5) importar el ad spend diario.

### Meta Ads

#### Obtener access token

1. En Meta developers → tu app → Marketing API → Tools.
2. Genera un User Access Token con permisos: `ads_management`, `ads_read`, `business_management`.
3. Intercámbialo por un Long-Lived Token (válido 60 días, renovable):
   ```bash
   curl "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_LIVED_TOKEN"
   ```
4. Configura en `.env`:
   ```env
   META_ADS_ACCESS_TOKEN=EAAG...
   META_ADS_ACCOUNT_ID=act_1234567890
   ```

#### Registrar webhook para leadgen (opcional)

Si quieres capturar leads en tiempo real, suscríbete al webhook `leadgen` en Meta dashboard. Para atribución de pedidos, no es necesario — basta con el `fbclid` capturado en el click.

#### Capturar fbclid

Cuando un usuario hace click en tu anuncio de Meta, la URL de destino incluye `?fbclid=abc123`. Tu WhatsApp link debe ser:

```
https://wa.me/573000000000?text=Hola%20vi%20el%20anuncio%20de%20Saramantha%20ref%3Dabc123
```

O bien, usa un redirect intermedio:

```
https://tu-dominio.com/r?platform=meta&ad_id=123&campaign_id=456&fbclid=abc123
→ redirect 302 a https://wa.me/...
```

El middleware captura `fbclid` y lo persiste en una cookie. Cuando el cliente escribe por WhatsApp, el webhook Meta recibe el `from` (número), y tu backend busca el `fbclid` asociado a ese número → crea `Attribution` con `model='last_click'`.

#### Importar ad spend diario

```bash
# Cron diario a las 03:00 UTC
0 3 * * * curl -X POST https://tu-dominio.com/api/ads/import-spend \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"platform":"meta","date":"yesterday"}'
```

El endpoint llama a `GET https://graph.facebook.com/v18.0/act_XXX/insights?fields=spend,impressions,clicks,actions&time_range={'since':'2026-01-14','until':'2026-01-14'}` y persiste en `AdSpend`.

---

### Google Ads

#### Obtener access token

1. Solicita acceso al [Google Ads API Developer Token](https://developers.google.com/google-ads/api/docs/first-call/dev-token).
2. Crea credenciales OAuth2 en Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID.
3. Scope: `https://www.googleapis.com/auth/adwords`.
4. Implementa el flow OAuth2 (Authorization Code flow) para obtener `refresh_token`.
5. Configura en `.env`:
   ```env
   GOOGLE_ADS_DEVELOPER_TOKEN=xxxxxxxxxx
   GOOGLE_ADS_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_ADS_CLIENT_SECRET=xxxxx
   GOOGLE_ADS_REFRESH_TOKEN=1//xxxxx
   GOOGLE_ADS_CUSTOMER_ID=123-456-7890
   ```

#### Capturar gclid

El `gclid` se agrega automáticamente a la URL de destino del click. Tu middleware debe capturarlo:

```
https://tu-dominio.com/r?platform=google&ad_id=123&gclid=abc123
→ redirect 302 a https://wa.me/...
```

#### Importar ad spend diario

El endpoint `POST /api/ads/import-spend` con `platform=google` usa la Google Ads API con GAQL (Google Ads Query Language):

```sql
SELECT
  segments.date,
  campaign.id,
  ad_group_ad.ad.id,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions
FROM ad_group_ad
WHERE segments.date = '2026-01-14'
```

`cost_micros` está en millones de la moneda base (ej: 1000000 = $1 USD). Conversión a COP en el adapter.

---

### TikTok Ads

#### Obtener access token

1. Ve a [TikTok For Business](https://business-api.tiktok.com/portal/) → Developer Portal.
2. Crea una app y solicita aprobación.
3. Genera el Access Token del advertiser.
4. Configura en `.env`:
   ```env
   TIKTOK_ADS_ACCESS_TOKEN=xxxxx
   TIKTOK_ADS_ADVERTISER_ID=1234567890
   ```

#### Capturar ttclid

Similar a fbclid/gclid — TikTok agrega `?ttclid=abc123` a la URL de destino. Tu middleware captura:

```
https://tu-dominio.com/r?platform=tiktok&ad_id=123&ttclid=abc123
→ redirect 302 a https://wa.me/...
```

#### Importar ad spend diario

```bash
0 4 * * * curl -X POST https://tu-dominio.com/api/ads/import-spend \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"platform":"tiktok","date":"yesterday"}'
```

El endpoint llama a `GET https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/` con `report_type=BASIC`, `data_level=AUCTION_AD`, `dimensions=["ad_id","stat_time_day"]`, `metrics=["spend","impressions","clicks","conversion"]`.

---

### Tabla resumen

| Plataforma | click_id | Auth | Webhook | Spend API endpoint |
|------------|----------|------|---------|---------------------|
| Meta Ads | `fbclid` | Long-Lived Token | `leadgen` (opcional) | `graph.facebook.com/v18.0/act_XXX/insights` |
| Google Ads | `gclid` | OAuth2 + Developer Token | n/a (polling) | Google Ads API (GAQL) |
| TikTok Ads | `ttclid` | Access Token del advertiser | n/a (polling) | `business-api.tiktok.com/open_api/v1.3/report/integrated/get/` |

> 💡 **Tip ágil**: en dev, no configures credenciales reales. Usa los 12 anuncios sembrados (`prisma/seed.ts`) con datos sintéticos para probar el dashboard de Atribución.

---

## 11. El motor de atribución explicado

El motor de atribución es la "killer feature" de CommerceFlow OS. Calcula 19 métricas por anuncio, las clasifica en 6 veredictos, y soporta 4 modelos de atribución multi-touch.

### Las 5 métricas principales

| Métrica | Fórmula | Significado | Ejemplo numérico (Saramantha) |
|---------|---------|-------------|-------------------------------|
| **CPA** | `spend / orderCount` | Costo por adquisición (pedido) | Anuncio "Glow Carousel": spend $480.000 COP, 12 pedidos → CPA = $40.000 COP |
| **ROAS** | `paidRevenue / spend` | Return On Ad Spend (revenue pagado / spend) | $1.150.000 / $480.000 = 2.4 → "por cada $1 invertido, recuperas $2.40" |
| **ROI** | `netProfit / spend` | Return On Investment (lucro neto / spend, incluye COGS) | netProfit $690.000 / $480.000 = 1.44 → "44% de retorno neto" |
| **CPL** | `spend / leads` | Costo por lead (conversación iniciada) | 480.000 / 30 leads = $16.000 COP por lead |
| **CVR** | `orderCount / clicks` | Conversion rate (clicks → pedidos) | 12 pedidos / 240 clicks = 5% |

#### Ejemplo numérico real de Saramantha

Anuncio "Glow Carousel Productos Saramantha" (Meta):

```
Spend:           $480.000 COP
Impressions:     120.000
Clicks:          240
CTR:             0.20% (240/120.000)
CPC:             $2.000 COP ($480.000/240)
ConvReported:    8 (lo que reporta Meta)
OrderCount:      12 (pedidos reales en CommerceFlow)
Units:           24
Revenue:         $1.380.000 COP
PaidRevenue:     $1.150.000 COP (algunos pedidos en COD aún no pagados)
AOV:             $115.000 COP
COGS:            $552.000 COP (40% del revenue)
GrossProfit:     $828.000 COP
NetProfit:       $690.000 COP (grossProfit - comisión 3% - impuestos)

CPA:             $40.000 COP ($480.000/12)
CPL:             $16.000 COP ($480.000/30)
CVR:             5% (12/240)
ROAS:            2.4 ($1.150.000/$480.000)
ROI:             1.44 ($690.000/$480.000)

Veredicto:       scale ✅ (ROAS > 2, CPA < target $50k)
```

Anuncio "Colágeno Video" (Meta, canibalizador):

```
Spend:           $620.000 COP
OrderCount:      0 (¡cero pedidos!)
ConvReported:    5 (Meta dice 5 conversiones)

Veredicto:       cannibalize ⚠️ (plataforma reporta conv pero 0 pedidos reales)
→ Kill-switch recomendado
```

---

### Los 4 modelos de atribución multi-touch

El endpoint `GET /api/attribution?tenantId=…&model=…` soporta 4 modelos. Cada uno reparte el crédito del pedido entre los touchpoints (anuncios) que tocaron al cliente antes de comprar.

#### Ejemplo: cliente vio 3 anuncios antes de comprar $100.000

```
Día 1: ve anuncio A (Glow carousel)    → click, no compra
Día 3: ve anuncio B (Batola video)     → click, no compra
Día 7: ve anuncio C (Short Tira)       → click, COMpra $100.000
```

| Modelo | Crédito al anuncio A | Crédito al anuncio B | Crédito al anuncio C | Cuándo usarlo |
|--------|----------------------|----------------------|----------------------|---------------|
| `last_click` | $0 | $0 | $100.000 (100%) | Default. Simple. Castiga el awareness. |
| `first_click` | $100.000 (100%) | $0 | $0 | Para medir qué anuncio DESCUBRE al cliente. |
| `linear` | $33.333 (33%) | $33.333 (33%) | $33.333 (33%) | Para medir contribución equitativa. |
| `time_decay` | $14.286 (14%) | $28.571 (29%) | $57.143 (57%) | Para favorecer el último contacto con decaimiento exponencial. |

> 💡 **Tip ágil**: en producción usa `last_click` para decisiones operativas (es el que mejor correlaciona con el revenue directo). Cambia a `linear` o `time_decay` cuando quieras re-priorizar awareness (campañas de discovery que no convierten directo pero alimentan el funnel).

---

### Qué es la canibalización y cómo se detecta

**Canibalización** = cuando Meta/Google/TikTok reportan conversiones para un anuncio, pero CommerceFlow no tiene pedidos reales asociados a ese `click_id`. Significa que el anuncio está consumiendo presupuesto sin generar ventas reales.

#### Cómo se detecta (algoritmo del veredicto `cannibalize`)

```typescript
if (ad.convReported > 0 && ad.orderCount === 0 && ad.roas < roas_kill_threshold) {
  verdict = 'cannibalize'
}
```

#### Causas comunes de canibalización

1. **Pixel mal configurado**: Meta cuenta como conversión un evento que no es compra real (ej: add-to-cart).
2. **Fraude de clicks**: bots generan clicks y events sin comprar.
3. **Audience overlap**: el mismo cliente ve 3 anuncios, Meta le atribuye la conversión al último (que quizás no es el que trajiste), pero en tu sistema el `click_id` no coincide con ningún ad.
4. **Conversion window muy largo**: Meta cuenta conversiones hasta 7 días después del click, pero el cliente compró por otra vía.

#### Qué hacer cuando ves `cannibalize`

1. Verifica el pixel de Meta (Event Manager → Diagnóstico).
2. Revisa el `orderCount` en CommerceFlow vs `convReported` en Meta dashboard. Si la diferencia es > 50%, hay problema.
3. Ejecuta el kill-switch para pausar el anuncio.
4. Anota en el audit log la razón ("canibalización detectada, gap > 50%").
5. Si el patrón se repite en varios anuncios, revisa tu strategy de attribution window.

---

### Umbrales configurables

En `⌘9` Configuración → "Umbrales de trafficker":

| Variable | Default | Efecto |
|----------|---------|--------|
| `roas_kill_threshold` | 1.5 | Anuncios con ROAS < 1.5 → veredicto `kill` (rojo). |
| `cpa_target` | $50.000 COP | Anuncios con CPA > $50k → veredicto `pause` (amarillo). |
| `cannibalize_gap_pct` | 50% | Si `convReported - orderCount) / convReported > 50%` y orderCount=0 → veredicto `cannibalize`. |
| `scale_roas_min` | 2.0 | Anuncios con ROAS > 2.0 y CPA < target → veredicto `scale` (verde). |

> ✅ **Best practice**: ajusta los umbrales según tu margen. Si tu margen es 60%, tu break-even ROAS es 1 / 0.6 = 1.67. Configura `roas_kill_threshold` = 1.8 (un poco por encima de break-even).

---

## 12. Workflows operativos diarios

Tres roles, tres rutinas. Cada rutina es una checklist que debes ejecutar al iniciar tu turno.

### Agente de chat (rutina mañana + tarde)

**Horario sugerido**: 8:00-12:00 y 14:00-18:00 (Lun-Vie).

#### Rutina mañana (8:00)

- [ ] Abrir el dashboard (`⌘1` Resumen).
- [ ] Verificar que el tenant activo es el correcto en el topbar.
- [ ] Verificar que el socket está conectado (footer: "Tiempo real conectado").
- [ ] `⌘2` para abrir Mensajería.
- [ ] Ver conversaciones no leídas (badge con contador en el sidebar).
- [ ] Responder las 5 conversaciones más antiguas primero (FIFO).
- [ ] Para cada conversación:
  - [ ] Leer el panel derecho: perfil, atribución, pedidos previos, memoria semántica.
  - [ ] Si el cliente pide producto → click "✨ Sugerir con IA" → selecciona agente `catalog` o `theme`.
  - [ ] Si el cliente confirma interés → agente `quote` para cotizar.
  - [ ] Si el cliente objecciona → agente `objection`.
  - [ ] Si el cliente acepta → agente `address` → `logistics` → `checkout`.
- [ ] Cerrar conversaciones resueltas (cambiar estado a "resuelta" en el menú `⋯`).

#### Rutina tarde (14:00)

- [ ] Mismas 5 conversaciones de la mañana, seguir donde se quedaron.
- [ ] Revisar Kanban (`⌘4`) — mover pedidos de "Llamar para confirmar" a "Datos completados" cuando el cliente confirma.
- [ ] Anotar en el `AuditLog` cualquier conversación que amerite seguimiento (ej: cliente prometió pagar y no pagó).

#### Errores que NO debes cometer

- ❌ Responder a un cliente sin leer su memoria semántica (puede haber pedido lo mismo ayer).
- ❌ Usar el agente `checkout` sin haber confirmado los 10 campos de dirección con `address`.
- ❌ Marcar conversación como "resuelta" sin confirmar que el pedido está creado.

---

### Trafficker (rutina diaria 9am)

**Horario sugerido**: 9:00-10:00 (Lun-Vie).

#### Rutina diaria

- [ ] `⌘6` para abrir Atribución de Pauta.
- [ ] Selecciona el rango "Ayer" en el selector de tiempo.
- [ ] Click en chip "X para apagar" (rose, icon Skull).
- [ ] Para cada anuncio con veredicto `kill`:
  - [ ] Click en el nombre del anuncio → abre detalle con métricas.
  - [ ] Verifica CPA > target y ROAS < threshold.
  - [ ] Click en "Apagar" → confirmar → audit log creado.
- [ ] Click en chip "X para escalar" (emerald, icon Rocket).
- [ ] Para cada anuncio con veredicto `scale`:
  - [ ] Verifica ROAS > 2 y CPA < target.
  - [ ] Click en "Escalar" → subir presupuesto 20-30% en Meta dashboard (no se hace automáticamente desde CommerceFlow por seguridad).
  - [ ] Anotar en `AuditLog` que se escaló (manual externo).
- [ ] Click en chip "X canibalizadores" (violeta, icon Flame).
- [ ] Para cada anuncio `cannibalize`:
  - [ ] Verificar pixel de Meta.
  - [ ] Si confirma canibalización → kill-switch.
- [ ] Cambiar modelo de atribución a `linear` → comparar verdicts con `last_click`. Si difieren mucho, hay análisis profundo que hacer.
- [ ] Anotar decisiones del día en un doc compartido (Notion/Confluence).

#### Errores que NO debes cometer

- ❌ Apagar un anuncio sin verificar que NO es semana de promo (puede estar en valley).
- ❌ Escalar más del 30% diario (algoritmo de Meta se vuelve inestable).
- ❌ Confiar 100% en el veredicto automático — siempre valida con contexto de negocio.

---

### Finanzas (rutina semanal, lunes 10am)

**Horario sugerido**: Lunes 10:00-12:00.

#### Rutina semanal

- [ ] `⌘7` para abrir Monetización.
- [ ] Selecciona rango "Últimos 7 días".
- [ ] Verificar GMV total de la semana.
- [ ] Comparar con GMV externo reportado por el tenant (vía conciliación).
- [ ] Click en "Conciliar" → verificar `riskLevel` (low/medium/high).
- [ ] Si `riskLevel = high` (gap > 15%):
  - [ ] Investigar pedidos faltantes.
  - [ ] Comparar conteo de pedidos en CommerceFlow vs CRM del cliente.
  - [ ] Reportar al equipo de operaciones.
- [ ] Verificar comisión reconocida:
  - [ ] 50% en pedidos `datos_completados`.
  - [ ] 100% en pedidos `despachados`.
- [ ] Generar invoice del período → enviar al cliente.
- [ ] Cerrar pedidos `devuelto` (comisión debe revertirse).
- [ ] Revisar el cuello de botella del embudo §15.1 — si > 70% en "Llamar para confirmar", notificar a operaciones que hay que mejorar la primera respuesta.

#### Errores que NO debes cometer

- ❌ Conciliar sin haber cargado los pedidos de la semana (script `load-real-orders`).
- ❌ Emitir invoice sin haber conciliado.
- ❌ Revertir comisión sin haber movido el pedido a `devuelto` en Kanban.

---

## 13. IA conversacional — cómo sacarle provecho

El botón "✨ Sugerir con IA" en Mensajería es tu asistente. Pero no es magia: funciona mejor cuando sabes CUÁNDO usarlo, qué contexto usa, y cómo editar sus sugerencias.

### Cuándo usar "Sugerir con IA"

| Situación | Agente a invocar | Por qué |
|-----------|------------------|---------|
| Cliente pregunta por producto | `catalog` | Te trae productos reales con imágenes, no genéricos. |
| Cliente menciona un personaje/tema | `theme` | Encuentra todos los SKUs del tema. |
| Cliente confirma interés por SKU | `quote` | Cotiza con volume pricing y margen. |
| Cliente dice "es caro" / "lo pienso" / "no tengo esa talla" | `objection` | Genera argumento basado en la tabla `Objection`. |
| Cliente envía foto de producto | `vision` | Identifica SKU por OCR de franja metadata. |
| Cliente acepta el pedido | `address` | Pregunta el campo faltante de los 10. |
| Datos confirmados, falta flete | `logistics` | Cotiza flete real con Dropi/99envios/Aveonline. |
| Todo listo para cerrar | `checkout` | Crea pedido + 8 side-effects. |

### Qué contexto usa la IA

La IA nunca inventa. Consulta la DB filtrada por `tenantId`:

- `Tenant` (tono de marca, nombre de asesora, política de pago)
- `SalesSpeech` (apertura, prueba social por perfil)
- `Product` (catálogo con SKU, precio, imagen)
- `VolumePrice` (precios por tramo 6-11, 12-35, 36+)
- `Objection` (respuestas base y gatillos mentales)
- `DeliveryHistory` (últimas 5 entregas a esa dirección)
- `Message` (historial de conversación → no repetir argumentos)
- `ThemeDesign` (productos por tema)
- `CategoryCombo` (categorías como "familia")

### Cómo editar la sugerencia

Después de click en "✨ Sugerir con IA" → selecciona agente → la respuesta aparece en el composer como DRAFT (no se envía solo).

Puedes:
- Editar el texto libremente antes de enviar.
- Click en "↻ Regenerar" para una nueva sugerencia (puede variar).
- Click en "✕ Descartar" para borrarla.

> ✅ **Best practice**: SIEMPRE lee la sugerencia antes de enviar. La IA tiene ~95% de acierto pero el 5% restante puede ser desastroso (ej: confundir tallas, inventar precios si faltan VolumePrice).

### 3 ejemplos prácticos

#### Ejemplo 1 — Cliente mayorista pide cotización

```
👤 Cliente: "Hola, vi el anuncio del Short Tira. Tengo tienda, quiero 12 unidades"
🤖 Tú: click "Sugerir con IA" → quote
🤖 IA: "12 Short Tira: pagas $164.400 → vendes $184.800 → te sobren $20.400. ¿Confirmas?"
✏️ Tú editas: "¡Hola! 12 Short Tira con descuento mayorista: pagas $164.400 → vendes $184.800 → te sobran $20.400. ¿Te lo separo?"
📤 Enviar
```

#### Ejemplo 2 — Cliente objecciona precio

```
👤 Cliente: "$22.300 me parece caro para una batola"
🤖 Tú: click "Sugerir con IA" → objection
🤖 IA: "Te entiendo. La Batola es 100% algodón peruano, una sola te dura 2 años. ¿La quieres en set de 2 con 10% off?"
✏️ Tú decides NO editar (la respuesta es buena).
📤 Enviar
```

#### Ejemplo 3 — Cliente confirma compra

```
👤 Cliente: "Sí, lo quiero, dónde te mando mis datos"
🤖 Tú: click "Sugerir con IA" → address
🤖 IA: "Perfecto. ¿Cuál es tu nombre completo?"
✏️ Tú decides editar para sonar más cercano: "¡Genial! 🎉 ¿Me dices tu nombre completo para registrarlo?"
📤 Enviar
```

### Limitaciones de la IA

- ⚠️ Latencia: 1-5 segundos por respuesta (depende del LLM provider). En timeout (>20s), usa fallback determinístico.
- ⚠️ Costo: cada llamada al LLM cuesta (variable según provider: Zai incluido, OpenAI ~$0.001 por request, xAI similar).
- ⚠️ Alucinaciones: si faltan datos en la DB (ej: no hay VolumePrice para ese SKU), la IA podría inventar precios. Por eso la regla de oro §2 inyecta datos reales en el user message.
- ⚠️ Idioma: funciona mejor en español LATAM neutro. Si el cliente escribe en spanglish o muy regional, la respuesta puede sonar genérica.
- ⚠️ No toma decisiones de negocio: la IA no decide si dar descuentos extra, no aprueba devoluciones, no gestiona quejas complejas → esas se derivan a humano.

---

## 14. Kanban operativo — gestión de pedidos

El Kanban (`⌘4`) es donde la operación se hace tangible. 8 columnas, drag & drop, filtros, y reconocimiento de comisión al mover.

### Las 8 columnas del §15.1

| # | Columna | Emoji | Color | Comisión | Significado |
|---|---------|-------|-------|----------|-------------|
| 1 | **Llamar para confirmar** | 📞 | Rose | 0% | Pedido creado, falta confirmar con cliente. Es el cuello de botella (73% promedio). |
| 2 | **Intento cancelación** | ⚠️ | Amber | 0% | Cliente quiso cancelar, agente salvando la venta. |
| 3 | **Datos completados** | ✅ | Sky | **50%** | 10 campos confirmados, listo para despachar. Comisión reconocida al 50%. |
| 4 | **Oficina** | 🏢 | Slate | 50% | Cliente recoge en oficina física. |
| 5 | **Programado** | 📅 | Indigo | 50% | Despacho programado para día específico. |
| 6 | **Despachado** | 🚚 | Emerald | **100%** | Guía generada, en manos de transportadora. Comisión reconocida al 100%. |
| 7 | **Novedad** | ❗ | Orange | 100% (retenida) | Transportadora reportó problema (dirección incorrecta, cliente no encontrado). |
| 8 | **Devuelto** | ↩️ | Red | 0% (revertida) | Pedido regresó a bodega. Comisión se revierte. |

### Drag & drop

Arrastra una card de una columna a otra → PATCH automático al backend → si el movimiento activa comisión, se crea `CommissionEntry`.

```
"Llamar para confirmar" → "Datos completados"
   ↓
PATCH /api/orders/[id] { status: "datos_completados" }
   ↓
Side-effects:
   - CommissionEntry creada (reconocidaPct=50, etapaReconocimiento='datos_completados')
   - OrderEvent creada (type='status_changed', from='llamar_para_confirmar', to='datos_completados')
   - AuditLog escrita (action='order.status_changed', actor=userId)
   - (Opcional) Webhook saliente a NocoDB si está configurado
```

### Sync con NocoDB

Si tienes `NOCODB_WEBHOOK_URL` y `NOCODB_WEBHOOK_SECRET` configurados, cada cambio de estado del Kanban se sincroniza bidireccionalmente con NocoDB:

1. **CommerceFlow → NocoDB**: PATCH a `/api/webhooks/nocodb-out` con header `X-NocoDB-Secret` y body `{ orderId, status }`.
2. **NocoDB → CommerceFlow**: si un operador cambia el estado en NocoDB, NocoDB envía webhook a `/api/webhooks/nocodb-in` (con el mismo secret) → CommerceFlow actualiza el pedido.

> ⚠️ **Warning**: el sync es eventual (no transaccional). Si NocoDB está caído, los cambios se quedan en una queue en memoria y se reintentan hasta 3 veces. Si después de 3 intentos no se sincronizó, hay un `AuditLog` con `action='sync.nocodb.failed'`.

### Filtros

En la barra de filtros arriba del Kanban:

- **Modo de pago**: Anticipado / COD / Híbrido.
- **Ciudad**: dinámico, extraído de los pedidos visibles.
- **Limpiar**: reset de todos los filtros.

Los filtros son AND (ej: ciudad=Bogotá + modo=COD → pedidos COD en Bogotá).

### Atajos del Kanban

- Click en el chevron del header → colapsa/expande la columna (persistente en sesión).
- Click en una card → abre el detalle en el panel derecho.
- `Esc` → cierra el panel de detalle.

> ✅ **Best practice**: organiza tu rutina Kanban por ciudad. Empieza por las ciudades con más pedidos pendientes en "Llamar para confirmar" — ahí está el ROI más alto de mover cards.

---

## 15. Monetización — cómo se cobra

CommerceFlow OS cobra a los tenants con un modelo de **fee base + comisión escalonada sobre GMV**. Esta es la única forma de alinear incentivos: si el tenant vende más, ganamos más.

### Modelo de comisión

| Tramo GMV mensual | Comisión | Justificación |
|-------------------|----------|---------------|
| $0 - $10M COP | 4.5% | Tramo inicial. Cubre costo de operación + margen. |
| $10M - $50M COP | 3.0% | Tramo medio. Economía de escala. |
| $50M+ COP | 1.75% | Tramo enterprise. El tenant es autosuficiente. |

**Fee base**: $500.000 COP/mes (cubre infraestructura + soporte básico). Se cobra al inicio del mes, sin importar GMV.

### Reconocimiento en 2 momentos

La comisión NO se reconoce 100% cuando se crea el pedido. Se reconoce en 2 momentos:

1. **50% cuando el pedido llega a `datos_completados`**: el agente hizo su trabajo (cerró la venta, capturó los 10 campos).
2. **100% cuando el pedido llega a `despachado`**: la operación cumplió (generó guía, entregó a transportadora).

Si el pedido se devuelve (columna `Devuelto`), la comisión se revierte (reconocidaPct=0).

### Por qué el cuello de botella del 73% afecta el cobro

El embudo §15.1 típico de Saramantha es:

```
174 Llamar para confirmar  (73%)  ← CUELLO DE BOTELLA
 21 Intento cancelación    (9%)
 15 Datos completados      (6%)   ← Aquí se reconoce el 50%
  3 Despachado             (1%)   ← Aquí se reconoce el 100%
```

Solo el 7% de los pedidos llegan a `datos_completados`. Significa que solo cobramos el 50% de comisión sobre el 7% del GMV potencial.

**Si mejoras el cuello de botella al 50%** (en vez de 73% en "Llamar para confirmar"):

```
87  Llamar para confirmar  (36%)  ← Mejorado
21  Intento cancelación    (9%)
60  Datos completados      (25%)  ← 4x más pedidos con comisión al 50%
30  Despachado             (12%)  ← 10x más pedidos con comisión al 100%
```

**Impacto en comisión mensual** (con GMV $32.6M, comisión efectiva 3.5%):

- Escenario actual (7% datos_completados, 1% despachado): comisión = $32.6M × 7% × 3.5% × 50% + $32.6M × 1% × 3.5% × 100% = $40k + $11k = $51k COP/mes.
- Escenario mejorado (25% datos_completados, 12% despachado): comisión = $32.6M × 25% × 3.5% × 50% + $32.6M × 12% × 3.5% × 100% = $143k + $137k = $280k COP/mes. **5.5x más comisión**.

> 💡 **Tip ágil**: el ROI de invertir en automatizar el seguimiento de "Llamar para confirmar" (mensajes proactivos, recordatorios) es masivo. El dashboard de Monetización te muestra exactamente dónde está el cuello.

### Conciliación anti-fuga

El endpoint `GET /api/conciliation?tenantId=…` compara:

- **GMV agente**: suma de `Order.total` con `origen='agente_whatsapp'` en el período.
- **GMV caja del cliente**: reportado externamente por el tenant (vía NocoDB sync o carga manual).
- **Gap**: diferencia porcentual.

```typescript
riskLevel =
  gapPct < 5   ? 'low'      // esperado, operación sana
: gapPct < 15  ? 'medium'   // investigar
:                'high'      // pérdida significativa, alertar a finanzas
```

#### Causas comunes de gap > 5%

1. **Pedidos creados en el CRM del cliente pero no en CommerceFlow**: el cliente cierra ventas fuera del agente.
2. **Pedidos cancelados que no se marcaron como `devuelto`**: el agente cerró pero el cliente no pagó.
3. **Diferencia de fechas**: el agente cerró el 30, el cliente reporta en caja el 1 del mes siguiente.
4. **Tipos de cambio**: si el tenant opera en multi-moneda.
5. **Fraude intencional**: el cliente oculta ventas para reducir comisión (grave).

> ⚠️ **Warning crítico**: si `riskLevel = high` por 2 meses consecutivos, hay que auditar al tenant. El modelo de comisión pierde sentido si el cliente puede ocultar ventas.

---

## 16. Seguridad y cumplimiento

CommerceFlow OS maneja PII (datos personales identificables) de clientes finales en LATAM y Europa. Esto te impone obligaciones legales: GDPR (UE) y Ley 1581 (Colombia).

### Qué PII se guarda

| Dato | Tabla | Justificación | Retención |
|------|-------|---------------|-----------|
| Nombre + apellido | `Customer` | Identificación del cliente | 2 años post-última compra |
| Teléfono | `Customer` | Contacto | 2 años |
| Dirección | `Order` + `DeliveryHistory` | Logística | 10 años (fiscal) |
| Email | `Customer` (opcional) | Comunicación | 2 años |
| Mensajes | `Message` | Auditoría + memoria semántica | 2 años |
| Embeddings | `Message.embedding` | Búsqueda semántica | 2 años |
| IP del cliente | `Message.metadata` | Anti-fraude | 90 días |
| Audit log | `AuditLog` | Cumplimiento | 5 años |

### Cómo se cifra

- **At rest**: Postgres con cifrado TDE (Transparent Data Encryption) recomendado en prod. En dev (SQLite) sin cifrar.
- **In transit**: HTTPS obligatorio (Caddy con Let's Encrypt, TLS 1.2+).
- **Secretos**: variables de entorno con permisos `600`. En prod, secrets manager (AWS Secrets Manager, Doppler, Vault).
- **PII en logs**: NUNCA loguear nombres, teléfonos o direcciones. Solo IDs.

### Retención y derecho al olvido

#### GDPR (UE) — artículos 15, 17

- **Acceso (art. 15)**: el usuario puede pedir todos sus datos. Endpoint `GET /api/customers/[id]/export` → JSON con todos sus mensajes, pedidos, embeddings.
- **Olvido (art. 17)**: el usuario puede pedir borrado. Endpoint `DELETE /api/customers/[id]` → soft delete (anonimiza nombre, teléfono, dirección) + hard delete de embeddings + retención de AuditLog con `action='customer.gdpr_deleted'`.

#### Ley 1581 (Colombia)

- **Registro Nacional de Bases de Datos (RNBD)**: registrar la base en la SIC (Superintendencia de Industria y Comercio).
- **Aviso de privacidad**: obligatorio en el primer contacto con el cliente. El agente `speech` debe incluirlo en su primer mensaje (configurable en `Tenant.avisoPrivacidad`).
- **Derecho de acceso, rectificación, cancelación, oposición (ARCO)**: endpoints equivalentes a GDPR.

### Roles y permisos

| Rol | Permisos |
|------|----------|
| `admin` | Todo. Cambiar configuración, gestionar usuarios, ver todos los tenants. |
| `agent` | Mensajería, Pedidos, Kanban. NO ve Atribución ni Monetización. |
| `trafficker` | Atribución, kill-switch, Configuración de umbrales. NO ve Mensajería ni Monetización detallada. |
| `finance` | Monetización, Conciliación, Invoice. NO ve Mensajería. |

> ✅ **Best practice**: crea usuarios con el rol MÍNIMO necesario. Un agente de chat no necesita ver el GMV ni la comisión.

### Webhook signature verification

Todos los webhooks entrantes deben verificar firma (en producción):

- **Meta (WhatsApp + Messenger + IG)**: HMAC SHA-256 del body con `META_APP_SECRET`, comparar con `X-Hub-Signature-256`.
- **NocoDB**: header `X-NocoDB-Secret` comparado con `NOCODB_WEBHOOK_SECRET`.
- **Shopify**: HMAC SHA-256 con `SHOPIFY_API_SECRET`.

```typescript
// Código de verificación en src/app/api/webhooks/whatsapp/route.ts
import crypto from 'crypto'

function verifyMetaSignature(body: string, signature: string, appSecret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
```

### Secrets management

| Tipo | Dev | Prod |
|------|-----|------|
| Variables de entorno | `.env` (gitignored) | Docker secrets o secrets manager |
| API keys LLM | vacío (Zai default) | OpenAI/xAI en secrets manager |
| Credenciales DB | `file:./dev.db` | Postgres con password fuerte (24+ chars) |
| Webhook secrets | tokens dev | Únicos por tenant, rotación 90 días |
| `META_APP_SECRET` | vacío (skip verification) | OBLIGATORIO en prod |

> ❌ **Don't do this**: NUNCA commitear `.env` al repo. Verificado por `.gitignore`, pero si lo haces por error: `git rm --cached .env && git commit --amend && FORCE PUSH + ROTAR TODOS LOS SECRETOS`.

> ⚠️ **Warning**: si sospechas un leak, sigue el proceso de [`SECURITY.md`](../SECURITY.md) — NO abras un issue público.

---

## 17. Troubleshooting (20 problemas comunes)

| # | Problema | Causa | Solución |
|---|----------|-------|----------|
| 1 | Socket.io no conecta (footer dice "Desconectado") | El chat-service en puerto 3003 no está corriendo | `cd mini-services/chat-service && bun run index.ts`. Verifica con `curl http://localhost:3003`. |
| 2 | Webhook Meta no verifica (403 forbidden) | `WA_VERIFY_TOKEN` o `META_VERIFY_TOKEN` no coincide con Meta dashboard | Verifica que sean EXACTAMENTE iguales. Reinicia el dev server. Prueba con curl de handshake. |
| 3 | IA no responde (timeout > 20s) | LLM provider del tenant caído o mal configurado | `curl /api/health?tenantId=ten-xxx \| jq '.checks[] \| select(.name \| startswith("llm"))'`. Si es Zai, debe estar ok. Si es OpenAI, verifica `OPENAI_API_KEY`. |
| 4 | ROAS se ve 0 en Atribución | El anuncio tiene `AdSpend` pero 0 `Attribution` (ningún pedido asociado) | Verifica que los pedidos tengan `attribution.clickId`. Si no, el cliente escribió sin click_id capturado. |
| 5 | Pedidos sin atribución | El cliente llegó al WhatsApp sin pasar por un anuncio con `fbclid` | Es esperado en ~10-15% de pedidos (tráfico directo, referido). No es un bug. |
| 6 | Kanban no carga (spinner infinito) | Endpoint `/api/orders` caído o tenant sin pedidos | `curl /api/orders?tenantId=ten-xxx` → ver respuesta. Si es 500, revisa logs del app. |
| 7 | Embeddings no funcionan (score siempre 0) | Mensajes sin `embedding` generado | `bun run scripts/backfill-embeddings.ts`. Verifica que `Message.embedding` no sea null. |
| 8 | Modo oscuro con contraste bajo | Variables CSS del tema dark mal calculadas | Verifica `globals.css` → `:root.dark` y `:root.dark *`. El tema emerald debe tener buen contraste en ambos. |
| 9 | Mobile no responsive (sidebar cubre todo) | Sheet del sidebar no se cierra al seleccionar item | Verifica el callback `onPick` en `sidebar.tsx` que llama `setMobileNavOpen(false)`. |
| 10 | Command palette no abre con ⌘K | `useEffect` que captura el shortcut no registrado | Verifica `topbar.tsx` → useEffect con `addEventListener('keydown')`. Debe capturar `metaKey` y `ctrlKey`. |
| 11 | "db.X is undefined" para un modelo Prisma nuevo | `globalThis.prisma` cacheado del schema anterior | `kill <PID del next dev>` y reinicia `bun run dev`. |
| 12 | Kanban pierde cards al arrastrar | PATCH al backend falla y el estado local se desincroniza | DevTools → Network → busca el PATCH fallido. Verifica status (404 = orderId no existe, 422 = status inválido). |
| 13 | Dropi/99envios/Aveonline devuelve tarifa 0 | Adapter en modo stub, ciudad no encontrada en tabla hardcodeada | Configura `DROPI_API_KEY` real en `.env`. Reinicia el app. |
| 14 | `db.X is not a function` después de agregar modelo | Falta `db:generate` después de modificar schema | `bun run db:generate` para regenerar el cliente Prisma tipado. |
| 15 | n8n workflows no aparecen | Contenedor n8n no levantado, o workflows no importados | `docker compose up -d n8n`. Verifica `https://tu-dominio/n8n/`. Importa los 11 JSON de `n8n-workflows/`. |
| 16 | NocoDB no ve las tablas de CommerceFlow | NocoDB usa base separada (`nocodb`) | En NocoDB → Settings → Data Sources → añadir base `commerceflow` como nueva conexión Postgres. |
| 17 | Webhooks de Meta fallan verificación en prod | `META_APP_SECRET` no configurado | `echo "META_APP_SECRET=abc123..." >> .env && docker compose restart app`. |
| 18 | pgvector no funciona (errores en búsqueda semántica) | Extensión `vector` no instalada en Postgres | `docker compose exec postgres psql -U commerceflow -d commerceflow -c "CREATE EXTENSION vector;"` + aplicar `prisma/sql/pgvector-setup.sql`. |
| 19 | App no arranca en prod ("DATABASE_URL malformed") | URL de Postgres con caracteres especiales sin escape | Verifica que el password no tenga `@`, `:`, `/` sin URL-encode. Usa `postgresql://user:pass@host:5432/db`. |
| 20 | Cambios en Configuración no se aplican | Frontend cachea o backend no persistió | Refresca la página (F5). Verifica en DB: `SELECT * FROM Setting WHERE tenantId='ten-xxx' AND key='payments.config.whatsapp_co'`. |

> 💡 **Tip ágil**: si tu problema no está aquí, busca en `worklog.md` (historial de 23+ sprints, todos los bugs resueltos están documentados) o en los docs específicos: `DEVELOPMENT.md` (troubleshooting técnico), `AGENTS-REFERENCE.md` (problemas de agentes), `ADAPTERS.md` (problemas de adaptadores).

---

## 18. Próximos pasos

Una vez que tienes el sistema corriendo y dominas los 9 módulos, estos son los siguientes pasos para sacar más provecho:

### Personalizar tono de marca

Cada tenant tiene `Tenant.tonoMarca` (string) y `Tenant.nombreAsesora` (string). Estos se inyectan en el `user` message del agente `speech` para que la apertura tenga el tono correcto.

```sql
-- Saramantha: tono empoderado, asesora "Sara"
UPDATE Tenant SET tonoMarca = 'empoderado, cercano, femenino', nombreAsesora = 'Sara' WHERE slug = 'saramantha';

-- Majestic: tono formal, asesora "Majestuosa"
UPDATE Tenant SET tonoMarca = 'formal, premium', nombreAsesora = 'Majestuosa' WHERE slug = 'majestic';
```

### Agregar productos al catálogo

Vía el adapter correspondiente (ver [§9](#9-conectar-canales-whatsapp-messenger-instagram)) o vía SQL directo:

```sql
INSERT INTO Product (id, tenantId, sku, name, diseno, price, imageUrl, fuenteSincronizacion, activo, createdAt, updatedAt)
VALUES ('prod-008', 'ten-saramantha', 'PIJ-BATOLA-STITCH-001', 'Batola Stitch', 'Stitch', 22300, 'https://...', 'manual', 1, NOW(), NOW());
```

Para volume pricing:

```sql
INSERT INTO VolumePrice (id, tenantId, productId, tipoCliente, cantidadMinima, cantidadMaxima, precioVolumen)
VALUES ('vp-001', 'ten-saramantha', 'prod-008', 'mayorista', 6, 11, 20070);  -- 10% off
```

### Conectar adaptador real

Para cada plataforma de ecommerce, hay un adapter con su interface (ver [`docs/ADAPTERS.md`](../docs/ADAPTERS.md)):

| Plataforma | Adapter | Variables de entorno |
|------------|---------|----------------------|
| WooCommerce | `WooCommerceAdapter` | `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_STORE_URL` |
| Shopify | `ShopifyAdapter` | `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_SHOP` |
| Supabase (cliente o nuestro) | `SupabaseCatalogAdapter` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Oracle | `OracleCatalogAdapter` | `ORACLE_CONNECTION_STRING`, `ORACLE_USER`, `ORACLE_PASSWORD` |

Configura las variables, cambia `Tenant.plataformaCatalogo` en DB, reinicia el app.

### Activar Ollama self-hosted

Para reducir costo de LLM y tener control total de los datos:

1. Levanta Ollama con el modelo `llama3.1:8b` o `qwen2.5:7b`:
   ```bash
   docker compose --profile ollama up -d ollama
   docker compose exec ollama ollama pull llama3.1:8b
   ```
2. Configura el tenant:
   ```sql
   UPDATE Tenant SET proveedorIa = 'ollama' WHERE slug = 'saramantha';
   ```
3. Verifica:
   ```bash
   curl -X POST http://tu-dominio/api/agents/speech \
     -H "Content-Type: application/json" \
     -d '{"tenantId":"ten-saramantha","perfil":"mayorista"}'
   # Debe responder en <5s
   ```

> ⚠️ Modelos locales son más lentos que Zai/OpenAI. Timeout del agente es 20s, así que modelos >13B pueden timeout.

### Escalar a multi-tenant

Para agregar un nuevo tenant:

1. Crea una fila en `Tenant`:
   ```sql
   INSERT INTO Tenant (id, slug, nombre, plan, plataformaCatalogo, bdCatalogo, proveedorLogistico, proveedorIa, tonoMarca, nombreAsesora, politicaPago, pais, moneda, createdAt, updatedAt)
   VALUES ('ten-nuevo', 'nuevo-tenant', 'Nuevo Tenant', 'pro', 'whatsapp_catalog', 'supabase_nuestro', 'dropi', 'zai', 'cercano', 'Asesora Nuevo', 'hybrid', 'CO', 'COP', NOW(), NOW());
   ```
2. Crea `Channel` rows para los canales del tenant.
3. Carga catálogo (via adapter o manual).
4. Configura estrategia de pago en `Setting`.
5. Configura webhooks Meta para el nuevo número de WhatsApp.
6. El tenant aparecerá en el tenant switcher del topbar.

> ✅ **Best practice**: usa el onboarding wizard (`POST /api/onboarding`) que crea todo lo necesario en una sola llamada. Ver [`docs/API-REFERENCE.md`](../docs/API-REFERENCE.md) sección Onboarding.

---

## 19. Glosario técnico completo

Términos del proyecto organizados alfabéticamente. Si encuentras una palabra que no conoces en el dashboard, búscala aquí.

| Término | Definición |
|---------|------------|
| **Adapter (Adaptador)** | Conector a un sistema externo. Hay 3 tipos: Ecommerce (5 impls), Logistics (3 impls), LLM (4 impls). |
| **AdPlatform** | Modelo Prisma que representa una plataforma de pauta (Meta, Google, TikTok). |
| **AdSpend** | Modelo Prisma que registra el gasto diario de un anuncio. Importado vía polling diario. |
| **Agent** | Función IA especializada en un momento de la conversación. 10 agentes en total. |
| **AgentContext** | Objeto TypeScript que recibe cada agente con `{ tenantId, conversationId?, customerId?, perfil?, items?, query?, message?, imageUrl? }`. |
| **AOV** | Average Order Value = GMV / # pedidos. |
| **Attribution** | Modelo Prisma que vincula un `Order` con un `Ad` y un `model` (last_click, first_click, linear, time_decay). |
| **AuditLog** | Modelo Prisma que registra todas las acciones sensibles (kill-switch, status changes, GDPR deletes, etc.). Retención 5 años. |
| **Carrier** | Modelo Prisma que representa una transportadora canónica (Servientrega, Coordinadora, Interrapidísimo, etc.). |
| **CartSync** | Modelo Prisma que sincroniza un `Order` de CommerceFlow con el `orderIdExterno` en la plataforma de ecommerce del tenant. |
| **Channel** | Modelo Prisma que representa un canal de mensajería (WhatsApp CO, WhatsApp MX, Messenger Global, Instagram). |
| **Click ID** | Identificador único del click en un anuncio: `fbclid` (Meta), `gclid` (Google), `ttclid` (TikTok). |
| **COD** | Cash On Delivery (pago contra entrega). |
| **CommissionEntry** | Modelo Prisma que registra la comisión reconocida por un pedido. `reconocidaPct` 50% o 100%. |
| **Conversation** | Modelo Prisma que agrupa mensajes entre un `Customer` y un `Channel`. |
| **CPA** | Costo Por Adquisición = spend / orderCount. |
| **CPL** | Costo Por Lead = spend / leads. |
| **Customer** | Modelo Prisma que representa al cliente final. Tiene `perfilDetectado`, `telefono`, `direccion`. |
| **CVR** | Conversion Rate = orderCount / clicks. |
| **DeliveryHistory** | Modelo Prisma que guarda últimas 5 entregas a una dirección para consulta del agente `address`. |
| **EcommerceAdapter** | Interfaz TypeScript con 5 métodos: `syncCatalog`, `getProduct`, `crearPedido`, `actualizarPedido`, `cancelarPedido`. |
| **Embedding** | Vector numérico (1024 dims) que representa el significado de un texto o imagen. Usado para búsqueda semántica. |
| **FreightQuote** | Modelo Prisma que cachea cotizaciones de flete por `tenantId_proveedor_ciudad_pais_cantidad`. |
| **GMV** | Gross Merchandise Value = suma del total de todos los pedidos en un período. |
| **HMAC** | Hash-based Message Authentication Code. Se usa para verificar firma de webhooks. |
| **ImageIdentification** | Modelo Prisma que guarda identificaciones visuales con `skuDetectado`, `confianza`, `metodo`. |
| **Invoice** | Modelo Prisma que agrupa `CommissionEntry` de un período para facturación. |
| **Kanban** | Vista del dashboard con 8 columnas del embudo §15.1. |
| **Kill-switch** | Acción que pausa un anuncio + escribe AuditLog. Solo roles `trafficker` y `admin`. |
| **LLMAdapter** | Interfaz TypeScript con 3 métodos: `createChat`, `createVision`, `createEmbedding`. |
| **LogisticsAdapter** | Interfaz TypeScript con 4 métodos: `cotizar`, `generarGuia`, `rastrear`, `cancelarGuia`. |
| **Message** | Modelo Prisma que representa un mensaje individual en una conversación. Tiene `embedding`. |
| **Multi-tenant** | Arquitectura donde múltiples tenants comparten la misma app pero con datos aislados (vía `tenantId` + RLS). |
| **n8n** | Orquestador de workflows externo self-hosted. 11 workflows importables. |
| **NocoDB** | Airtable open-source conectado a Postgres. Vista operativa Kanban. |
| **Objection** | Modelo Prisma con respuestas base y gatillos mentales para objeciones comunes. |
| **Order** | Modelo Prisma principal. Tiene `status` (8 valores), `total`, `paymentMode`, `origen`, `tenantId`. |
| **OrderEvent** | Modelo Prisma que registra eventos del pedido (created, status_changed, shipped, etc.). |
| **OrderItem** | Modelo Prisma que representa un item dentro de un `Order` (sku, cantidad, precio). |
| **Orquestador** | Componente que ejecuta los 10 agentes en secuencia de 9 pasos. |
| **pgvector** | Extensión de Postgres para embeddings vectoriales. HNSW index para búsqueda sub-100ms. |
| **Product** | Modelo Prisma que representa un producto del catálogo. Tiene `embeddingTexto` y `embeddingVisual`. |
| **Profile** | 4 tipos: `mayorista`, `emprendedor`, `detal`, `regalo`. Detectado por el agente `profile`. |
| **Regla de oro §2** | Los system prompts NO contienen datos de negocio. Se inyectan en el user message después de consultar la DB. |
| **RLS** | Row Level Security de Postgres. Aislamiento por `tenantId` a nivel DB. |
| **ROAS** | Return On Ad Spend = paidRevenue / spend. |
| **ROI** | Return On Investment = netProfit / spend. |
| **SalesSpeech** | Modelo Prisma con `aperturaTexto` y `pruebaSocial` por `tenantId_perfil`. |
| **Setting** | Modelo Prisma para configuración key-value del tenant (estrategia de pago, umbrales, etc.). |
| **Shipment** | Modelo Prisma que representa la guía de envío generada por `LogisticsAdapter`. |
| **Saramantha** | Documento funcional de especificación de ZIAY SAS. Referencia del proyecto. |
| **ThemeDesign** | Modelo Prisma que agrupa productos por tema/personaje (Stitch, Hello Kitty, etc.). |
| **Tenant** | Modelo Prisma que representa una marca/empresa aislada. |
| **VolumePrice** | Modelo Prisma con precios por tramo (6-11, 12-35, 36+) y tipo de cliente. |
| **WABA** | WhatsApp Business Account. Cuenta empresarial aprobada por Meta. |
| **withTenant()** | Función de `src/lib/rls.ts` que ejecuta una query con `SET LOCAL app.tenant_id=…` para RLS. |

---

## 20. Soporte y recursos

### Documentación del proyecto

| Documento | Path | Qué contiene |
|-----------|------|--------------|
| **README** | [`README.md`](../README.md) | Visión general, quick start, estructura, stack. Punto de entrada. |
| **API Reference** | [`docs/API-REFERENCE.md`](../docs/API-REFERENCE.md) | Las 34 rutas API con body, query, response, ejemplos curl. |
| **Data Model** | [`docs/DATA-MODEL.md`](../docs/DATA-MODEL.md) | Los 31 modelos Prisma + diagrama ER ASCII + decisiones de diseño. |
| **Agents Reference** | [`docs/AGENTS-REFERENCE.md`](../docs/AGENTS-REFERENCE.md) | Los 10 agentes, system prompts, side-effects, orquestación §12. |
| **Adapters** | [`docs/ADAPTERS.md`](../docs/ADAPTERS.md) | Capa de adaptadores: Ecommerce (5) + Logistics (3) + LLM (4) + Registry. |
| **Development** | [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) | Guía de dev local: setup, scripts, smoke tests, troubleshooting. |
| **Environment** | [`docs/ENVIRONMENT.md`](../docs/ENVIRONMENT.md) | TODAS las variables de entorno por categoría. |
| **Production Checklist** | [`docs/PRODUCTION-CHECKLIST.md`](../docs/PRODUCTION-CHECKLIST.md) | Checklist de go-live con checkboxes. |
| **Guía Deploy** | [`upload/GUIA-DEPLOY-PRODUCCION.md`](GUIA-DEPLOY-PRODUCCION.md) | Deploy paso a paso en VPS con Docker. |
| **Onboarding E2E** | [`upload/onboarding-end-to-end.md`](onboarding-end-to-end.md) | Onboarding end-to-end alternativo (2000+ líneas, 17 secciones). |
| **Maestro Arquitectura** | [`upload/MAESTRO-arquitectura.md`](MAESTRO-arquitectura.md) | Documento maestro de arquitectura y viabilidad. |
| **CHANGELOG** | [`CHANGELOG.md`](../CHANGELOG.md) | Historial de versiones (Keep a Changelog). |
| **CONTRIBUTING** | [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Cómo contribuir: branches, commits, PRs, cómo añadir agentes y adaptadores. |
| **SECURITY** | [`SECURITY.md`](../SECURITY.md) | Política de seguridad y divulgación responsable. |
| **Worklog** | [`worklog.md`](../worklog.md) | Bitácora completa del desarrollo (23+ sprints). |
| **Este documento** | [`upload/ONBOARDING-COMPLETO.md`](ONBOARDING-COMPLETO.md) | Onboarding definitivo (este archivo). |

### Dónde obtener ayuda

| Tipo de ayuda | Canal |
|----------------|-------|
| **Bug o problema técnico** | Abre un issue en GitHub con tag `bug` + template `Bug_Report.md`. |
| **Pregunta de uso** | Abre un issue con tag `question` o pregunta en el canal de Slack del equipo. |
| **Vulnerabilidad de seguridad** | `security@ziay.co` — **NO abras issue público**. Ver [`SECURITY.md`](../SECURITY.md). |
| **Onboarding de nuevo tenant** | Endpoint `POST /api/onboarding` con body del wizard. |
| **Soporte de Meta (WhatsApp Business)** | Meta Business Support Center. |
| **Soporte de n8n** | https://community.n8n.io |
| **Soporte de Prisma** | GitHub issues del repo `prisma/prisma`. |
| **Soporte de adaptadores externos** | Contactar al proveedor (WooCommerce, Shopify, Dropi, etc.). |
| **Emergencias de producción** | `ops@ziay.co` / +57 XXX XXX XXXX (on-call 24/7). |

### Cómo reportar bugs

Template obligatorio:

```markdown
**Título**: [Bug] Descripción concisa del problema

**Ambiente**:
- Tenant: ten-saramantha
- Módulo: Atribución de Pauta
- Browser: Chrome 121
- ¿Dev o prod?: prod (https://ziay.co)

**Pasos para reproducir**:
1. Ir a ⌘6 Atribución
2. Click en chip "Canibalizadores"
3. Click en "Apagar" del anuncio "Colágeno Video"
4. ...

**Comportamiento esperado**: Toast de confirmación + audit log creado.
**Comportamiento actual**: 500 Internal Server Error.

**Logs relevantes**:
```
(pégalo del dev.log o docker compose logs)
```

**Screenshots**: (si aplica)
```

### Cómo contribuir

Lee [`CONTRIBUTING.md`](../CONTRIBUTING.md) en detalle. Resumen:

1. Fork el repo.
2. Crea branch con naming: `feat/...`, `fix/...`, `docs/...`, `refactor/...`, `chore/...`, `perf/...`, `test/...`, `security/...`.
3. Commits con Conventional Commits: `feat(agents): add new objection handler for shipping cost`.
4. Abre PR con descripción + checklist.
5. CI debe pasar (ESLint + TypeScript + tests).
6. Review por 2 maintainers.
7. Merge a `main` → deploy automático a staging.

#### Cómo añadir un nuevo agente

Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#cómo-añadir-un-nuevo-agente-conversacional) y [`docs/AGENTS-REFERENCE.md`](../docs/AGENTS-REFERENCE.md#cómo-extender-con-un-nuevo-agente).

Resumen:
1. Añade el nombre al tipo `AgentName` en `src/lib/agents/prompts.ts`.
2. Implementa `buildXxxPrompt(ctx)` que retorna `{ system, user }` respetando la regla de oro §2.
3. Añádelo al router `buildAgentPrompt`.
4. Añádelo a `AGENT_NAMES` y `AGENT_LABELS`.
5. Si tiene side-effects, añádelos en `src/app/api/agents/[agentName]/route.ts`.
6. Si entra en el orquestador, actualiza `ORCHESTRATOR_STEPS` en `src/lib/orchestrator/constants.ts`.
7. Añade un fallback determinístico (timeout 20s).
8. Documenta en `docs/AGENTS-REFERENCE.md` y `docs/API-REFERENCE.md`.

#### Cómo añadir un nuevo adaptador

Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#cómo-añadir-un-nuevo-adaptador) y [`docs/ADAPTERS.md`](../docs/ADAPTERS.md).

Resumen para un `EcommerceAdapter`:
1. Crea `src/lib/adapters/mi-ecommerce.ts` implementando la interfaz (5 métodos).
2. Añádelo al registry `src/lib/adapters/registry.ts` en el switch sobre `Tenant.plataformaCatalogo`.
3. Añade las variables de entorno a `.env.example` y `docs/ENVIRONMENT.md`.
4. Documenta en `docs/ADAPTERS.md`.
5. Si el adapter tiene HTTP real, asegúrate de hacer fallback a stub cuando no haya creds.

---

## Cierre

Si llegaste hasta aquí, ya estás listo para operar CommerceFlow OS en producción. El sistema está pensado para ser **autoexplicativo**: el dashboard te dice qué hacer (veredictos, gaps, cuellos de botella), los agentes te dan las respuestas listas, y los workflows operativos son repetibles.

Las tres reglas de oro que debes recordar siempre:

1. **Regla de oro §2**: nunca inyectes datos de negocio en los system prompts.
2. **El cuello de botella del 73%**: si no mueves pedidos de "Llamar para confirmar" a "Datos completados", no cobras. Tu ROI está en el Kanban.
3. **Conciliación anti-fuga**: si `riskLevel = high` por 2 meses, audita al tenant. Sin conciliación, el modelo de comisión no tiene sentido.

Feliz operación 🚀

---

**Última actualización**: 2026-01-15 (sincronizado con `worklog.md` post sprint `UX-UI-VERIFICACION`).
**Mantenimiento**: este documento debe actualizarse cuando se agreguen nuevos agentes, adaptadores, módulos del dashboard o cambios en el modelo de monetización. Ver [`CONTRIBUTING.md`](../CONTRIBUTING.md) para el proceso.
