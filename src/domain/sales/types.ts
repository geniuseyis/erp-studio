import type { CUSTOMER_KINDS, LINE_STATUSES, ORDER_STATUSES, customers, salesOrderLines, salesOrders } from "@/db/schema";

export type CustomerKind = (typeof CUSTOMER_KINDS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type LineStatus = (typeof LINE_STATUSES)[number];

type CustomerRecord = typeof customers.$inferSelect;
export type Customer = Omit<CustomerRecord, "kind"> & { kind: CustomerKind };

type OrderRecord = typeof salesOrders.$inferSelect;
export type SalesOrder = Omit<OrderRecord, "status"> & { status: OrderStatus };

type LineRecord = typeof salesOrderLines.$inferSelect;
export type SalesOrderLine = Omit<LineRecord, "status"> & { status: LineStatus };

export function asCustomer(row: CustomerRecord): Customer {
  return row as Customer;
}
export function asOrder(row: OrderRecord): SalesOrder {
  return row as SalesOrder;
}
export function asOrderLine(row: LineRecord): SalesOrderLine {
  return row as SalesOrderLine;
}
