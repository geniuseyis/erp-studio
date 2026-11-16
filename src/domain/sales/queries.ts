import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, products, salesOrderLines, salesOrders, users, workOrders } from "@/db/schema";
import { isUuid } from "../context";
import { asWorkOrder, type ProductFinish, type WorkOrderStatus } from "../production/types";
import { matchesSearch } from "../text";
import { lineNetKurus, orderTotals } from "./money";
import { asCustomer, asOrder, asOrderLine, type Customer, type CustomerKind, type OrderStatus, type SalesOrderLine } from "./types";

/** Açık sipariş: onaylanmış ama sevk edilmemiş. Taslak ve iptal sayılmaz. */
const OPEN_STATUSES: readonly OrderStatus[] = ["confirmed", "in_production", "ready"];

export type OrderRow = {
  id: string;
  code: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  waitingMaterial: boolean;
  dueAt: Date;
  overdue: boolean;
  lineCount: number;
  netKurus: number;
  totalKurus: number;
  createdAt: Date;
};

type OrderRecord = typeof salesOrders.$inferSelect;
type LineRecord = typeof salesOrderLines.$inferSelect;

function toOrderRow(record: OrderRecord, customerName: string, lines: LineRecord[], now: Date): OrderRow {
  const order = asOrder(record);
  const totals = orderTotals(lines.map(asOrderLine));
  const dueAt = order.dueAt ?? order.createdAt;
  return {
    id: order.id,
    code: order.code,
    customerId: order.customerId,
    customerName,
    status: order.status,
    waitingMaterial: lines.some((l) => l.status === "waiting_material"),
    dueAt,
    overdue: order.dueAt !== null && order.dueAt.getTime() < now.getTime() && order.status !== "draft" && order.status !== "shipped" && order.status !== "cancelled",
    lineCount: lines.filter((l) => l.status !== "cancelled").length,
    netKurus: totals.netKurus,
    totalKurus: totals.totalKurus,
    createdAt: order.createdAt,
  };
}

async function orderRows(db: Db, now: Date, only?: { id?: string }): Promise<OrderRow[]> {
  const orders = await db
    .select({ order: salesOrders, customerName: customers.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(only?.id ? eq(salesOrders.id, only.id) : undefined)
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.code));
  if (orders.length === 0) return [];
  const lines = only?.id
    ? await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, only.id))
    : await db.select().from(salesOrderLines);
  const byOrder = new Map<string, LineRecord[]>();
  for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);
  return orders.map((o) => toOrderRow(o.order, o.customerName, byOrder.get(o.order.id) ?? [], now));
}

export type OrderFilter = { search?: string; status?: OrderStatus; customerId?: string; now?: Date };

/** Siparişler, yeniden eskiye. Arama sipariş kodu ve müşteri adında, Türkçe harf duyarsızdır. */
export async function listOrders(db: Db, f: OrderFilter = {}): Promise<OrderRow[]> {
  const rows = await orderRows(db, f.now ?? new Date());
  return rows
    .filter((o) => !f.status || o.status === f.status)
    .filter((o) => !f.customerId || o.customerId === f.customerId)
    .filter((o) => matchesSearch([o.code, o.customerName], f.search));
}

export type OrderLineRow = SalesOrderLine & {
  productCode: string;
  productName: string;
  finish: ProductFinish;
  netKurus: number;
  workOrder: { id: string; code: string; status: WorkOrderStatus; materialsReserved: boolean } | null;
};
export type OrderDetail = OrderRow & {
  note: string;
  customer: Customer;
  lines: OrderLineRow[];
  totals: ReturnType<typeof orderTotals>;
  createdByName: string;
};

