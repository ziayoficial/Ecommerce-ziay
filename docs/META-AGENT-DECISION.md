# Decisión: Meta Business Agent vs. Stack Propio

**Fecha:** Julio 2026
**Documento de referencia:** Comercio Agéntico §13.1
**Sprint:** SPRINT-FINANCE-META-001

## Contexto

Meta presentó oficialmente su **Meta Business Agent** el 3 de junio de 2026,
disponible globalmente en WhatsApp, Messenger e Instagram. Recomienda
productos del catálogo, agenda citas, califica leads y escala a un humano.
Todo dentro de la app de Meta, sin código.

ZIAY ya cuenta con 26 agentes especializados que cubren las 6 etapas del
flujo agéntico (perfilación → catálogo → carrito → checkout → logística →
fidelización), orquestados en tiempo real vía Socket.io sobre la WhatsApp
Cloud API.

## Opciones evaluadas

### 1. Meta Native (Meta Business Agent)

- **Pros:** Cero desarrollo, integrado en app, catálogo navegable, escalado
  a humano nativo.
- **Contras:** Costo per-token desde ago 2026 (tarifa no pública), cede
  datos de conversación y patrones de venta a Meta, reglas endurecidas
  (chats de IA sin objetivo comercial prohibidos).
- **Costo estimado:** `$0.002/token × 1000 tokens/conversación ≈ $2/conversación`.
- **Datos cedidos:** Conversaciones + patrones de venta.

### 2. Stack Propio (Cloud API + ZIAY agents)

- **Pros:** Control total, 26 agentes especializados, socket.io tiempo real,
  AP2/UCP compliance, no data sharing.
- **Contras:** Mayor costo de desarrollo, mantenimiento de infraestructura.
- **Costo estimado:** `$0.015/conversación (LLM) + $0.0085/mensaje (Meta) ≈ $0.02/conversación`.
- **Datos cedidos:** Ninguno (solo metadatos requeridos por Meta).

### 3. Híbrido

- **Pros:** Meta para queries simples (FAQ, catálogo), ZIAY para flows
  complejos (checkout, novedades, VIP).
- **Contras:** Doble mantenimiento, complejidad de routing.
- **Costo estimado:** `60% Meta ($1.2) + 40% propio ($0.008) ≈ $0.76/conversación promedio`.

## Decisión: `own_stack` (configurable vía `META_AGENT_STRATEGY`)

**Razón:**

1. ZIAY ya tiene 26 agentes especializados que cubren las 6 etapas del flujo
   agéntico — el agente de Meta es funcionalmente un subconjunto.
2. El stack propio es **~100x más barato** por conversación (`$0.02` vs `$2`).
3. AP2/UCP compliance requiere control del signing service (imposible con
   Meta Native — Meta posee el contexto de la conversación).
4. La tesis del estudio es **"infraestructura habilitadora"**, no "otro
   asistente conversacional". Ceder los datos a Meta erosiona el foso
   competitivo.

**Cuándo reconsiderar:**

- Si Meta reduce el costo per-token drásticamente (≤ `$0.0001/token`).
- Si un cliente enterprise exige Meta Native como requisito contractual.
- Si el tiempo de primera respuesta (TTR) degrada por debajo de 5s con el
  stack propio de forma sostenida.

**Cómo cambiar la estrategia:**

```bash
# En .env (deploy-time, no runtime):
META_AGENT_STRATEGY=hybrid    # o meta_native
```

El cambio requiere redeploy porque la lógica de routing + el wiring de los
agentes son distintos por modo (ver `src/lib/config/meta-agent-config.ts`).

## Routing logic (hybrid mode)

Cuando la estrategia es `hybrid`, la función `shouldEscalateToOwnAgent()`
decide por mensaje si se queda en Meta Native o se escala a un agente ZIAY:

| Intent              | Meta Native | Own Agent |
|---------------------|-------------|-----------|
| FAQ general         | ✅          |           |
| Catálogo query      | ✅          |           |
| Checkout / pago     |             | ✅        |
| Novedades / reclamos|             | ✅        |
| VIP customer        |             | ✅        |
| Orden > $500k COP   |             | ✅        |
| Queja formal        |             | ✅        |

En modo `meta_native`, TODO se queda en Meta. En modo `own_stack`, TODO lo
maneja ZIAY (Meta nunca ve el contenido de la conversación).

## Implementación

- **Config:** `src/lib/config/meta-agent-config.ts` — `getMetaAgentStrategy()`
  + `shouldEscalateToOwnAgent()`.
- **Env var:** `META_AGENT_STRATEGY` (ver `.env.example`).
- **Costo operativo:** El costo del agente (Meta per-token o LLM propio) se
  trackea en `ChannelCost.aiTokenCost` (study §14.1) — ver
  `src/lib/services/channel-cost.service.ts`.
