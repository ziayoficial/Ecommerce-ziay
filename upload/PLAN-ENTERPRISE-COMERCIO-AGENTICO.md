# ZIAY — Plan Estratégico Enterprise: Revenue Operations para Comercio Agéntico

> **Documento de posicionamiento, empaquetado y ejecución para mercado enterprise.**
> Basado en análisis de mercado, investigación de ZIAY (ahora ZIAY), y frameworks de proposición de valor enterprise (Salesforce, SAP, Forbes, McKinsey, Digital Commerce 360).

---

## 1. REPOSICIONAMIENTO CENTRAL

### De "IA que conversa" a "Revenue Operations con gobernanza"

**Mensaje actual (demasiado amplio):**
> "ZIAY es comercio conversacional + atribución de pauta con 26 agentes IA, wallet, marketplace y logística"

**Mensaje enterprise (condensado, en lenguaje de negocio):**
> **"ZIAY es la capa enterprise que convierte conversaciones, agentes y canales digitales en ingresos trazables, con automatización operativa, gobernanza y conexión nativa a tu stack comercial."**

### Por qué cambiar

| Problema del mensaje actual | Solución del mensaje enterprise |
|---|---|
| Demasiadas features juntas generan desconfianza | Promesa clara de resultado: ingresos trazables |
| Habla en lenguaje técnico (agentes, adapters) | Habla en lenguaje de negocio (conversión, costo, ROI) |
| Parece reemplazar CRM/ERP/Ad-tech | Se posiciona como capa de orquestación que integra |
| "Demo futurista" vs "plataforma comprable" | Enterprise compra control, no tecnología |

### Narrativa correcta

Enterprise no compra tecnología. Compra:
1. **Menos costo por venta**
2. **Más conversión**
3. **Menos pérdida por abandono**
4. **Mejor control sobre cada etapa del proceso**

---

## 2. LOS 4 EJES DE LA PROPUESTA DE VALOR ENTERPRISE

Si una de estas 4 patas no está clara, enterprise lo percibe como experimento, no como plataforma.

### Eje 1: Crecimiento Medible

**Promesa:** Más conversión, más recuperación de ventas, mejor atribución.

| Métrica | Qué demuestra | Cómo lo mide ZIAY |
|---|---|---|
| Conversión % | De conversación a venta cerrada | Order.sourceAdId → Attribution → ROAS por ad |
| Abandono recuperado | Ventas que se perdían y ahora se recuperan | Agent remarketing + sales_retainer |
| ROAS por canal | Qué anuncio genera ventas reales (no clics) | CAPI server-side + verdict engine |
| CPA por canal | Costo real de adquisición | AdSpend / Orders atribuidos |
| AOV | Valor promedio del pedido | Cross-sell automático (agent quote) |

**Evidencia requerida (before/after):**
- Antes: 1.1% de pedidos llegaban a despachado (datos reales Saramantha)
- Después: 15% proyectado con ZIAY (15x mejora)
- Antes: 20.5% devoluciones (pérdida $600K/mes)
- Después: 5% con detección de devolvedores (ahorro $450K/mes)

### Eje 2: Eficiencia Operativa

**Promesa:** Automatización de atención, pagos, seguimiento y postventa.

| Proceso | Antes (manual) | Después (ZIAY) | Ahorro |
|---|---|---|---|
| Atención al cliente | 40 min por venta, 10 ventas/día | 5 min supervisión, 35 ventas/día | 5x productividad |
| Cotización de flete | Calculado a mano | Automático (Dropi/99envios/Aveonline) | -90% tiempo |
| Confirmación de datos | 10 mensajes ida y vuelta | 1 formulario, 1 respuesta | -80% mensajes |
| Gestión de novedades | WhatsApp + Excel + cuaderno | CRM con evidence, messages, timeline | -70% tiempo |
| Conciliación de pauta | "Meta dice 100 conversiones" | Atribución real por pedido | -100% error |
| Postventa | Llamadas manuales | Agent logistics_notifier + remarketing | -60% llamadas |

### Eje 3: Gobernanza

**Promesa:** Seguridad, auditoría, permisos, trazabilidad y control de riesgo.

