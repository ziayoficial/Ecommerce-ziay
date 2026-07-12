'use client'

import { SessionProvider } from 'next-auth/react'
import { ReactNode } from 'react'

// Client-side SessionProvider wrapper.
// Wrap the entire app (or a subtree) so `useSession()` works in any client
// component (e.g. the topbar shows the current user; the login page calls
// `signIn`/`signOut`).
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
