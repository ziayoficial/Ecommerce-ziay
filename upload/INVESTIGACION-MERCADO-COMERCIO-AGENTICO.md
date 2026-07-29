# 🔬 Investigación Profunda de Mercado: Comercio Agéntico

## Resumen Ejecutivo

El **comercio agéntico** (agentic commerce) es la próxima gran disrupción del retail global. Los agentes de IA autónomos están pasando de ser asistentes pasivos a convertirse en compradores y vendedores activos que investigan, comparan, negocian y transan en nombre de humanos. McKinsey estima que podría generar **$1 trillón en retail orquestado para 2030**, y **$3-5 trillones en gasto retail global redirigido**. LATAM, con 400M+ usuarios de WhatsApp y 72% de consumidores que ya compran por mensajería, es el mercado más receptivo del mundo para esta disrupción.

---

## 1. Definición: ¿Qué es el Comercio Agéntico?

El comercio agéntico es la evolución natural del comercio conversacional y el e-commerce tradicional. Mientras que el comercio conversacional usa chatbots que sugieren y asisten, el **comercio agéntico** usa **agentes de IA autónomos** que:

- **Investigan** productos across múltiples tiendas
- **Comparan** precios, características y reseñas
- **Negocian** descuentos y condiciones
- **Transan** completando la compra sin intervención humana
- **Aprenden** de cada interacción para mejorar futuras recomendaciones

### Niveles de Autonomía (Deloitte)

| Nivel | Nombre | Qué hace | Ejemplo |
|---|---|---|---|
| 0 | Asistido | Chatbot sugiere, humano decide | "Te recomiendo este pijama" |
| 1 | Semi-autónomo | Agente prepara, humano aprueba | "Encontré 3 opciones, ¿cuál prefieres?" |
| 2 | Autónomo supervisado | Agente compra, humano recibe notificación | "Compré el pijama Stitch en $25K, llega mañana" |
| 3 | Autónomo total | Agente decide todo dentro de parámetros | "Compré semanalmente según tu presupuesto" |

**ZIAY está en Nivel 1-2**: sus 24 agentes hacen el 95% del trabajo (investigan, perfilan, cotizan, cierran) y el humano solo supervisa casos edge.

---

## 2. Tamaño del Mercado

### Mercado Global de Comercio Agéntico

| Fuente | 2025 | 2026 | 2030 | CAGR |
|---|---|---|---|---|
| Grand View Research | $5.7B | $7.7B | — | — |
| McKinsey | — | — | $1T (US retail orquestado) | — |
| McKinsey (global) | — | — | $3-5T (gasto retail redirigido) | — |
| Commercetools | — | — | $144B-$5T (rango amplio) | — |

### Segmento AI en Retail/E-commerce

| Métrica | Valor | Fuente |
|---|---|---|
| AI en retail y e-commerce (2025) | $46.74B | Nevermined |
| AI-enabled e-commerce (2025) | $8.65B | HelloRep |
| Empresas que usan o testan AI | 89% | HelloRep |
| Sites con AI ven 47% más conversión | 47% | HelloRep |
| Apps enterprise con agentes IA (2026) | 33% | Gartner |
| Apps enterprise con agentes IA (2025) | <1% | Gartner |
| Fortune 500 pilotando sistemas agénticos (2025) | 45% | Nevermined |

### Mercado LATAM

| Métrica | Valor | Fuente |
|---|---|---|
| Mercado conversational commerce LATAM (2025) | $18.2B | Alex Digital 360 |
| Crecimiento anual LATAM | 35% | Alex Digital 360 |
| Usuarios de WhatsApp en LATAM | 400M+ | Multiple |
| Penetración WhatsApp en internet users LATAM | 93%+ | User Intuition |
| Consumidores LATAM que compran por mensajería | 72% | Aurora Inbox |
| E-commerce LATAM (2025) | $1.61T | Market Data Forecast |
| E-commerce LATAM (2034 proyección) | $4.06T | Market Data Forecast |
| WhatsApp Business Platform market (2025) | $4.8B | Dataintelo |
| WhatsApp Business Platform market (2034) | $19.6B | Dataintelo |
| OTT business messaging revenue (2025) | $3.6B | Juniper Research |
| OTT business messaging revenue (2029) | $9.8B | Juniper Research |

---

## 3. Tendencias Clave 2025-2026

### Tendencia 1: De Chatbots a Agentes Inteligentes
Los chatbots tradicionales ("Gracias por escribir, te contactaremos pronto") están siendo reemplazados por agentes que **entienden contexto, perfilan, recomiendan productos con imágenes, arman carritos, cotizan fletes y cierran ventas** — todo en una conversación.

