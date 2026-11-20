import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bomLines, materials, products, routings, salesOrderLines, salesOrders, stations, users, workOrders, workOrderSteps } from "@/db/schema";
import { isUuid } from "../context";
import { DAY_MS, istanbulDayStart } from "./calendar";
import type { MaterialCategory } from "../inventory/types";
import { matchesSearch } from "../text";
import { laborCostKurus } from "./costing";
import type { Unit } from "../units";
import { asProduct, asWorkOrder, type Product, type ProductFinish, type Shortage, type Station, type WorkOrderStatus } from "./types";
import { findShortages, materialNeeds, reservedForWorkOrder } from "./workOrders";

/** `unitCostKurus`: malzeme + işçilik ve genel gider (katalog fiyatının dayanağı); `materialCostKurus`: yalnızca malzeme. */
export type ProductRow = Product & { availableMilli: number; unitCostKurus: number; materialCostKurus: number };
export type ProductFilter = { search?: string; collection?: string; finish?: ProductFinish };

type Cost = { unitCostKurus: number; materialCostKurus: number };

/**
 * Birim maliyet, katalogdaki gibi: malzeme Σ reçete × (1000 + fire) / 1000 × ortalama maliyet / 1000, artı rota
 * dakikaları × işçilik × genel gider çarpanı (laborCostKurus). Toplam kuruşa bir kez yuvarlanır; malzeme maliyeti
 * ayrıca kendi başına yuvarlanır.
 */
async function unitCosts(db: Db, productIds?: string[]): Promise<Map<string, Cost>> {
  if (productIds && productIds.length === 0) return new Map();
  const [bom, route] = await Promise.all([
    db
      .select({ productId: bomLines.productId, qtyMilli: bomLines.qtyMilli, scrapPermille: bomLines.scrapPermille, avgCostKurus: materials.avgCostKurus })
      .from(bomLines)
      .innerJoin(materials, eq(materials.id, bomLines.materialId))
      .where(productIds ? inArray(bomLines.productId, productIds) : undefined),
    db
      .select({ productId: routings.productId, minutesPerUnit: routings.minutesPerUnit })
      .from(routings)
      .where(productIds ? inArray(routings.productId, productIds) : undefined),
  ]);
  const material = new Map<string, number>();
  for (const r of bom) {
    material.set(r.productId, (material.get(r.productId) ?? 0) + (r.qtyMilli * (1000 + r.scrapPermille) * r.avgCostKurus) / 1_000_000);
  }
  const minutes = new Map<string, number>();
  for (const r of route) minutes.set(r.productId, (minutes.get(r.productId) ?? 0) + r.minutesPerUnit);
  const out = new Map<string, Cost>();
  for (const id of new Set([...material.keys(), ...minutes.keys()])) {
    const m = material.get(id) ?? 0;
    out.set(id, { unitCostKurus: Math.round(m + laborCostKurus(minutes.get(id) ?? 0)), materialCostKurus: Math.round(m) });
  }
  return out;
}

function toProductRow(record: typeof products.$inferSelect, cost: Cost | undefined): ProductRow {
  const p = asProduct(record);
  return { ...p, availableMilli: p.onHandMilli - p.reservedMilli, unitCostKurus: cost?.unitCostKurus ?? 0, materialCostKurus: cost?.materialCostKurus ?? 0 };
}

/** Ürünler, kod sırasıyla. Arama kod, ad ve kategoride, Türkçe harf duyarsızdır. */
export async function listProducts(db: Db, f: ProductFilter = {}): Promise<ProductRow[]> {
  const [rows, costs] = await Promise.all([db.select().from(products).orderBy(asc(products.code)), unitCosts(db)]);
  return rows
    .map((r) => toProductRow(r, costs.get(r.id)))
    .filter((p) => !f.collection || p.collection === f.collection)
    .filter((p) => !f.finish || p.finish === f.finish)
    .filter((p) => matchesSearch([p.code, p.name, p.category], f.search));
}

export type ProductDetail = ProductRow & {
  bom: { materialId: string; code: string; name: string; category: MaterialCategory; unit: Unit; qtyMilli: number; scrapPermille: number; availableMilli: number }[];
  routing: { seq: number; stationCode: string; stationName: string; minutesPerUnit: number }[];
};

