import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/providers/auth-session-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZIAY · Comercio Conversacional + Atribución Inteligente",
  description: "Plataforma omnicanal de venta conversacional (WhatsApp, Messenger, Instagram) con órdenes, pagos anticipado/contra entrega y atribución de pauta con CPA, ROAS y ROI.",
  keywords: ["conversational commerce", "WhatsApp Business", "Messenger", "ad attribution", "ROAS", "CPA", "Colombia", "ecommerce"],
  authors: [{ name: "ZIAY" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

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
