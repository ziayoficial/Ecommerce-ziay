// NextAuth v4 type augmentation — adds tenantId, role, etc. to Session and JWT.
// This file MUST be a .d.ts module (no runtime code) and is picked up by tsc
// automatically because `src` is in the tsconfig include path.

import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string | null
      role: string
      tenantId: string | null
      tenantSlug: string | null
      tenantName: string | null
      avatarUrl?: string | null
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: string
    tenantId: string | null
    tenantSlug: string | null
    tenantName: string | null
    avatarUrl?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string
    tenantId?: string | null
    tenantSlug?: string | null
    tenantName?: string | null
    sub?: string
  }
}
