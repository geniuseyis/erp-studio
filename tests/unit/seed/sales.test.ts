import { asc } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
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
import { DAY_MS as DAY, isWorkday, istanbulDayStart } from "@/domain/production/calendar";
import { verifyProductLedger } from "@/domain/production/productLedger";
import { getWorkOrder, kanbanColumns, listWorkOrders, stationQueue } from "@/domain/production/queries";
import { weekPlan, weekStartOf } from "@/domain/production/schedule";
import { listOrders } from "@/domain/sales/queries";
import { seedBase } from "@/seed/base";
import { SEED_PRODUCTS, STATIONS } from "@/seed/data/products";
import { seedSales } from "@/seed/sales";
import { exportSnapshot, loadSnapshot, SNAPSHOT_NOW } from "@/seed/snapshot";
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

test("her taslak siparişte en az iki satır var", async () => {
  const drafts = (await a.select().from(salesOrders)).filter((o) => o.status === "draft");
  expect(drafts.length).toBeGreaterThanOrEqual(1);
  const lines = await a.select().from(salesOrderLines);
  for (const d of drafts) expect(lines.filter((l) => l.orderId === d.id).length, d.code).toBeGreaterThanOrEqual(2);
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
      // Sıra numarasıyla: aynı anda yazılan tüketim satırlarının sırası da sabit olmalı.
      stockMovements: (await db.select().from(stockMovements).orderBy(asc(stockMovements.seq))).map((m) => [
        ms(m.createdAt),
        m.type,
        materialCode.get(m.materialId),
        m.deltaOnHandMilli,
        m.deltaReservedMilli,
        m.unitCostKurus,
        m.note,
      ]),
    };
  };
  expect(await projection(a)).toEqual(await projection(b));
});

describe("bu hafta senaryoları (örnek veri hangi gün açılırsa açılsın)", () => {
  // Anlık görüntü pazar günü alınır; yükleme tarihleri iş günü olarak kaydırır. Pazartesiden pazara her gün açılış denenir.
  const OPEN_DAYS = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
  const loads = new Map<string, { db: Db; now: Date }>();

  beforeAll(async () => {
    const snapshot = await exportSnapshot(a, SNAPSHOT_NOW);
    for (const day of OPEN_DAYS) {
      const opened = new Date(`${day}T10:00:00+03:00`);
      const db = await createTestDb({ fresh: true });
      await loadSnapshot(db, snapshot, opened);
      loads.set(day, { db, now: opened });
    }
  }, 300_000);

  const eachOpening = async (check: (db: Db, now: Date, label: string) => Promise<void>) => {
    for (const [day, { db, now: opened }] of loads) await check(db, opened, day);
  };

  test("haftanın planında en az bir hücre kapasiteyi aşıyor", async () => {
    await eachOpening(async (db, opened, day) => {
      const plan = await weekPlan(db, weekStartOf(opened));
      expect(plan.cells.some((c) => c.loadMinutes > c.capacityMin), day).toBe(true);
    });
  });

  test("en az bir iş emri, termininden sonraki güne planlı", async () => {
    await eachOpening(async (db, opened, day) => {
      const plan = await weekPlan(db, weekStartOf(opened));
      const late = plan.cells.flatMap((c) => c.steps).filter((s) => s.late && s.state !== "done");
      expect(late.length, day).toBeGreaterThanOrEqual(1);
    });
  });

  test("en az bir planlanmamış iş emri var ve planlanmamış süzgeci aynı sayıyı verir", async () => {
    await eachOpening(async (db, opened, day) => {
      const plan = await weekPlan(db, weekStartOf(opened));
      expect(plan.unscheduled, day).toBeGreaterThanOrEqual(1);
      expect((await listWorkOrders(db, { unscheduled: true })).length, day).toBe(plan.unscheduled);
    });
  });

  test("kanbanda Malzeme bekliyor sütununda planlı, malzemesi eksik en az bir iş emri var", async () => {
    await eachOpening(async (db, opened, day) => {
      const columns = await kanbanColumns(db, opened);
      const waiting = columns.find((c) => c.key === "waiting_material");
      expect(waiting?.items.length, day).toBeGreaterThanOrEqual(1);
      expect(
        waiting?.items.every((w) => w.status === "planned" && !w.materialsReserved),
        day,
      ).toBe(true);
    });
  });

  test("bugünden başlayan dört iş gününün her birinde ızgara dolu: toplam yük en az 1500 dakika, en az 4 istasyonda iş", async () => {
    await eachOpening(async (db, opened, day) => {
      const today = istanbulDayStart(opened).getTime();
      const thisWeek = weekStartOf(opened);
      const nextWeek = new Date(thisWeek.getTime() + 7 * DAY);
      const cells = [...(await weekPlan(db, thisWeek)).cells, ...(await weekPlan(db, nextWeek)).cells].filter((c) => c.day.getTime() >= today);
      const days = [...new Set(cells.map((c) => c.day.getTime()))].sort((x, y) => x - y).slice(0, 4);
      expect(days, day).toHaveLength(4);
      for (const d of days) {
        const ofDay = cells.filter((c) => c.day.getTime() === d);
        expect(
          ofDay.reduce((n, c) => n + c.loadMinutes, 0),
          `${day} ${new Date(d).toISOString()} yük`,
        ).toBeGreaterThanOrEqual(1500);
        expect(ofDay.filter((c) => c.loadMinutes > 0).length, `${day} ${new Date(d).toISOString()} istasyon`).toBeGreaterThanOrEqual(4);
      }
    });
  });
});

test("ürün adı kataloğun adıdır; kategori adda iki kez geçmez", async () => {
  const rows = await a.select().from(products).orderBy(asc(products.code));
  const first = rows.find((p) => p.code === "URN-0001");
  expect(first?.name).toBe("Eksen Gardırop");
  for (const p of rows) {
    expect(p.name, p.code).toBe(SEED_PRODUCTS.find((s) => s.code === p.code)?.name);
    expect(p.name.endsWith(`${p.category} ${p.category}`), p.name).toBe(false);
  }
});
