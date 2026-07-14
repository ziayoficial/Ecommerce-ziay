import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-static'

/**
 * Sirve el OpenAPI spec YAML desde `docs/openapi.yaml` (file system).
 *
 * La ruta `/docs/openapi.yaml` es consumida por el visor ReDoc montado en
 * `/docs/page.tsx` (llamada `Redoc.init('/docs/openapi.yaml', ...)`).
 *
 * `force-static` genera el YAML en build time (sin DB / sin env vars), así
 * que el despliegue solo sirve el archivo pre-renderizado. Cache-Control
 * 1h permite a CDNs y browsers cachear el spec sin re-fetch en cada
 * render de la documentación.
 *
 * @see docs/openapi.yaml
 * @see src/app/docs/page.tsx
 * @returns 200 con el spec YAML (`Content-Type: application/yaml`).
 */
export async function GET() {
  const specPath = join(process.cwd(), 'docs', 'openapi.yaml')
  const spec = readFileSync(specPath, 'utf-8')
  return new NextResponse(spec, {
    headers: {
      'Content-Type': 'application/yaml',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
