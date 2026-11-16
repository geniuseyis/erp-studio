import type { PRODUCT_FINISHES, PRODUCT_MOVEMENT_TYPES, productMovements, products, stations, WORK_ORDER_STATUSES, workOrders, workOrderSteps } from "@/db/schema";
import type { Unit } from "../units";

export type ProductMovementType = (typeof PRODUCT_MOVEMENT_TYPES)[number];

type ProductMovementRecord = typeof productMovements.$inferSelect;
export type ProductMovement = Omit<ProductMovementRecord, "type"> & { type: ProductMovementType };

export function asProductMovement(row: ProductMovementRecord): ProductMovement {
  return row as ProductMovement;
}

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

type WorkOrderRecord = typeof workOrders.$inferSelect;
export type WorkOrder = Omit<WorkOrderRecord, "status"> & { status: WorkOrderStatus };
export type WorkOrderStep = typeof workOrderSteps.$inferSelect;

export function asWorkOrder(row: WorkOrderRecord): WorkOrder {
  return row as WorkOrder;
}

/** İş emrinin ayıramadığı malzeme: gereken ve o an kullanılabilir (eldeki − ayrılmış) miktar. */
export type Shortage = { materialId: string; code: string; name: string; unit: Unit; neededMilli: number; availableMilli: number };

export type ProductFinish = (typeof PRODUCT_FINISHES)[number];

type ProductRecord = typeof products.$inferSelect;
export type Product = Omit<ProductRecord, "finish"> & { finish: ProductFinish };

export function asProduct(row: ProductRecord): Product {
  return row as Product;
}

export type Station = typeof stations.$inferSelect;
