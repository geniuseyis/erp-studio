import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, materials, productMovements, products, salesOrderLines, salesOrders, stockMovements, workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { produceIn, verifyProductLedger } from "@/domain/production/productLedger";
import { finishCurrentStep, retryMaterials, startNextStep } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let planlama: Ctx;
let depo: Ctx;
let atolye: Ctx;
let productId: string;
let materialId: string;
let orderId: string;
let workOrderId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

async function steps() {
  return db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, workOrderId)).orderBy(asc(workOrderSteps.seq));
}
async function workOrder() {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) throw new Error("iş emri yok");
  return wo;
}
async function material() {
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!m) throw new Error("malzeme yok");
  return m;
}
async function product() {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) throw new Error("ürün yok");
  return p;
}
async function lines() {
  return db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.id));
}
/** Stok gelir ve planlama malzemeyi ayırır. */
async function reserveMaterials(qtyMilli = 3000) {
  await receiveStock(depo, { materialId, qtyMilli, unitCostKurus: 100 });
  await retryMaterials(planlama, workOrderId);
}
async function runAllSteps() {
  for (let i = 0; i < 3; i += 1) {
    await startNextStep(atolye, workOrderId);
    await finishCurrentStep(atolye, workOrderId);
  }
}

// Ürünün 3 adımlı rotası ve 2 plakalık reçetesi var; malzeme stokta yok, onaylanan sipariş bekleyen iş emri açar.
async function setup(target: Db) {
  db = target;
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  atolye = ctxFor(db, await addUser(db, "atolye", "operator"));
  productId = (await addProduct(db)).id;
  for (let seq = 1; seq <= 3; seq += 1) {
    await addRouting(db, { productId, seq, stationId: (await addStation(db)).id, minutesPerUnit: 20 });
  }
  materialId = (await addMaterial(db, { unit: "plaka" })).id;
  await addBomLine(db, { productId, materialId, qtyMilli: 2000 });

  orderId = (await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day("2026-12-15") })).id;
  await addLine(satis, { orderId, productId, qtyMilli: 1000 });
  await confirmOrder(satis, orderId);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  workOrderId = wo.id;
}

beforeEach(async () => {
  await setup(await createTestDb());
});

test("ilk adım malzemeleri tüketir; ayrılmış ve eldeki birlikte düşer", async () => {
  await reserveMaterials();
  expect(await material()).toMatchObject({ onHandMilli: 3000, reservedMilli: 2000 });

  const step = await startNextStep(atolye, workOrderId);
  expect(step.seq).toBe(1);
  expect(step.startedAt).toEqual(atolye.now);
  expect(step.startedBy).toBe(atolye.user.id);
  expect(await material()).toMatchObject({ onHandMilli: 1000, reservedMilli: 0 });
  const wo = await workOrder();
  expect(wo.status).toBe("in_progress");
  expect(wo.startedAt).toEqual(atolye.now);

  const consumed = await db.select().from(stockMovements).where(eq(stockMovements.type, "consume"));
  expect(consumed).toMatchObject([{ materialId, deltaOnHandMilli: -2000, deltaReservedMilli: -2000, refType: "work_order", refId: workOrderId }]);

  // İkinci adım malzemeye yeniden dokunmaz.
  await finishCurrentStep(atolye, workOrderId);
  await startNextStep(atolye, workOrderId);
  expect(await material()).toMatchObject({ onHandMilli: 1000, reservedMilli: 0 });
});

test("reçete sonradan değişse de ayrılan kadar tüketilir", async () => {
  await reserveMaterials();
  await addBomLine(db, { productId, materialId: (await addMaterial(db, { unit: "plaka" })).id, qtyMilli: 5000 });
  await startNextStep(atolye, workOrderId);
  expect(await material()).toMatchObject({ onHandMilli: 1000, reservedMilli: 0 });
});

test("malzemesi ayrılmamış iş emri başlamaz, eksik kalemi söyler", async () => {
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId));
  await expect(startNextStep(atolye, workOrderId)).rejects.toMatchObject({
    code: "INVALID_STATE",
    message: `Malzeme ayrılmadı: ${m?.code} ${m?.name}`,
  });
  expect((await workOrder()).status).toBe("planned");
  expect((await steps()).every((s) => s.startedAt === null)).toBe(true);

  // Stok var ama ayrılmamış: eksik yok, planlamaya yönlendirir.
  await receiveStock(depo, { materialId, qtyMilli: 3000, unitCostKurus: 100 });
  await expect(startNextStep(atolye, workOrderId)).rejects.toMatchObject({
    code: "INVALID_STATE",
    message: expect.stringContaining("planlama 'Malzemeyi yeniden dene' ile ayırmalı"),
  });
});

