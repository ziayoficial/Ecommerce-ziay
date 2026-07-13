'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="size-16 rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 flex items-center justify-center">
        <AlertTriangle className="size-8 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Algo salió mal</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || 'Ocurrió un error inesperado. Intenta de nuevo.'}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/60">ID: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset} variant="outline" size="sm" className="gap-2">
        <RefreshCw className="size-4" /> Reintentar
      </Button>
    </div>
  )
}
