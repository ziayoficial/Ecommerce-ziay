import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

// NextAuth v4 route handler for App Router.
// Mounts GET + POST on /api/auth/[...nextauth] (sign-in, sign-out, session, csrf, etc).
const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
