import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, products, routings, salesOrderLines, salesOrders, stations, workOrders, workOrderSteps } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { addWorkdays, istanbulDayStart, isWorkday, workdaysBetween } from "./calendar";
import { stepPosition } from "./queries";
import type { WorkOrderStep } from "./types";
import { materialNeeds } from "./workOrders";

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

export type MoveResult = { step: WorkOrderStep; loadMinutes: number; capacityMin: number; overCapacity: boolean };
type MoveInput = { workOrderId: string; seq: number; toDay: Date };

/** "20.11": İstanbul günü ve ayı. (tr-TR yerel ayarı yılsız biçimde "20/11" verir; elle yazılır.) */
function dayMonth(d: Date): string {
  const s = new Date(d.getTime() + ISTANBUL_OFFSET_MS);
  return `${String(s.getUTCDate()).padStart(2, "0")}.${String(s.getUTCMonth() + 1).padStart(2, "0")}`;
}

const validDay = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());

/** Yalnızca güne bakan kurallar; veritabanına dokunmaz. */
function dayError(toDay: Date, now: Date): string | null {
  if (!validDay(toDay)) return "Gün geçersiz";
  if (istanbulDayStart(toDay).getTime() < istanbulDayStart(now).getTime()) return "Geçmiş bir güne taşınamaz";
  if (!isWorkday(toDay)) return "Hafta sonu iş günü değil";
  return null;
}

type Assessment = MoveResult & {
  error: string | null;
  wo: typeof workOrders.$inferSelect;
  stationName: string;
  isFirst: boolean;
  target: Date | null;
  sameDay: boolean;
};

/**
 * Önizleme ve taşımanın ortak hesabı: kural ihlali (ilk bulunan, sabit sırayla) ve taşımadan sonraki hedef gün yükü.
 * Hiçbir şey yazmaz. İş emri ya da adım yoksa fırlatır: gün hatalıysa o iletiyle VALIDATION, değilse NOT_FOUND (döndürülecek
 * adım yoktur). `lock` iş emri satırını kilitler (transaction içinde).
 */
async function assessMove(db: Db, i: MoveInput & { now: Date }, lock: boolean): Promise<Assessment> {
  // Gün kuralları adım aramasından önce: gün hatalıysa iş emri ya da adım bulunamasa da aynı ileti döner.
  let error = dayError(i.toDay, i.now);
  const notFound = (message: string) => (error ? new DomainError("VALIDATION", error) : new DomainError("NOT_FOUND", message));
  const query = db.select().from(workOrders).where(eq(workOrders.id, i.workOrderId));
  const [wo] = isUuid(i.workOrderId) ? await (lock ? query.for("update") : query) : [];
  if (!wo) throw notFound("İş emri bulunamadı");
  const rows = await db
    .select({ step: workOrderSteps, stationName: stations.name, capacityMin: stations.dailyCapacityMin })
    .from(workOrderSteps)
    .innerJoin(stations, eq(stations.id, workOrderSteps.stationId))
    .where(eq(workOrderSteps.workOrderId, wo.id))
    .orderBy(asc(workOrderSteps.seq));
  const index = rows.findIndex((r) => r.step.seq === i.seq);
  const current = rows[index];
  if (!current) throw notFound("Adım bulunamadı");
  const { step, capacityMin } = current;

  const target = validDay(i.toDay) ? istanbulDayStart(i.toDay) : null;
  if (!error && step.plannedDay === null) error = "Önce iş emrini planlayın";
  if (!error && step.startedAt !== null) error = "Başlamış adım taşınamaz";
  if (!error && wo.status !== "planned" && wo.status !== "in_progress") error = "Yalnızca açık iş emrinin adımı taşınır";
  const prev = rows[index - 1];
  const next = rows[index + 1];
  // Bitmiş önceki adımın sınırı gerçekte bittiği gündür; planlı günü artık bayattır (erken ya da geç bitmiş olabilir).
  const prevDay = prev ? (prev.step.finishedAt ?? prev.step.plannedDay) : null;
  if (!error && target && prev && prevDay && istanbulDayStart(prevDay).getTime() > target.getTime()) {
    error = `Önce ${prev.stationName} adımı (${dayMonth(istanbulDayStart(prevDay))}) gelir`;
  }
  if (!error && target && next?.step.plannedDay && istanbulDayStart(next.step.plannedDay).getTime() < target.getTime()) {
    error = `${next.stationName} adımı (${dayMonth(next.step.plannedDay)}) bundan önce olamaz`;
  }

  const sameDay = target !== null && step.plannedDay !== null && istanbulDayStart(step.plannedDay).getTime() === target.getTime();
  // stationLoad bitmemiş adımları sayar: aynı günde adım zaten içindedir, başka günden geliyorsa eklenir.
  const loadMinutes = target ? (await stationLoad(db, step.stationId, target)) + (sameDay || step.finishedAt ? 0 : step.minutes) : 0;
  return {
    step,
    loadMinutes,
    capacityMin,
    overCapacity: loadMinutes > capacityMin,
    error,
    wo,
    stationName: current.stationName,
    isFirst: index === 0,
    target,
    sameDay,
  };
}

