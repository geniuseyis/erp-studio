import { expect, test } from "vitest";
import { products } from "@/db/schema";
import { isDomainError } from "@/domain/errors";
import { produceIn, releaseProduct, reserveProduct, shipProduct, verifyProductLedger } from "@/domain/production/productLedger";
import { mulberry32 } from "@/seed/rng";
import { addProduct, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

test("rastgele 300 işlemden sonra mamul defteri tutarlı", async () => {
  const db = await createTestDb();
  const ctx = ctxFor(db, await addUser(db, "atolye", "uzman"));
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await addProduct(db)).id);
  const rnd = mulberry32(20261116);
  const ref = { type: "test", id: "1" };
  const ops = [produceIn, reserveProduct, releaseProduct, shipProduct] as const;
  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < 300; i++) {
    const productId = ids[Math.floor(rnd() * ids.length)] as string;
    const qtyMilli = (1 + Math.floor(rnd() * 5)) * 1000;
    const op = ops[Math.floor(rnd() * ops.length)] as (typeof ops)[number];
    try {
      await op(ctx, { productId, qtyMilli, ref });
      accepted++;
    } catch (e) {
      if (!isDomainError(e)) throw e;
      rejected++;
    }
  }

  expect(accepted).toBeGreaterThan(50);
  expect(rejected).toBeGreaterThan(20);
  expect(await verifyProductLedger(db)).toEqual([]);
  for (const p of await db.select().from(products)) {
    expect(p.onHandMilli).toBeGreaterThanOrEqual(p.reservedMilli);
    expect(p.reservedMilli).toBeGreaterThanOrEqual(0);
    expect(p.onHandMilli % 1000).toBe(0);
  }
});
