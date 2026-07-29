'use client'
import { useEffect } from 'react'
import './globals.css'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="es">
      <body>
        <main role="alert" aria-live="assertive" className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full space-y-4 text-center">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-2xl font-bold text-foreground">Error crítico del sistema</h1>
            <p className="text-muted-foreground">
              {error.message || 'Ocurrió un error inesperado en el sistema.'}
            </p>
            {process.env.NODE_ENV === 'development' && error.digest && (
              <p className="text-xs text-muted-foreground font-mono">
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
