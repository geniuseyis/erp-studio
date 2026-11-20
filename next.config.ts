import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tarayıcı testleri ayrı klasörde derlenir (NEXT_DIST_DIR=.next-e2e): açık bir geliştirme sunucusuyla çakışmaz.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        // PGlite paketindeki PostgreSQL dosyası (~6 MB) application/octet-stream gelir; Next ve Vercel yalnızca metin
        // benzeri türleri sıkıştırır. Tür düz metin yapılınca istemciye ~1,9 MB gider (tarayıcı gövdeyi olduğu gibi
        // okur, türe bakmaz). Dosya adı içerik özetlidir, bu yüzden sınırsız önbellek güvenlidir. .wasm zaten sıkışık gelir.
        source: "/_next/static/media/:file*.data",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=binary" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