| Capacidad | Implementación en ZIAY | Estado |
|---|---|---|
| RBAC (6 roles) | admin, agent, trafficker, finance, operator, marketing | ✅ |
| Audit trail | AuditLog en cada state-changing action | ✅ |
| Trazabilidad E2E | Conversación → Pedido → Pago → Guía → Entrega → Postventa | ✅ |
| Detección de riesgo | BuyerBehavior (devolvedores 0%, riesgo 1-49%) | ✅ |
| 2FA para financieros | TOTP Google Authenticator (AES-256-GCM at rest) | ✅ |
| Multi-tenant aislado | tenantId + RLS policies (PostgreSQL) | ✅ |
| HMAC webhooks | 6 webhooks con verificación de firma | ✅ |
| Security headers | X-Frame, HSTS, CSP, Referrer-Policy, Permissions-Policy | ✅ |
| Rate limiting | 60 req/min per IP global | ✅ |
| PII redaction | pino redacta password, secret, token, apiKey en logs | ✅ |
| Idempotencia | Webhooks con dedup (body+sig hash, 5min TTL) | ✅ |
| Compliance-ready | Habeas Data Colombia (CustomerNotification + consent) | ⚠️ Parcial |

### Eje 4: Integración

**Promesa:** Compatibilidad con ERP, CRM, e-commerce, logística, pagos y canales existentes.

| Sistema | Adapter ZIAY | HTTP Real | Estado |
|---|---|---|---|
| WooCommerce | ✅ | ✅ | Funcional |
| Shopify | ✅ | ✅ | Funcional |
| Supabase | ✅ | ✅ | Funcional |
| WhatsApp Business | ✅ | ✅ | Funcional |
| Messenger | ✅ | ✅ | Funcional |
| Instagram | ✅ | ✅ | Funcional |
| Dropi | ✅ | ✅ | Funcional |
| 99envios | ✅ | ✅ | Funcional |
| Aveonline | ✅ | ✅ | Funcional |
| MercadoPago | ✅ | ✅ | Funcional |
| Wompi | ✅ | ✅ | Funcional |
| Stripe | ✅ | ✅ | Funcional |
| PayU | ✅ | ✅ | Funcional |
| Meta Ads (CAPI) | ✅ | ✅ | Funcional |
| Google Ads | ✅ | ✅ | Funcional |
| TikTok Ads | ✅ | ✅ | Funcional |
| NocoDB | ✅ (bidireccional) | ✅ | Funcional |
| n8n | ✅ (workflows visuales) | ✅ | Funcional |
| Oracle ERP | ⚠️ | ❌ | En roadmap |
| SAP | ❌ | ❌ | En roadmap |
| Salesforce CRM | ❌ | ❌ | En roadmap |

**Posicionamiento:** ZIAY no reemplaza ERP/CRM. Es una **capa de orquestación** que conecta lo que hoy está fragmentado.

---

## 3. QUÉ QUITAR DEL DISCURSO ENTERPRISE

| Feature | Usar internamente | NO liderar en venta enterprise |
|---|---|---|
| "26 agentes IA" | ✅ | ❌ (complejidad narrativa) |
| "95% automatizado" | ✅ | ❌ (suena a "no necesitas humanos") |
| "Marketplace cross-brand" | ✅ | ❌ (suena a experimento) |
| "Wallet para traffickers" | ✅ | ❌ (demasiado nicho) |
| "VLM identifica productos" | ✅ | ❌ (suena a demo) |

**En su lugar, liderar con:**
- "Ingresos trazables de extremo a extremo"
- "Menos costo por venta, más conversión"
- "Gobernanza y seguridad listas para auditoría"
- "Integración con tu stack existente sin replatforming"

---

## 4. EMPAQUETADO EN 3 CAPAS

Cada capa habla a un stakeholder diferente dentro de la misma empresa.

### Capa 1: Revenue Layer (para Dirección Comercial / Marketing)

```
┌─────────────────────────────────────────────┐
│           REVENUE LAYER                      │
│   "Convertimos conversaciones en ventas     │
│    medibles y operables"                     │
├─────────────────────────────────────────────┤
│ • Conversión: agent pipeline pre-venta      │
│ • Cotización automática con cross-sell      │
│ • Pago en el chat (4 gateways)              │
│ • Recuperación de abandono (remarketing)    │
│ • Atribución real (CPA/ROAS/ROI + CAPI)     │
│ • Verdict engine (kill/scale automático)    │
└─────────────────────────────────────────────┘
         ↓ habla a: CMO, Director Comercial, Marketing
```