export async function getProduct(db: Db, id: string): Promise<ProductDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) return null;
  const costs = await unitCosts(db, [id]);
  const bom = await db
    .select({ line: bomLines, material: materials })
    .from(bomLines)
    .innerJoin(materials, eq(materials.id, bomLines.materialId))
    .where(eq(bomLines.productId, id))
    .orderBy(asc(materials.code));
  const route = await db
    .select({ seq: routings.seq, stationCode: stations.code, stationName: stations.name, minutesPerUnit: routings.minutesPerUnit })
    .from(routings)
    .innerJoin(stations, eq(stations.id, routings.stationId))
    .where(eq(routings.productId, id))
    .orderBy(asc(routings.seq));
  return {
    ...toProductRow(row, costs.get(id)),
    bom: bom.map(({ line, material }) => ({
      materialId: material.id,
      code: material.code,
      name: material.name,
      category: material.category as MaterialCategory,
      unit: material.unit as Unit,
      qtyMilli: line.qtyMilli,
      scrapPermille: line.scrapPermille,
      availableMilli: material.onHandMilli - material.reservedMilli,
    })),
    routing: route,
  };
}

export type WorkOrderRow = {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  qtyMilli: number;
  status: WorkOrderStatus;
  materialsReserved: boolean;
  plannedStart: Date | null;
  orderCode: string | null;
  /** Çalışan adımın, yoksa sıradaki adımın istasyon adı; iş emri bitmiş ya da adımsızsa null. */
  currentStation: string | null;
  /** `currentStation`ın kodu; kanban sütunu bununla seçilir. */
  currentStationCode: string | null;
  doneSteps: number;
  totalSteps: number;
  /** Bağlı siparişin termini; stok için açılan iş emrinde null. */
  dueAt: Date | null;
  completedAt: Date | null;
};
/**
 * Planlanmamış iş emri: açık (planlı ya da üretimde) ve planlı günü olmayan en az bir adımı var. Haftalık planın
 * "Planlanmamış" sayısı ve iş emri listesinin `planlanmamis=1` süzgeci bu tek koşulu kullanır; iki sayı ayrışamaz.
 */
export function unscheduledWorkOrder(): SQL {
  return and(
    inArray(workOrders.status, ["planned", "in_progress"]),
    sql`exists (select 1 from ${workOrderSteps} where ${workOrderSteps.workOrderId} = ${workOrders.id} and ${workOrderSteps.plannedDay} is null)`,
  )!;
}

/** Malzemesini bekleyen iş emri: planlı ve malzemesi ayrılmamış. Liste, özet ve kanban bu tek tanımı kullanır. */
export function isWaitingForMaterial(w: Pick<WorkOrderRow, "status" | "materialsReserved">): boolean {
  return w.status === "planned" && !w.materialsReserved;
}

/** Aramanın eşleştiği alanlar: kod, ürün adı, sipariş kodu. Liste ve kanban aynı sonucu bu işlevle verir. */
export function workOrderMatches(w: Pick<WorkOrderRow, "code" | "productName" | "orderCode">, search: string | undefined): boolean {
  return matchesSearch([w.code, w.productName, w.orderCode ?? ""], search);
}

/** Açık ama sıradaki adımı olmayan iş emrinin nedeni: rotası yok ya da bütün adımları bitmiş. Başka durumda null. */
export function stepGap(w: Pick<WorkOrderRow, "status" | "currentStationCode" | "totalSteps">): "Rotası yok" | "Adım kalmadı" | null {
  if ((w.status !== "planned" && w.status !== "in_progress") || w.currentStationCode !== null) return null;
  return w.totalSteps === 0 ? "Rotası yok" : "Adım kalmadı";
}

/** `unscheduled`: yalnızca planlanmamış iş emirleri (unscheduledWorkOrder). */
export type WorkOrderFilter = { search?: string; status?: WorkOrderStatus; unscheduled?: boolean };

type StepRecord = typeof workOrderSteps.$inferSelect;

