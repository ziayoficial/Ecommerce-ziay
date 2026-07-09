// Formatting helpers — COP-aware, multi-currency ready

export function formatCurrency(value: number, currency = 'COP', opts?: { compact?: boolean }) {
  if (currency === 'COP') {
    if (opts?.compact && Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    if (opts?.compact && Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
}

export function formatNumber(value: number, opts?: { compact?: boolean }) {
  if (opts?.compact && Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (opts?.compact && Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat('es-CO').format(value)
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

export function formatMultiplier(value: number, digits = 2) {
  return `${value.toFixed(digits)}x`
}

export function timeAgo(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  return `hace ${Math.floor(s / 86400)} d`
}

export function shortDate(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export function shortTime(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}
