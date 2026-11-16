import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { salesOrderLines, salesOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { getCustomer, getOrder, listCustomers, listOrders, salesSummary } from "@/domain/sales/queries";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let depo: Ctx;
let productId: string;
let materialId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman", { name: "Selin Aksoy" }));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  productId = (await addProduct(db, { priceKurus: 100_000, vatRate: 10 })).id;
  await addRouting(db, { productId, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  materialId = (await addMaterial(db, { unit: "plaka" })).id;
  await addBomLine(db, { productId, materialId, qtyMilli: 1000 });
});

async function draft(customerName: string, dueAt = "2026-12-15", qty = 1000) {
  const customer = await addCustomer(db, { name: customerName });
  const order = await createOrder(satis, { customerId: customer.id, dueAt: day(dueAt) });
  await addLine(satis, { orderId: order.id, productId, qtyMilli: qty });
  return { customer, order };
}

test("sipariş toplamı satırların toplamına eşit, iptal satır hariç", async () => {
  const { order } = await draft("Ayşe Kaya", "2026-12-15", 2000);
  const p2 = await addProduct(db, { priceKurus: 50_000, vatRate: 20 });
  await addLine(satis, { orderId: order.id, productId: p2.id, qtyMilli: 1000 });
  const before = await getOrder(db, order.id);
  expect(before?.netKurus).toBe(250_000);
  expect(before?.totalKurus).toBe(220_000 + 60_000);
  expect(before?.lineCount).toBe(2);

  await db.update(salesOrderLines).set({ status: "cancelled" }).where(eq(salesOrderLines.productId, p2.id));
  const after = await getOrder(db, order.id);
  expect(after?.netKurus).toBe(200_000);
  expect(after?.lineCount).toBe(1);
  expect(after?.lines).toHaveLength(2);
  expect((await listOrders(db))[0]?.lineCount).toBe(1);
  expect(after?.totalKurus).toBe(220_000);
  expect(after?.totals.totalKurus).toBe(after?.totalKurus);
  expect(after?.lines.map((l) => l.netKurus).sort((a, b) => a - b)).toEqual([50_000, 200_000]);
  expect(after?.createdByName).toBe("Selin Aksoy");
  expect(after?.customer.name).toBe("Ayşe Kaya");
});

test("geciken sipariş: termin geçmiş ve sevk edilmemiş", async () => {
  const { order } = await draft("A", "2026-12-15");
  await confirmOrder(satis, order.id);
  const now = day("2026-12-16");
  expect((await listOrders(db, { now }))[0]?.overdue).toBe(true);
  expect((await listOrders(db, { now: day("2026-12-14") }))[0]?.overdue).toBe(false);
  await db.update(salesOrders).set({ status: "draft" }).where(eq(salesOrders.id, order.id));
  expect((await listOrders(db, { now }))[0]?.overdue).toBe(false);
  await db.update(salesOrders).set({ status: "confirmed" }).where(eq(salesOrders.id, order.id));
  await db.update(salesOrders).set({ status: "shipped" }).where(eq(salesOrders.id, order.id));
  expect((await listOrders(db, { now }))[0]?.overdue).toBe(false);
  await db.update(salesOrders).set({ status: "cancelled" }).where(eq(salesOrders.id, order.id));
  expect((await listOrders(db, { now }))[0]?.overdue).toBe(false);
});

test("malzeme bekleyen sipariş işaretlenir; stoklu sipariş işaretlenmez", async () => {
  const { order } = await draft("A");
  await confirmOrder(satis, order.id);
  const waiting = await getOrder(db, order.id);
  expect(waiting?.waitingMaterial).toBe(true);
  expect(waiting?.lines[0]?.workOrder).toMatchObject({ materialsReserved: false, status: "planned" });

  await receiveStock(depo, { materialId, qtyMilli: 5000, unitCostKurus: 100 });
  const { order: ok } = await draft("B");
  await confirmOrder(satis, ok.id);
  const detail = await getOrder(db, ok.id);
  expect(detail?.waitingMaterial).toBe(false);
  expect(detail?.lines[0]?.workOrder?.materialsReserved).toBe(true);
});

test("liste yeniden eskiye gider; durum, müşteri ve arama süzer", async () => {
  const a = await draft("Çiğdem Şahin");
  const b = await draft("Bora Demir");
  await db.update(salesOrders).set({ createdAt: day("2026-11-01") }).where(eq(salesOrders.id, a.order.id));
  await db.update(salesOrders).set({ createdAt: day("2026-11-02") }).where(eq(salesOrders.id, b.order.id));
  expect((await listOrders(db)).map((o) => o.customerName)).toEqual(["Bora Demir", "Çiğdem Şahin"]);
  expect((await listOrders(db, { search: "cigdem" })).map((o) => o.customerName)).toEqual(["Çiğdem Şahin"]);
  expect((await listOrders(db, { search: a.order.code.toLowerCase() })).map((o) => o.id)).toEqual([a.order.id]);
  expect((await listOrders(db, { customerId: b.customer.id })).map((o) => o.id)).toEqual([b.order.id]);
  await confirmOrder(satis, b.order.id);
  expect((await listOrders(db, { status: "draft" })).map((o) => o.id)).toEqual([a.order.id]);
  expect(await getOrder(db, "not-a-uuid")).toBeNull();
});

test("müşteri satırı: sipariş sayısı, açık sipariş tutarı, son sipariş", async () => {
  const a = await draft("Ayşe Kaya", "2026-12-15", 2000);
  await confirmOrder(satis, a.order.id);
  const second = await createOrder(satis, { customerId: a.customer.id, dueAt: day("2026-12-20") });
  await addLine(satis, { orderId: second.id, productId, qtyMilli: 1000 });
  await draft("Bora Demir");

  const row = await getCustomer(db, a.customer.id);
  expect(row?.orderCount).toBe(2);
  expect(row?.openOrderTotalKurus).toBe(220_000);
  expect(row?.lastOrderAt).toBeInstanceOf(Date);

  const empty = await addCustomer(db, { name: "Yeni Müşteri", kind: "kurumsal", city: "Kütahya" });
  expect((await getCustomer(db, empty.id))?.lastOrderAt).toBeNull();
  expect((await getCustomer(db, empty.id))?.orderCount).toBe(0);
  expect((await listCustomers(db, { kind: "kurumsal" })).map((c) => c.name)).toEqual(["Yeni Müşteri"]);
  expect((await listCustomers(db, { search: "kutahya" })).map((c) => c.name)).toEqual(["Yeni Müşteri"]);
  expect((await listCustomers(db, { search: "bora" })).length).toBe(1);
});

test("salesSummary sayıları listOrders ile sayılanlara eşit", async () => {
  const a = await draft("A", "2026-12-15");
  const b = await draft("B", "2026-12-20", 2000);
  await draft("C", "2026-12-01");
  await confirmOrder(satis, a.order.id);
  await confirmOrder(satis, b.order.id);
  const now = day("2026-12-16");
  const rows = await listOrders(db, { now });
  const open = rows.filter((o) => ["confirmed", "in_production", "ready"].includes(o.status));
  const summary = await salesSummary(db, now);
  expect(summary).toEqual({
    openOrders: open.length,
    waitingMaterial: rows.filter((o) => o.waitingMaterial).length,
    overdue: rows.filter((o) => o.overdue).length,
    openTotalKurus: open.reduce((s, o) => s + o.totalKurus, 0),
  });
  expect(summary.openOrders).toBe(2);
  expect(summary.overdue).toBe(1);
  expect(rows.find((o) => o.status === "draft")?.overdue).toBe(false);
});