async function workOrderRows(db: Db, id?: string): Promise<WorkOrderRow[]> {
  const rows = await db
    .select({ wo: workOrders, productCode: products.code, productName: products.name, orderCode: salesOrders.code, dueAt: salesOrders.dueAt })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(id ? eq(workOrders.id, id) : undefined)
    .orderBy(desc(workOrders.createdAt), desc(workOrders.code));
  if (rows.length === 0) return [];

  const steps = await db
    .select({ step: workOrderSteps, stationName: stations.name, stationCode: stations.code })
    .from(workOrderSteps)
    .innerJoin(stations, eq(stations.id, workOrderSteps.stationId))
    .where(id ? eq(workOrderSteps.workOrderId, id) : undefined)
    .orderBy(asc(workOrderSteps.seq));
  const byOrder = new Map<string, { step: StepRecord; stationName: string; stationCode: string }[]>();
  for (const s of steps) byOrder.set(s.step.workOrderId, [...(byOrder.get(s.step.workOrderId) ?? []), s]);

  return rows.map((r) => {
    const wo = asWorkOrder(r.wo);
    const mine = byOrder.get(wo.id) ?? [];
    const open = wo.status === "planned" || wo.status === "in_progress";
    const current = open ? (mine.find((s) => s.step.startedAt !== null && s.step.finishedAt === null) ?? mine.find((s) => s.step.startedAt === null)) : undefined;
    return {
      id: wo.id,
      code: wo.code,
      productId: wo.productId,
      productCode: r.productCode,
      productName: r.productName,
      qtyMilli: wo.qtyMilli,
      status: wo.status,
      materialsReserved: wo.materialsReserved,
      plannedStart: wo.plannedStart,
      orderCode: r.orderCode,
      currentStation: current?.stationName ?? null,
      currentStationCode: current?.stationCode ?? null,
      dueAt: r.dueAt,
      completedAt: wo.completedAt,
      doneSteps: mine.filter((s) => s.step.finishedAt !== null).length,
      totalSteps: mine.length,
    };
  });
}

/** İş emirleri, yeniden eskiye. Arama kod, ürün adı ve sipariş kodunda. */
export async function listWorkOrders(db: Db, f: WorkOrderFilter = {}): Promise<WorkOrderRow[]> {
  const rows = await workOrderRows(db);
  const unscheduled = f.unscheduled
    ? new Set((await db.select({ id: workOrders.id }).from(workOrders).where(unscheduledWorkOrder())).map((r) => r.id))
    : null;
  return rows
    .filter((w) => !unscheduled || unscheduled.has(w.id))
    .filter((w) => !f.status || w.status === f.status)
    .filter((w) => workOrderMatches(w, f.search));
}

export type WorkOrderDetail = WorkOrderRow & {
  steps: {
    seq: number;
    stationCode: string;
    stationName: string;
    minutes: number;
    plannedDay: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    startedByName: string | null;
    finishedByName: string | null;
  }[];
  materials: { materialId: string; code: string; name: string; unit: Unit; neededMilli: number; availableMilli: number }[];
  shortages: Shortage[];
};

export async function getWorkOrder(db: Db, id: string): Promise<WorkOrderDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await workOrderRows(db, id);
  if (!row) return null;

  const startedBy = alias(users, "started_by_user");
  const finishedBy = alias(users, "finished_by_user");
  const steps = await db
    .select({ step: workOrderSteps, stationCode: stations.code, stationName: stations.name, startedByName: startedBy.name, finishedByName: finishedBy.name })
    .from(workOrderSteps)
    .innerJoin(stations, eq(stations.id, workOrderSteps.stationId))
    .leftJoin(startedBy, eq(startedBy.id, workOrderSteps.startedBy))
    .leftJoin(finishedBy, eq(finishedBy.id, workOrderSteps.finishedBy))
    .where(eq(workOrderSteps.workOrderId, id))
    .orderBy(asc(workOrderSteps.seq));

  // Ayrılmışsa ihtiyaç, ayrılan net miktardır (reçete sonradan değişmiş olabilir); değilse reçeteden hesaplanır.
  const needs = row.materialsReserved ? await reservedForWorkOrder(db, id) : await materialNeeds(db, row.productId, row.qtyMilli);
  // Eksik yalnızca malzemesini bekleyen planlı iş emrinde anlamlıdır; iptal ya da tamamlanmışta gösterilmez.
  const shortages = row.status === "planned" && !row.materialsReserved ? await findShortages(db, needs) : [];
  const found = needs.length ? await db.select().from(materials).where(inArray(materials.id, needs.map((n) => n.materialId))) : [];
  const byId = new Map(found.map((m) => [m.id, m]));
  const mats = needs
    .flatMap((n) => {
      const m = byId.get(n.materialId);
      return m
        ? [{ materialId: m.id, code: m.code, name: m.name, unit: m.unit as Unit, neededMilli: n.neededMilli, availableMilli: m.onHandMilli - m.reservedMilli }]
        : [];
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    ...row,
    steps: steps.map((s) => ({
      seq: s.step.seq,
      stationCode: s.stationCode,
      stationName: s.stationName,
      minutes: s.step.minutes,
      plannedDay: s.step.plannedDay,
      startedAt: s.step.startedAt,
      finishedAt: s.step.finishedAt,
      startedByName: s.startedByName,
      finishedByName: s.finishedByName,
    })),
    materials: mats,
    shortages,
  };
}

