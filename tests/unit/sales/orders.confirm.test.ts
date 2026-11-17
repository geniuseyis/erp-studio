import { asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { materials, productMovements, products, salesOrderLines, salesOrders, stockMovements, workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { produceIn } from "@/domain/production/productLedger";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let depo: Ctx;
let customerId: string;
let productId: string;
const DUE = new Date("2026-12-01T12:00:00+03:00");
const ref = { type: "test", id: "kurulum" };

const later = (ctx: Ctx, minutes: number): Ctx => ({ ...ctx, now: new Date(NOW.getTime() + minutes * 60_000) });

async function material(id: string) {
  const [m] = await db.select().from(materials).where(eq(materials.id, id));
  if (!m) throw new Error("malzeme yok");
  return m;
}
async function product(id: string) {
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) throw new Error("mamul yok");
  return p;
}
async function linesOf(orderId: string) {
  return db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.createdAt));
}
async function orderOf(...items: { productId: string; qtyMilli: number }[]) {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  for (const [i, item] of items.entries()) await addLine(later(satis, i), { orderId: o.id, ...item });
  return o;
}
/** İş emri ancak rotalı ürüne açılır: tek adımlık rota. */
async function route(id: string) {
  await addRouting(db, { productId: id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
}
async function stock(materialId: string, qtyMilli: number) {
  await receiveStock(depo, { materialId, qtyMilli, unitCostKurus: 100 });
}

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  customerId = (await addCustomer(db)).id;
  productId = (await addProduct(db)).id;
});

test("mamul stoğu yeterse satır ready, iş emri açılmaz", async () => {
  await produceIn(satis, { productId, qtyMilli: 3000, ref });
  const o = await orderOf({ productId, qtyMilli: 2000 });

  const { order, shortages } = await confirmOrder(later(satis, 60), o.id);

  expect(shortages).toEqual([]);
  expect(order).toMatchObject({ status: "ready", confirmedAt: later(satis, 60).now });
  const [line] = await linesOf(o.id);
  expect(line).toMatchObject({ status: "ready", reservedMilli: 2000 });
  expect(await product(productId)).toMatchObject({ onHandMilli: 3000, reservedMilli: 2000 });
  const reserve = (await db.select().from(productMovements)).find((m) => m.type === "reserve");
  expect(reserve).toMatchObject({ refType: "sales_order_line", refId: line?.id, deltaReservedMilli: 2000 });
  expect(await db.select().from(workOrders)).toHaveLength(0);
});

test("mamul kısmen yeterse eldeki ayrılır, kalan için iş emri açılır", async () => {
  await route(productId);
  await produceIn(satis, { productId, qtyMilli: 1000, ref });
  const o = await orderOf({ productId, qtyMilli: 3000 });

  const { order } = await confirmOrder(satis, o.id);

  const [line] = await linesOf(o.id);
  expect(line).toMatchObject({ reservedMilli: 1000, status: "in_production" });
  const wos = await db.select().from(workOrders);
  expect(wos).toHaveLength(1);
  expect(wos[0]).toMatchObject({
    code: "IE-2026-0001",
    productId,
    qtyMilli: 2000,
    salesOrderLineId: line?.id,
    status: "planned",
    materialsReserved: true,
    createdBy: satis.user.id,
  });
  expect(order.status).toBe("in_production");
});

test("malzeme yeterse iş emri malzemeleri fire dahil ayrılır", async () => {
  await route(productId);
  const panel = await addMaterial(db, { unit: "plaka" });
  const boya = await addMaterial(db, { unit: "L" });
  await addBomLine(db, { productId, materialId: panel.id, qtyMilli: 340, scrapPermille: 150 });
  await addBomLine(db, { productId, materialId: boya.id, qtyMilli: 125 }); // 2 × 0,125 L = 0,25 → 0,3 L
  await stock(panel.id, 5000);
  await stock(boya.id, 1000);
  const o = await orderOf({ productId, qtyMilli: 2000 });

  const { shortages } = await confirmOrder(satis, o.id);

  expect(shortages).toEqual([]);
  expect((await material(panel.id)).reservedMilli).toBe(1000); // 0,34 × 2 × 1,15 = 0,782 → 1 plaka
  expect((await material(boya.id)).reservedMilli).toBe(300);
  const [wo] = await db.select().from(workOrders);
  expect(wo?.materialsReserved).toBe(true);
  const reserves = (await db.select().from(stockMovements)).filter((m) => m.type === "reserve");
  expect(reserves).toHaveLength(2);
  expect(reserves.every((m) => m.refType === "work_order" && m.refId === wo?.id)).toBe(true);
  expect((await linesOf(o.id))[0]?.status).toBe("in_production");
});

