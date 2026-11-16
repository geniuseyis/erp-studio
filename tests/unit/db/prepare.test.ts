import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { type Db, makeDb, prepare } from "@/db/client";
import { departments, meta } from "@/db/schema";

const insertDepartment = (db: Db) => db.transaction(async (tx) => void (await tx.insert(departments).values({ code: "depo", name: "Depo" })));

test("örnek veri yüklendikten sonra ama işaret yazılmadan açılış kesilirse sonraki açılış yine kurulur", async () => {
  const pg = await PGlite.create();
  const db = makeDb(pg);

  // Örnek veri kendi transaction'ında yazılır, sonra (ör. sekme kapandığı için) açılış yarıda kalır.
  await expect(
    prepare(pg, db, {
      seed: async (d) => {
        await insertDepartment(d);
        throw new Error("sekme kapandı");
      },
    }),
  ).rejects.toThrow("sekme kapandı");

  // Bir sonraki açılış aynı örnek veriyi yükler; yinelenen anahtar hatasıyla kilitlenmemeli.
  await prepare(pg, db, { seed: insertDepartment });
  expect(await db.select().from(departments)).toHaveLength(1);
  expect((await db.select().from(meta)).map((m) => m.key)).toContain("seeded");
  await pg.close();
});