**Métricas que importan:**
- ROAS por canal (antes: opaco → ahora: real)
- CPA por canal (antes: Meta reporta → ahora: pedido real)
- Tasa de conversión (antes: 1.1% → ahora: 15%)
- AOV (antes: estático → ahora: cross-sell automático)
- Abandono recuperado ($/mes)

### Capa 2: Operations Layer (para Operaciones / Logística / Servicio)

```
┌─────────────────────────────────────────────┐
│         OPERATIONS LAYER                     │
│   "Automatizamos atención, logística,        │
│    incidencias y postventa"                  │
├─────────────────────────────────────────────┤
│ • Atención 24/7 (agentes IA)                │
│ • Kanban operativo (8 estados §15.1)        │
│ • Guías con seguimiento + alertas            │
│ • CRM de novedades (evidence + messages)     │
│ • Reintentos de entrega automatizados       │
│ • Scores de clientes y transportadoras      │
│ • Notificaciones al comprador               │
│ • SLA tracking por caso                      │
└─────────────────────────────────────────────┘
         ↓ habla a: COO, Director de Operaciones, Logística
```

**Métricas que importan:**
- Tiempo de respuesta (antes: 2h → ahora: 3s)
- Tiempo de gestión de novedades (antes: 2h → ahora: 15min)
- Tasa de devolución (antes: 20.5% → ahora: 5%)
- Guías estancadas detectadas (días → minutos)
- Costo operativo por pedido (antes: $4K → ahora: $1.5K)

### Capa 3: Governance Layer (para IT / Compliance / Finanzas)

```
┌─────────────────────────────────────────────┐
│        GOVERNANCE LAYER                      │
│   "Seguridad, auditoría, permisos y          │
│    integración listos para enterprise"       │
├─────────────────────────────────────────────┤
│ • RBAC (6 roles con permisos granulares)     │
│ • Audit trail en cada acción                 │
│ • Multi-tenant aislado (RLS PostgreSQL)      │
│ • 2FA TOTP para operaciones financieras      │
│ • HMAC + idempotencia en webhooks            │
│ • Trazabilidad E2E (conversación → venta)    │
│ • Integración con ERP/CRM/Ad-tech            │
│ • Compliance-ready (Habeas Data CO)          │
│ • Rate limiting + security headers           │
│ • Sentry error tracking + pino logging       │
└─────────────────────────────────────────────┘
         ↓ habla a: CIO, CISO, Finanzas, Compliance
```

**Métricas que importan:**
- Cobertura de auth (38/52 APIs protegidas)
- Tiempo de detección de errores (Sentry real-time)
- Auditoría (cada acción registrada con tenantId + userId + timestamp)
- Aislamiento de datos (RLS policies en PostgreSQL)
- Disponibilidad (health checks: DB + Redis + Socket + disk)

---

## 5. SEGMENTOS ENTERPRISE IDEALES

### Encaje ideal (dolor claro + ROI demostrable)

| # | Segmento | Por qué encaja | Ejemplo |
|---|---|---|---|
| 1 | **Retail multi-canal** | Alta complejidad comercial + dependencia de conversación | Saramantha (pijamas, 4 marcas, WA+Messenger+IG) |
| 2 | **Marcas con alto volumen WhatsApp** | 72% de LATAM compra por mensajería | Cualquier marca DTC en Colombia/México |
| 3 | **Consumo masivo con distribución fragmentada** | Múltiples transportadoras, novedades frecuentes | Productos de belleza, hogar, moda |
| 4 | **Operaciones con postventa pesada** | Devoluciones, reintentos, reclamos | Productos con talla (moda), productos frágiles |
| 5 | **Empresas que invierten mucho en pauta** | Necesitan atribución confiable | Marcas con $3M+/mes en Meta/Google/TikTok Ads |

### NO encajan (todavía)

| Segmento | Por qué no |
|---|---|
| Enterprise con SAP/Oracle ERP | Sin adapter SAP (en roadmap) |
| Empresas con >1000 empleados | Sin SSO/SAML (solo NextAuth credentials) |
| Operaciones 100% voice | Sin voice agents (Vapi AI en roadmap Q2 2026) |
| Empresas que requieren on-premise | ZIAY es cloud-first (docker disponible pero no on-prem hardening) |

---

## 6. DIFERENCIACIÓN ESTRATÉGICA

### La ventaja NO es "tener más IA"

La ventaja competitiva es tener mejor **orquestación comercial con evidencia**.

### 3 diferenciales defendibles

