import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, stockMovements } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { consumeStock, issueStock, receiveStock, releaseStock, reserveStock, verifyLedger } from "@/domain/inventory/ledger";
import { getMaterial } from "@/domain/inventory/queries";
import { addMaterial, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let ctx: Ctx;
let materialId: string;
const ref = { type: "work_order", id: "WO-1" };

async function material() {
  const m = await getMaterial(db, materialId);
  if (!m) throw new Error("malzeme yok");
  return m;
}
async function movementCount() {
  return (await db.select().from(stockMovements)).length;
}

beforeEach(async () => {
  db = await createTestDb();
  ctx = ctxFor(db, await addUser(db, "depo", "uzman", { name: "Onur Tekin" }));
  materialId = (await addMaterial(db)).id;
});

test("giriş eldeki stoğu artırır ve ortalama maliyeti günceller", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 10_000, unitCostKurus: 10_000 });
  await receiveStock(ctx, { materialId, qtyMilli: 30_000, unitCostKurus: 20_000 });
  const m = await material();
  expect(m.onHandMilli).toBe(40_000);
  expect(m.avgCostKurus).toBe(17_500);
  expect(m.stockValueKurus).toBe(700_000);
});

test("çıkış eldeki stoğu düşürür, ortalama maliyeti değiştirmez", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 10_000, unitCostKurus: 12_345 });
  const mv = await issueStock(ctx, { materialId, qtyMilli: 4_000, note: "fire" });
  expect(mv).toMatchObject({ type: "issue", deltaOnHandMilli: -4_000, deltaReservedMilli: 0, note: "fire" });
  const m = await material();
  expect(m.onHandMilli).toBe(6_000);
  expect(m.avgCostKurus).toBe(12_345);
});

test("ayrılmış stok çıkılamaz; kullanılabilir kadar çıkılır", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 10_000, unitCostKurus: 100 });
  await reserveStock(ctx, { materialId, qtyMilli: 8_000, ref });
  await expect(issueStock(ctx, { materialId, qtyMilli: 3_000 })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  await issueStock(ctx, { materialId, qtyMilli: 2_000 });
  const m = await material();
  expect(m.onHandMilli).toBe(8_000);
  expect(m.reservedMilli).toBe(8_000);
  expect(m.availableMilli).toBe(0);
});

test("kullanılabilirden fazlası ayrılamaz", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 5_000, unitCostKurus: 100 });
  await reserveStock(ctx, { materialId, qtyMilli: 3_000, ref });
  await expect(reserveStock(ctx, { materialId, qtyMilli: 2_001, ref })).rejects.toMatchObject({
    code: "INSUFFICIENT_STOCK",
  });
});

test("tüketim eldeki ve ayrılmışı birlikte düşürür", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 10_000, unitCostKurus: 100 });
  await reserveStock(ctx, { materialId, qtyMilli: 4_000, ref });
  const mv = await consumeStock(ctx, { materialId, qtyMilli: 4_000, ref });
  expect(mv).toMatchObject({ type: "consume", deltaOnHandMilli: -4_000, deltaReservedMilli: -4_000, refType: "work_order", refId: "WO-1" });
  const m = await material();
  expect(m.onHandMilli).toBe(6_000);
  expect(m.reservedMilli).toBe(0);
});

test("ayrılmıştan fazlası serbest bırakılamaz ya da tüketilemez", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 10_000, unitCostKurus: 100 });
  await reserveStock(ctx, { materialId, qtyMilli: 2_000, ref });
  await expect(releaseStock(ctx, { materialId, qtyMilli: 2_001, ref })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(consumeStock(ctx, { materialId, qtyMilli: 2_001, ref })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await releaseStock(ctx, { materialId, qtyMilli: 2_000, ref });
  expect((await material()).reservedMilli).toBe(0);
});

test.each([0, -5, 1.5, Number.NaN])("geçersiz miktar %s reddedilir", async (qtyMilli) => {
  await expect(receiveStock(ctx, { materialId, qtyMilli, unitCostKurus: 100 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(issueStock(ctx, { materialId, qtyMilli })).rejects.toMatchObject({ code: "VALIDATION" });
});

test.each([-1, 1.5])("geçersiz birim maliyet %s reddedilir", async (unitCostKurus) => {
  await expect(receiveStock(ctx, { materialId, qtyMilli: 1_000, unitCostKurus })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("olmayan malzemede NOT_FOUND", async () => {
  const none = "00000000-0000-0000-0000-000000000000";
  await expect(receiveStock(ctx, { materialId: none, qtyMilli: 1_000, unitCostKurus: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("başka departman stok girişi ve çıkışı yapamaz; hareket yazılmaz", async () => {
  const satis = ctxFor(db, await addUser(db, "satis", "mudur"));
  await expect(receiveStock(satis, { materialId, qtyMilli: 1_000, unitCostKurus: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(issueStock(satis, { materialId, qtyMilli: 1_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await movementCount()).toBe(0);
});

test("depo operatörü giriş yapabilir", async () => {
  const op = ctxFor(db, await addUser(db, "depo", "operator"));
  await receiveStock(op, { materialId, qtyMilli: 1_000, unitCostKurus: 100 });
  expect((await material()).onHandMilli).toBe(1_000);
});

test("başarısız işlem hiçbir iz bırakmaz", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 1_000, unitCostKurus: 100 });
  const before = await movementCount();
  const audits = (await db.select().from(auditLog)).length;
  await expect(issueStock(ctx, { materialId, qtyMilli: 5_000 })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  expect(await movementCount()).toBe(before);
  expect((await db.select().from(auditLog)).length).toBe(audits);
  expect((await material()).onHandMilli).toBe(1_000);
});

test("her hareket kullanıcı ve tarihle yazılır, işlem geçmişine düşer", async () => {
  const mv = await receiveStock(ctx, { materialId, qtyMilli: 2_500, unitCostKurus: 100, note: "irsaliye 12" });
  expect(mv).toMatchObject({ userId: ctx.user.id, type: "receipt", deltaOnHandMilli: 2_500, unitCostKurus: 100 });
  expect(mv.createdAt.getTime()).toBe(ctx.now.getTime());
  const log = await db.select().from(auditLog).where(eq(auditLog.entityId, materialId));
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ userId: ctx.user.id, entity: "material", action: "receipt" });
});

test("verifyLedger tutarlı defterde boş, elle bozulmuş stokta farkı döner", async () => {
  await receiveStock(ctx, { materialId, qtyMilli: 5_000, unitCostKurus: 100 });
  expect(await verifyLedger(db)).toEqual([]);
  await db.execute(`update materials set on_hand_milli = 7000 where id = '${materialId}'`);
  const diff = await verifyLedger(db);
  expect(diff).toHaveLength(1);
  expect(diff[0]).toMatchObject({ materialId, field: "on_hand", expected: 5_000, actual: 7_000 });
});
