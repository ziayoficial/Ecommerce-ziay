import { Metadata } from 'next'

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
// When the age-gate middleware (`src/lib/compliance/age-gate.ts`) detects
// a minor trying to checkout without a recorded parental consent, it
// redirects here. The page collects the tutor's identity + relationship
// + explicit consent checkbox; on submit, the form POSTs to
// `/api/compliance/consent` (already exists) with
// `purpose: 'parental_consent_minor'`.
//
// This is a static page (no server data fetch) — kept simple intentionally
// so the legal surface is identical regardless of dashboard state. The
// actual consent record (with the signed payload + IP + user agent) is
// persisted by the API route, not here.
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
            <li>El documento de identidad del menor</li>
            <li>Confirmar que eres el tutor legal</li>
          </ul>
        </div>

        <form className="space-y-4">
          <div>
            <label htmlFor="tutor-name" className="block text-sm font-medium mb-1">
              Nombre completo del tutor
            </label>
            <input
              id="tutor-name"
              type="text"
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="tutor-doc" className="block text-sm font-medium mb-1">
              Documento de identidad del tutor
            </label>
            <input
              id="tutor-doc"
              type="text"
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="relationship" className="block text-sm font-medium mb-1">
              Parentesco
            </label>
            <select
              id="relationship"
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecciona...</option>
              <option value="padre">Padre</option>
              <option value="madre">Madre</option>
              <option value="tutor">Tutor legal</option>
              <option value="abuelo">Abuelo/a</option>
            </select>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="consent"
              type="checkbox"
              required
              className="mt-1"
            />
            <label htmlFor="consent" className="text-xs text-muted-foreground">
              Confirmo que soy el padre, madre o tutor legal del menor y autorizo esta compra conforme a la Ley 1098 de 2006.
            </label>
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Autorizar compra
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground">
          Al autorizar, registraremos tu consentimiento de forma verificable conforme a la Ley 1581 de 2012.
        </p>
      </div>
    </main>
  )
}
