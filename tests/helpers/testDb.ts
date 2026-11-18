import { PGlite } from "@electric-sql/pglite";
import { afterAll } from "vitest";
import { type Db, makeDb } from "@/db/client";
import { applyMigrations } from "@/db/migrate";

let shared: { pg: PGlite; db: Db } | null = null;
const fresh: PGlite[] = [];

// Test dosyası bitince açılan bütün PostgreSQL örnekleri kapatılır (bellek sızıntısı olmasın).
afterAll(async () => {
  const all = [...fresh.splice(0), ...(shared ? [shared.pg] : [])];
  shared = null;
  await Promise.all(all.map((pg) => pg.close().catch(() => undefined)));
});

async function open(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite();
  await applyMigrations(pg);
  return { pg, db: makeDb(pg) };
}

/**
 * Bellekte, şeması uygulanmış, boş bir veritabanı.
 * Varsayılan: test dosyası başına tek PostgreSQL açılır ve her çağrıda tablolar boşaltılır (hızlı).
 * `fresh: true`: aynı anda iki ayrı veritabanı gereken testler için yeni bir PostgreSQL açar.
 */
export async function createTestDb(opts: { fresh?: boolean } = {}): Promise<Db> {
  if (opts.fresh) {
    const opened = await open();
    fresh.push(opened.pg);
    return opened.db;
  }
  if (!shared) {
    shared = await open();
    return shared.db;
  }
  const tables = await shared.pg.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'",
  );
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await shared.pg.exec(`truncate ${names} restart identity cascade`);
  return shared.db;
}
