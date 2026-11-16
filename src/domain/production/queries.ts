import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bomLines, materials, products, routings, salesOrderLines, salesOrders, stations, users, workOrders, workOrderSteps } from "@/db/schema";
import { isUuid } from "../context";
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
  doneSteps: number;
  totalSteps: number;
};
export type WorkOrderFilter = { search?: string; status?: WorkOrderStatus };

type StepRecord = typeof workOrderSteps.$inferSelect;

async function workOrderRows(db: Db, id?: string): Promise<WorkOrderRow[]> {
  const rows = await db
    .select({ wo: workOrders, productCode: products.code, productName: products.name, orderCode: salesOrders.code })
    .from(workOrders)
    .innerJoin(products, eq(products.id, workOrders.productId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(id ? eq(workOrders.id, id) : undefined)
    .orderBy(desc(workOrders.createdAt), desc(workOrders.code));
  if (rows.length === 0) return [];

  const steps = await db
    .select({ step: workOrderSteps, stationName: stations.name })
    .from(workOrderSteps)
    .innerJoin(stations, eq(stations.id, workOrderSteps.stationId))
    .where(id ? eq(workOrderSteps.workOrderId, id) : undefined)
    .orderBy(asc(workOrderSteps.seq));
  const byOrder = new Map<string, { step: StepRecord; stationName: string }[]>();
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
      doneSteps: mine.filter((s) => s.step.finishedAt !== null).length,
      totalSteps: mine.length,
    };
  });
}

/** İş emirleri, yeniden eskiye. Arama kod, ürün adı ve sipariş kodunda. */
export async function listWorkOrders(db: Db, f: WorkOrderFilter = {}): Promise<WorkOrderRow[]> {
  const rows = await workOrderRows(db);
  return rows
    .filter((w) => !f.status || w.status === f.status)
    .filter((w) => matchesSearch([w.code, w.productName, w.orderCode ?? ""], f.search));
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
  const shortages = row.materialsReserved ? [] : await findShortages(db, needs);
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

export type QueueItem = {
  workOrderId: string;
  code: string;
  productName: string;
  qtyMilli: number;
  seq: number;
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