test("bitmemiş adım varken sonraki başlamaz", async () => {
  await reserveMaterials();
  await startNextStep(atolye, workOrderId);
  await expect(startNextStep(atolye, workOrderId)).rejects.toMatchObject({
    code: "INVALID_STATE",
    message: expect.stringMatching(/^Önce Test istasyon \d+ adımını bitirin$/),
  });
  await finishCurrentStep(atolye, workOrderId);
  const second = await startNextStep(atolye, workOrderId);
  expect(second.seq).toBe(2);
});

test("başlamış adım yokken bitirilemez; tamamlanmış iş emri başlamaz", async () => {
  await reserveMaterials();
  await expect(finishCurrentStep(atolye, workOrderId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  await runAllSteps();
  await expect(startNextStep(atolye, workOrderId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(finishCurrentStep(atolye, workOrderId)).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("son adım bitince mamul stoğa girer ve satıra ayrılır, satır ready", async () => {
  await reserveMaterials();
  await startNextStep(atolye, workOrderId);
  const mid = await finishCurrentStep(atolye, workOrderId);
  expect(mid.completed).toBe(false);
  expect(mid.step.finishedBy).toBe(atolye.user.id);
  expect(await product()).toMatchObject({ onHandMilli: 0, reservedMilli: 0 });

  await startNextStep(atolye, workOrderId);
  await finishCurrentStep(atolye, workOrderId);
  await startNextStep(atolye, workOrderId);
  const last = await finishCurrentStep(atolye, workOrderId);
  expect(last.completed).toBe(true);
  expect(last.step.finishedAt).toEqual(atolye.now);

  const wo = await workOrder();
  expect(wo.status).toBe("completed");
  expect(wo.completedAt).toEqual(atolye.now);
  expect(await product()).toMatchObject({ onHandMilli: 1000, reservedMilli: 1000 });
  const [line] = await lines();
  expect(line).toMatchObject({ status: "ready", reservedMilli: 1000 });
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  expect(order?.status).toBe("ready");
});

test("bağlı siparişin bütün satırları ready ise sipariş ready", async () => {
  // İki satırlı ikinci sipariş (aynı ürün tek satırda birleşir, bu yüzden ikinci ürün): her satır kendi iş emrini açar.
  const product2 = (await addProduct(db)).id;
  for (let seq = 1; seq <= 3; seq += 1) {
    await addRouting(db, { productId: product2, seq, stationId: (await addStation(db)).id, minutesPerUnit: 20 });
  }
  await addBomLine(db, { productId: product2, materialId, qtyMilli: 1000 });
  const o2 = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day("2026-12-15") });
  await addLine(satis, { orderId: o2.id, productId, qtyMilli: 1000 });
  await addLine(satis, { orderId: o2.id, productId: product2, qtyMilli: 2000 });
  await receiveStock(depo, { materialId, qtyMilli: 20000, unitCostKurus: 100 });
  await confirmOrder(satis, o2.id);
  const all = await db.select().from(workOrders).orderBy(asc(workOrders.code));
  expect(all).toHaveLength(3);

  const forO2 = [];
  for (const wo of all) {
    const [l] = wo.salesOrderLineId ? await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, wo.salesOrderLineId)) : [];
    if (l?.orderId === o2.id) forO2.push(wo);
  }
  expect(forO2).toHaveLength(2);

  const finish = async (id: string) => {
    for (let i = 0; i < 3; i += 1) {
      await startNextStep(atolye, id);
      await finishCurrentStep(atolye, id);
    }
  };
  await finish(forO2[0]!.id);
  const [mid] = await db.select().from(salesOrders).where(eq(salesOrders.id, o2.id));
  expect(mid?.status).not.toBe("ready");
  await finish(forO2[1]!.id);
  const [done] = await db.select().from(salesOrders).where(eq(salesOrders.id, o2.id));
  expect(done?.status).toBe("ready");
  const ls = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o2.id));
  expect(ls.every((l) => l.status === "ready" && l.reservedMilli === l.qtyMilli)).toBe(true);
});

test("atölye operatörü ilerletir; satış ilerletemez", async () => {
  await reserveMaterials();
  await expect(startNextStep(satis, workOrderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await workOrder()).status).toBe("planned");
  await startNextStep(atolye, workOrderId);
  await expect(finishCurrentStep(satis, workOrderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await steps())[0]?.finishedAt).toBeNull();
});

test("tam akıştan sonra iki defter de tutarlı", async () => {
  await reserveMaterials();
  await runAllSteps();
  expect(await verifyLedger(db)).toEqual([]);
  expect(await verifyProductLedger(db)).toEqual([]);
});

