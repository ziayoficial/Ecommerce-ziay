'use client'

import { FormEvent, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

// ───────────────────────────────────────────────────────────────────────────
// ParentalConsentForm — client island for /compliance/parental-consent
//
// AUDIT-CYCLE-4-H3 — wires the previously inert form (no action, no
// handler) to the anonymous public endpoint POST /api/compliance/
// parental-consent. The tutor arrives from a chat link
// (?customerId=…) without a NextAuth session, so the submission is
// anonymous + rate-limited + same-origin (see the route).
// ───────────────────────────────────────────────────────────────────────────

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; alreadyRegistered: boolean }
  | { status: 'error'; message: string }

export function ParentalConsentForm() {
  const search = useSearchParams()
  const customerId = search.get('customerId') || ''

  const [tutorName, setTutorName] = useState('')
  const [tutorDocumentId, setTutorDocumentId] = useState('')
  const [relationship, setRelationship] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<SubmitState>({ status: 'idle' })

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.status === 'submitting') return

    setState({ status: 'submitting' })
    try {
      const res = await fetch('/api/compliance/parental-consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId,
          tutorName,
          tutorDocumentId,
          relationship,
          consent: true,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        alreadyRegistered?: boolean
      }
      if (!res.ok) {
        setState({
          status: 'error',
          message:
            data.error ??
            'No pudimos registrar el consentimiento. Intenta de nuevo en unos minutos.',
        })
        return
      }
      setState({
        status: 'success',
        alreadyRegistered: data.alreadyRegistered === true,
      })
    } catch {
      setState({
        status: 'error',
        message:
          'No pudimos registrar el consentimiento. Verifica tu conexión e intenta de nuevo.',
      })
    }
  }

  // No customerId in the URL → the age-gate escalation link is missing.
  // Show a helpful message instead of a form that can never submit.
  if (!customerId) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
      >
        <p className="font-medium">Falta el identificador del menor.</p>
        <p className="mt-1 text-muted-foreground">
          Abre esta página desde el enlace que te compartió el asesor en el
          chat. Si crees que esto es un error, escríbele de nuevo para
          recibir un enlace nuevo.
        </p>
      </div>
    )
  }

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2"
      >
        <p className="font-medium">
          {state.alreadyRegistered
            ? 'Este consentimiento ya estaba registrado.'
            : '¡Consentimiento registrado!'}
        </p>
        <p className="text-muted-foreground">
          Quedó guardado de forma verificable conforme a la Ley 1581 de
          2012. El asesor puede continuar con la compra del menor.
        </p>
        <Link
          href="/"
          className="inline-block mt-1 text-sm font-medium text-primary hover:underline"
        >
          Volver al inicio →
        </Link>
      </div>
    )
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="tutor-name" className="block text-sm font-medium mb-1">
          Nombre completo del tutor
        </label>
        <input
          id="tutor-name"
          name="tutorName"
          type="text"
          required
          minLength={3}
          maxLength={120}
          autoComplete="name"
          value={tutorName}
          onChange={(e) => setTutorName(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="tutor-doc" className="block text-sm font-medium mb-1">
          Documento de identidad del tutor
        </label>
        <input
          id="tutor-doc"
          name="tutorDocumentId"
          type="text"
          required
          minLength={5}
          maxLength={32}
          inputMode="numeric"
          autoComplete="off"
          value={tutorDocumentId}
          onChange={(e) => setTutorDocumentId(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Se almacena cifrado (hash) — nunca guardamos el número completo.
        </p>
      </div>

      <div>
        <label htmlFor="relationship" className="block text-sm font-medium mb-1">
          Parentesco
        </label>
        <select
          id="relationship"
          name="relationship"
          required
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
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
          name="consent"
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1"
        />
        <label htmlFor="consent" className="text-xs text-muted-foreground">
          Confirmo que soy el padre, madre o tutor legal del menor y autorizo
          esta compra conforme a la Ley 1098 de 2006.
        </label>
      </div>

      {state.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={state.status === 'submitting' || !consent || !relationship}
        className="w-full rounded-md bg-primary px-4 py-2.5 min-h-11 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {state.status === 'submitting' ? 'Registrando…' : 'Autorizar compra'}
      </button>
    </form>
  )
}
