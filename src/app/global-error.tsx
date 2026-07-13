'use client'
import { useEffect } from 'react'

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
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0a0f0d', color: '#e8f0ec', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px' }}>⚠️</div>
        <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Error crítico del sistema</h2>
        <p style={{ fontSize: '14px', opacity: 0.7, maxWidth: '400px' }}>
          {error.message || 'Ocurrió un error inesperado en el sistema.'}
        </p>
        <button onClick={reset} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #2a3a34', background: '#111815', color: '#e8f0ec', cursor: 'pointer', fontSize: '14px' }}>
          Reintentar
        </button>
      </body>
    </html>
  )
}