/** Taşımanın sonucunu yazmadan hesaplar: onay penceresinin yük metni ve (varsa) reddetme iletisi. */
export async function previewMove(db: Db, i: MoveInput & { now: Date }): Promise<MoveResult & { error: string | null }> {
  const a = await assessMove(db, i, false);
  return { step: a.step, loadMinutes: a.loadMinutes, capacityMin: a.capacityMin, overCapacity: a.overCapacity, error: a.error };
}

/**
 * Başlamamış adımı açık iş emrinde başka bir iş gününe taşır; komşu adımların sırası korunur. Kapasite aşımı
 * engellemez, `overCapacity` döner. İlk adım taşınırsa iş emrinin planlı başlangıcı da değişir. Aynı gün: yazmaz.
 */
export async function moveStep(ctx: Ctx, i: MoveInput): Promise<MoveResult> {
  assertCan(ctx.user, "planning", "write");
  return inTx(ctx, async (tx) => {
    const a = await assessMove(tx.db, { ...i, now: tx.now }, true);
    if (a.error) throw new DomainError("VALIDATION", a.error);
    const result = { loadMinutes: a.loadMinutes, capacityMin: a.capacityMin, overCapacity: a.overCapacity };
    if (a.sameDay || !a.target || !a.step.plannedDay) return { step: a.step, ...result };

    const [step] = await tx.db.update(workOrderSteps).set({ plannedDay: a.target }).where(eq(workOrderSteps.id, a.step.id)).returning();
    if (!step) throw new Error("adım taşınamadı");
    if (a.isFirst) await tx.db.update(workOrders).set({ plannedStart: a.target }).where(eq(workOrders.id, a.wo.id));
    const n = (v: number) => v.toLocaleString("tr-TR");
    await logAudit(tx, {
      entity: "work_order",
      entityId: a.wo.id,
      action: "move_step",
      summary: `${a.wo.code} ${a.stationName} adımı ${dayMonth(a.step.plannedDay)} → ${dayMonth(a.target)} taşındı (yük ${n(a.loadMinutes)}/${n(a.capacityMin)} dk)`,
    });
    return { step, ...result };
  });
}

// ---- Termin önerisi -------------------------------------------------------------------------------------

export type DueSuggestion = { dueAt: Date; basis: "stok" | "kapasite" | "malzeme"; detail: string };

/** Önerinin arayacağı en uzak gün: sonraki iş gününden itibaren 60 iş günü. */
const HORIZON_WORKDAYS = 60;

/** Günden (İstanbul günü) kesinlikle sonraki ilk iş günü. */
function nextWorkday(d: Date): Date {
  return addWorkdays(new Date(istanbulDayStart(d).getTime() + DAY_MS), 0);
}

type LineSuggestion = DueSuggestion & { overflow: boolean };

/**
 * Siparişin satırları için en erken gerçekçi termin. Satır başına: kullanılabilir mamul yetiyorsa sonraki iş günü. Yetmeyen
 * adet üretilir: başlangıç sonraki iş günü, malzeme eksikse en uzun tedarik süresi (iş günü) sonrasının ertesi iş günü.
 * Rota adımları sırayla, her biri öncekinden en az bir iş günü sonra ve istasyonun o günkü yükü (planlı adımlar + bu
 * hesabın önceki satır ve adımlarla geçici yerleştirdikleri) + adım dakikası kapasiteyi aşmayan ilk güne konur; kapasiteden
 * büyük adım yükü olmayan ilk güne kendi başına konur. Termin = son adım günü + 1 iş günü. Sipariş termini satırların en
 * geç önerisidir; `detail` belirleyici satırı söyler. Hiçbir şey yazmaz.
 */