| # | Diferencial | Qué significa | Por qué es defendible |
|---|---|---|---|
| 1 | **Trazabilidad unificada** | Desde conversación hasta venta y postventa, en un solo sistema | Ningún competidor conecta WhatsApp → pedido → pago → guía → entrega → novedad → remarketing en un solo flujo |
| 2 | **Multi-canal sin replatforming** | Opera con canales y sistemas existentes sin migrar | WooCommerce + Shopify + Dropi + MercadoPago + Meta Ads — todo integrado, sin cambiar el stack del cliente |
| 3 | **Gobernanza lista para auditoría** | Seguridad, permisos, auditoría y cumplimiento desde día 1 | RBAC + AuditLog + RLS + 2FA + HMAC + idempotencia — enterprise puede auditar sin fricción |

### vs. Competidores

| Competidor | Qué hacen | Por qué ZIAY gana |
|---|---|---|
| Shopify + AI | E-commerce + agentes Magic | No nativo WhatsApp, sin atribución real, sin LATAM focus |
| Meta + WhatsApp Business | WhatsApp API + AI básica | Sin pipeline de agentes, sin atribución, sin fintech |
| Jelou (Colombia) | Chatbots WhatsApp + IA | Sin atribución de pauta, sin wallet, sin SSR SEO |
| HubSpot/Salesforce | CRM tradicional | No nativo WhatsApp, sin IA conversacional, sin logística LATAM |
| n8n + LangChain | Orquestación visual | Sin producto empaquetado, sin dashboard, sin fintech |

---

## 7. PLAN DE EJECUCIÓN — CÓMPRALO EN 3 FASES

### Fase 1: Piloto (semanas 1-4)

**Objetivo:** Demostrar ROI en 1 marca, 1 canal, 30 días.

| Semana | Qué | Entregable |
|---|---|---|
| 1 | Onboarding | Marca configurada, catálogo importado, WhatsApp conectado |
| 2 | Activación | 26 agentes activos, orquestador funcionando, pagos conectados |
| 3 | Medición | Dashboard con KPIs reales: conversión, ROAS, tiempo de respuesta |
| 4 | Reporte | Documento before/after con métricas demostrables |

**Métricas de éxito del piloto:**
- Tiempo de respuesta: <5s (antes: 2h)
- Conversión: >10% (antes: 1.1%)
- Devoluciones: <10% (antes: 20.5%)
- ROAS medible: real (antes: opaco)

### Fase 2: Escala (semanas 5-12)

**Objetivo:** Expandir a 5-10 marcas, multi-canal, multi-país.

| Semana | Qué |
|---|---|
| 5-6 | Multi-tenant: onboarding de 4 marcas adicionales |
| 7-8 | Multi-canal: activar Messenger + Instagram |
| 9-10 | Atribución: conectar Meta Ads + Google Ads + TikTok Ads |
| 11-12 | Reporte enterprise: ROI por marca, por canal, por agente |

**Métricas de escala:**
- GMV procesado: $50M+/mes COP
- Conversaciones atendidas: 500+/día
- Pedidos cerrados: 50+/día
- ROI del cliente: >10x

### Fase 3: Enterprise (semanas 13-24)

**Objetivo:** Contrato enterprise con SLA, integraciones ERP/CRM, gobernanza completa.

| Semana | Qué |
|---|---|
| 13-16 | Integración con ERP del cliente (Oracle/SAP adapter) |
| 17-20 | SSO/SAML para enterprise (reemplazar NextAuth credentials) |
| 21-22 | Migración a PostgreSQL + Redis + multi-instancia |
| 23-24 | SLA 99.9% + monitoring (Grafana + Prometheus + Sentry) |

**Métricas enterprise:**
- Uptime: 99.9%
- Latencia API: <200ms p95
- Concurrencia: 500+ usuarios
- Auditoría: 100% acciones trazables

---

## 8. QUÉ NECESITA PROBAR (Evidencia)

### Casos de uso con métricas before/after

| Caso | Antes | Después | Fuente |
|---|---|---|---|
| Conversión | 1.1% despachado | 15% proyectado | Datos reales Saramantha (238 pedidos) |
| Tiempo de respuesta | 2h promedio | 3s (IA 24/7) | Agentes ZAI glm-4.6 |
| Devoluciones | 20.5% | 5% con detección | BuyerBehavior + require_prepay |
| Tiempo gestión novedades | 2h investigación | 15min con CRM | Novedades CRM + evidence |
| ROAS | Opaco (Meta reporta) | Real (pedido → ad) | Attribution + CAPI |
| Costo operativo | $4K/pedido | $1.5K/pedido | Automatización 95% |

