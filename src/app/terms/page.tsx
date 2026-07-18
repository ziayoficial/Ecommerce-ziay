import type { Metadata } from 'next'
import Link from 'next/link'

// ───────────────────────────────────────────────────────────────────────────
// /terms — SSR Términos de Servicio
//
// FIX-LEGAL-P0-001 L-1 — public Terms of Service. Required for B2B SaaS
// enforceability + Ley 1480/2011 (Estatuto del Consumidor) disclosure.
// Server-rendered (same pattern as /privacy + /directorio).
// ───────────────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Términos de Servicio',
  description:
    'Términos y condiciones del servicio ZIAY — plataforma de comercio conversacional operada por ZIAY SAS.',
  alternates: { canonical: `${BASE_URL}/terms` },
  openGraph: {
    title: 'Términos de Servicio · ZIAY',
    description:
      'Términos y condiciones del servicio ZIAY — plataforma de comercio conversacional operada por ZIAY SAS.',
    url: `${BASE_URL}/terms`,
    type: 'article',
    locale: 'es_CO',
    siteName: 'ZIAY',
  },
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-10 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            Términos de Servicio
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última actualización: Julio 2026 · ZIAY SAS
          </p>
        </header>

        <article className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold mb-2">1. Aceptación</h2>
            <p>
              Estos Términos de Servicio (&laquo;Términos&raquo;) regulan el
              acceso y uso de la plataforma ZIAY (la &laquo;Plataforma&raquo;),
              operada por ZIAY SAS (&laquo;ZIAY&raquo;, &laquo;nosotros&raquo;).
              Al registrarte, iniciar sesión, navegar o utilizar la Plataforma
              — ya sea como comerciante (&laquo;Tenant&raquo;), agente, traficante
              o usuario final (&laquo;Cliente&raquo;) — aceptas quedar vinculado
              por estos Términos. Si no estás de acuerdo, no utilices la
              Plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">2. Descripción del Servicio</h2>
            <p>
              ZIAY es una plataforma omnicanal de comercio conversacional que
              permite a los comerccios vender por WhatsApp Business, Messenger,
              Instagram y canales web. Incluye: gestión de catálogo, mensajería
              unificada, agentes de IA conversacionales, procesamiento de
              pedidos y pagos (anticipado / contra entrega / cuotas / crédito),
              atribución de pauta publicitaria (CAPI), gestión de envíos y
              novedades logísticas, y gobernanza agéntica con trazabilidad de
              decisiones.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">3. Elegibilidad</h2>
            <p>
              Para usar la Plataforma como Tenant debes tener capacidad legal
              para contratar en Colombia (mayor de 18 años) o estar debidamente
              representado por tu representante legal. Para realizar compras
              como Cliente, debes ser mayor de edad (Ley 1098 de 2006). Los
              menores de edad requieren consentimiento de padre, madre o tutor
              legal — dicho consentimiento será verificado mediante el gate de
              edad en el flujo de checkout.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">4. Obligaciones del Usuario</h2>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Proporcionar información veraz, exacta y actualizada al
                registrarse y al realizar pedidos.
              </li>
              <li>
                Mantener la confidencialidad de tus credenciales (usuario,
                contraseña, 2FA TOTP) y ser responsable de toda actividad
                realizada con tu cuenta.
              </li>
              <li>
                Cumplir toda la normativa aplicable, incluyendo Ley 1581 de
                2012 (protección de datos de tus propios clientes), Ley 1480
                de 2011 (Estatuto del Consumidor), y las normas tributarias
                colombianas (facturación electrónica DIAN).
              </li>
              <li>
                No eludir los límites de gobernanza agéntica ni desactivar los
                mecanismos de escalamiento a humano sin autorización.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">5. Usos Prohibidos</h2>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>
                Usar la Plataforma para actividades fraudulentas, ilícitas o
                que violen derechos de terceros.
              </li>
              <li>
                Enviar mensajes de marketing a clientes sin consentimiento
                previo, expreso y revocable (Ley 1581 Art 10 + política de
                Meta Cloud API).
              </li>
              <li>
                Intentar acceder a datos de otros tenants o explotar
                vulnerabilidades de seguridad.
              </li>
              <li>
                Ingerir, almacenar o procesar datos de menores de edad sin el
                consentimiento parental requerido (Ley 1098 de 2006).
              </li>
              <li>
                Extraer, scrapear o indexar masivamente la Plataforma sin
                autorización escrita.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              6. Propiedad Intelectual
            </h2>
            <p>
              La Plataforma, su código fuente, diseño, marcas, logotipos y
              documentación son propiedad de ZIAY SAS y están protegidos
              por la legislación colombiana sobre propiedad intelectual (Ley 23
              de 1982, Decisión Andina 351) y los tratados internacionales
              suscritos por Colombia. El Tenant conserva la titularidad sobre
              su catálogo de productos, marca y contenido propio cargado a la
              Plataforma; otorga a ZIAY una licencia no exclusiva para
              procesarlos con la finalidad exclusiva de prestar el servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              7. Agentes de IA y Trazabilidad
            </h2>
            <p>
              La Plataforma utiliza modelos de lenguaje (LLM) y agentes de IA
              para automatizar respuestas, generar carritos, proponer cotizaciones
              y tomar decisiones operativas. Cada decisión agéntica queda
              registrada en un log de gobernanza trazable (W3C Verifiable
              Credentials). Las transacciones de alto valor, primera compra o
              métodos de pago sensibles son escaladas a revisión humana. ZIAY
              no garantiza la exactitud absoluta de las decisiones automatizadas
              y el Tenant puede ejercer control humano en cualquier momento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              8. Pagos y Comisiones
            </h2>
            <p>
              El Tenant paga a ZIAY una comisión según el plan contratado
              (Starter, Growth, Scale o Enterprise) y/o un porcentaje del GMV
              procesado. Las facturas se emiten mensualmente. El Tenant es
              responsable de los impuestos aplicables a sus ventas (IVA,
              retefuente, reteica, impuesto al consumo). El procesamiento de
              pagos se realiza a través de pasarelas externas (Stripe,
              MercadoPago, Wompi, PayU); ZIAY nunca almacena el PAN ni datos
              sensibles de tarjetas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              9. Limitación de Responsabilidad
            </h2>
            <p>
              En la máxima medida permitida por la ley, ZIAY no será responsable
              de daños indirectos, incidentales, consecuentes, especiales o
              punitivos derivados del uso o la imposibilidad de uso de la
              Plataforma. La responsabilidad agregada de ZIAY frente a un
              Tenant se limita al monto efectivamente pagado por el Tenant a
              ZIAY en los 12 meses anteriores al evento generador. Esta
              limitación no afecta la responsabilidad por dolo, culpa grave ni
              las obligaciones inderogables bajo la Ley 1480 de 2011 (Estatuto
              del Consumidor).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              10. Suspensión y Terminación
            </h2>
            <p>
              ZIAY podrá suspender o terminar el acceso a la Plataforma en caso
              de incumplimiento de estos Términos, actividad fraudulenta,
              violación de los derechos de terceros o por requerimiento legal.
              El Tenant puede terminar su cuenta en cualquier momento con
              preaviso de 30 días, sin perjuicio del pago de las obligaciones
              pendientes. La retención de datos tras la terminación se rige por
              la Política de Privacidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              11. Ley Aplicable y Jurisdicción
            </h2>
            <p>
              Estos Términos se rigen por las leyes de la República de
              Colombia. Cualquier controversia se resolverá preferentemente
              mediante conciliación extrajudicial de conformidad con la Ley 640
              de 2001. De no llegarse a un acuerdo, las partes se someten a la
              jurisdicción y competencia de los jueces civiles del circuito de
              Bogotá D.C., Colombia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">
              12. Derecho de Retracto (Ley 1480 Art 47)
            </h2>
            <p>
              Conforme al Estatuto del Consumidor, el Cliente final tiene
              derecho a retractarse de la compra dentro de los 5 días hábiles
              siguientes a la recepción del producto. El ejercicio de este
              derecho no genera penalización y procede para ventas realizadas
              por medios no convencionales (e-commerce, WhatsApp).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">13. Modificaciones</h2>
            <p>
              ZIAY podrá modificar estos Términos en cualquier momento. Las
              modificaciones materialmente significativas serán notificadas al
              Tenant vía correo electrónico con 30 días de anticipación. El uso
              continuado de la Plataforma después de la entrada en vigor
              constituye aceptación tácita de los Términos modificados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">14. Contacto</h2>
            <p>
              Para preguntas sobre estos Términos:{' '}
              <a
                href="mailto:datos@ziay.co"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                datos@ziay.co
              </a>{' '}
              — ZIAY SAS, Bogotá D.C., Colombia.
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
          <Link
            href="/privacy"
            className="mr-4 hover:text-foreground hover:underline"
          >
            Política de Privacidad
          </Link>
          <Link href="/" className="hover:text-foreground hover:underline">
            Inicio
          </Link>
        </footer>
      </div>
    </main>
  )
}
