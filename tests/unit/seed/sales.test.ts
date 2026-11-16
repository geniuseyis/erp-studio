import { asc } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  bomLines,
  customers,
  materials,
  productMovements,
  products,
  routings,
  salesOrderLines,
  salesOrders,
  stations,
  stockMovements,
  workOrders,
  workOrderSteps,
} from "@/db/schema";
import { verifyLedger } from "@/domain/inventory/ledger";
import { isWorkday } from "@/domain/production/calendar";
import { verifyProductLedger } from "@/domain/production/productLedger";
import { getWorkOrder, stationQueue } from "@/domain/production/queries";
import { listOrders } from "@/domain/sales/queries";
import { seedBase } from "@/seed/base";
import { SEED_PRODUCTS, STATIONS } from "@/seed/data/products";
import { seedSales } from "@/seed/sales";
import { SNAPSHOT_NOW } from "@/seed/snapshot";
import { createTestDb } from "../../helpers/testDb";

const now = SNAPSHOT_NOW;
let a: Db;
let b: Db;

beforeAll(async () => {
  a = await createTestDb({ fresh: true });
  b = await createTestDb({ fresh: true });
  for (const db of [a, b]) {
    await seedBase(db, { now });
    await seedSales(db, { now });
  }
}, 300_000);

test("iki defter tutarlı", async () => {
  expect(await verifyLedger(a)).toEqual([]);
  expect(await verifyProductLedger(a)).toEqual([]);
});

test("40 ürün, 6 istasyon, 25 müşteri", async () => {
  expect(await a.select().from(stations)).toHaveLength(6);
  const rows = await a.select().from(products).orderBy(asc(products.code));
  expect(rows.map((p) => [p.code, p.priceKurus, p.vatRate])).toEqual(SEED_PRODUCTS.map((p) => [p.code, p.priceKurus, p.vatRate]));
  expect(await a.select().from(bomLines)).toHaveLength(SEED_PRODUCTS.reduce((n, p) => n + p.bom.length, 0));
  expect(await a.select().from(routings)).toHaveLength(SEED_PRODUCTS.reduce((n, p) => n + p.routing.length, 0));

  const list = await a.select().from(customers);
  expect(list).toHaveLength(25);
  expect(list.filter((c) => c.kind === "bireysel")).toHaveLength(15);
  expect(list.filter((c) => c.kind === "kurumsal")).toHaveLength(10);
  expect(list.every((c) => /^0 5\d\d 000 00 \d\d$/.test(c.phone))).toBe(true);
  expect(list.filter((c) => c.kind === "bireysel").every((c) => c.paymentTermDays === 0)).toBe(true);
  expect(list.filter((c) => c.kind === "kurumsal").every((c) => [30, 45, 60].includes(c.paymentTermDays))).toBe(true);
});

test("her durumdan en az bir sipariş var", async () => {
  const rows = await listOrders(a, { now });
  for (const status of ["draft", "in_production", "ready", "shipped", "cancelled"] as const) {
    expect(rows.filter((o) => o.status === status).length, status).toBeGreaterThanOrEqual(1);
  }
  expect(rows.filter((o) => o.status === "confirmed" && o.waitingMaterial).length).toBeGreaterThanOrEqual(1);
});

test("malzeme bekleyen iş emirlerinin eksiği yalnızca kritik arkalık", async () => {
  const waiting = (await a.select().from(workOrders)).filter((w) => w.status === "planned" && !w.materialsReserved);
  expect(waiting.length).toBeGreaterThanOrEqual(1);
  for (const w of waiting) {
    const detail = await getWorkOrder(a, w.id);
    expect(detail?.shortages.map((s) => s.name)).toEqual(["MDF Lam 8 mm Beyaz Arkalık 2100×2800"]);
  }
});

test("en az iki geciken sipariş", async () => {
  const rows = await listOrders(a, { now });
  expect(rows.filter((o) => o.overdue).length).toBeGreaterThanOrEqual(2);
});

test("her istasyonun kuyruğunda en az bir iş", async () => {
  for (const s of STATIONS) {
    expect((await stationQueue(a, s.code)).length, s.code).toBeGreaterThanOrEqual(1);
  }
});