/** Adımın iş emri içindeki 1 tabanlı sırası; `siblings` seq sırasındaki bütün adımlardır. */
export function stepPosition(siblings: { id: string }[], stepId: string): number {
  return siblings.findIndex((s) => s.id === stepId) + 1;
}

export type QueueItem = {
  workOrderId: string;
  code: string;
  productName: string;
  qtyMilli: number;
  seq: number;
  /** Rotadaki 1 tabanlı sıra; `seq` boşluklu olabilir, ekranda bu gösterilir. */
  position: number;
  totalSteps: number;
  minutes: number;
  state: "waiting" | "running";
  plannedDay: Date | null;
  orderCode: string | null;
  dueAt: Date | null;
};

/**
 * İstasyonun kuyruğu. `running`: başlamış, bitmemiş. `waiting`: başlamamış ve hazır: ilk adımsa iş emri
 * planlı ve malzemesi ayrılmış, sonraki adımsa önceki adım bitmiş. Önce çalışanlar, sonra planlı gün, sonra kod.
 */
export async function stationQueue(db: Db, stationCode: string): Promise<QueueItem[]> {
  const [station] = await db.select().from(stations).where(eq(stations.code, stationCode));
  if (!station) return [];

  const mine = await db
    .select({ step: workOrderSteps, wo: workOrders, productName: products.name, orderCode: salesOrders.code, dueAt: salesOrders.dueAt })
    .from(workOrderSteps)
    .innerJoin(workOrders, eq(workOrders.id, workOrderSteps.workOrderId))
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(eq(workOrderSteps.stationId, station.id));
  const live = mine.filter((r) => r.wo.status === "planned" || r.wo.status === "in_progress");
  if (live.length === 0) return [];

  const siblings = await db
    .select()
    .from(workOrderSteps)
    .where(inArray(workOrderSteps.workOrderId, [...new Set(live.map((r) => r.wo.id))]))
    .orderBy(asc(workOrderSteps.seq));
  const byOrder = new Map<string, StepRecord[]>();
  for (const s of siblings) byOrder.set(s.workOrderId, [...(byOrder.get(s.workOrderId) ?? []), s]);

  const items: QueueItem[] = [];
  for (const r of live) {
    const all = byOrder.get(r.wo.id) ?? [];
    const index = all.findIndex((s) => s.id === r.step.id);
    let state: QueueItem["state"] | null = null;
    if (r.step.startedAt !== null) {
      if (r.step.finishedAt === null) state = "running";
    } else if (index === 0) {
      if (r.wo.status === "planned" && r.wo.materialsReserved) state = "waiting";
    } else if (all[index - 1]?.finishedAt) {
      state = "waiting";
    }
    if (!state) continue;
    items.push({
      workOrderId: r.wo.id,
      code: r.wo.code,
      productName: r.productName,
      qtyMilli: r.wo.qtyMilli,
      seq: r.step.seq,
      position: stepPosition(all, r.step.id),
      totalSteps: all.length,
      minutes: r.step.minutes,
      state,
      plannedDay: r.step.plannedDay,
      orderCode: r.orderCode,
      dueAt: r.dueAt,
    });
  }
  const day = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY;
  return items.sort(
    (a, b) => Number(b.state === "running") - Number(a.state === "running") || day(a.plannedDay) - day(b.plannedDay) || a.code.localeCompare(b.code),
  );
}

export function listStations(db: Db): Promise<Station[]> {
  return db.select().from(stations).orderBy(asc(stations.seq), asc(stations.code));
}

export type KanbanColumn = { key: "waiting_material" | "unplanned" | `station:${string}` | "completed"; title: string; items: WorkOrderRow[] };

/** Tamamlandı sütununun penceresi: bugün dahil son 7 İstanbul günü. */
const COMPLETED_DAYS = 7;

