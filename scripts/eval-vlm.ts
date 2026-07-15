/**
 * VLM (Vision Language Model) eval harness.
 *
 * SPRINT-AI-FINAL-001 §3 — tests the `identifyImage` pipeline with real
 * images. A diferencia de `scripts/eval-live.ts` (que usa el adapter de
 * chat texto-only), este script invoca al VLM real (zai-vlm / glm-4.6v)
 * a través del pipeline de visión completo (`identifyImage`).
 *
 * El pipeline hace 3 cosas:
 *   1. Lee el catálogo del tenant desde la DB (para comparación visual).
 *   2. Invoca al VLM con la imagen + el catálogo como contexto.
 *   3. Persiste el resultado en `ImageIdentification` (auditoría).
 *
 * Por eso este script requiere:
 *   - ZAI_API_KEY en .env (para el VLM).
 *   - DATABASE_URL en .env (para leer catálogo + persistir auditoría).
 *   - Un tenant válido con productos en catálogo (para que el VLM tenga
 *     contra qué comparar). Si el tenant no existe o no tiene productos,
 *     el VLM recibe "Catálogo vacío" y responde `metodo="sin_match"`.
 *
 * Usage:  bun run scripts/eval-vlm.ts
 *         bun run eval:vlm
 *
 * Costo aproximado: ~$0.005 por caso (las llamadas VLM son más caras que
 * las de chat — glm-4.6v cuesta ~$0.005/call vs ~$0.001 de glm-4.6).
 */

/* eslint-disable no-console -- script de CLI: el uso de console.log es intencional. */

import { identifyImage } from '../src/lib/vision/pipeline'

interface VlmTestCase {
  imageUrl: string
  description: string
  // Categoria esperada — solo para logging (no se valida estrictamente
  // porque el VLM puede responder con SKU null si la imagen no matchea
  // el catálogo del tenant). Si la confianza es baja, el pipeline
  // devuelve `pregunta_confirmacion` en lugar de un SKU.
  expectCategory: string
}

/**
 * Casos de test VLM. Las URLs son imágenes públicas de Unsplash que
 * muestran prendas de vestir ( pijama / short / pantalón ).
 *
 * Nota: el resultado depende del catálogo real del tenant 'ten-1'. Si
 * el tenant tiene shorts/pantalones de pijama en catálogo, el VLM debería
 * hacer match visual. Si no, devolverá `metodo="sin_match"` con confianza
 * baja — lo cual es una respuesta válida del pipeline (no un error).
 */
const VLM_TEST_CASES: VlmTestCase[] = [
  {
    imageUrl: 'https://images.unsplash.com/photo-1571513722275-4b41940f54b8?w=400',
    description: 'Short de pijama — should identify as clothing/sleepwear',
    expectCategory: 'short',
  },
  {
    imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400',
    description: 'Pantalón de pijama — should identify as clothing/sleepwear',
    expectCategory: 'pantalon',
  },
]

async function runVlmEval(): Promise<void> {
  console.log('🔍 ZIAY VLM Eval Harness\n')
  console.log(`Running ${VLM_TEST_CASES.length} VLM test cases...\n`)
  console.log('Requiere: ZAI_API_KEY + DATABASE_URL + tenant con catálogo.\n')

  for (const testCase of VLM_TEST_CASES) {
    console.log(`▶ ${testCase.description}`)
    console.log(`  URL: ${testCase.imageUrl}`)
    try {
      // `identifyImage` recibe un TenantVisionContext (objeto, no string).
      // Pasamos `{ tenantId: 'ten-1' }` — el pipeline usará ese tenant
      // para leer el catálogo y persistir la auditoría.
      const result = await identifyImage(testCase.imageUrl, { tenantId: 'ten-1' })
      console.log(`  ✅ sku: ${result.sku ?? 'null'}`)
      console.log(`  metodo: ${result.metodo}`)
      console.log(`  confianza: ${result.confianza.toFixed(2)}`)
      if (result.pregunta_confirmacion) {
        console.log(`  pregunta: ${result.pregunta_confirmacion}`)
      }
      // Hint sobre la categoría esperada (solo informativo — no se valida
      // porque el resultado depende del catálogo real del tenant).
      console.log(`  (categoría esperada: ${testCase.expectCategory})`)
    } catch (e) {
      console.log(`  ❌ error: ${e instanceof Error ? e.message : 'unknown'}`)
    }
    console.log()
  }

  console.log('━'.repeat(50))
  console.log('\n📊 VLM eval completo.')
  console.log('  Nota: revisa los logs de `vision:pipeline` para detalle técnico.')
  console.log('  Las identificaciones se persisten en la tabla `ImageIdentification`.')
}

runVlmEval().catch((err) => {
  console.error('VLM eval harness failed:', err)
  process.exit(1)
})
