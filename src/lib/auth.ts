import NextAuth, { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { db } from '@/lib/db'
import * as bcrypt from 'bcryptjs'

// ───────────────────────────────────────────────────────────────────────────
// NextAuth v4 configuration — Credentials provider + JWT sessions.
//
// Sessions are JWT-based (no DB session table needed). The JWT carries:
//   sub          → user.id
//   role         → user.role          (admin | agent | trafficker | finance | operator | marketing)
//   tenantId     → user.tenantId      (null for platform-level users)
//   tenantSlug   → tenant.slug        (used for public SSR /t/[slug] cross-link)
//   tenantName   → tenant.nombreNegocio
//
// The callbacks below inject these into `session.user` so the client and
// `getServerSession` can both read them.
// ───────────────────────────────────────────────────────────────────────────

// ── JWT secret ────────────────────────────────────────────────────────────
// Production REQUIRES an explicit NEXTAUTH_SECRET — using a known fallback in
// prod would let anyone forge JWTs. We fail fast at boot instead. In dev we
// allow a deterministic fallback so a fresh checkout can run `bun run dev`
// without first generating a secret.
const __secret = process.env.NEXTAUTH_SECRET
if (!__secret && process.env.NODE_ENV === 'production') {
  throw new Error(
    'NEXTAUTH_SECRET must be set in production. Generate with: openssl rand -base64 32',
  )
}
/** Shared NextAuth JWT secret. Used by auth.ts and middleware.ts. */
export const AUTH_SECRET: string =
  __secret || 'ziay-dev-secret-fallback-only-for-development'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
          include: { tenant: true },
        })
        if (!user || !user.passwordHash) return null
        if (user.status !== 'active') return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        // Stamp lastLoginAt — fire-and-forget; do not block the login flow.
        await db.user
          .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
          .catch(() => {})

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          tenantSlug: user.tenant?.slug ?? null,
          tenantName: user.tenant?.nombreNegocio ?? null,
          avatarUrl: user.avatarUrl,
        }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 days
  pages: { signIn: '/login' },
  callbacks: {
    jwt: async ({ token, user }) => {
      // `user` is only populated on first sign-in; thereafter only `token` is
      // available. The cast-free read works thanks to the `User` augmentation
      // in `src/types/next-auth.d.ts` (adds role/tenantId/tenantSlug/tenantName).
      if (user) {
        token.role = user.role
        token.tenantId = user.tenantId
        token.tenantSlug = user.tenantSlug
        token.tenantName = user.tenantName
      }
      return token
    },
    session: async ({ session, token }) => {
      // `session.user` is typed via the Session augmentation in
      // `src/types/next-auth.d.ts` — direct assignment, no cast needed.
      if (session.user) {
        session.user.id = token.sub ?? session.user.id
        session.user.role = token.role ?? session.user.role
        session.user.tenantId = token.tenantId ?? null
        session.user.tenantSlug = token.tenantSlug ?? null
        session.user.tenantName = token.tenantName ?? null
      }
      return session
    },
  },
  secret: AUTH_SECRET,
}

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions)

export default authOptions
