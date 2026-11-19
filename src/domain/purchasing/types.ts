import type {
  CURRENCIES,
  goodsReceipts,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderLines,
  purchaseOrders,
  supplierItems,
  suppliers,
} from "@/db/schema";

export type Currency = (typeof CURRENCIES)[number];
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
/** 0: onay gerekmez, 1: müdür, 2: müdür + Yönetim. */
export type ApprovalTier = 0 | 1 | 2;

type SupplierRecord = typeof suppliers.$inferSelect;
export type Supplier = Omit<SupplierRecord, "currency"> & { currency: Currency };

export type SupplierItem = typeof supplierItems.$inferSelect;

type OrderRecord = typeof purchaseOrders.$inferSelect;
export type PurchaseOrder = Omit<OrderRecord, "status" | "currency" | "requiredTier"> & {
  status: PurchaseOrderStatus;
  currency: Currency;
  requiredTier: ApprovalTier;
};

export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;

export function asSupplier(row: SupplierRecord): Supplier {
  return row as Supplier;
}
export function asSupplierItem(row: SupplierItem): SupplierItem {
  return row;
}
export function asPurchaseOrder(row: OrderRecord): PurchaseOrder {
  return row as PurchaseOrder;
}
export function asPurchaseOrderLine(row: PurchaseOrderLine): PurchaseOrderLine {
  return row;
}
export function asGoodsReceipt(row: GoodsReceipt): GoodsReceipt {
  return row;
}