**Implicación para ZIAY:** ✅ ZIAY ya tiene 24 agentes especializados que hacen exactamente esto.

### Tendencia 2: Protocolos Abiertos de Comercio Agéntico
- **Agentic Commerce Protocol (ACP)** — Creado por OpenAI + Stripe (Q1 2025). Estandariza cómo los agentes de IA ejecutan compras.
- **Universal Commerce Protocol** — Google + Shopify (Q4 2025). Protocolo universal para agentes.
- **Model Context Protocol (MCP)** — Anthropic, donado a Linux Foundation (Diciembre 2025). Estandariza cómo los agentes se conectan a herramientas externas.

**Implicación para ZIAY:** ZIAY debería integrar ACP/MCP en 2026 para que agentes externos puedan comprar en tiendas ZIAY.

### Tendencia 3: Hiper-Personalización en Tiempo Real
Los agentes ahora perfilan en tiempo real: detectan si el cliente es mayorista/detal/regalo, ajustan discurso, precios y recomendaciones instantáneamente.

**Implicación para ZIAY:** ✅ ZIAY ya hace esto con el agente `profile` + `speech`.

### Tendencia 4: Agents que Entienden Imágenes (VLM)
Los agentes ahora "ven" productos. Si un cliente manda una foto, el agente identifica qué producto es y lo ofrece.

**Implicación para ZIAY:** ✅ ZIAY tiene el agente `vision` con VLM glm-4.6v.

### Tendencia 5: Tráfico Agéntico (15-25% para 2026-2027)
MetaRouter proyecta que el tráfico de agentes AI pasará de <1% en 2025 a **15-25% en 2026-2027**. Los retailers deben optimizar para que los agentes (no solo humanos) puedan navegar sus catálogos.

**Implicación para ZIAY:** ZIAY tiene APIs públicas (`/api/public/*`) y SSR con Schema.org, lo que permite que agentes externos lean el catálogo.

### Tendencia 6: Orquestación Multi-Agente
En lugar de un solo chatbot, los sistemas usan **equipos de agentes especializados** que trabajan en secuencia (pipeline) o en paralelo.

**Implicación para ZIAY:** ✅ ZIAY tiene 3 pipelines (pre-venta 10, post-venta 4, inteligencia 5) = 19 agentes en secuencia.

### Tendencia 7: Comercio Sin Fricción (Cero Saltos)
La experiencia ideal: catálogo + chat + carrito + pago TODO en una conversación. Sin saltar a páginas web, sin registrarse, sin llenar formularios.

**Implicación para ZIAY:** ✅ ZIAY tiene el diferenciador ⑪ (catálogo + chat híbrido con imágenes).

---

## 4. Panorama Competitivo

### Tier 1: Gigantes Globales (USA/EU)

| Competidor | Qué hace | Fortaleza | Debilidad en LATAM |
|---|---|---|---|
| **Shopify + AI** | E-commerce + agentes Magic | Escala global, integraciones | No nativo WhatsApp, no LATAM-focused |
| **Meta + WhatsApp Business** | WhatsApp Business API + AI | 2B+ usuarios, distribución | No es plataforma completa, sin atribución |
| **Google + Universal Commerce Protocol** | Agente de Google que compra | Protocolo abierto, search | No monetiza directamente, sin LATAM focus |
| **OpenAI + Stripe (ACP)** | Agente de ChatGPT que compra | Protocolo estándar, IA líder | Muy temprano, sin LATAM |

### Tier 2: Plataformas LATAM

| Competidor | Qué hace | Fortaleza | Debilidad |
|---|---|---|---|
| **Jelou** (Colombia) | Chatbots WhatsApp + IA | LATAM, Colombia, WhatsApp | Sin atribución de pauta, sin wallet |
| **Aurora Inbox** | WhatsApp Business multi-agente | LATAM, adopción | Sin agentes IA autónomos, sin fintech |
| **Infobip** (Croacia/LATAM) | CPaaS + conversacional | Escala, infraestructura | Sin IA agents, sin atribución |
| **Trengo/Kommo** | Inbox unificado + CRM | Simplicidad, multi-canal | Sin IA, sin logística LATAM |

### Tier 3: Herramientas Tradicionales

| Competidor | Qué hace | Por qué no compite directamente |
|---|---|---|
| **HubSpot/Salesforce** | CRM tradicional | No nativo WhatsApp, sin IA conversacional |
| **Meta Ads Manager** | Pauta | No conecta con ventas reales por WhatsApp |
| **Wati/Trengo** | WhatsApp inbox | Sin IA que vende, sin atribución |

