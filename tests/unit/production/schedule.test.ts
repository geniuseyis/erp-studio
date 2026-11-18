import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { stationLoad, weekPlan, weekStartOf } from "@/domain/production/schedule";
import { planWorkOrder } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addCustomer, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let planlama: Ctx;
let stationIds: string[];
let productId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);
const MON = day("2026-11-16");

// Üç istasyonlu rota (her biri birim başına 20 dk). Malzeme bekleyen iş emirleri açılır; adım dakikası = 20 × miktar.
beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  productId = (await addProduct(db, { name: "Sükût Komodin" })).id;
  stationIds = [];
  for (let seq = 1; seq <= 3; seq += 1) {
    const st = await addStation(db, { dailyCapacityMin: 100 * seq });
    stationIds.push(st.id);
    await addRouting(db, { productId, seq, stationId: st.id, minutesPerUnit: 20 });
  }
});

async function openOrder(due: string, qtyMilli = 1000) {
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day(due) });
  await addLine(satis, { orderId: o.id, productId, qtyMilli });
  await confirmOrder(satis, o.id);
  const rows = await db.select().from(workOrders);
  return { order: o, wo: rows.find((w) => !planned.has(w.id))! };
}
const planned = new Set<string>();
async function planned1(due: string, start: Date, qtyMilli = 1000) {
  const { wo } = await openOrder(due, qtyMilli);
  planned.add(wo.id);
  await planWorkOrder(planlama, { workOrderId: wo.id, start });
  return wo;
}
function cellOf(plan: Awaited<ReturnType<typeof weekPlan>>, stationIndex: number, ymd: string) {
  const c = plan.cells.find((x) => x.stationId === stationIds[stationIndex] && x.day.getTime() === day(ymd).getTime());
  if (!c) throw new Error("hücre yok");
  return c;
}

beforeEach(() => planned.clear());

test("hücre yükü planlı ve bitmemiş adımların dakika toplamı", async () => {
  await planned1("2026-12-15", MON, 1000);
  await planned1("2026-12-15", MON, 2000);
  const plan = await weekPlan(db, MON);
  const cell = cellOf(plan, 0, "2026-11-16");
  expect(cell.steps).toHaveLength(2);
  expect(cell.loadMinutes).toBe(20 + 40);
  expect(cell.capacityMin).toBe(100);
  expect(cellOf(plan, 1, "2026-11-17").loadMinutes).toBe(60);
  expect(cellOf(plan, 1, "2026-11-16").loadMinutes).toBe(0);
  expect(plan.days).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map(day));
  expect(plan.cells).toHaveLength(15);
  expect(plan.stations.map((s) => s.capacityMin)).toEqual([100, 200, 300]);
  expect(await stationLoad(db, stationIds[0]!, MON)).toBe(60);
});

test("biten adım kart olarak kalır ama yükten düşer; çalışan adım yüke girer ve movable değildir", async () => {
  const wo = await planned1("2026-12-15", MON, 1000);
  const [s1, s2] = await db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, wo.id)).orderBy(workOrderSteps.seq);
  await db.update(workOrderSteps).set({ startedAt: day("2026-11-16"), finishedAt: day("2026-11-16") }).where(eq(workOrderSteps.id, s1!.id));
  await db.update(workOrderSteps).set({ startedAt: day("2026-11-17") }).where(eq(workOrderSteps.id, s2!.id));
  await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, wo.id));
  const plan = await weekPlan(db, MON);
  const done = cellOf(plan, 0, "2026-11-16");
  expect(done.steps.map((s) => s.state)).toEqual(["done"]);
  expect(done.loadMinutes).toBe(0);
  const running = cellOf(plan, 1, "2026-11-17");
  expect(running.steps[0]).toMatchObject({ state: "running", movable: false, position: 2, totalSteps: 3 });
  expect(running.loadMinutes).toBe(20);
  const next = cellOf(plan, 2, "2026-11-18");
  expect(next.steps[0]).toMatchObject({ state: "planned", movable: true, position: 3 });
});

