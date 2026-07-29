'use client'
import { create } from 'zustand'

type TenantInfo = {
  id: string; slug: string; nombreNegocio: string; marca: string
  planMonetizacion: string; proveedorIa: string; proveedorLogistico: string
  plataformaCatalogo: string; politicaPago: string | null
}

interface TenantState {
  activeTenant: TenantInfo | null
  tenants: TenantInfo[]
  // preferredTenantId is the logged-in user's own tenantId (from the NextAuth
  // session). When auto-selecting on first load, we prefer the user's tenant
  // over tenants[0] so that RBAC-bound API calls (/api/marketplace,
  // /api/novedades, …) don't 403 with "tenant mismatch".
  setTenants: (t: TenantInfo[], preferredTenantId?: string) => void
  setActive: (t: TenantInfo) => void
}

export const useTenantStore = create<TenantState>((set) => ({
  activeTenant: null,
  tenants: [],
  setTenants: (t, preferredTenantId) => {
    set({ tenants: t })
    // Auto-select the user's own tenant if no tenant is active yet.
    // Falls back to tenants[0] only when no session tenantId matches.
    set((state) => state.activeTenant ? {} : {
      activeTenant: (preferredTenantId && t.find((x) => x.id === preferredTenantId)) || t[0] || null,
    })
  },
  setActive: (t) => set({ activeTenant: t }),
}))

// Helper hook to get the tenantId for API requests
export function useTenantId(): string | undefined {
  return useTenantStore((s) => s.activeTenant?.id)
}
