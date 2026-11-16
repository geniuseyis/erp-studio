// Şemadan SQL üretir ve tarayıcı için tek modüle toplar.
// Vitrin sürümünde veritabanı şema değişince baştan kurulduğu için artımlı dosya tutulmaz:
// her çalıştırmada drizzle/ silinir ve tek bir "init" dosyası üretilir.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("drizzle", { recursive: true, force: true });
execSync("npx drizzle-kit generate --name init", { stdio: "inherit" });
execSync("node scripts/bundle-migrations.mjs", { stdio: "inherit" });