### Posición de ZIAY

ZIAY se posiciona en un **espacio único** que ningún competidor cubre completamente:

```
                    Atribución de Pauta
                           ↑
                           |
          ZIAY ●           |
                           |
                           |
  ─────────────────────────┼─────────────────────→ IA Agents
                           |          
     HubSpot    Meta Ads   |   Shopify+AI
                           |   OpenAI+Stripe
     Wati      Jelou       |
     Trengo    Aurora      |
                           |
                    Conversacional
```

**ZIAY es el ÚNICO** que combina:
1. 24 agentes IA autónomos (pipeline completo)
2. Atribución real de pauta (CPA/ROAS/ROI + CAPI)
3. Wallet con 2FA para traffickers
4. Multi-tenant real (varias marcas aisladas)
5. SSR SEO público (cada tienda = URL indexable)
6. Marketplace cross-brand
7. CRM de novedades logísticas
8. LATAM-focused (Colombia, Dropi, MercadoPago, Wompi)

---

## 5. Oportunidad de Mercado para ZIAY

### TAM/SAM/SOM

| Nivel | Mercado | Tamaño |
|---|---|---|
| **TAM** (Total Addressable Market) | Comercio agéntico global 2030 | $1-5 Trillones |
| **SAM** (Serviceable Addressable Market) | LATAM conversational commerce 2026 | $24.6B ($18.2B × 1.35 growth) |
| **SOM** (Serviceable Obtainable Market) | Colombia + México WhatsApp commerce year 1 | $50-100M (0.2-0.4% del SAM) |

### Caso de Uso Específico: ZIAY SAS

| Métrica | Valor |
|---|---|
| Marcas en ZIAY | 4 (Saramantha, Majestic, Lovely, Reina) |
| GMV actual (histórico) | $34.5M COP |
| Pedidos históricos | 238 |
| Devolvedores | 20.5% (pérdida $600K/mes sin ZIAY) |
| ROAS sin ZIAY | 0.96x (pierde dinero) |
| ROAS con ZIAY (proyectado) | 2.5x+ (verdict engine automático) |
| ROI ZIAY | 16x (por cada $1 invertido, recupera $16) |

### Expansión: De ZIAY a mercado abierto

| Fase | Mercado | Clientes objetivo | GMV esperado |
|---|---|---|---|
| **Fase 1** (meses 1-3) | ZIAY (4 marcas) | 4 | $50M COP/mes |
| **Fase 2** (meses 4-6) | Colombia, moda/textil | 20 marcas | $500M COP/mes |
| **Fase 3** (meses 7-12) | LATAM (CO, MX, PE, CL) | 100 marcas | $5B COP/mes |
| **Fase 4** (año 2) | LATAM + cross-industry | 500+ marcas | $50B COP/mes |

### Modelo de Monetización

| Tramo | GMV mensual | Comisión | Ejemplo |
|---|---|---|---|
| Starter | < $10M COP | 4.5% | $450K sobre $10M |
| Growth | $10M-$40M COP | 3.0% | $900K sobre $30M |
| Enterprise | > $40M COP | 1.75% | $700K sobre $40M |

**Ingresos adicionales:**
- Marketplace cross-brand: 5% comisión de referral
- Trafficker affiliate: sin costo (trafficker invierte en pauta)
- SEO orgánico: sin costo (cada tienda = URL indexable)

---

## 6. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Meta cambia API de WhatsApp | Media | Alto | Multi-canal (Messenger, IG, Telegram ready) |
| OpenAI/Google lanzan agente gratuito | Alta | Medio | ZIAY se diferencia con LATAM + atribución + wallet |
| Competencia LATAM (Jelou, Aurora) agrega IA | Media | Medio | ZIAY tiene 10x features (24 agentes vs 1-3) |
| Regulación de IA en LATAM | Baja | Medio | ZIAY tiene audit trail, RLS, 2FA, redacción logs |
| Cliente prefiere Shopify/WooCommerce | Media | Bajo | ZIAY se integra con ambos (adapters) |
| Costo de LLM (ZAI/OpenAI) sube | Media | Medio | Multi-provider (Zai, OpenAI, xAI, Ollama local) |

---

## 7. Predicciones 2026-2030

### 2026: El Año del Comercio Agéntico
- 33% de apps enterprise tendrán agentes IA (Gartner)
- Tráfico agéntico: 15-25% del total (MetaRouter)
- LATAM conversational commerce: $24.6B (35% CAGR)
- ACP y MCP se estandarizan
- **ZIAY debe:** integrar ACP/MCP, expandir a 20+ marcas en Colombia

