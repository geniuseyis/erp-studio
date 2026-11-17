import { asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, materials, products, salesOrderLines, salesOrders, workOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { produceIn, verifyProductLedger } from "@/domain/production/productLedger";
import { finishCurrentStep, retryMaterials, startNextStep } from "@/domain/production/workOrders";
import { addLine, cancelOrder, confirmOrder, createOrder, shipOrder } from "@/domain/sales/orders";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let satisMudur: Ctx;
let planlama: Ctx;
let depo: Ctx;
let atolye: Ctx;
let customerId: string;
let productId: string;
let materialId: string;
const DUE = new Date("2026-12-15T12:00:00+03:00");
const ref = { type: "test", id: "kurulum" };

async function product() {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) throw new Error("ürün yok");
  return p;
}
async function material() {
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!m) throw new Error("malzeme yok");
  return m;
}
async function order(id: string) {
  const [o] = await db.select().from(salesOrders).where(eq(salesOrders.id, id));
  if (!o) throw new Error("sipariş yok");
  return o;
}
async function linesOf(id: string) {
  return db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.createdAt));
}
/** Açık (sevk edilmemiş, iptal olmayan) satırların ayrılmışı ürünün ayrılmışına eşit olmalı. */
async function expectReservedInvariant() {
  for (const p of await db.select().from(products)) {
    const open = (await db.select().from(salesOrderLines).where(eq(salesOrderLines.productId, p.id))).filter(
      (l) => l.status !== "shipped" && l.status !== "cancelled",
    );
    expect(open.reduce((n, l) => n + l.reservedMilli, 0)).toBe(p.reservedMilli);
  }
}
/** Mamul stokta: onayda satır doğrudan ready olur. */
async function readyOrder(qtyMilli = 2000) {
  await produceIn(depo, { productId, qtyMilli, ref });
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId, qtyMilli });
  await confirmOrder(satis, o.id);
  return o;
}
/** Mamul stokta yok: onayda iş emri açılır, malzeme stokta yoksa bekler. */
async function productionOrder() {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: 1000 });
  await confirmOrder(satis, o.id);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  return { order: o, workOrderId: wo.id };
}

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  satisMudur = ctxFor(db, await addUser(db, "satis", "mudur"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  atolye = ctxFor(db, await addUser(db, "atolye", "operator"));
  customerId = (await addCustomer(db)).id;
  productId = (await addProduct(db)).id;
  for (let seq = 1; seq <= 2; seq += 1) {
    await addRouting(db, { productId, seq, stationId: (await addStation(db)).id, minutesPerUnit: 20 });
  }
  materialId = (await addMaterial(db, { unit: "plaka" })).id;
  await addBomLine(db, { productId, materialId, qtyMilli: 2000 });
});

test("hazır sipariş sevk edilir; mamul eldeki ve ayrılmış düşer", async () => {
  const o = await readyOrder(2000);
  expect(await product()).toMatchObject({ onHandMilli: 2000, reservedMilli: 2000 });

  const shipped = await shipOrder(depo, o.id);
  expect(shipped).toMatchObject({ status: "shipped", shippedAt: depo.now });
  expect(await product()).toMatchObject({ onHandMilli: 0, reservedMilli: 0 });
  expect(await linesOf(o.id)).toMatchObject([{ status: "shipped", reservedMilli: 0 }]);
  await expectReservedInvariant();
  const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, o.id));
  expect(logs.filter((r) => r.action === "ship")).toMatchObject([{ summary: `${o.code} sevk edildi: 1 satır, KDV dahil ₺2.200,00` }]);
});

