import { expect, test } from "vitest";
import { isDomainError } from "@/domain/errors";
import { consumeStock, issueStock, receiveStock, releaseStock, reserveStock, verifyLedger } from "@/domain/inventory/ledger";
import { listMaterials } from "@/domain/inventory/queries";
import { mulberry32 } from "@/seed/rng";
import { addMaterial, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

test("mulberry32 aynı tohumla aynı diziyi üretir, 0–1 aralığında", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 50 }, () => a());
  expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(new Set(xs).size).toBeGreaterThan(45);
});

test("rastgele 500 işlemden sonra defter tutarlı kalır", async () => {
  const db = await createTestDb();
  const ctx = ctxFor(db, await addUser(db, "depo", "uzman"));
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) ids.push((await addMaterial(db)).id);
  const rnd = mulberry32(20261115);
  const ref = { type: "test", id: "1" };
  const ops = [receiveStock, issueStock, reserveStock, releaseStock, consumeStock] as const;
  let accepted = 0;
  let rejected = 0;

  for (let i = 0; i < 500; i++) {
    const materialId = ids[Math.floor(rnd() * ids.length)] as string;
    const qtyMilli = 1 + Math.floor(rnd() * 5_000);
    const op = ops[Math.floor(rnd() * ops.length)] as (typeof ops)[number];
    try {
      await op(ctx, { materialId, qtyMilli, unitCostKurus: 1 + Math.floor(rnd() * 10_000), ref });
      accepted++;
    } catch (e) {
      if (!isDomainError(e)) throw e;
      rejected++;
    }
  }

  expect(accepted).toBeGreaterThan(100);
  expect(rejected).toBeGreaterThan(50);
  expect(await verifyLedger(db)).toEqual([]);
  for (const m of await listMaterials(db)) {
    expect(m.onHandMilli).toBeGreaterThanOrEqual(m.reservedMilli);
    expect(m.reservedMilli).toBeGreaterThanOrEqual(0);
    expect(m.avgCostKurus).toBeGreaterThanOrEqual(0);
  }
});
