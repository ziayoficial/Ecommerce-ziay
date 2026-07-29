import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

// NextAuth v4 route handler for App Router.
// Mounts GET + POST on /api/auth/[...nextauth] (sign-in, sign-out, session, csrf, etc).
const handler = NextAuth(authOptions)

/**
 * GET /api/auth/[...nextauth]
 *
 * NextAuth v4 handler — sign-in pages, session lookup, csrf token, etc.
 *
 * @security Public (NextAuth manages its own auth state)
 * @returns NextAuth response (HTML/JSON depending on action)
 */
/**
 * POST /api/auth/[...nextauth]
 *
 * NextAuth v4 handler — credentials sign-in / form submissions / sign-out.
 *
 * @security Public (NextAuth manages its own auth state)
 * @returns NextAuth response
 */
export { handler as GET, handler as POST }
