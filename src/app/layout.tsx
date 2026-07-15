import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/providers/auth-session-provider";

// ───────────────────────────────────────────────────────────────────────────
// Fonts — `display: 'swap'` is the next/font default but we set it
// explicitly so FOUT (Flash Of Unstyled Text) is locked in across Next
// versions (P2 finding #18 from AUDIT-SEO-001).
// ───────────────────────────────────────────────────────────────────────────
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Canonical origin for OG / Twitter / JSON-LD absolute URLs.
const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

// ───────────────────────────────────────────────────────────────────────────
// Root metadata — metadataBase + title template + OG/Twitter + robots.
// ───────────────────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "ZIAY · Comercio Conversacional + Atribución Inteligente",
    template: "%s · ZIAY",
  },
  description:
    "Plataforma omnicanal de venta conversacional (WhatsApp, Messenger, Instagram) con órdenes, pagos anticipado/contra entrega y atribución de pauta con CPA, ROAS y ROI.",
  keywords: [
    "conversational commerce",
    "WhatsApp Business",
    "Messenger",
    "ad attribution",
    "ROAS",
    "CPA",
    "Colombia",
    "ecommerce",
  ],
  applicationName: "ZIAY",
  authors: [{ name: "Indisutex SAS" }],
  creator: "Indisutex SAS",
  publisher: "Indisutex SAS",
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    type: "website",
    locale: "es_CO",
    url: BASE_URL,
    siteName: "ZIAY",
    title: "ZIAY · Comercio Conversacional + Atribución Inteligente",
    description:
      "Plataforma de comercio conversacional para LATAM. WhatsApp, Messenger, Instagram con atribución de pauta y agentes IA.",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "ZIAY · Comercio Conversacional + Atribución Inteligente",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZIAY · Comercio Conversacional + Atribución Inteligente",
    description:
      "Plataforma de comercio conversacional para LATAM. WhatsApp, Messenger, Instagram con atribución de pauta y agentes IA.",
    images: ["/og-default.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Viewport export — Next.js 16 requires this in a separate export
// (themeColor was removed from `metadata`). P1 finding #3.
// ───────────────────────────────────────────────────────────────────────────
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f0d" },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Root JSON-LD — Organization + WebSite. Provides Google Knowledge Panel
// entity + sitelinks search box eligibility. P1 finding #8.
// `</` is escaped to `\u003c` to prevent `</script>` injection from
// tenant-controlled strings (defense-in-depth against stored XSS).
// ───────────────────────────────────────────────────────────────────────────
const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ZIAY",
  legalName: "Indisutex SAS",
  url: BASE_URL,
  logo: `${BASE_URL}/logo.svg`,
  description: "Plataforma de comercio conversacional para LATAM",
  foundingDate: "2024",
  areaServed: ["CO", "MX", "PE", "CL", "AR"],
  sameAs: ["https://z-cdn.chatglm.cn/z-ai/static/logo.svg"],
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ZIAY",
  url: BASE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${BASE_URL}/directorio?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ───────────────────────────────────────────────────────────────────────────
// SPRINT-MONITORING-DR-001 · M-10 — Web Vitals reporting.
//
// Next.js calls this function for every Core Web Vital (LCP, FID/INP, CLS,
// FCP, TTFB) measured in the browser. We forward each metric to
// /api/analytics/web-vitals (which logs it through pino) using `sendBeacon`
// so the upload doesn't block the page navigation.
//
// Only fires in production — the route handler is a no-op for dev builds
// (and the early return here keeps the dev console clean).
// ───────────────────────────────────────────────────────────────────────────
export function reportWebVitals(metric: {
  name: string
  value: number
  id: string
  label: 'web-vital' | 'custom'
}) {
  // Only report in production
  if (process.env.NODE_ENV !== 'production') return

  // Send to analytics endpoint
  const url = '/api/analytics/web-vitals'
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    page: typeof window !== 'undefined' ? window.location.pathname : '/',
  })

  // Use sendBeacon for non-blocking
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(url, body)
  } else {
    fetch(url, { body, method: 'POST', keepalive: true })
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(websiteJsonLd) }}
        />
        <ThemeProvider>
          <AuthSessionProvider>
            {children}
            <Toaster />
            <SonnerToaster richColors position="top-right" />
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
