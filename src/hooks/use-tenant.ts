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
  setTenants: (t: TenantInfo[]) => void
  setActive: (t: TenantInfo) => void
}

export const useTenantStore = create<TenantState>((set) => ({
  activeTenant: null,
  tenants: [],
  setTenants: (t) => {
    set({ tenants: t })
    // Auto-select first tenant if none active
    set((state) => state.activeTenant ? {} : { activeTenant: t[0] || null })
  },
  setActive: (t) => set({ activeTenant: t }),
}))

// Helper hook to get the tenantId for API requests
export function useTenantId(): string | undefined {
  return useTenantStore((s) => s.activeTenant?.id)
}
