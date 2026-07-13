# ZIAY

> **Revenue Operations para Comercio Agéntico.**
> La capa enterprise que convierte conversaciones, agentes y canales digitales en ingresos trazables, con automatización operativa, gobernanza y conexión nativa a tu stack comercial.

---

## 🎯 Posicionamiento Enterprise

ZIAY no es un chatbot, no es un CRM, no es un gateway de pagos. ZIAY es la **capa enterprise** que se conecta sobre tu stack comercial existente y orquesta conversaciones, agentes y canales digitales hacia **ingresos trazables**.

### Mensaje core

> _"ZIAY es la capa enterprise que convierte conversaciones, agentes y canales digitales en ingresos trazables, con automatización operativa, gobernanza y conexión nativa a tu stack comercial."_

### Tagline

- **Revenue Operations para Comercio Agéntico** (reemplaza a _"Comercio Conversacional + Atribución Inteligente"_)

---

## 📐 4 Ejes Enterprise

Cada feature de ZIAY se mapea a uno de los 4 ejes:

| Eje | Qué significa | Features |
|---|---|---|
| **Crecimiento medible** | Cada conversación, agente y canal se atribuye a ingresos reales. ROAS, CPA y ROI auditables. | Atribución por canal, verdict engine (kill/pause/scale/watch), CAPI server-side, SEO orgánico medible |
| **Eficiencia operativa** | Automatización end-to-end del ciclo de venta. Menos costo por venta, más conversión. | 26 agentes en 3 pipelines, logística, novedades, reintentos, remarketing |
| **Gobernanza** | Wallet 2FA, multi-tenant isolation, audit trail, control de riesgo financiero y de devoluciones. | Wallet con TOTP, RLS Postgres, AuditLog, detección de devolvedores |
| **Integración** | Conexión nativa con tu stack comercial: Meta/Google/TikTok Ads, Shopify, WooCommerce, 4 gateways, 3 carriers. | 18 adapters, 6 webhooks HMAC, CAPI adapters, multi-canal unificado |

---

## 🏛️ 3 Capas de Arquitectura

La plataforma se estructura en 3 capas, cada una responsable de uno o más ejes:

### 1. Revenue Layer — _Crecimiento medible_

Conversaciones, agentes y canales digitales conectados a ingresos trazables. Atribución real por canal, verdict engine y CAPI server-side a Meta/Google/TikTok.

### 2. Operations Layer — _Eficiencia operativa_

Automatización operativa del ciclo de venta: 26 agentes en 3 pipelines (pre-venta, post-venta, inteligencia). Logística, novedades, reintentos y remarketing sin intervención humana.

### 3. Governance Layer — _Gobernanza + Integración_

Gobernanza financiera y de datos: wallet con 2FA, multi-tenant isolation (app + ORM + RLS), audit log en cada transición, control de devolvedores. Conexión nativa al stack comercial vía 18 adapters y 6 webhooks HMAC.

---

## 🚫 Mensajes que NO lideran (kept internally)

Los siguientes elementos siguen existiendo en la plataforma pero **no son el mensaje principal**:

- ~~"26 agentes"~~ como headline → ahora: _"Automatización operativa end-to-end"_ (los 26 agentes se mencionan como **cómo lo hacemos**, no como qué vendemos)
- ~~"95% automatizado"~~ → ahora: _"Menos costo por venta, más conversión"_
- ~~"Marketplace cross-brand"~~ como headline → ahora parte del eje **Integración** (_"Monetización adicional"_)
- ~~"Wallet para traffickers"~~ como headline → ahora parte del eje **Gobernanza** (_"Gobernanza financiera"_)

---

## 🔄 Key Replacements

| Antes | Ahora |
|---|---|
| Comercio Conversacional + Atribución Inteligente | **Revenue Operations para Comercio Agéntico** |
| 26 agentes IA (como headline) | **Ingresos trazables de extremo a extremo** |
| 95% automatizado | **Menos costo por venta, más conversión** |
| Convierte conversaciones en ventas | **Convierte conversaciones, agentes y canales en ingresos trazables** |

---

## 📊 Stack Técnico (resumen)

- **Frontend:** Next.js 16, React 19, TypeScript 5 (strict), Tailwind CSS 4, shadcn/ui (48 componentes)
- **Backend:** Next.js API Routes (44 endpoints), Prisma 6 (62 modelos), Socket.io (mini-service :3003)
- **IA:** z-ai-web-dev-sdk (LLM glm-4.6 + VLM glm-4.6v), 26 agentes en 3 pipelines
- **DB:** SQLite (dev) → PostgreSQL 16 (prod, RLS + pgvector)
- **DevOps:** Docker Compose (11 servicios), Caddy (auto-HTTPS), Uptime Kuma, n8n, MinIO
- **Seguridad:** 2FA TOTP, HMAC en webhooks, multi-tenant isolation (3 capas), audit log

Ver detalles completos en [`upload/PRESENTACION-STACK-COMPLETO.html`](upload/PRESENTACION-STACK-COMPLETO.html).

---

## 📚 Documentación

| Audiencia | Documento |
|---|---|
| Clientes enterprise | [`upload/PRESENTACION-CLIENTES-COMPLETA.html`](upload/PRESENTACION-CLIENTES-COMPLETA.html) |
| No-técnicos / emprendedores | [`upload/PRESENTACION-NO-TECNICOS.html`](upload/PRESENTACION-NO-TECNICOS.html) |
| Diferenciadores enterprise | [`upload/PRESENTACION-DIFERENCIADORES.html`](upload/PRESENTACION-DIFERENCIADORES.html) |
| Stack técnico completo | [`upload/PRESENTACION-STACK-COMPLETO.html`](upload/PRESENTACION-STACK-COMPLETO.html) |
| Evidencia E2E (QA) | [`upload/PRESENTACION-E2E-TESTS.html`](upload/PRESENTACION-E2E-TESTS.html) |
| Customer journeys (trazabilidad) | [`upload/PRESENTACION-CUSTOMER-JOURNEYS.html`](upload/PRESENTACION-CUSTOMER-JOURNEYS.html) |
| Onboarding de clientes | [`upload/GUIA-ONBOARDING-CLIENTES.md`](upload/GUIA-ONBOARDING-CLIENTES.md) |
| Lecciones aprendidas | [`upload/LECCIONES-APRENDIDAS.md`](upload/LECCIONES-APRENDIDAS.md) |
| Plan enterprise | [`upload/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md`](upload/PLAN-ENTERPRISE-COMERCIO-AGENTICO.md) |
| Resumen técnico | [`upload/RESUMEN-TECNICO-COMPLETO.md`](upload/RESUMEN-TECNICO-COMPLETO.md) |

Las presentaciones HTML están duplicadas y servidas públicamente en [`public/presentaciones/`](public/presentaciones/).

---

## 🏢 Compañía

**ZIAY** es operado por Indisutex SAS · Bogotá, Colombia · LATAM.

---

_Reposicionamiento enterprise aplicado en todas las presentaciones y docs. Tagline: **Revenue Operations para Comercio Agéntico**._
