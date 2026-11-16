import { asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { materials, salesOrderLines, salesOrders, workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { planWorkOrder, retryMaterials } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let planlama: Ctx;
let depo: Ctx;
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

// NOW: pazar 15 Kasım 2026. Ürünün 5 adımlı rotası ve 2 plakalık reçetesi var; malzeme stokta yok,
// bu yüzden onaylanan sipariş malzeme bekleyen bir iş emri açar.
beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  productId = (await addProduct(db)).id;
  for (let seq = 1; seq <= 5; seq += 1) {
    await addRouting(db, { productId, seq, stationId: (await addStation(db)).id, minutesPerUnit: 20 });
  }
  materialId = (await addMaterial(db, { unit: "plaka" })).id;
  await addBomLine(db, { productId, materialId, qtyMilli: 2000 });

  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day("2026-12-15") });
  orderId = o.id;
  await addLine(satis, { orderId, productId, qtyMilli: 1000 });
  await confirmOrder(satis, orderId);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  workOrderId = wo.id;
});

test("cuma başlayan 5 adım cuma, pzt, salı, çarşamba, perşembe", async () => {
  const wo = await planWorkOrder(planlama, { workOrderId, start: new Date("2026-11-20T14:00:00+03:00") });
  expect(wo.plannedStart).toEqual(day("2026-11-20"));
  expect((await steps()).map((s) => s.plannedDay)).toEqual([
    day("2026-11-20"),
    day("2026-11-23"),
    day("2026-11-24"),
    day("2026-11-25"),
    day("2026-11-26"),
  ]);
});

test("hafta sonu başlangıç sonraki iş gününden başlar", async () => {
  await planWorkOrder(planlama, { workOrderId, start: day("2026-11-21") });
  expect((await steps()).map((s) => s.plannedDay)).toEqual([
    day("2026-11-23"),
    day("2026-11-24"),
    day("2026-11-25"),
    day("2026-11-26"),
    day("2026-11-27"),
  ]);
});

test("geçmiş güne planlama reddedilir", async () => {
  await expect(planWorkOrder(planlama, { workOrderId, start: new Date("2026-11-14T23:59:00+03:00") })).rejects.toMatchObject({
    code: "VALIDATION",
  });
  expect((await steps()).every((s) => s.plannedDay === null)).toBe(true);
  // Bugünün erken saati geçmiş sayılmaz (pazar olduğu için ilk adım pazartesiye düşer).
  await planWorkOrder(planlama, { workOrderId, start: new Date("2026-11-15T00:30:00+03:00") });
  expect((await steps())[0]?.plannedDay).toEqual(day("2026-11-16"));
});

test("yeniden planlama önceki günlerin yerine yazar", async () => {
  await planWorkOrder(planlama, { workOrderId, start: day("2026-11-20") });
  await planWorkOrder(planlama, { workOrderId, start: day("2026-11-17") });
  expect((await steps()).map((s) => s.plannedDay)).toEqual([
    day("2026-11-17"),
    day("2026-11-18"),
    day("2026-11-19"),
    day("2026-11-20"),
    day("2026-11-23"),
  ]);
});

test("yalnızca planned iş emri planlanır", async () => {
  await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, workOrderId));
  await expect(planWorkOrder(planlama, { workOrderId, start: day("2026-11-20") })).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("planlama uzmanı planlar; satış planlayamaz", async () => {
  await expect(planWorkOrder(satis, { workOrderId, start: day("2026-11-20") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const operator = ctxFor(db, await addUser(db, "planlama", "operator"));
  await expect(planWorkOrder(operator, { workOrderId, start: day("2026-11-20") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await planWorkOrder(planlama, { workOrderId, start: day("2026-11-20") });
});

test("malzeme gelince yeniden deneme ayırır ve satırı in_production yapar", async () => {
  const [lineBefore] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  expect(lineBefore?.status).toBe("waiting_material");

  const stillShort = await retryMaterials(planlama, workOrderId);
  expect(stillShort.workOrder.materialsReserved).toBe(false);
  expect(stillShort.shortages).toMatchObject([{ materialId, neededMilli: 2000, availableMilli: 0 }]);

  await receiveStock(depo, { materialId, qtyMilli: 3000, unitCostKurus: 100 });
  const { workOrder: wo, shortages } = await retryMaterials(planlama, workOrderId);

  expect(shortages).toEqual([]);
  expect(wo.materialsReserved).toBe(true);
  const [m] = await db.select().from(materials).where(eq(materials.id, materialId));
  expect(m?.reservedMilli).toBe(2000);
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  expect(line?.status).toBe("in_production");
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  expect(order?.status).toBe("in_production");

  await expect(retryMaterials(planlama, workOrderId)).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("yeniden denemeyi satış yapamaz", async () => {
  await expect(retryMaterials(satis, workOrderId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await workOrder()).materialsReserved).toBe(false);
});