/**
 * İş emirleri kanbanı. Her açık (planlı ya da üretimde) iş emri tam bir sütuna düşer; öncelik sırası:
 *   1. Planlanmadı: haftalık planın "Planlanmamış" sayısını veren unscheduledWorkOrder koşulu (`planlanmamis=1` listesiyle aynı)
 *      ARTI sıradaki adımı olmayan açık iş emirleri (rotası yok ya da bütün adımları bitmiş; bkz. stepGap). İkinci grup
 *      yüzünden sütun sayısı plan sayısından büyük olabilir; kartları "Rotası yok" / "Adım kalmadı" notu taşır, açık iş
 *      emri hiçbir sütunda kaybolmaz. Malzemesi de bekleyen plansız iş emri yine buradadır (plansızlık malzemeden önce
 *      gelir); kartında "Malzeme bekliyor" çipi görünür.
 *   2. Malzeme bekliyor: planlanmış (bütün adımlarının günü var) ama planlı ve malzemesi ayrılmamış.
 *   3. İstasyon: çalışan adımın, yoksa sıradaki adımın istasyonu (rota sırasıyla).
 * Tamamlandı yalnızca son 7 İstanbul gününde bitenleri alır; eski tamamlananlar ve iptaller hiçbir sütunda yoktur.
 * Açık sütunlar termine (termini olmayan sonda), sonra koda göre; Tamamlandı en son biteni üstte dizer.
 */
export async function kanbanColumns(db: Db, now: Date): Promise<KanbanColumn[]> {
  const [rows, stationList, unscheduledRows] = await Promise.all([
    workOrderRows(db),
    listStations(db),
    db.select({ id: workOrders.id }).from(workOrders).where(unscheduledWorkOrder()),
  ]);
  const unscheduled = new Set(unscheduledRows.map((r) => r.id));
  const since = istanbulDayStart(now).getTime() - (COMPLETED_DAYS - 1) * DAY_MS;

  const waiting: WorkOrderRow[] = [];
  const unplanned: WorkOrderRow[] = [];
  const completed: WorkOrderRow[] = [];
  const byStation = new Map<string, WorkOrderRow[]>(stationList.map((s) => [s.code, []]));

  for (const w of rows) {
    if (w.status === "completed") {
      if (w.completedAt && w.completedAt.getTime() >= since) completed.push(w);
      continue;
    }
    if (w.status === "cancelled") continue;
    const station = w.currentStationCode ? byStation.get(w.currentStationCode) : undefined;
    if (unscheduled.has(w.id) || !station) unplanned.push(w);
    else if (isWaitingForMaterial(w)) waiting.push(w);
    else station.push(w);
  }

  const due = (w: WorkOrderRow) => w.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const byDue = (a: WorkOrderRow, b: WorkOrderRow) => due(a) - due(b) || a.code.localeCompare(b.code);
  completed.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) || a.code.localeCompare(b.code));

  return [
    { key: "waiting_material", title: "Malzeme bekliyor", items: waiting.sort(byDue) },
    { key: "unplanned", title: "Planlanmadı", items: unplanned.sort(byDue) },
    ...stationList.map((s): KanbanColumn => ({ key: `station:${s.code}`, title: s.name, items: (byStation.get(s.code) ?? []).sort(byDue) })),
    { key: "completed", title: "Tamamlandı", items: completed },
  ];
}

/**
 * Bugünün iş emirleri: açık (planlı ya da üretimde) ve bugün (İstanbul günü) bitmemiş bir adımı planlı olanlar.
 * Hızlı yardımcı "bugünün iş emirleri" sorusunu bununla cevaplar.
 */
export async function todaysWorkOrders(db: Db, now: Date): Promise<WorkOrderRow[]> {
  const start = istanbulDayStart(now);
  const end = new Date(start.getTime() + DAY_MS);
  const steps = await db
    .select({ id: workOrderSteps.workOrderId })
    .from(workOrderSteps)
    .where(and(gte(workOrderSteps.plannedDay, start), lt(workOrderSteps.plannedDay, end), isNull(workOrderSteps.finishedAt)));
  const ids = new Set(steps.map((s) => s.id));
  if (ids.size === 0) return [];
  const rows = await workOrderRows(db);
  return rows.filter((w) => ids.has(w.id) && (w.status === "planned" || w.status === "in_progress")).sort((a, b) => a.code.localeCompare(b.code));
}
