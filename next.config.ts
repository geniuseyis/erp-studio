import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tarayıcı testleri ayrı klasörde derlenir (NEXT_DIST_DIR=.next-e2e): açık bir geliştirme sunucusuyla çakışmaz.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
