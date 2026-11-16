// drizzle-kit'in ürettiği SQL dosyalarını tarayıcıda da çalışabilsin diye tek bir TypeScript modülüne toplar.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const migrations = journal.entries
  .sort((a, b) => a.idx - b.idx)
  .map((e) => ({ tag: e.tag, sql: readFileSync(`drizzle/${e.tag}.sql`, "utf8").replace(/\r\n/g, "\n") }));
const version = createHash("sha256").update(JSON.stringify(migrations)).digest("hex").slice(0, 12);

const out = `// Bu dosya \`npm run db:generate\` ile üretilir; elle düzenlemeyin.
export const SCHEMA_VERSION = ${JSON.stringify(version)};
export const MIGRATIONS: { tag: string; sql: string }[] = ${JSON.stringify(migrations, null, 2)};
`;
writeFileSync("src/db/migrations.generated.ts", out);
console.log(`migrations.generated.ts: ${migrations.length} dosya, sürüm ${version}`);
