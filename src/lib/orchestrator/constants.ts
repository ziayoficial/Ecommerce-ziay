// CommerceFlow OS — Orchestrator constants
// Saramantha §6 (10 agents) + §12 (orchestrator) + §15.1 (Kanban board columns)
//
// This file is the single source of truth for:
// 1. The 9-step agent pipeline (each step maps to one of the 10 conversational agents).
// 2. The 4 orchestration scenarios used by the "Ejecutar todo" / "Siguiente paso" buttons.
// 3. The 8 Kanban board columns (§15.1 funnel) used by the operational Kanban view.

// ───────────────────────────────────────────────────────────────────────────
// 1. Pipeline steps — 9 visual steps mapped to the 10 agents (vision is the
//    optional 4.5/visual-primero variant; we keep it folded into "catalog"
//    for the visual stepper, but expose it separately in the agent list).
// ───────────────────────────────────────────────────────────────────────────
export type OrchestratorStepId =
  | 'profile' | 'speech' | 'catalog' | 'theme'
  | 'quote' | 'objection' | 'address' | 'logistics' | 'checkout'

export interface OrchestratorStep {
  id: OrchestratorStepId
  index: number
  label: string
  emoji: string
  agent: string // matches AgentName in src/lib/agents/prompts.ts
  description: string
  /** Accent color (Tailwind token) — emerald/teal primary palette; secondary accents per §6 spec */
  accent: 'primary' | 'amber' | 'sky' | 'violet' | 'rose' | 'emerald'
}

export const ORCHESTRATOR_STEPS: OrchestratorStep[] = [
  { id: 'profile',    index: 1, label: 'Perfilamiento',     emoji: '🎯', agent: 'profile',    description: 'Detecta mayorista / emprendedor / detal / regalo',         accent: 'primary' },
  { id: 'speech',     index: 2, label: 'Discurso',          emoji: '💬', agent: 'speech',     description: 'Apertura + prueba social por perfil',                       accent: 'emerald' },
  { id: 'catalog',    index: 3, label: 'Catálogo',          emoji: '🖼️', agent: 'catalog',    description: 'Respuesta visual-primero con imágenes reales',              accent: 'sky' },
  { id: 'theme',      index: 4, label: 'Tema/personaje',    emoji: '🐱', agent: 'theme',      description: 'Stitch, Hello Kitty y otros — busca en temas_diseño',      accent: 'violet' },
  { id: 'quote',      index: 5, label: 'Cotización',        emoji: '🧮', agent: 'quote',      description: 'Precio por volumen + margen por tramo',                     accent: 'amber' },
  { id: 'objection',  index: 6, label: 'Objeciones',        emoji: '🛡️', agent: 'objection',  description: 'Clasifica + aplica gatillo mental',                         accent: 'rose' },
  { id: 'address',    index: 7, label: 'Dirección',         emoji: '📍', agent: 'address',    description: '10 campos — uno a la vez si falta',                         accent: 'primary' },
  { id: 'logistics',  index: 8, label: 'Logística',         emoji: '🚚', agent: 'logistics',  description: 'Flete real vía LogisticsAdapter (Dropi/99envios/Aveonline)', accent: 'emerald' },
  { id: 'checkout',   index: 9, label: 'Checkout',          emoji: '✅', agent: 'checkout',   description: 'Resumen + confirmación + sync ecommerce + guía',           accent: 'sky' },
]

// ───────────────────────────────────────────────────────────────────────────
// 2. Scenarios — used by the scenario selector in OrchestratorView
// ───────────────────────────────────────────────────────────────────────────
export type ScenarioId =
  | 'mayorista_familia'
  | 'detal_stitch'
  | 'regalo_hello_kitty'
  | 'cancelacion_inventario'

export interface OrchestratorScenario {
  id: ScenarioId
  label: string
  emoji: string
  description: string
  perfil: 'mayorista' | 'emprendedor' | 'detal' | 'regalo'
  seedMessage: string
  /** Optional product query for the catalog step */
  catalogQuery?: string
  /** Optional theme for the theme step */
  theme?: string
  /** Optional objection message for the objection step */
  objectionMessage?: string
}

export const ORCHESTRATOR_SCENARIOS: OrchestratorScenario[] = [
  {
    id: 'mayorista_familia',
    label: 'Mayorista — categoría "familia"',
    emoji: '🏬',
    description: 'Lead mayorista pide "familia" — el agente de catálogo trae mínimo 3 prendas (§6.4).',
    perfil: 'mayorista',
    seedMessage: 'Hola, vi el anuncio. Quiero surtir el negocio, me regalas precio de familia.',
    catalogQuery: 'familia',
  },
  {
    id: 'detal_stitch',
    label: 'Detal — tema Stitch',
    emoji: '🐱',
    description: 'Cliente final pregunta por Stitch — busca en temas_diseño y muestra todas las prendas.',
    perfil: 'detal',
    seedMessage: 'Hola! Vi el anuncio de pijama familia. Para mi, qué diseños tienen?',
    theme: 'Stitch',
    catalogQuery: 'Stitch',
  },
  {
    id: 'regalo_hello_kitty',
    label: 'Regalo — Hello Kitty',
    emoji: '🎁',
    description: 'Lead de regalo, sensibilidad a precio — el agente de objeciones maneja "caro".',
    perfil: 'regalo',
    seedMessage: 'Es para un regalo, pero me parece caro. ¿Hay descuento?',
    theme: 'Hello Kitty',
    objectionMessage: 'Me parece caro para un regalo',
  },
  {
    id: 'cancelacion_inventario',
    label: 'Cancelación — sin inventario',
    emoji: '❌',
    description: 'Cliente quiere cancelar por falta de inventario — objeción tipo "desconfianza/disp".',
    perfil: 'detal',
    seedMessage: 'Voy a cancelar el pedido, no me lo van a cumplir.',
    objectionMessage: 'Voy a cancelar el pedido, no me lo van a cumplir',
  },
]