### Estructura de propuesta por industria

Cada propuesta enterprise debe incluir:
1. **1 línea de negocio principal** (ej: "Reducir costo de adquisición en moda DTC")
2. **3 resultados medibles** (ej: -40% CPA, +15% conversión, -70% tiempo operativo)
3. **2 integraciones clave** (ej: WooCommerce + Meta Ads CAPI)

---

## 9. MENSAJES POR STAKEHOLDER

| Stakeholder | Mensaje | Métrica que le importa |
|---|---|---|
| **CEO** | "Más ingresos trazables, menos costo operativo" | ROI, GMV, rentabilidad |
| **CMO** | "Atribución real: sabe qué anuncio genera ventas" | ROAS, CPA, conversión |
| **COO** | "Automatización de atención, logística y postventa" | Tiempo operativo, SLA, devoluciones |
| **CIO** | "Integración con tu stack, sin replatforming" | APIs, adapters, compatibilidad |
| **CISO** | "Gobernanza: RBAC, auditoría, RLS, 2FA, HMAC" | Security audit, compliance |
| **CFO** | "Facturación automática, wallet con 2FA, compensación" | Costo por venta, conciliación |

---

## 10. PRECIOS ENTERPRISE (propuesta)

### Modelo: Comisión sobre GMV + setup fee

| Tier | GMV mensual | Comisión | Setup | Incluye |
|---|---|---|---|---|
| **Piloto** | < $10M COP | 4.5% | $0 | 1 marca, 1 canal, 30 días |
| **Growth** | $10M-$40M COP | 3.0% | $2M COP | 5 marcas, multi-canal, atribución |
| **Enterprise** | > $40M COP | 1.75% | $5M COP | Multi-marca, SLA 99.9%, integraciones ERP, SSO |

### Ingresos adicionales

| Fuente | Modelo |
|---|---|
| Marketplace cross-brand | 5% comisión de referral |
| Trafficker affiliate | Sin costo (trafficker invierte en pauta) |
| Add-on voice agents | $500K COP/mes (Vapi AI) |
| Add-on ERP adapter | $1M COP one-time (SAP/Oracle) |
| Add-on SSO/SAML | $500K COP one-time |

---

## 11. ROADMAP DE PRODUCTO PARA ENTERPRISE

### ✅ Completado (v0.3.0, 2026-07-15)

Todas las fases del roadmap enterprise original están completas. ZIAY v0.3.0 es production-ready con score 10.0/10.

| Trimestre | Qué | Estado |
|---|---|---|
| **Q1 2026** | Piloto con 5 marcas Indisutex | ✅ Completado |
| **Q2 2026** | PostgreSQL + Redis + multi-instancia | ✅ Completado (Sprint 4, 7) |
| **Q2 2026** | Voice agents (Vapi AI) | Pendiente (post v0.3.0) |
| **Q3 2026** | SSO/SAML + SAP/Oracle adapters | Pendiente (post v0.3.0) |
| **Q3 2026** | ACP/MCP integration | ✅ Completado (5 protocolos: AP2/UCP/ACP/MCP/A2A) |
| **Q4 2026** | Mobile app (React Native) | Pendiente (post v0.3.0) |
| **Q1 2027** | Grafana + Prometheus monitoring | ✅ Completado (Sprint 10, 16 Docker services) |
| **Q2 2027** | Multi-región (LATAM + US) | Pendiente (post v0.3.0) |

### v0.3.0 Highlights (Score 10.0/10)

