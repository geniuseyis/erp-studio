import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, productMovements, products } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import {
  produceIn,
  releaseProduct,
  reserveProduct,
  shipProduct,
  verifyProductLedger,
} from "@/domain/production/productLedger";
import { addProduct, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let ctx: Ctx;
let productId: string;
const ref = { type: "sales_order", id: "SO-1" };

async function product() {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) throw new Error("mamul yok");
  return p;
}
async function movementCount() {
  return (await db.select().from(productMovements)).length;
}

beforeEach(async () => {
  db = await createTestDb();
  ctx = ctxFor(db, await addUser(db, "atolye", "uzman"));
  productId = (await addProduct(db)).id;
});

test("üretimden giriş eldekiyi artırır, hareket yazar", async () => {
  const mv = await produceIn(ctx, { productId, qtyMilli: 2_000, ref: { type: "work_order", id: "WO-1" }, note: "parti 1" });
  expect(mv).toMatchObject({
    type: "production_in",
    deltaOnHandMilli: 2_000,
    deltaReservedMilli: 0,
    refType: "work_order",
    refId: "WO-1",
    note: "parti 1",
    userId: ctx.user.id,
  });
  expect((await product()).onHandMilli).toBe(2_000);
  const log = await db.select().from(auditLog).where(eq(auditLog.entityId, productId));
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ entity: "product", action: "production_in" });
  expect(log[0]?.summary).toContain("üretimden giriş");
  expect(log[0]?.summary).toContain("2 adet");
});

test("ayırma kullanılabilir mamulü aşarsa INSUFFICIENT_STOCK", async () => {
  await produceIn(ctx, { productId, qtyMilli: 2_000, ref });
  await expect(reserveProduct(ctx, { productId, qtyMilli: 3_000, ref })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
});

test("sevk eldeki ve ayrılmışı birlikte düşürür", async () => {
  await produceIn(ctx, { productId, qtyMilli: 3_000, ref });
  await reserveProduct(ctx, { productId, qtyMilli: 2_000, ref });
  const mv = await shipProduct(ctx, { productId, qtyMilli: 2_000, ref });
  expect(mv).toMatchObject({ type: "ship", deltaOnHandMilli: -2_000, deltaReservedMilli: -2_000 });
  const p = await product();
  expect(p.onHandMilli).toBe(1_000);
  expect(p.reservedMilli).toBe(0);
});

test("ayrılmıştan fazlası bırakılamaz: INVALID_STATE", async () => {
  await produceIn(ctx, { productId, qtyMilli: 3_000, ref });
  await reserveProduct(ctx, { productId, qtyMilli: 1_000, ref });
  await expect(releaseProduct(ctx, { productId, qtyMilli: 2_000, ref })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(shipProduct(ctx, { productId, qtyMilli: 2_000, ref })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await releaseProduct(ctx, { productId, qtyMilli: 1_000, ref });
  expect((await product()).reservedMilli).toBe(0);
});

test.each([0, -1000, 1500])("geçersiz adet %s reddedilir", async (qtyMilli) => {
  await expect(produceIn(ctx, { productId, qtyMilli, ref })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(reserveProduct(ctx, { productId, qtyMilli, ref })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(releaseProduct(ctx, { productId, qtyMilli, ref })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(shipProduct(ctx, { productId, qtyMilli, ref })).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await movementCount()).toBe(0);
});

test("olmayan mamulde NOT_FOUND", async () => {
  const none = "00000000-0000-0000-0000-000000000000";
  await expect(produceIn(ctx, { productId: none, qtyMilli: 1_000, ref })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("başarısız işlem iz bırakmaz", async () => {
  await produceIn(ctx, { productId, qtyMilli: 1_000, ref });
  const before = await movementCount();
  const audits = (await db.select().from(auditLog)).length;
  await expect(shipProduct(ctx, { productId, qtyMilli: 5_000, ref })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(reserveProduct(ctx, { productId, qtyMilli: 5_000, ref })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  expect(await movementCount()).toBe(before);
  expect((await db.select().from(auditLog)).length).toBe(audits);
  expect((await product()).onHandMilli).toBe(1_000);
});

test("verifyProductLedger tutarlı defterde boş, bozulmuş stokta farkı döner", async () => {
  await produceIn(ctx, { productId, qtyMilli: 5_000, ref });
  expect(await verifyProductLedger(db)).toEqual([]);
  await db.execute(`update products set on_hand_milli = 7000 where id = '${productId}'`);
  const diff = await verifyProductLedger(db);
  expect(diff).toHaveLength(1);
  expect(diff[0]).toMatchObject({ productId, field: "on_hand", expected: 5_000, actual: 7_000 });
});
