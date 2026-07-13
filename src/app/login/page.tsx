'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Zap,
  Mail,
  Lock,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  ArrowRight,
  Sparkles,
  Building2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const loginSchema = z.object({
  email: z.string().email('Ingresa un correo válido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
})
type LoginForm = z.infer<typeof loginSchema>

const DEMO_ACCOUNTS = [
  {
    role: 'Admin',
    email: 'valentina@saramantha.co',
    password: 'demo123',
    desc: 'Acceso total · Saramantha',
    color: 'from-emerald-500 to-emerald-700',
  },
  {
    role: 'Agente',
    email: 'camila@saramantha.co',
    password: 'demo123',
    desc: 'Mensajería y ventas · Saramantha',
    color: 'from-teal-500 to-emerald-600',
  },
  {
    role: 'Trafficker',
    email: 'sebastian@trafficker.co',
    password: 'demo123',
    desc: 'Pauta y atribución · Plataforma',
    color: 'from-cyan-500 to-teal-600',
  },
] as const

function LoginInner() {
  const router = useRouter()
  const search = useSearchParams()
  const [showPass, setShowPass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Sanitize callbackUrl: only accept a relative path that starts with '/'
  // and is NOT the login page itself. Otherwise default to '/'.
  // This fixes the bug where the user gets bounced back to /login?callbackUrl=%2F
  // after a successful login (because router.push with a relative URL doesn't
  // always re-evaluate middleware cookies before navigation completes).
  const rawCallback = search.get('callbackUrl') || '/'
  const isSafeRelative = (u: string) =>
    u.startsWith('/') && !u.startsWith('//') && !u.toLowerCase().startsWith('/login')
  const callbackUrl = isSafeRelative(rawCallback) ? rawCallback : '/'

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function submitCredentials(email: string, password: string) {
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await signIn('credentials', {
        email: email.toLowerCase(),
        password,
        redirect: false,
      })
      if (!res || res.error) {
        setServerError('Correo o contraseña incorrectos. Verifica e intenta de nuevo.')
        setSubmitting(false)
        return
      }
      // CRITICAL FIX: use a hard navigation (window.location) instead of
      // router.push so the browser sends a brand-new request that includes
      // the just-set NextAuth JWT cookie. router.push + router.refresh can
      // race with cookie propagation and cause the middleware to bounce
      // the user back to /login?callbackUrl=%2F.
      if (typeof window !== 'undefined') {
        window.location.assign(callbackUrl)
      } else {
        router.push(callbackUrl)
      }
    } catch (err) {
      console.error(err)
      setServerError('No pudimos iniciar sesión. Intenta nuevamente.')
      setSubmitting(false)
    }
  }

  // Form submit handler — wraps submitCredentials for react-hook-form.
  async function onSubmit(values: LoginForm) {
    await submitCredentials(values.email, values.password)
  }

  // Demo buttons: fill the visible fields AND auto-submit, so the user gets
  // logged in with a single click (no second "Iniciar sesión" click needed).
  async function fillAndSubmitDemo(email: string, password: string) {
    setValue('email', email, { shouldValidate: true })
    setValue('password', password, { shouldValidate: true })
    setServerError(null)
    await submitCredentials(email, password)
  }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      {/* ── Left: brand / value panel ─────────────────────────────────── */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white p-10">
        {/* Decorative blurred orbs */}
        <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-teal-300/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:24px_24px]" />

        <div className="relative z-10 flex items-center gap-2">
          <div className="size-9 rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur flex items-center justify-center">
            <Zap className="size-5" />
          </div>
          <span className="font-semibold text-lg tracking-tight">ZIAY</span>
        </div>

        <div className="relative z-10 space-y-6 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-xs font-medium backdrop-blur">
            <Sparkles className="size-3.5" />
            Comercio Conversacional + Atribución Inteligente
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Tu negocio conversacional, <span className="text-emerald-200">atribuido de extremo a extremo.</span>
          </h1>
          <p className="text-emerald-50/90 leading-relaxed">
            WhatsApp, Messenger e Instagram en una sola bandeja. Pago anticipado, contra entrega e híbrido. Atribución de pauta con CPA, ROAS y ROI por anuncio.
          </p>
          <ul className="space-y-2.5 text-sm">
            {[
              'Multi-tenant con RBAC por rol',
              '26 agentes IA orquestados',
              'Webhooks firmados (HMAC) para 4 pasarelas',
              'SSR público por tenant con JSON-LD',
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 shrink-0 text-emerald-200" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-emerald-100/80">
          © {new Date().getFullYear()} ZIAY · Indisutex SAS
        </div>
      </aside>

      {/* ── Right: form panel ─────────────────────────────────────────── */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6 animate-fade-in-up">
          {/* Mobile-only brand header */}
          <div className="flex lg:hidden items-center gap-2 mb-2">
            <div className="size-9 rounded-xl bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center">
              <Zap className="size-5 text-primary" />
            </div>
            <span className="font-semibold text-lg tracking-tight">ZIAY</span>
          </div>

          <Card className="border-border/70 shadow-lg shadow-emerald-900/5">
            <CardHeader className="space-y-2">
              <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 ring-1 ring-primary/20 px-2.5 py-1 text-[11px] font-semibold text-primary">
                <ShieldCheck className="size-3.5" />
                Acceso seguro
              </div>
              <CardTitle className="text-2xl">Bienvenida de nuevo</CardTitle>
              <CardDescription>
                Inicia sesión para entrar al dashboard de tu tenant.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
              <CardContent className="space-y-4">
                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Correo</Label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="valentina@saramantha.co"
                      className="pl-9"
                      aria-invalid={!!errors.email}
                      {...register('email')}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Contraseña</Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => setShowPass((v) => !v)}
                    >
                      {showPass ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9 pr-9"
                      aria-invalid={!!errors.password}
                      {...register('password')}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  )}
                </div>

                {/* Server error */}
                {serverError && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2"
                  >
                    <span className="font-medium">Error:</span>
                    <span>{serverError}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-10 text-sm font-medium"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Verificando…
                    </>
                  ) : (
                    <>
                      Iniciar sesión
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </CardContent>
            </form>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <p className="text-[11px] text-muted-foreground text-center w-full">
                ¿Sin cuenta? Usa una de las credenciales demo abajo.
              </p>
            </CardFooter>
          </Card>

          {/* Demo accounts */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              Credenciales demo
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={submitting}
                  onClick={() => fillAndSubmitDemo(acc.email, acc.password)}
                  aria-label={`Entrar como ${acc.role} con ${acc.email}`}
                  className="group flex items-center gap-3 rounded-lg border bg-card hover:border-primary/40 hover:bg-accent/40 transition-all p-3 text-left disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div
                    className={`size-9 shrink-0 rounded-md bg-gradient-to-br ${acc.color} text-white flex items-center justify-center text-xs font-bold shadow-sm`}
                    aria-hidden
                  >
                    {acc.role.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{acc.role}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {acc.email}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Building2 className="size-3" />
                      {acc.desc}
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              Contraseña para todas: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">demo123</code>
            </p>
          </div>

          {/* Public pages link */}
          <div className="text-center text-xs text-muted-foreground">
            ¿Quieres ver las tiendas públicas?{' '}
            <a
              href="/directorio"
              className="font-medium text-primary hover:underline"
            >
              Ver directorio →
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
