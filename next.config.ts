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
};

export default nextConfig;
