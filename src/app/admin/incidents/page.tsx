// SPRINT-SSR-SHELL-001 §2 — admin incidents route (server component).
//
// Server-side admin guard. Replaces the previous client-side
// `useSession()` + `window.location.href = '/'` redirect path that
// produced a visible redirect flash on slow connections (the entire
// client bundle had to download + mount before the role check could
// fire).
//
// Flow:
//   1. `getServerSession(authOptions)` reads the JWT cookie on the
//      server — no client roundtrip.
//   2. No session → `redirect('/login?callbackUrl=/admin/incidents')`
//      returns a 307 BEFORE any HTML is sent. The `callbackUrl` lets
//      NextAuth bounce back to the incidents page after a successful
//      login.
//   3. Session exists but `session.user.role !== 'admin'` →
//      `redirect('/')` returns a 307 before any HTML is sent. Non-admins
//      never see the incidents UI, not even a skeleton.
//   4. Otherwise, render `<AdminIncidentsClient />` — the client island
//      that owns the incidents data fetch + create/update forms.
//
// Defense-in-depth: the route handler at `/api/status/incidents`
// (POST + PATCH) ALSO runs `requireRole(['admin'])` server-side, so
// even if a non-admin somehow mounted the client island (e.g. by
// hand-editing the response) the mutations are still 403'd.
//
// Note: `redirect()` from `next/navigation` throws internally to abort
// the render — the `return` after it is unreachable but keeps tsc happy
// about the function's return type.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AdminIncidentsClient } from '@/components/admin/incidents-client'

export default async function AdminIncidentsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login?callbackUrl=/admin/incidents')
  }
  if (session.user.role !== 'admin') {
    redirect('/')
  }

  return <AdminIncidentsClient />
}