test("olmayan iş emri NOT_FOUND", async () => {
  await expect(startNextStep(atolye, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(finishCurrentStep(atolye, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("iptal satırlı iş emri biter: mamul serbest stoğa girer, satıra ayrılmaz", async () => {
  await reserveMaterials();
  const [before] = await lines();
  await db.update(salesOrderLines).set({ status: "cancelled" }).where(eq(salesOrderLines.id, before!.id));
  await runAllSteps();

  expect((await workOrder()).status).toBe("completed");
  expect(await product()).toMatchObject({ onHandMilli: 1000, reservedMilli: 0 });
  const [line] = await lines();
  expect(line).toMatchObject({ status: "cancelled", reservedMilli: before!.reservedMilli });
  const reserves = await db.select().from(productMovements).where(eq(productMovements.type, "reserve"));
  expect(reserves).toEqual([]);
  const [done] = await db.select().from(auditLog).where(eq(auditLog.action, "complete"));
  expect(done?.summary).toContain("satır iptal, mamul serbest stokta");
  expect(await verifyProductLedger(db)).toEqual([]);
});

test("kısmi ayırma: stoktaki 1 adet onayda ayrılır, iş emri kalan 2'yi üretir, satır ready", async () => {
  const o2 = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day("2026-12-15") });
  const product2 = (await addProduct(db)).id;
  for (let seq = 1; seq <= 3; seq += 1) {
    await addRouting(db, { productId: product2, seq, stationId: (await addStation(db)).id, minutesPerUnit: 20 });
  }
  await addBomLine(db, { productId: product2, materialId, qtyMilli: 1000 });
  await receiveStock(depo, { materialId, qtyMilli: 10000, unitCostKurus: 100 });
  await produceIn(depo, { productId: product2, qtyMilli: 1000, ref: { type: "manual", id: "test" } });
  await addLine(satis, { orderId: o2.id, productId: product2, qtyMilli: 3000 });
  await confirmOrder(satis, o2.id);

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.productId, product2));
  expect(wo?.qtyMilli).toBe(2000);
  const [mid] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o2.id));
  expect(mid?.reservedMilli).toBe(1000);

  for (let i = 0; i < 3; i += 1) {
    await startNextStep(atolye, wo!.id);
    await finishCurrentStep(atolye, wo!.id);
  }
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, o2.id));
  expect(line).toMatchObject({ reservedMilli: 3000, status: "ready" });
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, o2.id));
  expect(order?.status).toBe("ready");
  expect(await verifyProductLedger(db)).toEqual([]);
});

test("her başlatma ve bitirme işlem geçmişine yazılır", async () => {
  await reserveMaterials();
  await runAllSteps();
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, workOrderId)).orderBy(asc(auditLog.createdAt));
  const count = (action: string) => rows.filter((r) => r.action === action).length;
  expect(count("step_start")).toBe(3);
  expect(count("step_finish")).toBe(3);
  expect(count("start")).toBe(1);
  expect(count("complete")).toBe(1);
  const wo = await workOrder();
  expect(rows.find((r) => r.action === "step_start")?.summary).toMatch(new RegExp(`^${wo.code} Test istasyon [0-9]+ başladı$`));
  expect(rows.find((r) => r.action === "complete")?.summary).toMatch(/1 adet SIP-\S+ satırına ayrıldı, satır hazır/);
});

test("tüketim defter hatası verirse ilk başlatma geri alınır", async () => {
  // Kısıt kaldırılacağı için ortak veritabanı değil, bu teste ait yeni bir veritabanı kullanılır.
  await setup(await createTestDb({ fresh: true }));
  await reserveMaterials();
  // Eldeki stok ayrılmışın altına düşürülür: tüketim defterde reddedilir.
  await db.execute(sql`alter table materials drop constraint materials_reserved_check`);
  await db.update(materials).set({ onHandMilli: 0 }).where(eq(materials.id, materialId));
  const movements = (await db.select().from(stockMovements)).length;
  const audits = (await db.select().from(auditLog)).length;

  await expect(startNextStep(atolye, workOrderId)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  expect((await steps()).every((s) => s.startedAt === null)).toBe(true);
  const wo = await workOrder();
  expect(wo.status).toBe("planned");
  expect(wo.startedAt).toBeNull();
  expect((await db.select().from(stockMovements)).length).toBe(movements);
  expect((await db.select().from(auditLog)).length).toBe(audits);
});

test("önceki testler ortak veritabanının kısıtlarını kalıcı değiştirmez", async () => {
  const found = await db.execute(sql`select 1 from pg_constraint where conname = 'materials_reserved_check'`);
  expect(found.rows).toHaveLength(1);
});