export async function getOrder(db: Db, id: string, now: Date = new Date()): Promise<OrderDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await orderRows(db, now, { id });
  if (!row) return null;
  const [head] = await db
    .select({ order: salesOrders, customer: customers, createdByName: users.name })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(users, eq(users.id, salesOrders.createdBy))
    .where(eq(salesOrders.id, id));
  if (!head) return null;

  const lineRows = await db
    .select({ line: salesOrderLines, productCode: products.code, productName: products.name, finish: products.finish })
    .from(salesOrderLines)
    .innerJoin(products, eq(products.id, salesOrderLines.productId))
    .where(eq(salesOrderLines.orderId, id))
    .orderBy(asc(salesOrderLines.createdAt), asc(salesOrderLines.id));
  const lineIds = lineRows.map((l) => l.line.id);
  const linked = lineIds.length
    ? await db.select().from(workOrders).where(inArray(workOrders.salesOrderLineId, lineIds)).orderBy(asc(workOrders.createdAt), asc(workOrders.code))
    : [];
  // Bir satırın birden çok iş emri olabilir (iptal edilip yenisi açılmış); iptal olmayan sonuncu öne geçer.
  const workOrderByLine = new Map<string, ReturnType<typeof asWorkOrder>>();
  for (const w of linked.map(asWorkOrder)) {
    const current = w.salesOrderLineId ? workOrderByLine.get(w.salesOrderLineId) : undefined;
    if (w.salesOrderLineId && (!current || current.status === "cancelled" || w.status !== "cancelled")) {
      workOrderByLine.set(w.salesOrderLineId, w);
    }
  }

  const lines = lineRows.map((r): OrderLineRow => {
    const line = asOrderLine(r.line);
    const wo = workOrderByLine.get(line.id);
    return {
      ...line,
      productCode: r.productCode,
      productName: r.productName,
      finish: r.finish as ProductFinish,
      netKurus: lineNetKurus(line.qtyMilli, line.unitPriceKurus, line.discountPermille),
      workOrder: wo ? { id: wo.id, code: wo.code, status: wo.status, materialsReserved: wo.materialsReserved } : null,
    };
  });
  return {
    ...row,
    note: head.order.note,
    customer: asCustomer(head.customer),
    lines,
    totals: orderTotals(lines),
    createdByName: head.createdByName,
  };
}

export type CustomerRow = Customer & { orderCount: number; openOrderTotalKurus: number; lastOrderAt: Date | null };
export type CustomerFilter = { search?: string; kind?: CustomerKind };

async function customerRows(db: Db, id?: string): Promise<CustomerRow[]> {
  const found = await db.select().from(customers).where(id ? eq(customers.id, id) : undefined).orderBy(asc(customers.name), asc(customers.code));
  if (found.length === 0) return [];
  const orders = await orderRows(db, new Date());
  const byCustomer = new Map<string, OrderRow[]>();
  for (const o of orders) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
  return found.map((c) => {
    const mine = byCustomer.get(c.id) ?? [];
    return {
      ...asCustomer(c),
      orderCount: mine.length,
      openOrderTotalKurus: mine.filter((o) => OPEN_STATUSES.includes(o.status)).reduce((sum, o) => sum + o.totalKurus, 0),
      lastOrderAt: mine.reduce<Date | null>((latest, o) => (latest && latest > o.createdAt ? latest : o.createdAt), null),
    };
  });
}

/** Müşteriler, ada göre. Arama ad, kod ve ilde. */
export async function listCustomers(db: Db, f: CustomerFilter = {}): Promise<CustomerRow[]> {
  const rows = await customerRows(db);
  return rows.filter((c) => !f.kind || c.kind === f.kind).filter((c) => matchesSearch([c.name, c.code, c.city], f.search));
}

export async function getCustomer(db: Db, id: string): Promise<CustomerRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await customerRows(db, id);
  return row ?? null;
}

export type SalesSummary = { openOrders: number; waitingMaterial: number; overdue: number; openTotalKurus: number };

export async function salesSummary(db: Db, now: Date): Promise<SalesSummary> {
  const rows = await orderRows(db, now);
  const open = rows.filter((o) => OPEN_STATUSES.includes(o.status));
  return {
    openOrders: open.length,
    waitingMaterial: rows.filter((o) => o.waitingMaterial).length,
    overdue: rows.filter((o) => o.overdue).length,
    openTotalKurus: open.reduce((sum, o) => sum + o.totalKurus, 0),
  };
}
