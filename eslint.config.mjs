import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", ".next-e2e/**", "node_modules/**", "public/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "drizzle/**", "src/db/migrations.generated.ts", ".superpowers/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
