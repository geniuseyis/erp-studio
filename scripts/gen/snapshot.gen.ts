// Örnek verinin anlık görüntüsünü üretir: npm run seed:snapshot
// Vitest ile çalışır çünkü proje içi yol kısaltmalarını (@/...) ve TypeScript'i hazır çözer.
import { writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { makeDb } from "@/db/client";
import { applyMigrations } from "@/db/migrate";
import { verifyLedger } from "@/domain/inventory/ledger";
import { seedBase } from "@/seed/base";
import { exportSnapshot, SNAPSHOT_NOW } from "@/seed/snapshot";

test("örnek veri anlık görüntüsünü yaz", async () => {
  const pg = new PGlite();
  await applyMigrations(pg);
  const db = makeDb(pg);
  await seedBase(db, { now: SNAPSHOT_NOW });
  expect(await verifyLedger(db)).toEqual([]);

  const snapshot = await exportSnapshot(db, SNAPSHOT_NOW);
  writeFileSync("src/seed/snapshot.generated.json", `${JSON.stringify(snapshot)}\n`);
  const rows = Object.entries(snapshot.tables).map(([name, list]) => `${name}: ${list.length}`);
  console.log(`snapshot.generated.json yazıldı (${rows.join(", ")})`);
}, 120_000);
