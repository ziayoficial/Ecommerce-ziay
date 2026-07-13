import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'

// ───────────────────────────────────────────────────────────────────────────
// Server-side auth helpers — used by every API route that needs protection.
//
// Usage in an API handler:
//
//   export async function GET(req: NextRequest) {
//     const { session, error } = await requireAuth()
//     if (error) return error
//     // ... existing logic ...
//   }
//
// For tenant-scoped routes:
//
//   const { session, error } = await requireTenantAccess(tenantId)
//   if (error) return error
//
// For role-gated routes:
//
//   const { session, error } = await requireRole(['admin', 'agent'])
//   if (error) return error
// ───────────────────────────────────────────────────────────────────────────

export async function getSession() {
  return getServerSession(authOptions)
}

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    return {
      session: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { session, error: null as null | typeof undefined }
}

export async function requireTenantAccess(tenantId: string) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error }
  // `session.user.tenantId` is typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const userTenantId = session?.user?.tenantId ?? null
  // Admins with no tenantId (platform users) are allowed to read any tenant.
  if (userTenantId && userTenantId !== tenantId) {
    return {
      session: null,
      error: NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 }),
    }
  }
  return { session, error: null as null | typeof undefined }
}

export async function requireRole(roles: string[]) {
  const { session, error } = await requireAuth()
  if (error) return { session: null, error }
  // `session.user.role` is typed via the Session augmentation in
  // `src/types/next-auth.d.ts` — direct access, no cast needed.
  const role = session?.user?.role
  if (!role || !roles.includes(role)) {
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Forbidden: insufficient role' },
        { status: 403 },
      ),
    }
  }
  return { session, error: null as null | typeof undefined }
}

// Role hierarchy — a higher tier implicitly has all lower-tier permissions.
// `admin` is the super-user (tenant-bound). Platform roles (trafficker,
// finance, operator, marketing) are scoped to their domain across tenants.
export const ROLES = {
  admin: ['admin', 'agent', 'trafficker', 'finance', 'operator', 'marketing'],
  agent: ['agent'],
  trafficker: ['trafficker'],
  finance: ['finance'],
  operator: ['operator'],
  marketing: ['marketing'],
} as const

export type Role = keyof typeof ROLES

// Convenience: the role is a string constant kept in the DB. Use these in
// code rather than literal strings so refactors are safe.
export const ROLE_VALUES = Object.keys(ROLES) as Role[]
