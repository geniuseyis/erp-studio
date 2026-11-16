import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Üretim betikleri (npm run seed:snapshot). Normal test çalıştırmasına dahil değildir.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["scripts/gen/**/*.gen.ts"], testTimeout: 120_000 },
});