test("bir malzeme yetmezse hiçbiri ayrılmaz, satır waiting_material, eksik döner", async () => {
  await route(productId);
  const panel = await addMaterial(db, { unit: "plaka", code: "PNL-01", name: "Beyaz panel" });
  const vida = await addMaterial(db, { unit: "adet", code: "VDA-01", name: "Vida" });
  await addBomLine(db, { productId, materialId: panel.id, qtyMilli: 1000 });
  await addBomLine(db, { productId, materialId: vida.id, qtyMilli: 8000 });
  await stock(panel.id, 10_000);
  await stock(vida.id, 10_000);
  const o = await orderOf({ productId, qtyMilli: 2000 });

  const { order, shortages } = await confirmOrder(satis, o.id);

  expect(shortages).toEqual([
    { materialId: vida.id, code: "VDA-01", name: "Vida", unit: "adet", neededMilli: 16_000, availableMilli: 10_000 },
  ]);
  expect((await material(panel.id)).reservedMilli).toBe(0);
  expect((await material(vida.id)).reservedMilli).toBe(0);
  expect((await db.select().from(stockMovements)).filter((m) => m.type === "reserve")).toHaveLength(0);
  const [wo] = await db.select().from(workOrders);
  expect(wo).toMatchObject({ materialsReserved: false, status: "planned" });
  expect((await linesOf(o.id))[0]?.status).toBe("waiting_material");
  expect(order).toMatchObject({ status: "confirmed", confirmedAt: NOW });
});

test("ikinci onay INVALID_STATE; ayırma ve iş emri sayısı değişmez", async () => {
  await route(productId);
  await produceIn(satis, { productId, qtyMilli: 1000, ref });
  const o = await orderOf({ productId, qtyMilli: 3000 });
  await confirmOrder(satis, o.id);
  const before = {
    product: await product(productId),
    movements: (await db.select().from(productMovements)).length,
    workOrders: (await db.select().from(workOrders)).length,
    steps: (await db.select().from(workOrderSteps)).length,
  };

  await expect(confirmOrder(satis, o.id)).rejects.toMatchObject({ code: "INVALID_STATE", message: "Sipariş zaten onaylanmış" });

  expect(await product(productId)).toEqual(before.product);
  expect((await db.select().from(productMovements)).length).toBe(before.movements);
  expect((await db.select().from(workOrders)).length).toBe(before.workOrders);
  expect((await db.select().from(workOrderSteps)).length).toBe(before.steps);
});

test("eldeki 2 adet iki siparişe: ilki 2'yi alır, ikincisi iş emri açar", async () => {
  await route(productId);
  await produceIn(satis, { productId, qtyMilli: 2000, ref });
  const first = await orderOf({ productId, qtyMilli: 2000 });
  const second = await orderOf({ productId, qtyMilli: 2000 });

  await confirmOrder(satis, first.id);
  await confirmOrder(satis, second.id);

  expect((await linesOf(first.id))[0]).toMatchObject({ status: "ready", reservedMilli: 2000 });
  const [secondLine] = await linesOf(second.id);
  expect(secondLine).toMatchObject({ status: "in_production", reservedMilli: 0 });
  const wos = await db.select().from(workOrders);
  expect(wos).toHaveLength(1);
  expect(wos[0]).toMatchObject({ qtyMilli: 2000, salesOrderLineId: secondLine?.id });
  expect(await product(productId)).toMatchObject({ onHandMilli: 2000, reservedMilli: 2000 });
});

