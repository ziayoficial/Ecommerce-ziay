// ZIAY — Shared types + helpers for the logistics intelligence view.
// Split out from logistics-intelligence-view.tsx in AUDIT-FINAL-SPLIT-001
// — no behavior changes, just file layout.

// ───────────────────────────────────────────────────────────────────────────
// Types — mirror the API response shape
// ───────────────────────────────────────────────────────────────────────────
export type CustomerScore = {
  id: string
  phone: string
  score: number
  category: string
  totalPedidos: number
  pedidosEntregados: number
  pedidosDevueltos: number
  lastOrderAt: string | null
}

export type CarrierScore = {
  id: string
  carrierName: string
  score: number
  totalGuias: number
  entregadas: number
  devueltas: number
  avgDeliveryDays: number | null
}

export type GuideTracking = {
  id: string
  guideNumber: string
  carrierName: string | null
  status: string
  lastEventAt: string | null
  daysStuck: number
}

export type BehaviorAlert = {
  id: string
  alertType: string
  message: string
  buyerBehaviorId: string
  createdAt: string
  buyerBehavior: {
    phone: string
    riskLevel: string
    totalReturns: number
    totalOrders: number
  } | null
}

export type LogisticsData = {
  customerScores: CustomerScore[]
  carrierScores: CarrierScore[]
  stuckGuides: GuideTracking[]
  alerts: BehaviorAlert[]
  stats: {
    confiables: number
    riesgo: number
    devolvedores: number
    stuckCount: number
    totalCustomers: number
    totalCarriers: number
    totalAlerts: number
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
export function categoryMeta(category: string) {
  switch (category) {
    case 'confiable':
      return { label: 'Confiable', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20' }
    case 'riesgo':
      return { label: 'Riesgo', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20' }
    case 'devolvedor':
      return { label: 'Devolvedor', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20' }
    default:
      return { label: category, cls: 'bg-muted text-muted-foreground' }
  }
}

export function alertSeverity(alertType: string): 'high' | 'medium' | 'low' {
  const t = alertType.toLowerCase()
  if (t.includes('blacklist') || t.includes('fraud') || t.includes('high')) return 'high'
  if (t.includes('return') || t.includes('caution') || t.includes('repeat')) return 'medium'
  return 'low'
}

export function severityMeta(s: 'high' | 'medium' | 'low') {
  switch (s) {
    case 'high':
      return { dot: 'bg-rose-500', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20', label: 'Alta' }
    case 'medium':
      return { dot: 'bg-amber-500', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20', label: 'Media' }
    case 'low':
      return { dot: 'bg-emerald-500', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20', label: 'Baja' }
  }
}