test("hazır olmayan sipariş sevk edilemez", async () => {
  const { order: o } = await productionOrder();
  await expect(shipOrder(depo, o.id)).rejects.toMatchObject({ code: "INVALID_STATE", message: "Sevk için bütün kalemler hazır olmalı" });
  expect((await order(o.id)).status).toBe("confirmed");
  await expect(shipOrder(depo, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("satış sevk edemez; depo uzmanı sevk eder", async () => {
  const o = await readyOrder();
  await expect(shipOrder(satis, o.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await order(o.id)).status).toBe("ready");
  await expect(shipOrder(depo, o.id)).resolves.toMatchObject({ status: "shipped" });
});

test("taslak iptalini satış uzmanı yapar; onaylı iptal için müdür gerekir", async () => {
  const draft = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: draft.id, productId, qtyMilli: 1000 });
  await expect(cancelOrder(satis, { orderId: draft.id, reason: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
  const cancelled = await cancelOrder(satis, { orderId: draft.id, reason: "Müşteri vazgeçti" });
  expect(cancelled).toMatchObject({ status: "cancelled", cancelledAt: satis.now });
  expect((await linesOf(draft.id)).map((l) => l.status)).toEqual(["cancelled"]);

  const confirmed = await readyOrder();
  await expect(cancelOrder(satis, { orderId: confirmed.id, reason: "Hata" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await order(confirmed.id)).status).toBe("ready");
  await expect(cancelOrder(satisMudur, { orderId: confirmed.id, reason: "Hata" })).resolves.toMatchObject({ status: "cancelled" });
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, confirmed.id));
  expect(rows.filter((r) => r.action === "cancel")).toMatchObject([{ summary: `${confirmed.code} iptal edildi: Hata (1 satır, KDV dahil ₺2.200,00)` }]);
});

test("iptalde hazır satırın ayrılmış mamulü serbest kalır", async () => {
  const o = await readyOrder(2000);
  await cancelOrder(satisMudur, { orderId: o.id, reason: "Hata" });
  expect(await product()).toMatchObject({ onHandMilli: 2000, reservedMilli: 0 });
  expect(await linesOf(o.id)).toMatchObject([{ status: "cancelled", reservedMilli: 0 }]);
});

test("iptalde planlı iş emri iptal olur, malzemesi serbest kalır", async () => {
  const { order: o, workOrderId } = await productionOrder();
  await receiveStock(depo, { materialId, qtyMilli: 3000, unitCostKurus: 100 });
  await retryMaterials(planlama, workOrderId);
  expect(await material()).toMatchObject({ onHandMilli: 3000, reservedMilli: 2000 });

  await cancelOrder(satisMudur, { orderId: o.id, reason: "Vazgeçildi" });
  expect(await material()).toMatchObject({ onHandMilli: 3000, reservedMilli: 0 });
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  expect(wo?.status).toBe("cancelled");
  expect((await order(o.id)).status).toBe("cancelled");
  const woLog = await db.select().from(auditLog).where(eq(auditLog.entityId, workOrderId));
  expect(woLog.some((r) => r.action === "cancel")).toBe(true);
  expect(await verifyLedger(db)).toEqual([]);

  // Malzemesi hiç ayrılmamış planlı iş emri de iptal olur.
  const second = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: second.id, productId, qtyMilli: 2000 });
  await receiveStock(depo, { materialId, qtyMilli: 100, unitCostKurus: 100 });
  await confirmOrder(satis, second.id);
  const [open] = await db.select().from(workOrders).where(eq(workOrders.status, "planned"));
  expect(open?.materialsReserved).toBe(false);
  await cancelOrder(satisMudur, { orderId: second.id, reason: "Vazgeçildi" });
  const [after] = await db.select().from(workOrders).where(eq(workOrders.id, open!.id));
  expect(after?.status).toBe("cancelled");
});

test("iptal edilmiş siparişin başlamış iş emri tamamlanınca mamul serbest stokta kalır", async () => {
  const { order: o, workOrderId } = await productionOrder();
  await receiveStock(depo, { materialId, qtyMilli: 3000, unitCostKurus: 100 });
  await retryMaterials(planlama, workOrderId);
  await startNextStep(atolye, workOrderId);

  await cancelOrder(satisMudur, { orderId: o.id, reason: "Vazgeçildi" });
  const [running] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  expect(running?.status).toBe("in_progress");

  await finishCurrentStep(atolye, workOrderId);
  await startNextStep(atolye, workOrderId);
  await finishCurrentStep(atolye, workOrderId);
  const [done] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  expect(done?.status).toBe("completed");
  expect(await product()).toMatchObject({ onHandMilli: 1000, reservedMilli: 0 });
  expect((await linesOf(o.id))[0]?.status).toBe("cancelled");
  expect((await order(o.id)).status).toBe("cancelled");
});

test("sevk edilmiş sipariş iptal edilemez; iptal edilmiş iki kez iptal edilemez", async () => {
  const o = await readyOrder();
  await shipOrder(depo, o.id);
  await expect(cancelOrder(satisMudur, { orderId: o.id, reason: "Geç" })).rejects.toMatchObject({ code: "INVALID_STATE" });

  const o2 = await createOrder(satis, { customerId, dueAt: DUE });
  await cancelOrder(satis, { orderId: o2.id, reason: "Vazgeçti" });
  await expect(cancelOrder(satisMudur, { orderId: o2.id, reason: "Yine" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(shipOrder(depo, o2.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("iptal ve sevkten sonra iki defter tutarlı", async () => {
  const shippedOrder = await readyOrder(1000);
  await shipOrder(depo, shippedOrder.id);
  const { order: o, workOrderId } = await productionOrder();
  await receiveStock(depo, { materialId, qtyMilli: 3000, unitCostKurus: 100 });
  await retryMaterials(planlama, workOrderId);
  await cancelOrder(satisMudur, { orderId: o.id, reason: "Vazgeçildi" });
  expect(await verifyLedger(db)).toEqual([]);
  expect(await verifyProductLedger(db)).toEqual([]);
  await expectReservedInvariant();
});

test("kısmen stoktan, kalanı tamamlanmış iş emrinden ayrılmış hazır satır iptal edilir", async () => {
  await produceIn(depo, { productId, qtyMilli: 1000, ref });
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: 3000 });
  await confirmOrder(satis, o.id);
  const [wo] = await db.select().from(workOrders);
  await receiveStock(depo, { materialId, qtyMilli: 10000, unitCostKurus: 100 });
  await retryMaterials(planlama, wo!.id);
  for (let i = 0; i < 2; i += 1) {
    await startNextStep(atolye, wo!.id);
    await finishCurrentStep(atolye, wo!.id);
  }
  expect(await linesOf(o.id)).toMatchObject([{ status: "ready", reservedMilli: 3000 }]);
  expect(await product()).toMatchObject({ onHandMilli: 3000, reservedMilli: 3000 });
  await expectReservedInvariant();

  await cancelOrder(satisMudur, { orderId: o.id, reason: "Vazgeçildi" });
  expect(await product()).toMatchObject({ onHandMilli: 3000, reservedMilli: 0 });
  expect(await linesOf(o.id)).toMatchObject([{ status: "cancelled", reservedMilli: 0 }]);
  expect(await verifyLedger(db)).toEqual([]);
  expect(await verifyProductLedger(db)).toEqual([]);
  await expectReservedInvariant();
});
