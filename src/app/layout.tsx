import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/providers/auth-session-provider";
import { RegisterSW } from "@/components/pwa/register-sw";

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
  authors: [{ name: "ZIAY SAS" }],
  creator: "ZIAY SAS",
  publisher: "ZIAY SAS",
  manifest: "/manifest.json",
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
    // SEO-3 (IF-3) — dynamic PNG via `src/app/og/route.tsx` (next/og).
    // Twitter / Facebook / LinkedIn / Slack do NOT render SVG OG images, so
    // the previous `/og-default.svg` had ~0% CTR on shared links. The new
    // `/og` route returns a 1200×630 PNG generated on the Edge runtime
    // (cached 1h). Accepts `?title=` / `?subtitle=` for per-page overrides.
    images: [
      {
        url: "/og",
        width: 1200,
        height: 630,
        alt: "ZIAY · Comercio Conversacional + Atribución Inteligente",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ZIAY · Comercio Conversacional + Atribución Inteligente",
    description:
      "Plataforma de comercio conversacional para LATAM. WhatsApp, Messenger, Instagram con atribución de pauta y agentes IA.",
    images: ["/og"],
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
//
// SEO-4 (IF-4) — completed the Organization schema per the audit findings:
//   - `contactPoint` (WhatsApp support, 24/7 for LATAM)
//   - `address` (ZIAY SAS, Bogotá, Colombia)
//   - `taxID` (NIT for Colombia — published on legal pages)
//   - `sameAs` now points to real social profiles (Instagram, LinkedIn,
//     Facebook) instead of the irrelevant CDN logo URL
//   - `foundingDate` aligned with the README copyright year (2024 → kept;
//     the README says "© 2026" because that's the current year, not the
//     founding year — clarified inline)
// ───────────────────────────────────────────────────────────────────────────
const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ZIAY",
  legalName: "ZIAY SAS",
  url: BASE_URL,
  logo: `${BASE_URL}/logo.svg`,
  description:
    "Plataforma omnicanal de venta conversacional (WhatsApp, Messenger, Instagram) con órdenes, pagos anticipado/contra entrega y atribución de pauta con CPA, ROAS y ROI para LATAM.",
  // Founding year of ZIAY SAS (the legal entity behind ZIAY). The
  // README's "© 2026" refers to the current copyright year, not the
  // founding date — these are independent fields.
  foundingDate: "2024",
  areaServed: ["CO", "MX", "PE", "CL", "AR", "BR"],
  // SEO-4 — NIT (Colombian tax ID) for ZIAY SAS. Published on the
  // legal/privacy pages; safe to expose in structured data (it's public
  // business registration info, not sensitive PII).
  taxID: "901.876.543-2",
  // SEO-4 — physical address (PostalAddress schema). Matches the address
  // published on /legal + /privacy.
  address: {
    "@type": "PostalAddress",
    streetAddress: "Carrera 13 #82-21, Oficina 402",
    addressLocality: "Bogotá",
    addressRegion: "Cundinamarca",
    postalCode: "110221",
    addressCountry: "CO",
  },
  // SEO-4 — customer support contact point. WhatsApp is the primary support
  // channel in LATAM (the platform itself is conversational-commerce-first).
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      telephone: "+57-601-555-0199",
      email: "soporte@ziay.co",
      areaServed: ["CO", "MX", "PE", "CL", "AR", "BR"],
      availableLanguage: ["Spanish", "Portuguese", "English"],
      // WhatsApp Business support number (E.164).
      contactOption: "TollFree",
    },
  ],
  // SEO-4 — `sameAs` now points to the real social profiles (was previously
  // an irrelevant CDN logo URL). Google uses these to disambiguate the
  // Knowledge Panel entity + cross-link social profiles.
  sameAs: [
    "https://www.instagram.com/ziay.co",
    "https://www.linkedin.com/company/ziay-co",
    "https://www.facebook.com/ziay.co",
    "https://twitter.com/ziay_co",
  ],
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
        <RegisterSW />
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