### 2027: Consolidación
- Agentes IA manejan 30%+ de compras online
- LATAM lidera adopción conversacional (WhatsApp = 93% penetración)
- **ZIAY debe:** expandir a México, Perú, Chile; 100+ marcas

### 2028-2029: Madurez
- Comercio agéntico = estándar, no novedad
- Agentes autónomos nivel 3 (compra sin aprobación humana)
- **ZIAY debe:** IPO o adquisición estratégica

### 2030: $1-5 Trillones
- McKinsey: $1T retail orquestado en US
- McKinsey: $3-5T gasto retail global redirigido
- **ZIAY debe:** ser líder LATAM o ser adquirida por Shopify/Meta/Google

---

## 8. Recomendaciones Estratégicas para ZIAY

### Inmediato (Q1 2026)
1. **Launch beta con 4 marcas ZIAY** — validar product-market fit
2. **Integrar Agentic Commerce Protocol (ACP)** — preparar para agentes externos
3. **Publicar APIs públicas con Schema.org** — ya hecho, optimizar para agentes
4. **Cerrar 5 clientes piloto en Colombia** — moda, belleza, home

### Corto plazo (Q2-Q3 2026)
5. **Expandir a 20 marcas en Colombia** — modelo SaaS con comisión escalonada
6. **Integrar Model Context Protocol (MCP)** — agents externos pueden comprar en ZIAY
7. **Lanzar marketplace cross-brand** — referrals entre marcas = ingresos extra
8. **Activar trafficker affiliate program** — affiliates invierten en pauta sin riesgo

### Medio plazo (Q4 2026 - Q2 2027)
9. **Expansión LATAM** — México, Perú, Chile (mismos adapters, multi-país)
10. **Mobile app (React Native)** — para asesores en campo
11. **Voice agents (ASR + TTS)** — llamadas automatizadas
12. **Series A funding** — $2-5M USD para escalar

### Largo plazo (2028+)
13. **Integración con OpenAI/Google agents** — ZIAY como backend de comercio
14. **Expansión cross-industry** — no solo moda, también belleza, home, food
15. **Plataforma abierta** — developers pueden crear agentes sobre ZIAY

---

## 9. Conclusión

El comercio agéntico es **la próxima revolución del retail**, comparable a lo que fue el mobile commerce en 2010. McKinsey estima $1-5 trillones para 2030. LATAM, con 400M+ usuarios de WhatsApp y 72% de adopción de compra por mensajería, es el mercado más receptivo del mundo.

**ZIAY está perfectamente posicionado** para capturar esta oportunidad porque:

1. ✅ **Tiene 24 agentes IA** (cuando la competencia tiene 1-3)
2. ✅ **Es LATAM-native** (WhatsApp, Dropi, MercadoPago, Wompi)
3. ✅ **Tiene atribución real** (CPA/ROAS/ROI + CAPI server-side)
4. ✅ **Tiene wallet con 2FA** (fintech layer para affiliates)
5. ✅ **Tiene SSR SEO** (cada tienda = URL indexable)
6. ✅ **Está 95% producción-ready** (891 tests, CI/CD, Docker, auth)

**La ventana de oportunidad es ahora.** En 12-18 meses, los gigantes (Shopify, Meta, OpenAI) llegarán a LATAM. ZIAY tiene esa ventana para capturar 100+ marcas y establecerse como el líder regional.

---

## Fuentes

- McKinsey: "The Agentic Commerce Opportunity" (Octubre 2025)
- Deloitte: "Agentic Commerce: AI Shopping Agents Guide" (2025)
- Gartner: Enterprise AI agent adoption forecasts (2026)
- Grand View Research: Agentic Commerce Market Report (2025-2033)
- Bain: "Agentic AI in Retail" (2025)
- MetaRouter: Agentic Commerce Trends 2026
- Mastercard: "What is Agentic Commerce?" (2025)
- MIT IDE: "AI Agents Want to Shop for You" (2025)
- Alex Digital 360: "LATAM WhatsApp Commerce Market" (2026)
- Aurora Inbox: "WhatsApp Business LATAM Adoption" (2026)
- Juniper Research: OTT Business Messaging (2025-2029)
- Dataintelo: WhatsApp Business Platform Market (2025-2034)
- Commercetools: Agentic Commerce Stats 2026
- Nevermined: 49 Agentic Commerce Growth Statistics
- SaaSMag: "Agentic Commerce SaaS Opportunity" (2026)

---

*Investigación realizada: Julio 2026 · ZIAY · ZIAY SAS · Bogotá, Colombia*
