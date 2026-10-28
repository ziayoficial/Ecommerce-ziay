import { Metadata } from 'next'
import { Suspense } from 'react'
import { ParentalConsentForm } from '@/components/compliance/parental-consent-form'

export const metadata: Metadata = {
  title: 'Consentimiento de Padre/Madre/Tutor',
  description: 'Autorización para compra de menor de edad conforme a la Ley 1098 de 2006',
  robots: { index: false, follow: false },
  // SEO-5 (IF-4) — canonical declared even on noindex pages so search
  // engines consolidate any stray inbound links to the canonical URL.
  alternates: { canonical: '/compliance/parental-consent' },
}

// SPRINT-ADOPT-ERRORHANDLER-001 — age-gate escalation target.
//
// When the age-gate (`src/lib/compliance/age-gate.ts`) detects a minor
// trying to checkout without a recorded parental consent, the UCP
// checkout redirects here with ?customerId=… (see
// /api/ucp/v1/checkout/[sessionId] `requires_escalation`). The tutor —
// who has NO NextAuth session — fills the form and the client island
// POSTs to the anonymous public endpoint `/api/compliance/parental-consent`
// (AUDIT-CYCLE-4-H3), which persists the `parental_consent_minor`
// ConsentRecord (with proof: tutor name, relationship, IP, user agent,
// timestamp and the tutor document HASHED) that `requireParentalConsent`
// checks to let the minor's checkout proceed.
//
// The page is public (in middleware PUBLIC_PATTERNS) because the tutor
// arrives from a chat link; the submission endpoint carries its own
// hardening (same-origin CSRF check, 5/10min rate limit, isMinor
// customer validation, Zod body).
//
// Legal references:
//   - Ley 1098 de 2006 — Código de la Infancia y la Adolescencia (Colombia)
//   - Ley 1581 de 2012 — Régimen General de Protección de Datos Personales
//     (consent must be free, prior, informed and verifiable — Art 10).

export default function ParentalConsentPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Consentimiento de Padre/Madre/Tutor</h1>
          <p className="text-sm text-muted-foreground">
            Ley 1098 de 2006 — Código de la Infancia y la Adolescencia
          </p>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-3 text-sm">
          <p>
            Para procesar la compra de un menor de edad, necesitamos que un padre, madre o tutor legal autorice la transacción.
          </p>
          <p className="font-medium">¿Qué necesitas?</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li>Tu documento de identidad</li>
            <li>El enlace que te compartió el asesor por chat</li>
            <li>Confirmar que eres el tutor legal</li>
          </ul>
        </div>

        {/* AUDIT-CYCLE-4-H3 — the form was previously inert (no action,
            nothing persisted). It now submits to the anonymous public
            endpoint. Suspense is required because the island reads
            ?customerId via useSearchParams (same pattern as /login). */}
        <Suspense fallback={<div className="h-64 animate-pulse rounded-md bg-muted/40" />}>
          <ParentalConsentForm />
        </Suspense>

        <p className="text-xs text-center text-muted-foreground">
          Al autorizar, registraremos tu consentimiento de forma verificable conforme a la Ley 1581 de 2012.
        </p>
      </div>
    </main>
  )
}