export async function suggestDueDate(db: Db, i: { lines: { productId: string; qtyMilli: number }[]; now: Date }): Promise<DueSuggestion> {
  const first = nextWorkday(i.now);
  const horizonEnd = addWorkdays(first, HORIZON_WORKDAYS - 1);
  const productAvail = new Map<string, number>();
  const materialUsed = new Map<string, number>();
  const tentative = new Map<string, number>();
  const loads = new Map<string, number>();
  const stationRows = await db.select().from(stations);
  const stationById = new Map(stationRows.map((s) => [s.id, s]));

  const loadOn = async (stationId: string, d: Date) => {
    const key = `${stationId}|${d.getTime()}`;
    let base = loads.get(key);
    if (base === undefined) {
      base = await stationLoad(db, stationId, d);
      loads.set(key, base);
    }
    return base + (tentative.get(key) ?? 0);
  };

  let result: LineSuggestion | null = null;
  for (const line of i.lines) {
    const [product] = isUuid(line.productId) ? await db.select().from(products).where(eq(products.id, line.productId)) : [];
    if (!product) throw new DomainError("NOT_FOUND", "Ürün bulunamadı");
    const avail = productAvail.get(product.id) ?? Math.max(product.onHandMilli - product.reservedMilli, 0);
    const fromStock = Math.min(avail, line.qtyMilli);
    productAvail.set(product.id, avail - fromStock);
    const make = line.qtyMilli - fromStock;
    const label = `${product.code} × ${line.qtyMilli / 1000}`;

    let s: LineSuggestion;
    if (make === 0) {
      s = { dueAt: first, basis: "stok", detail: "stokta var", overflow: false };
    } else {
      // Malzeme: önceki satırların ihtiyacı kullanılabilir stoktan düşülür.
      const needs = await materialNeeds(db, product.id, make);
      const rows = needs.length
        ? await db.select().from(materials).where(inArray(materials.id, needs.map((n) => n.materialId))).orderBy(asc(materials.code))
        : [];
      let slowest: (typeof rows)[number] | null = null;
      for (const m of rows) {
        const needed = needs.filter((n) => n.materialId === m.id).reduce((a, n) => a + n.neededMilli, 0);
        const used = materialUsed.get(m.id) ?? 0;
        if (m.onHandMilli - m.reservedMilli - used < needed && (!slowest || m.leadTimeDays > slowest.leadTimeDays)) slowest = m;
        materialUsed.set(m.id, used + needed);
      }
      const start = slowest ? nextWorkday(addWorkdays(istanbulDayStart(i.now), slowest.leadTimeDays)) : first;

      const route = await db.select().from(routings).where(eq(routings.productId, product.id)).orderBy(asc(routings.seq));
      let earliest = start;
      let last: Date | null = null;
      let pushed: string | null = null;
      let overflow = false;
      for (const r of route) {
        const minutes = r.minutesPerUnit * (make / 1000);
        const capacity = stationById.get(r.stationId)?.dailyCapacityMin ?? 0;
        let placed: Date | null = null;
        for (let d = earliest; d.getTime() <= horizonEnd.getTime(); d = addWorkdays(d, 1)) {
          const current = await loadOn(r.stationId, d);
          if (minutes > capacity ? current === 0 : current + minutes <= capacity) {
            placed = d;
            break;
          }
          pushed ??= `${stationById.get(r.stationId)?.name ?? "İstasyon"} ${dayMonth(d)}'de dolu`;
        }
        // Kapasiteden büyük adıma ufukta boş gün yoksa en erken güne konur; sığan adım sığmıyorsa ufkun dışındayız.
        if (!placed && minutes > capacity && earliest.getTime() <= horizonEnd.getTime()) placed = earliest;
        if (!placed) {
          overflow = true;
          break;
        }
        const key = `${r.stationId}|${placed.getTime()}`;
        tentative.set(key, (tentative.get(key) ?? 0) + minutes);
        last = placed;
        earliest = addWorkdays(placed, 1);
      }

      if (overflow) {
        s = { dueAt: addWorkdays(horizonEnd, 1), basis: "kapasite", detail: `${HORIZON_WORKDAYS} iş günü içinde yer yok`, overflow: true };
      } else if (!last) {
        s = { dueAt: start, basis: "kapasite", detail: `${label}: rota tanımlı değil`, overflow: false };
      } else {
        const dueAt = addWorkdays(last, 1);
        if (pushed) s = { dueAt, basis: "kapasite", detail: `${label}: ${pushed}`, overflow: false };
        else if (slowest) s = { dueAt, basis: "malzeme", detail: `${slowest.code} ${slowest.name} için ${slowest.leadTimeDays} iş günü tedarik`, overflow: false };
        else s = { dueAt, basis: "kapasite", detail: `${label}: üretim ${workdaysBetween(start, last) + 1} iş günü`, overflow: false };
      }
    }
    if (!result || (s.overflow && !result.overflow) || (s.overflow === result.overflow && s.dueAt.getTime() > result.dueAt.getTime())) result = s;
  }

  if (!result) return { dueAt: first, basis: "stok", detail: "stokta var" };
  return { dueAt: result.dueAt, basis: result.basis, detail: result.detail };
}