// ───────────────────────────────────────────────────────────────────────────
// 3. Kanban columns — Saramantha §15.1 funnel (8 board columns)
// ───────────────────────────────────────────────────────────────────────────
export type KanbanStageId =
  | 'pending_confirmation'
  | 'intent_cancelacion'
  | 'datos_completados'
  | 'seguimiento'
  | 'oficina'
  | 'programado'
  | 'despachado'
  | 'pendiente_guia'

export interface KanbanStage {
  id: KanbanStageId
  label: string
  emoji: string
  /** Tailwind token — funnel from "stuck" (rose) to "delivered" (emerald) */
  accent: 'rose' | 'amber' | 'sky' | 'violet' | 'emerald' | 'primary' | 'slate'
  /** Historical share from §15.1 (informational — for the column header hint) */
  historicalPct: number
}

export const KANBAN_STAGES: KanbanStage[] = [
  { id: 'pending_confirmation', label: 'Llamar para confirmar',   emoji: '✍️',  accent: 'rose',    historicalPct: 73.2 },
  { id: 'intent_cancelacion',   label: 'Intento de cancelación',  emoji: '⁉️',  accent: 'amber',   historicalPct: 8.8 },
  { id: 'datos_completados',    label: 'Datos completados',       emoji: '✅',  accent: 'sky',     historicalPct: 6.3 },
  { id: 'seguimiento',          label: 'Seguimiento WhatsApp',    emoji: '📱',  accent: 'violet',  historicalPct: 5.0 },
  { id: 'oficina',              label: 'Oficina',                 emoji: '📦',  accent: 'primary', historicalPct: 3.8 },
  { id: 'programado',           label: 'Pedido programado',       emoji: '⏱️',  accent: 'emerald', historicalPct: 1.3 },
  { id: 'despachado',           label: 'Despachado',              emoji: '🚚',  accent: 'emerald', historicalPct: 1.3 },
  { id: 'pendiente_guia',       label: 'Pendiente guía',          emoji: '🧾',  accent: 'slate',   historicalPct: 0.4 },
]

// Accent → Tailwind class map (kept here so the view layer doesn't repeat tokens)
export const KANBAN_ACCENT: Record<KanbanStage['accent'], { header: string; ring: string; chip: string; bar: string }> = {
  rose:    { header: 'text-rose-700 dark:text-rose-300',     ring: 'ring-rose-500/30',     chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',     bar: 'bg-rose-500' },
  amber:   { header: 'text-amber-700 dark:text-amber-300',   ring: 'ring-amber-500/30',    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',  bar: 'bg-amber-500' },
  sky:     { header: 'text-sky-700 dark:text-sky-300',       ring: 'ring-sky-500/30',      chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',        bar: 'bg-sky-500' },
  violet:  { header: 'text-violet-700 dark:text-violet-300', ring: 'ring-violet-500/30',   chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', bar: 'bg-violet-500' },
  emerald: { header: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/30', chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  primary: { header: 'text-primary',                          ring: 'ring-primary/30',       chip: 'bg-primary/10 text-primary',                           bar: 'bg-primary' },
  slate:   { header: 'text-slate-700 dark:text-slate-300',   ring: 'ring-slate-500/30',    chip: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',  bar: 'bg-slate-500' },
}

export const ORCHESTRATOR_ACCENT: Record<OrchestratorStep['accent'], { chip: string; bar: string; ring: string }> = {
  primary: { chip: 'bg-primary/10 text-primary',               bar: 'bg-primary',    ring: 'ring-primary/30' },
  emerald: { chip: 'bg-emerald-500/10 text-emerald-600',       bar: 'bg-emerald-500', ring: 'ring-emerald-500/30' },
  sky:     { chip: 'bg-sky-500/10 text-sky-600',               bar: 'bg-sky-500',     ring: 'ring-sky-500/30' },
  violet:  { chip: 'bg-violet-500/10 text-violet-600',         bar: 'bg-violet-500',  ring: 'ring-violet-500/30' },
  amber:   { chip: 'bg-amber-500/10 text-amber-600',           bar: 'bg-amber-500',   ring: 'ring-amber-500/30' },
  rose:    { chip: 'bg-rose-500/10 text-rose-600',             bar: 'bg-rose-500',    ring: 'ring-rose-500/30' },
}
