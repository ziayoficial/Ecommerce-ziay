// CommerceFlow OS — Genera los 9 workflows n8n individuales + master orchestrator
// Run: bun run scripts/generate-n8n-workflows.ts
//
// v0.4.1 · IA-3: 9-step → 8-step pipeline (theme folded into catalog,
// cart_builder into quote, address_analysis into address). Output drops
// the standalone `theme` workflow — `catalog` now handles theme queries
// via `?theme=Stitch` query param.
import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('/home/z/my-project/n8n-workflows', { recursive: true })

const AGENTS = [
  { id: 'profile', label: '6.1 Perfilamiento de leads', desc: 'Clasifica mayorista/emprendedor/detal/regalo' },
  { id: 'speech', label: '6.2 Discurso de ventas por perfil', desc: 'Apertura + prueba social por perfil' },
  { id: 'quote', label: '6.3 Cotización + constructor de carrito', desc: 'Volume pricing + margen + cart NL' },
  { id: 'catalog', label: '6.4 Catálogo visual + búsqueda por tema', desc: 'Mínimo 3 prendas + temas_diseño' },
  { id: 'objection', label: '6.6 Manejo de objeciones', desc: 'Desconfianza/precio/talla/lo pienso' },
  { id: 'address', label: '6.7 Confirmación de datos + análisis', desc: '10 campos + cobertura + historial' },
  { id: 'logistics', label: '6.8 Logística de fletes', desc: 'Cotización real vía LogisticsAdapter' },
  { id: 'vision', label: '6.9 Visión (identificación por imagen)', desc: 'OCR + CLIP + LLM fallback' },
  { id: 'checkout', label: '6.10 Checkout y sincronización', desc: 'Crea pedido + guía + comisión' },
]

// Generate one workflow per agent
for (const agent of AGENTS) {
  const workflow = {
    name: `CommerceFlow — Agente ${agent.label}`,
    nodes: [
      {
        parameters: { httpMethod: 'POST', path: `agent-${agent.id}`, responseMode: 'responseNode' },
        id: `webhook-${agent.id}`,
        name: 'Webhook Entrada',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [0, 0],
      },
      {
        parameters: {
          method: 'POST',
          url: `http://app:3000/api/agents/${agent.id}`,
          sendBody: true,
          bodyParameters: {
            parameters: [
              { name: 'tenantId', 'value': '={{ $json.body.tenantId }}' },
              { name: 'conversationId', 'value': '={{ $json.body.conversationId }}' },
              { name: 'customerId', 'value': '={{ $json.body.customerId }}' },
              { name: 'perfil', 'value': '={{ $json.body.perfil }}' },
              { name: 'items', 'value': '={{ $json.body.items }}' },
              { name: 'query', 'value': '={{ $json.body.query }}' },
              { name: 'message', 'value': '={{ $json.body.message }}' },
              { name: 'partialAddress', 'value': '={{ $json.body.partialAddress }}' },
              { name: 'imageUrl', 'value': '={{ $json.body.imageUrl }}' },
            ],
          },
        },
        id: `call-agent-${agent.id}`,
        name: `Llamar Agente ${agent.id}`,
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4,
        position: [220, 0],
      },
      {
        parameters: { respondWith: 'json', responseBody: '={{ $json }}' },
        id: `respond-${agent.id}`,
        name: 'Responder',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [440, 0],
      },
    ],
    connections: {
      'Webhook Entrada': { main: [[{ node: `Llamar Agente ${agent.id}`, type: 'main', index: 0 }]] },
      [`Llamar Agente ${agent.id}`]: { main: [[{ node: 'Responder', type: 'main', index: 0 }]] },
    },
    active: false,
    settings: { executionOrder: 'v1' },
    _notes: [
      `Agente ${agent.label} — ${agent.desc}`,
      'Endpoint: POST http://app:3000/api/agents/' + agent.id,
      'Importar: n8n → Workflows → Import from File → seleccionar este JSON',
      'Activar workflow después de importar.',
    ],
  }
  writeFileSync(`/home/z/my-project/n8n-workflows/agent-${agent.id}.json`, JSON.stringify(workflow, null, 2))
}

// Master orchestrator — chains all 10 agents
const masterWorkflow = {
  name: 'CommerceFlow — Master Orchestrator (§12 — 4 escenarios)',
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'orchestrate', responseMode: 'responseNode' },
      id: 'webhook-orch',
      name: 'Webhook Orquestador',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 1,
      position: [0, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: 'http://app:3000/api/orchestrate',
        sendBody: true,
        bodyParameters: {
          parameters: [
            { name: 'action', 'value': 'full' },
            { name: 'tenantId', 'value': '={{ $json.body.tenantId }}' },
            { name: 'scenario', 'value': '={{ $json.body.scenario || "ziay_wa_catalog" }}' },
            { name: 'customerId', 'value': '={{ $json.body.customerId }}' },
            { name: 'conversationId', 'value': '={{ $json.body.conversationId }}' },
          ],
        },
      },
      id: 'call-orchestrate',
      name: 'Ejecutar Escenario Completo',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4,
      position: [220, 0],
    },
    {
      parameters: { respondWith: 'json', responseBody: '={{ $json }}' },
      id: 'respond-orch',
      name: 'Responder',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      position: [440, 0],
    },
  ],
  connections: {
    'Webhook Orquestador': { main: [[{ node: 'Ejecutar Escenario Completo', type: 'main', index: 0 }]] },
    'Ejecutar Escenario Completo': { main: [[{ node: 'Responder', type: 'main', index: 0 }]] },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  _notes: [
    'Master Orchestrator — ejecuta los 10 agentes en secuencia (§12.1 narrative).',
    'Endpoint: POST http://app:3000/api/orchestrate con action=full',
    '4 escenarios: ziay_wa_catalog | client_woocommerce | client_shopify | client_supabase_nuestro',
    'Importar: n8n → Workflows → Import from File → seleccionar este JSON',
  ],
}
writeFileSync('/home/z/my-project/n8n-workflows/master-orchestrator.json', JSON.stringify(masterWorkflow, null, 2))

console.log(`✅ ${AGENTS.length + 1} workflows n8n generados en /home/z/my-project/n8n-workflows/`)
