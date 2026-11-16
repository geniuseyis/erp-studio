import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { applyMigrations } from "@/db/migrate";
import { meta } from "@/db/schema";
import { createTestDb } from "../../helpers/testDb";

test("bellekte PostgreSQL açılır ve şema uygulanır", async () => {
  const db = await createTestDb();
  const r = await db.execute(sql`select version() as v`);
  expect(String(r.rows[0]?.v)).toContain("PostgreSQL");
  await db.insert(meta).values({ key: "k", value: "v" });
  expect(await db.select().from(meta)).toEqual([{ key: "k", value: "v" }]);
});

test("applyMigrations iki kez çalışınca hata vermez", async () => {
  const pg = new PGlite();
  await applyMigrations(pg);
  await applyMigrations(pg);
  const r = await pg.query<{ n: number }>("select count(*)::int as n from _migrations");
  expect(r.rows[0]?.n).toBeGreaterThan(0);
});
