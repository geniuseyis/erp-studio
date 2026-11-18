import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { products, salesOrderLines, salesOrders, stations, workOrders, workOrderSteps } from "@/db/schema";
import { istanbulDayStart } from "./calendar";
import { stepPosition } from "./queries";

export type PlanStep = {
  workOrderId: string;
  code: string;
  productName: string;
  qtyMilli: number;
  seq: number;
  position: number;
  totalSteps: number;
  minutes: number;
  state: "planned" | "running" | "done";
  orderCode: string | null;
  dueAt: Date | null;
  /** İş emrinin son adımının planlı günü, termin gününden sonra (İstanbul günü). */
  late: boolean;
  /** Yalnızca başlamamış adım, açık (planlı ya da sürüyor) iş emrinde taşınabilir. */
  movable: boolean;
};
export type PlanCell = { stationId: string; day: Date; steps: PlanStep[]; loadMinutes: number; capacityMin: number };
export type WeekPlan = {
  weekStart: Date;
  days: Date[];
  stations: { id: string; code: string; name: string; capacityMin: number }[];
  cells: PlanCell[];
  unscheduled: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const STATE_ORDER = { running: 0, planned: 1, done: 2 } as const;

/** Verilen anın İstanbul haftasının pazartesisi, 00:00. */
export function weekStartOf(d: Date): Date {
  const start = istanbulDayStart(d);
  const weekday = new Date(start.getTime() + ISTANBUL_OFFSET_MS).getUTCDay(); // 0 pazar … 6 cumartesi
  return new Date(start.getTime() - ((weekday + 6) % 7) * DAY_MS);
}

/** İstasyonun o gündeki bitmemiş (planlı ve çalışan) adımlarının dakikası; iptal edilmiş iş emirleri sayılmaz. */
export async function stationLoad(db: Db, stationId: string, day: Date): Promise<number> {
  const start = istanbulDayStart(day);
  const [row] = await db
    .select({ minutes: sql<number>`coalesce(sum(${workOrderSteps.minutes}), 0)::int` })
    .from(workOrderSteps)
    .innerJoin(workOrders, eq(workOrders.id, workOrderSteps.workOrderId))
    .where(
      and(
        eq(workOrderSteps.stationId, stationId),
        gte(workOrderSteps.plannedDay, start),
        lt(workOrderSteps.plannedDay, new Date(start.getTime() + DAY_MS)),
        isNull(workOrderSteps.finishedAt),
        ne(workOrders.status, "cancelled"),
      ),
    );
  return row?.minutes ?? 0;
}

/**
 * Haftanın 5 iş günü × istasyon ızgarası. Dört sorgu, iş emri sayısından bağımsız: istasyonlar, haftanın adımları
 * (iş emri, ürün ve sipariş birleşimiyle), bu iş emirlerinin bütün adımları (sıra ve son adım günü için) ve
 * planlanmamış açık iş emirleri sayısı.
 */
export async function weekPlan(db: Db, weekStart: Date): Promise<WeekPlan> {
  const first = weekStartOf(weekStart);
  const days = Array.from({ length: 5 }, (_, i) => new Date(first.getTime() + i * DAY_MS));
  const end = new Date(first.getTime() + 5 * DAY_MS);

  const stationRows = await db.select().from(stations).orderBy(asc(stations.seq), asc(stations.code));
  const week = await db
    .select({ step: workOrderSteps, wo: workOrders, productName: products.name, orderCode: salesOrders.code, dueAt: salesOrders.dueAt })
    .from(workOrderSteps)
    .innerJoin(workOrders, eq(workOrders.id, workOrderSteps.workOrderId))
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(and(gte(workOrderSteps.plannedDay, first), lt(workOrderSteps.plannedDay, end), ne(workOrders.status, "cancelled")));

  const siblings = week.length
    ? await db
        .select({ id: workOrderSteps.id, workOrderId: workOrderSteps.workOrderId, plannedDay: workOrderSteps.plannedDay })
        .from(workOrderSteps)
        .where(inArray(workOrderSteps.workOrderId, [...new Set(week.map((r) => r.wo.id))]))
        .orderBy(asc(workOrderSteps.seq))
    : [];
  const byOrder = new Map<string, typeof siblings>();
  for (const s of siblings) byOrder.set(s.workOrderId, [...(byOrder.get(s.workOrderId) ?? []), s]);

  const [unscheduledRow] = await db
    .select({ n: sql<number>`count(distinct ${workOrders.id})::int` })
    .from(workOrders)
    .innerJoin(workOrderSteps, eq(workOrderSteps.workOrderId, workOrders.id))
    .where(and(inArray(workOrders.status, ["planned", "in_progress"]), isNull(workOrderSteps.plannedDay)));

  const cells = new Map<string, PlanCell>();
  for (const st of stationRows) {
    for (const d of days) cells.set(`${st.id}|${d.getTime()}`, { stationId: st.id, day: d, steps: [], loadMinutes: 0, capacityMin: st.dailyCapacityMin });
  }

  for (const r of week) {
    if (!r.step.plannedDay) continue;
    const cell = cells.get(`${r.step.stationId}|${istanbulDayStart(r.step.plannedDay).getTime()}`);
    if (!cell) continue;
    const all = byOrder.get(r.wo.id) ?? [];
    const lastDay = all[all.length - 1]?.plannedDay ?? null;
    const state: PlanStep["state"] = r.step.finishedAt ? "done" : r.step.startedAt ? "running" : "planned";
    cell.steps.push({
      workOrderId: r.wo.id,
      code: r.wo.code,
      productName: r.productName,
      qtyMilli: r.wo.qtyMilli,
      seq: r.step.seq,
      position: stepPosition(all, r.step.id),
      totalSteps: all.length,
      minutes: r.step.minutes,
      state,
      orderCode: r.orderCode,
      dueAt: r.dueAt,
      late: lastDay !== null && r.dueAt !== null && istanbulDayStart(lastDay).getTime() > istanbulDayStart(r.dueAt).getTime(),
      movable: state === "planned" && (r.wo.status === "planned" || r.wo.status === "in_progress"),
    });
    if (state !== "done") cell.loadMinutes += r.step.minutes;
  }
  for (const c of cells.values()) c.steps.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.code.localeCompare(b.code));

  return {
    weekStart: first,
    days,
    stations: stationRows.map((s) => ({ id: s.id, code: s.code, name: s.name, capacityMin: s.dailyCapacityMin })),
    cells: stationRows.flatMap((st) => days.map((d) => cells.get(`${st.id}|${d.getTime()}`)!)),
    unscheduled: unscheduledRow?.n ?? 0,
  };
}
