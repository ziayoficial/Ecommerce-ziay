import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-6xl font-bold text-primary">404</div>
      <h2 className="text-lg font-semibold">Página no encontrada</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        La página que buscas no existe o fue movida.
      </p>
      <Link href="/">
        <Button variant="outline" size="sm" className="gap-2">
          <Home className="size-4" /> Ir al inicio
        </Button>
      </Link>
    </div>
  )
}
