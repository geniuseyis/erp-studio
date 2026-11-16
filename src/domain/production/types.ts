import type { PRODUCT_MOVEMENT_TYPES, productMovements } from "@/db/schema";

export type ProductMovementType = (typeof PRODUCT_MOVEMENT_TYPES)[number];

type ProductMovementRecord = typeof productMovements.$inferSelect;
export type ProductMovement = Omit<ProductMovementRecord, "type"> & { type: ProductMovementType };

export function asProductMovement(row: ProductMovementRecord): ProductMovement {
  return row as ProductMovement;
}
