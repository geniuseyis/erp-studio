import type { MATERIAL_CATEGORIES, MOVEMENT_TYPES, COUNT_STATUSES, materials, stockCounts, stockMovements } from "@/db/schema";
import type { Unit } from "../units";

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type CountStatus = (typeof COUNT_STATUSES)[number];

type MaterialRecord = typeof materials.$inferSelect;
export type Material = Omit<MaterialRecord, "unit" | "category"> & { unit: Unit; category: MaterialCategory };

type MovementRecord = typeof stockMovements.$inferSelect;
export type StockMovement = Omit<MovementRecord, "type"> & { type: MovementType };

type CountRecord = typeof stockCounts.$inferSelect;
export type StockCount = Omit<CountRecord, "status"> & { status: CountStatus };

export function asMaterial(row: MaterialRecord): Material {
  return row as Material;
}
export function asMovement(row: MovementRecord): StockMovement {
  return row as StockMovement;
}
export function asCount(row: CountRecord): StockCount {
  return row as StockCount;
}