test("bütün sipariş, iş emri ve hareket zamanları mesai içinde ve şimdiden önce", async () => {
  const istanbulHour = (d: Date) => (d.getUTCHours() + 3) % 24;
  const times: Date[] = [];
  const add = (...list: (Date | null)[]) => {
    for (const d of list) if (d) times.push(d);
  };
  const orders = await a.select().from(salesOrders);
  for (const o of orders) add(o.createdAt, o.confirmedAt, o.shippedAt, o.cancelledAt);
  const lines = await a.select().from(salesOrderLines);
  for (const l of lines) add(l.createdAt);
  for (const w of await a.select().from(workOrders)) add(w.createdAt, w.startedAt, w.completedAt);
  for (const s of await a.select().from(workOrderSteps)) add(s.startedAt, s.finishedAt);
  for (const m of await a.select().from(productMovements)) add(m.createdAt);
  // Temel verinin malzeme hareketleri (seedBase) takvim günlerine yayılır; burada satış ve üretimin yazdıkları denetlenir.
  const ours = (await a.select().from(stockMovements)).filter((m) => m.refType === "work_order" || m.note === "Tedarikçi irsaliyesi");
  for (const m of ours) add(m.createdAt);

  expect(ours.length).toBeGreaterThan(500);
  for (const t of times) {
    expect(t.getTime(), t.toISOString()).toBeLessThan(now.getTime());
    expect(isWorkday(t), t.toISOString()).toBe(true);
    expect(istanbulHour(t), t.toISOString()).toBeGreaterThanOrEqual(8);
    expect(istanbulHour(t), t.toISOString()).toBeLessThan(18);
  }
  // Onay satırları oluşturulma anına göre sıralar; iki satır aynı anda açılmaz.
  expect(new Set(lines.map((l) => l.createdAt.getTime())).size).toBe(lines.length);
  expect(new Set(orders.map((o) => o.createdAt.getTime())).size).toBe(orders.length);
});

test("aynı tohum aynı veriyi üretir", async () => {
  const projection = async (db: Db) => {
    const productCode = new Map((await db.select().from(products)).map((p) => [p.id, p.code]));
    const customerCode = new Map((await db.select().from(customers)).map((c) => [c.id, c.code]));
    const orderCode = new Map((await db.select().from(salesOrders)).map((o) => [o.id, o.code]));
    const materialCode = new Map((await db.select().from(materials)).map((m) => [m.id, m.code]));
    const woCode = new Map((await db.select().from(workOrders)).map((w) => [w.id, w.code]));
    const ms = (d: Date | null) => d?.getTime() ?? null;
    return {
      customers: (await db.select().from(customers).orderBy(asc(customers.code))).map((c) => [c.code, c.name, c.kind, c.city, c.district, c.phone]),
      products: (await db.select().from(products).orderBy(asc(products.code))).map((p) => [p.code, p.onHandMilli, p.reservedMilli]),
      orders: (await db.select().from(salesOrders).orderBy(asc(salesOrders.code))).map((o) => [
        o.code,
        customerCode.get(o.customerId),
        o.status,
        ms(o.dueAt),
        ms(o.createdAt),
        ms(o.confirmedAt),
        ms(o.shippedAt),
        ms(o.cancelledAt),
      ]),
      lines: (await db.select().from(salesOrderLines))
        .map((l) => [orderCode.get(l.orderId), productCode.get(l.productId), l.qtyMilli, l.status, l.reservedMilli, ms(l.createdAt)])
        .sort((x, y) => Number(x[5]) - Number(y[5])),
      workOrders: (await db.select().from(workOrders).orderBy(asc(workOrders.code))).map((w) => [
        w.code,
        productCode.get(w.productId),
        w.qtyMilli,
        w.status,
        w.materialsReserved,
        ms(w.plannedStart),
        ms(w.startedAt),
        ms(w.completedAt),
      ]),
      steps: (await db.select().from(workOrderSteps))
        .map((s) => [woCode.get(s.workOrderId), s.seq, s.minutes, ms(s.plannedDay), ms(s.startedAt), ms(s.finishedAt)])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])) || Number(x[1]) - Number(y[1])),
      productMovements: (await db.select().from(productMovements).orderBy(asc(productMovements.seq))).map((m) => [
        productCode.get(m.productId),
        m.type,
        m.deltaOnHandMilli,
        m.deltaReservedMilli,
        m.refType,
        ms(m.createdAt),
      ]),
      // Bir iş emrinin tüketim satırları aynı anda yazılır ve aralarındaki sıra sabit değildir; anla, türle ve malzemeyle sıralanır.
      stockMovements: (await db.select().from(stockMovements))
        .map((m) => [ms(m.createdAt), m.type, materialCode.get(m.materialId), m.deltaOnHandMilli, m.deltaReservedMilli, m.unitCostKurus, m.note])
        .sort((x, y) => Number(x[0]) - Number(y[0]) || String(x[1]).localeCompare(String(y[1])) || String(x[2]).localeCompare(String(y[2]))),
    };
  };
  expect(await projection(a)).toEqual(await projection(b));
});