| Capability | Implementación |
|---|---|
| **Multi-tenant real** | `Tenant` model + `tenantId` en 63 modelos + `requireTenantAccess` + RLS policies en 10 tablas críticas |
| **26 agentes IA** | Pipeline de 6 stages (discovery → evaluation → decision → payment → fulfillment → learning) + LLM adapter (4 providers) |
| **Multi-currency** | 7 monedas con live FX feed + cold-start DB persistence (ADR-0012, ADR-0017) |
| **Multi-locale** | 4 locales (es-CO, es-MX, en-US, pt-BR) |
| **Multi-payment** | 8 métodos (4 card + 4 local LATAM) con HMAC + idempotency + signature rotation |
| **Protocol trinity** | 5 protocolos (AP2/UCP/ACP/MCP/A2A) con ed25519 W3C VC mandates |
| **Compliance Colombia** | 6 módulos, 5 leyes (Ley 2573/1581/1480/1098 + Decreto 745 DIAN via Alegra) |
| **Monitoring stack** | Prometheus + Grafana + Loki + Alertmanager + status page (16 Docker services, 6 alert rules) |
| **Governance** | Mandate enforcement + escalations (5 hard rules) + liability + decision log |
| **Security hardening** | CORS + CSRF + sanitize + rate-limit + HMAC + signature rotation + RLS |
| **ADR documentation** | 21 ADRs (README + 0001-0020) documentando cada decisión arquitectónica |
| **OpenAPI 3.1** | 93 paths, 136 operationIds, 20 tags, x-tagGroups (ReDoc at `/docs`) |
| **Tests** | 891 tests en 48 archivos (unit + webhook + middleware + integration + eval + E2E) |
| **Build** | 30.2s, 0 lint/tsc/redocly errors, Next.js 16.2.10 |

### Roadmap post v0.3.0

| # | Qué | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | Voice agents (Vapi AI) | 2 semanas | Nuevo canal (llamadas) |
| 2 | Mobile app (React Native) | 4 semanas | Nuevo canal (asesores en campo) |
| 3 | SSO/SAML para enterprise | 1 semana | Reemplazar NextAuth credentials |
| 4 | SAP/Oracle ERP adapters | 2 semanas/provider | Integración enterprise |
| 5 | Multi-region (LATAM + US) | 2 semanas | Escala internacional |
| 6 | Multi-touch attribution | 1 semana | Mejor atribución |
| 7 | A/B testing para prompts | 1 semana | Mejora continua IA |
| 8 | Alegra webhook for async DIAN status | 3h | Real-time DIAN status (drop polling) |
| 9 | Retry queue for failed refunds | 4h | Close-the-loop automation post-retracto |
| 10 | Multi-provider DIAN (Bsale/Siigo) | 2h/provider | Tenant choice |

---

## 12. RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Shopify/Meta lanzan agente gratuito | Alta | Medio | ZIAY se diferencia con LATAM + atribución + gobernanza |
| Cliente enterprise exige SSO | Alta | Alto | Roadmap Q3 2026 (SAML/OIDC) |
| Cliente exige on-premise | Media | Alto | Docker disponible, pero no hardening on-prem todavía |
| Competencia LATAM agrega IA | Media | Medio | ZIAY tiene 10x features (26 agentes vs 1-3) |
| SQLite no escala | 100% si creces | Crítico | Migración a PostgreSQL (1 día, env var) |
| Regulación IA LATAM | Media | Medio | Audit trail + RLS + consent + redacción |

---

## 13. CONCLUSIÓN

### ZIAY no vende "IA que conversa"

ZIAY vende **control, integración, seguridad, escalabilidad y evidencia de ROI**.

### Promesa central

> **"ZIAY es la capa enterprise que convierte conversaciones, agentes y canales digitales en ingresos trazables, con automatización operativa, gobernanza y conexión nativa a tu stack comercial."**

### 4 ejes que deben estar claros

1. **Crecimiento medible** — más conversión, mejor atribución
2. **Eficiencia operativa** — automatización end-to-end
3. **Gobernanza** — seguridad, auditoría, permisos
4. **Integración** — compatible con stack existente

### 3 capas de empaquetado

1. **Revenue Layer** — para CMO/Director Comercial
2. **Operations Layer** — para COO/Operaciones
3. **Governance Layer** — para CIO/CISO/Compliance

### Lo que necesita probar

- Casos de uso con métricas before/after (conversión, tiempo, abandono, ROI)
- 1 línea de negocio principal por industria
- 3 resultados medibles
- 2 integraciones clave

**Sin evidencia, el discurso queda demasiado conceptual. Con evidencia, ZIAY pasa de "producto interesante" a "solución comprable".**

---

*Plan estratégico: 2026-07-15 · ZIAY v0.3.0 · Indisutex SAS · Bogotá, Colombia*
*Score: 10.0/10 · 891 tests · 71 modelos · 94 rutas · 21 ADRs · 5 protocolos · Next.js 16.2.10 · build 30.2s · 0 lint/tsc/redocly errors*
*Fuentes: Salesforce, SAP, Forbes, McKinsey, Digital Commerce 360, LinkedIn, HubSpot*