test("satış uzmanı onaylar; atölye kullanıcısı onaylayamaz", async () => {
  await produceIn(satis, { productId, qtyMilli: 1000, ref });
  const o = await orderOf({ productId, qtyMilli: 1000 });
  const atolye = ctxFor(db, await addUser(db, "atolye", "mudur"));
  await expect(confirmOrder(atolye, o.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const [stored] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
  expect(stored?.status).toBe("draft");
  expect((await confirmOrder(satis, o.id)).order.status).toBe("ready");
});

test("rota adımları dakikası adetle çarpılır", async () => {
  const kesim = await addStation(db);
  const montaj = await addStation(db);
  await addRouting(db, { productId, seq: 20, stationId: montaj.id, minutesPerUnit: 45 });
  await addRouting(db, { productId, seq: 10, stationId: kesim.id, minutesPerUnit: 30 });
  const o = await orderOf({ productId, qtyMilli: 3000 });

  await confirmOrder(satis, o.id);

  const [wo] = await db.select().from(workOrders);
  const steps = await db.select().from(workOrderSteps).orderBy(asc(workOrderSteps.seq));
  expect(steps.map((s) => ({ workOrderId: s.workOrderId, seq: s.seq, stationId: s.stationId, minutes: s.minutes, plannedDay: s.plannedDay }))).toEqual([
    { workOrderId: wo?.id, seq: 10, stationId: kesim.id, minutes: 90, plannedDay: null },
    { workOrderId: wo?.id, seq: 20, stationId: montaj.id, minutes: 135, plannedDay: null },
  ]);
});

test("rotasız ürün üretilecekse onay reddedilir; mamul ayırması dahil hiçbir şey yazılmaz", async () => {
  const routed = (await addProduct(db)).id;
  await route(routed);
  await produceIn(satis, { productId: routed, qtyMilli: 1000, ref });
  const o = await orderOf({ productId: routed, qtyMilli: 1000 }, { productId, qtyMilli: 1000 });
  await expect(confirmOrder(satis, o.id)).rejects.toMatchObject({ code: "VALIDATION", message: "Ürünün rotası tanımlı değil" });
  expect((await db.select().from(salesOrders).where(eq(salesOrders.id, o.id)))[0]?.status).toBe("draft");
  expect((await product(routed)).reservedMilli).toBe(0);
  expect(await db.select().from(workOrders)).toHaveLength(0);
});

test("satırsız sipariş onaylanamaz; bilinmeyen sipariş NOT_FOUND", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await expect(confirmOrder(satis, o.id)).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(confirmOrder(satis, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("önceki satırın ayırdığı malzeme sonraki satırdan düşülür; eksikler sonunda toplanır", async () => {
  const other = (await addProduct(db)).id;
  const third = (await addProduct(db)).id;
  for (const id of [productId, other, third]) await route(id);
  const panel = await addMaterial(db, { unit: "plaka", code: "PNL-02", name: "Ceviz panel" });
  await addBomLine(db, { productId, materialId: panel.id, qtyMilli: 2000 });
  await addBomLine(db, { productId: other, materialId: panel.id, qtyMilli: 2000 });
  await addBomLine(db, { productId: third, materialId: panel.id, qtyMilli: 1000 });
  await stock(panel.id, 5000);
  // Satır 1: 4 plaka, yeter (kalan 1). Satır 2: 4 plaka, yetmez. Satır 3: 1 plaka, yeter (kalan 0).
  const o = await orderOf({ productId, qtyMilli: 2000 }, { productId: other, qtyMilli: 2000 }, { productId: third, qtyMilli: 1000 });

  const { order, shortages } = await confirmOrder(satis, o.id);

  expect((await linesOf(o.id)).map((l) => l.status)).toEqual(["in_production", "waiting_material", "in_production"]);
  expect((await material(panel.id)).reservedMilli).toBe(5000);
  // Eksik, bütün satırlar işlendikten sonraki duruma göre: bekleyen 4 plaka, boşta 0.
  expect(shortages).toEqual([
    { materialId: panel.id, code: "PNL-02", name: "Ceviz panel", unit: "plaka", neededMilli: 4000, availableMilli: 0 },
  ]);
  expect(order.status).toBe("confirmed");
});
