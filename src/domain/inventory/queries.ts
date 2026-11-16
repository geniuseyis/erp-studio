import { and, asc, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, stockCountLines, stockCounts, stockMovements, users } from "@/db/schema";
import { isUuid } from "../context";
import { matchesSearch } from "../text";
import { lineValueKurus, type Unit } from "../units";
import {
  asCount,
  asMaterial,
  asMovement,
  type Material,
  type MaterialCategory,
  type MovementType,
  type StockCount,
  type StockMovement,
} from "./types";

export type MaterialRow = Material & {
  /** Eldeki − ayrılmış. */
  availableMilli: number;
  /** Kullanılabilir miktar yeniden sipariş noktasının altında. */
  isCritical: boolean;
  stockValueKurus: number;
};

export type MaterialFilter = { search?: string; category?: MaterialCategory; criticalOnly?: boolean };

function toRow(record: typeof materials.$inferSelect): MaterialRow {
  const m = asMaterial(record);
  const availableMilli = m.onHandMilli - m.reservedMilli;
  return {
    ...m,
    availableMilli,
    isCritical: availableMilli < m.reorderPointMilli,
    stockValueKurus: lineValueKurus(m.onHandMilli, m.avgCostKurus),
  };
}

/** Malzemeler, kod sırasıyla. Arama kod ve adda, Türkçe harf ve büyük-küçük harf duyarsızdır. */
export async function listMaterials(db: Db, f: MaterialFilter = {}): Promise<MaterialRow[]> {
  const rows = await db.select().from(materials).orderBy(asc(materials.code));
  return rows
    .map(toRow)
    .filter((m) => !f.category || m.category === f.category)
    .filter((m) => !f.criticalOnly || m.isCritical)
    .filter((m) => matchesSearch([m.code, m.name], f.search));
}

export async function getMaterial(db: Db, id: string): Promise<MaterialRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(materials).where(eq(materials.id, id));
  return row ? toRow(row) : null;
}

export type MovementRow = StockMovement & { materialCode: string; materialName: string; materialCategory: MaterialCategory; unit: Unit; userName: string };
export type MovementFilter = { materialId?: string; type?: MovementType; from?: Date; to?: Date; limit?: number };

/** Stok hareketleri, yeniden eskiye. */
export async function listMovements(db: Db, f: MovementFilter = {}): Promise<MovementRow[]> {
  const where: SQL[] = [];
  if (f.materialId) where.push(eq(stockMovements.materialId, f.materialId));
  if (f.type) where.push(eq(stockMovements.type, f.type));
  if (f.from) where.push(gte(stockMovements.createdAt, f.from));
  if (f.to) where.push(lte(stockMovements.createdAt, f.to));

  const rows = await db
    .select({
      movement: stockMovements,
      materialCode: materials.code,
      materialName: materials.name,
      materialCategory: materials.category,
      unit: materials.unit,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(materials, eq(materials.id, stockMovements.materialId))
    .innerJoin(users, eq(users.id, stockMovements.userId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.seq))
    .limit(f.limit ?? 200);

  return rows.map((r) => ({
    ...asMovement(r.movement),
    materialCode: r.materialCode,
    materialName: r.materialName,
    materialCategory: r.materialCategory as MaterialCategory,
    unit: r.unit as Unit,
    userName: r.userName,
  }));
}

export type StockCountSummary = StockCount & { createdByName: string; lineCount: number; countedCount: number };
export type StockCountLine = {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: Unit;
  /** Fiş açıldığı andaki eldeki miktar. */
  systemMilli: number;
  countedMilli: number | null;
  currentOnHandMilli: number;
  /** Sayılan − şu anki eldeki; sayılmadıysa null. */
  diffMilli: number | null;
};
export type StockCountDetail = StockCountSummary & { lines: StockCountLine[] };

async function countSummaries(db: Db, id?: string): Promise<StockCountSummary[]> {
  const rows = await db
    .select({
      count: stockCounts,
      createdByName: users.name,
      lineCount: sql<number>`count(${stockCountLines.id})::int`,
      countedCount: sql<number>`count(${stockCountLines.countedMilli})::int`,
    })
    .from(stockCounts)
    .innerJoin(users, eq(users.id, stockCounts.createdBy))
    .leftJoin(stockCountLines, eq(stockCountLines.countId, stockCounts.id))
    .where(id ? eq(stockCounts.id, id) : undefined)
    .groupBy(stockCounts.id, users.name)
    .orderBy(desc(stockCounts.createdAt), desc(stockCounts.code));
  return rows.map((r) => ({
    ...asCount(r.count),
    createdByName: r.createdByName,
    lineCount: r.lineCount,
    countedCount: r.countedCount,
  }));
}

export function listCounts(db: Db): Promise<StockCountSummary[]> {
  return countSummaries(db);
}

export async function getCount(db: Db, id: string): Promise<StockCountDetail | null> {
  if (!isUuid(id)) return null;
  const [summary] = await countSummaries(db, id);
  if (!summary) return null;
  const lines = await db
    .select({ line: stockCountLines, material: materials })
    .from(stockCountLines)
    .innerJoin(materials, eq(materials.id, stockCountLines.materialId))
    .where(eq(stockCountLines.countId, id))
    .orderBy(asc(materials.code));
  return {
    ...summary,
    lines: lines.map(({ line, material }) => ({
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      unit: material.unit as Unit,
      systemMilli: line.systemMilli,
      countedMilli: line.countedMilli,
      currentOnHandMilli: material.onHandMilli,
      diffMilli: line.countedMilli === null ? null : line.countedMilli - material.onHandMilli,
    })),
  };
}

export type InventorySummary = { totalValueKurus: number; materialCount: number; criticalCount: number; openCounts: number };

export async function inventorySummary(db: Db): Promise<InventorySummary> {
  const rows = await listMaterials(db);
  const [open] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stockCounts)
    .where(eq(stockCounts.status, "open"));
  return {
    totalValueKurus: rows.reduce((sum, r) => sum + r.stockValueKurus, 0),
    materialCount: rows.length,
    criticalCount: rows.filter((r) => r.isCritical).length,
    openCounts: open?.n ?? 0,
  };
}
