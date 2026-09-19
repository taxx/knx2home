import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully client-side app: no API routes or server components, so we can
  // ship a static export. This also matches the GitHub Pages CI (./out).
  output: "export",
};

export default nextConfig;
