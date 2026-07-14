import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable the Next.js 16 dev overlay (the issues/build-activity badge that
  // floats at the bottom of the viewport). In dev it was blocking clicks on
  // the sidebar nav (agent-browser reported "Element is covered by
  // <nextjs-portal> at its click point"). It's a dev-only UI element and does
  // not appear in production builds.
  devIndicators: false,

  // FIX-PERFORMANCE-001 — build config improvements:
  //   - compress: gzip at the app layer (Caddy could also brotli, but this
  //     guarantees compression even when running standalone behind a bare
  //     reverse proxy).
  //   - poweredByHeader: false removes the `X-Powered-By: Next.js` header
  //     so the framework + version isn't leaked to passive scanners.
  //   - experimental.optimizePackageImports: tree-shakes per-icon imports
  //     from lucide-react + @radix-ui/react-icons so only the icons
  //     actually referenced ship in the client bundle (lucide-react has
  //     ~1.5k icons — barrel imports without this flag pull the whole set
  //     into the dev graph and slow first build).
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
};

export default nextConfig;
