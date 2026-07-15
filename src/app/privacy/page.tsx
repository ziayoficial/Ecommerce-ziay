import type { Metadata } from 'next'
import Link from 'next/link'

// ───────────────────────────────────────────────────────────────────────────
// /privacy — SSR Política de Privacidad (Ley 1581 de 2012)
//
// FIX-LEGAL-P0-001 L-1 — public privacy policy required by Ley 1581 Art 10
// (right to be informed about data processing). Server-rendered so crawlers
// + data subjects can read it without authentication. Mirrors the SSR pattern
// of /directorio + /vendedor (NOT a client-only SPA behind noindex).
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description:
    'Política de tratamiento de datos personales conforme a la Ley 1581 de 2012 (Habeas Data, Colombia).',
  alternates: { canonical: `${BASE_URL}/privacy` },
  openGraph: {
    title: 'Política de Privacidad · ZIAY',
    description:
      'Política de tratamiento de datos personales conforme a la Ley 1581 de 2012 (Habeas Data, Colombia).',
    url: `${BASE_URL}/privacy`,
    type: 'article',
    locale: 'es_CO',
    siteName: 'ZIAY',
  },
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-10 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Política de Privacidad
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última actualización: Julio 2026 · Indisutex SAS
          </p>
        </header>

        <article className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-2">
              1. Responsable del Tratamiento
            </h2>
            <p>
              Indisutex SAS, con NIT en trámite, domiciliada en Bogotá D.C.,
              Colombia, en su calidad de responsable del tratamiento de datos
              personales en los términos del artículo 3 de la Ley 1581 de 2012
              y el Decreto Reglamentario 1377 de 2013. Contacto del
              responsable:{' '}
              <a
                href="mailto:datos@ziay.co"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                datos@ziay.co
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              2. Datos Recopilados
            </h2>
            <p className="mb-3">Tratamos las siguientes categorías de datos:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Identificación:</strong> nombre, correo electrónico,
                teléfono y dirección de entrega.
              </li>
              <li>
                <strong>Transaccionales:</strong> historial de compras,
                métodos de pago (tokenizados por los pasarelas — ZIAY nunca
                almacena el PAN ni el código de seguridad).
              </li>
              <li>
                <strong>Conversacionales:</strong> mensajes de WhatsApp,
                Messenger e Instagram intercambiados con el cliente, incluyendo
                transcripciones procesadas por los agentes de IA.
              </li>
              <li>
                <strong>Navegación:</strong> cookies de sesión estrictamente
                necesarias, preferencias de idioma y eventos analíticos
                agregados.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">3. Base Legal</h2>
            <p className="mb-3">
              El tratamiento de datos personales se fundamenta en las bases
              legales previstas en el artículo 4 de la Ley 1581 de 2012:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Consentimiento:</strong> para marketing, generación de
                perfiles con IA y transferencias transfronterizas a proveedores
                no esenciales.
              </li>
              <li>
                <strong>Ejecución de un contrato:</strong> para el procesamiento
                de pedidos, pagos, envíos y atención al cliente.
              </li>
              <li>
                <strong>Interés legítimo:</strong> para la prevención de fraude,
                análisis de riesgo crediticio y mejora de la experiencia del
                usuario.
              </li>
              <li>
                <strong>Obligación legal:</strong> para facturación electrónica,
                retención documental tributaria y respuesta a requerimientos de
                autoridades competentes (DIAN, SIC, Fiscalía).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">4. Finalidad</h2>
            <p>
              Los datos personales son tratados con las siguientes finalidades:
              procesamiento y despacho de pedidos; atención al cliente por
              canales conversacionales (WhatsApp, Messenger, Instagram);
              marketing directo (únicamente con consentimiento previo, expreso
              y revocable); prevención de fraude y análisis de riesgo;
              cumplimiento de obligaciones legales, tributarias y de
              facturación electrónica; mejora del servicio mediante análisis
              agregado e instrucción de agentes de IA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              5. Derechos del Titular (Ley 1581 Art 8)
            </h2>
            <p className="mb-3">
              Como titular de los datos personales tienes derecho a:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Acceso a tus datos personales tratados por Indisutex SAS.</li>
              <li>Rectificación de datos inexactos o incompletos.</li>
              <li>Supresión de datos en los casos previstos por la ley.</li>
              <li>
                Revocación del consentimiento otorgado para finalidades
                opcionales (marketing, perfiles con IA).
              </li>
              <li>
                Presentar queja ante la Superintendencia de Industria y Comercio
                (SIC) si consideras que tus derechos han sido vulnerados.
              </li>
            </ul>
            <p className="mt-3">
              Para ejercer estos derechos envía tu solicitud a{' '}
              <a
                href="mailto:datos@ziay.co"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                datos@ziay.co
              </a>{' '}
              indicando el derecho que quieres ejercer. Atenderemos tu
              solicitud en los plazos legales máximos (15 días hábiles).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">6. Retención</h2>
            <p>
              Conservamos tus datos personales durante la vigencia de la relación
              comercial y hasta por <strong>5 años</strong> después de finalizada,
              en cumplimiento de obligaciones fiscales (Estatuto Tributario Art
              632) y legales. Los mensajes conversacionales se conservan por 2
              años; los registros de auditoría por 7 años. Transcurridos los
              plazos, los datos son anonimizados o eliminados de forma segura.
              Ver nuestra política de retención en{' '}
              <Link
                href="/api/compliance/retention"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                /api/compliance/retention
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              7. Transferencias Transfronterizas (Ley 1581 Art 26)
            </h2>
            <p className="mb-3">
              Tus datos personales pueden transferirse a los siguientes
              encargados ubicados fuera de Colombia, bajo Cláusulas Contractuales
              Tipo (SCC) aprobadas por la SIC y/o bajo el amparo de las
              garantías previstas en el artículo 26 de la Ley 1581:
            </p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                <strong>Meta Platforms, Inc. (EE. UU.)</strong> — WhatsApp
                Business API, Messenger, Instagram. Procesa número telefónico,
                contenido de mensajes y metadatos de conversación.
              </li>
              <li>
                <strong>Stripe, Inc. (EE. UU.)</strong> — tokenización de
                instrumentos de pago. Recibe referencias tokenizadas, nunca el
                PAN.
              </li>
              <li>
                <strong>MercadoPago / MercadoLibre (Argentina/EE. UU.)</strong>{' '}
                — pasarela de pago.
              </li>
              <li>
                <strong>Wompi (Bancolombia, Colombia)</strong> — pasarela de
                pago local.
              </li>
              <li>
                <strong>PayU (Países Bajos / India)</strong> — pasarela de pago
                internacional.
              </li>
              <li>
                <strong>Google LLC (EE. UU.)</strong> y{' '}
                <strong>ByteDance (China/EE. UU.)</strong> — plataformas de
                atribución de pauta (CAPI). Reciben identificadores hashed
                (SHA-256) del cliente.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">8. Seguridad</h2>
            <p>
              Implementamos medidas técnicas y organizativas razonables para
              proteger tus datos: cifrado AES-256 en reposo, TLS 1.3 / HTTPS en
              tránsito, HSTS (max-age=31536000; includeSubDomains),
              autenticación de dos factores para accesos administrativos,
              tokenización de datos de pago, verificación de firmas HMAC en
              webhooks y auditoría de accesos firmada criptográficamente
              (W3C Verifiable Credentials).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              9. Menores de Edad (Ley 1098 de 2006)
            </h2>
            <p>
              ZIAY no recopila intencionalmente datos de menores de 18 años.
              Aplicamos un gate de verificación de edad en el flujo de checkout
              (Ley 1098 de 2006 — Código de la Infancia y la Adolescencia). Si
              detectamos que un cliente es menor de edad, bloqueamos la
              transacción hasta obtener el consentimiento de padre, madre o
              tutor legal, y excluimos al cliente de cualquier tratamiento con
              finalidad de marketing.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              10. Cambios a esta Política
            </h2>
            <p>
              Esta política puede actualizarse. Notificaremos cambios
              materialmente significativos vía correo electrónico a la dirección
              registrada del titular, con al menos 30 días de anticipación a su
              entrada en vigor. La versión vigente estará siempre publicada en
              esta URL.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">11. Contacto</h2>
            <p>
              Para cualquier solicitud relacionada con esta política o el
              tratamiento de tus datos personales, contacta a:{' '}
              <a
                href="mailto:datos@ziay.co"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                datos@ziay.co
              </a>{' '}
              — Indisutex SAS, Bogotá D.C., Colombia.
            </p>
          </section>
        </article>

        <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          <Link
            href="/legal"
            className="mr-4 hover:text-foreground hover:underline"
          >
            Índice legal
          </Link>
          <Link href="/terms" className="mr-4 hover:text-foreground hover:underline">
            Términos de Servicio
          </Link>
          <Link href="/" className="hover:text-foreground hover:underline">
            Inicio
          </Link>
        </footer>
      </div>
    </main>
  )
}
