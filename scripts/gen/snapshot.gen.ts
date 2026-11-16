// Örnek veri anlık görüntüsünü üretir: npm run seed:snapshot
// Vitest ile çalışır çünkü proje içi yol kısaltmalarını (@/...) ve TypeScript'i hazır çözer.
import { writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { makeDb } from "@/db/client";
import { applyMigrations } from "@/db/migrate";
import { verifyLedger } from "@/domain/inventory/ledger";
import { verifyProductLedger } from "@/domain/production/productLedger";
import { seedBase } from "@/seed/base";
import { seedSales } from "@/seed/sales";
import { exportSnapshot, SNAPSHOT_NOW } from "@/seed/snapshot";

test("örnek veri anlık görüntüsünü yaz", async () => {
  const pg = new PGlite();
  await applyMigrations(pg);
  const db = makeDb(pg);
  await seedBase(db, { now: SNAPSHOT_NOW });
  await seedSales(db, { now: SNAPSHOT_NOW });
  expect(await verifyLedger(db)).toEqual([]);
  expect(await verifyProductLedger(db)).toEqual([]);

  const snapshot = await exportSnapshot(db, SNAPSHOT_NOW);
  const json = `${JSON.stringify(snapshot)}\n`;
  writeFileSync("src/seed/snapshot.generated.json", json);
  const rows = Object.entries(snapshot.tables).map(([name, t]) => `${name}: ${t.rows.length}`);
  console.log(`snapshot.generated.json yazıldı, ${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB (${rows.join(", ")})`);
}, 300_000);