test("son adımı terminden sonraya düşen iş emrinin bütün kartları late", async () => {
  await planned1("2026-11-17", MON); // son adım çarşamba > termin salı
  await planned1("2026-11-18", MON); // son adım çarşamba = termin çarşamba
  const plan = await weekPlan(db, MON);
  const first = plan.cells.filter((c) => c.steps.length).flatMap((c) => c.steps);
  const late = first.filter((s) => s.late);
  expect(late).toHaveLength(3);
  expect(new Set(late.map((s) => s.workOrderId)).size).toBe(1);
  expect(first.filter((s) => !s.late)).toHaveLength(3);
});

test("siparişi olmayan iş emri hiçbir zaman late değildir", async () => {
  const wo = await planned1("2026-11-17", MON);
  await db.update(workOrders).set({ salesOrderLineId: null }).where(eq(workOrders.id, wo.id));
  const plan = await weekPlan(db, MON);
  expect(plan.cells.flatMap((c) => c.steps).every((s) => !s.late && s.dueAt === null)).toBe(true);
});

test("başlamış adım movable değil", async () => {
  const wo = await planned1("2026-12-15", MON);
  const [s1] = await db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, wo.id)).orderBy(workOrderSteps.seq);
  await db.update(workOrderSteps).set({ startedAt: day("2026-11-16") }).where(eq(workOrderSteps.id, s1!.id));
  const plan = await weekPlan(db, MON);
  expect(cellOf(plan, 0, "2026-11-16").steps[0]).toMatchObject({ state: "running", movable: false });
});

test("iptal edilen iş emri planda görünmez; planlanmamış açık iş emirleri unscheduled sayılır", async () => {
  const cancelled = await planned1("2026-12-15", MON);
  await db.update(workOrders).set({ status: "cancelled" }).where(eq(workOrders.id, cancelled.id));
  await openOrder("2026-12-15"); // planlanmamış, adımlarının günü boş
  const plan = await weekPlan(db, MON);
  expect(plan.cells.flatMap((c) => c.steps)).toHaveLength(0);
  expect(plan.unscheduled).toBe(1);
});

test("hücre sırası: çalışan, planlı, biten; sonra iş emri kodu", async () => {
  const a = await planned1("2026-12-15", MON);
  const b = await planned1("2026-12-15", MON);
  const [bs1] = await db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, b.id)).orderBy(workOrderSteps.seq);
  await db.update(workOrderSteps).set({ startedAt: day("2026-11-16") }).where(eq(workOrderSteps.id, bs1!.id));
  const cell = cellOf(await weekPlan(db, MON), 0, "2026-11-16");
  expect(cell.steps.map((s) => [s.workOrderId, s.state])).toEqual([
    [b.id, "running"],
    [a.id, "planned"],
  ]);
});

test("weekStartOf pazar 23:30 İstanbul → o haftanın pazartesisi; pazartesi 00:00 → aynı gün", () => {
  expect(weekStartOf(new Date("2026-11-22T23:30:00+03:00"))).toEqual(MON);
  expect(weekStartOf(new Date("2026-11-16T00:00:00+03:00"))).toEqual(MON);
  expect(weekStartOf(new Date("2026-11-18T15:00:00+03:00"))).toEqual(MON);
  expect(weekStartOf(new Date("2026-11-23T00:00:00+03:00"))).toEqual(day("2026-11-23"));
});

test("haftalık plan sabit sayıda sorgu çalıştırır (40 iş emrinde ≤ 4)", async () => {
  async function selects(): Promise<number> {
    const spy = vi.spyOn(db, "select");
    try {
      await weekPlan(db, MON);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }
  for (let i = 0; i < 2; i += 1) await planned1("2026-12-15", MON);
  const few = await selects();
  for (let i = 0; i < 38; i += 1) await planned1("2026-12-15", MON);
  const many = await selects();
  expect(many).toBe(few);
  expect(many).toBeLessThanOrEqual(4);
  expect((await weekPlan(db, MON)).cells.flatMap((c) => c.steps)).toHaveLength(120);
}, 60_000);
