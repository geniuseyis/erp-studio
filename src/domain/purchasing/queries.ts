import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { goodsReceiptLines, goodsReceipts, materials, purchaseOrderLines, purchaseOrders, supplierItems, suppliers, users } from "@/db/schema";
import { isUuid } from "../context";
import { istanbulDayStart } from "../production/calendar";
import { matchesSearch } from "../text";
import { lineValueKurus, type Unit } from "../units";
import {
  type ApprovalTier,
  asSupplier,
  type Currency,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
  type Supplier,
  type SupplierItem,
} from "./types";

/** Açık sipariş: onay bekleyen, gönderilmiş ya da kısmen teslim alınmış. Taslak, tamamlanmış ve iptal sayılmaz. */
const OPEN_STATUSES: readonly PurchaseOrderStatus[] = ["pending_approval", "sent", "partial"];

export type SupplierRow = Supplier & { itemCount: number; openOrderCount: number; openNetMinor: number };
export type SupplierItemRow = SupplierItem & { materialCode: string; materialName: string; unit: Unit };
export type SupplierDetail = SupplierRow & { items: SupplierItemRow[] };

/** Açık tutar, açık siparişlerin teslim alınmamış kalan miktarının değeridir (KDV hariç, tedarikçinin para biriminin küçük birimi). */
async function supplierRows(db: Db, only?: { id: string }): Promise<SupplierRow[]> {
  const records = await db
    .select()
    .from(suppliers)
    .where(only ? eq(suppliers.id, only.id) : undefined)
    .orderBy(asc(suppliers.code));
  if (records.length === 0) return [];
  const ids = records.map((s) => s.id);

  const itemCounts = new Map<string, number>();
  for (const r of await db.select({ supplierId: supplierItems.supplierId }).from(supplierItems).where(inArray(supplierItems.supplierId, ids))) {
    itemCounts.set(r.supplierId, (itemCounts.get(r.supplierId) ?? 0) + 1);
  }

  const open = new Map<string, { orders: Set<string>; net: number }>();
  const lines = await db
    .select({
      supplierId: purchaseOrders.supplierId,
      orderId: purchaseOrders.id,
      qtyMilli: purchaseOrderLines.qtyMilli,
      receivedMilli: purchaseOrderLines.receivedMilli,
      unitPriceMinor: purchaseOrderLines.unitPriceMinor,
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.orderId, purchaseOrders.id))
    .where(and(inArray(purchaseOrders.supplierId, ids), inArray(purchaseOrders.status, [...OPEN_STATUSES])));
  for (const l of lines) {
    const entry = open.get(l.supplierId) ?? { orders: new Set<string>(), net: 0 };
    entry.orders.add(l.orderId);
    // Açık tutar yalnızca teslim alınmamış kalan miktarın değeridir.
    entry.net += lineValueKurus(l.qtyMilli - l.receivedMilli, l.unitPriceMinor);
    open.set(l.supplierId, entry);
  }

  return records.map((s) => ({
    ...asSupplier(s),
    itemCount: itemCounts.get(s.id) ?? 0,
    openOrderCount: open.get(s.id)?.orders.size ?? 0,
    openNetMinor: open.get(s.id)?.net ?? 0,
  }));
}

/** Tedarikçiler, koda göre. Arama kod, ad ve ilde, Türkçe harf duyarsızdır. */
export async function listSuppliers(db: Db, f: { search?: string } = {}): Promise<SupplierRow[]> {
  const rows = await supplierRows(db);
  return rows.filter((s) => matchesSearch([s.code, s.name, s.city], f.search));
}

export async function getSupplier(db: Db, id: string): Promise<SupplierDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await supplierRows(db, { id });
  if (!row) return null;
  const items = await db
    .select({ item: supplierItems, materialCode: materials.code, materialName: materials.name, unit: materials.unit })
    .from(supplierItems)
    .innerJoin(materials, eq(materials.id, supplierItems.materialId))
    .where(eq(supplierItems.supplierId, id))
    .orderBy(asc(materials.code));
  return { ...row, items: items.map((r) => ({ ...r.item, materialCode: r.materialCode, materialName: r.materialName, unit: r.unit as Unit })) };
}

export type PurchaseOrderRow = {
  id: string;
  code: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  currency: Currency;
  netMinor: number;
  netKurus: number;
  lineCount: number;
  createdAt: Date;
  createdById: string;
  createdByName: string;
  requiredTier: ApprovalTier;
  managerApprovedBy: string | null;
  boardApprovedBy: string | null;
  expectedAt: Date | null;
  /** Açık (gönderilmiş ya da kısmi) ve beklenen İstanbul günü bugünden önce. */
  late: boolean;
};
export type PurchaseOrderFilter = { search?: string; status?: PurchaseOrderStatus; supplierId?: string; now?: Date };
export type PurchaseOrderLineRow = PurchaseOrderLine & {
  materialCode: string;
  materialName: string;
  unit: Unit;
  remainingMilli: number;
  lineNetMinor: number;
};
export type PurchaseOrderDetail = PurchaseOrderRow & {
  lines: PurchaseOrderLineRow[];
  note: string;
  cancelReason: string;
  submittedAt: Date | null;
  sentAt: Date | null;
  managerApprovedByName: string | null;
  boardApprovedByName: string | null;
  receipts: { id: string; code: string; deliveryNote: string; createdAt: Date; receivedByName: string; lineCount: number }[];
};

/** Sipariş satırları: sipariş başına kalem sayısı ve KDV hariç tutar (satır başına kuruşa yuvarlanır). İki sorgu. */
async function orderRecords(db: Db, where: ReturnType<typeof and>) {
  const creator = alias(users, "creator");
  const records = await db
    .select({ order: purchaseOrders, supplierCode: suppliers.code, supplierName: suppliers.name, createdByName: creator.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(creator, eq(creator.id, purchaseOrders.createdBy))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.code));
  const totals = new Map<string, { count: number; net: number }>();
  if (records.length > 0) {
    const sums = await db
      .select({
        orderId: purchaseOrderLines.orderId,
        count: sql<number>`count(*)::int`,
        net: sql<number>`sum(round(${purchaseOrderLines.qtyMilli} * ${purchaseOrderLines.unitPriceMinor} / 1000.0))::float8`,
      })
      .from(purchaseOrderLines)
      .where(inArray(purchaseOrderLines.orderId, records.map((r) => r.order.id)))
      .groupBy(purchaseOrderLines.orderId);
    for (const s of sums) totals.set(s.orderId, { count: Number(s.count), net: Number(s.net) });
  }
  return { records, totals };
}

function toRow(
  r: Awaited<ReturnType<typeof orderRecords>>["records"][number],
  totals: Map<string, { count: number; net: number }>,
  now: Date,
): PurchaseOrderRow {
  const o = r.order;
  const net = totals.get(o.id)?.net ?? 0;
  const open = o.status === "sent" || o.status === "partial";
  return {
    id: o.id,
    code: o.code,
    supplierId: o.supplierId,
    supplierCode: r.supplierCode,
    supplierName: r.supplierName,
    status: o.status as PurchaseOrderStatus,
    currency: o.currency as Currency,
    netMinor: net,
    netKurus: net, // 3A'da yalnızca TL
    lineCount: totals.get(o.id)?.count ?? 0,
    createdAt: o.createdAt,
    createdById: o.createdBy,
    createdByName: r.createdByName,
    requiredTier: o.requiredTier as ApprovalTier,
    managerApprovedBy: o.managerApprovedBy,
    boardApprovedBy: o.boardApprovedBy,
    expectedAt: o.expectedAt,
    late: open && o.expectedAt !== null && istanbulDayStart(o.expectedAt).getTime() < istanbulDayStart(now).getTime(),
  };
}

/** Siparişler, yeniden eskiye. Arama sipariş kodu, tedarikçi kodu ve adında, Türkçe harf duyarsızdır. En çok 2 sorgu. */
export async function listPurchaseOrders(db: Db, f: PurchaseOrderFilter = {}): Promise<PurchaseOrderRow[]> {
  const now = f.now ?? new Date();
  const where = and(
    f.status ? eq(purchaseOrders.status, f.status) : undefined,
    f.supplierId ? (isUuid(f.supplierId) ? eq(purchaseOrders.supplierId, f.supplierId) : sql`false`) : undefined,
  );
  const { records, totals } = await orderRecords(db, where);
  return records.map((r) => toRow(r, totals, now)).filter((r) => matchesSearch([r.code, r.supplierCode, r.supplierName], f.search));
}

export async function getPurchaseOrder(db: Db, id: string, now: Date = new Date()): Promise<PurchaseOrderDetail | null> {
  if (!isUuid(id)) return null;
  const { records, totals } = await orderRecords(db, eq(purchaseOrders.id, id));
  const record = records[0];
  if (!record) return null;
  const o = record.order;

  const lineRows = await db
    .select({ line: purchaseOrderLines, materialCode: materials.code, materialName: materials.name, unit: materials.unit })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
    .where(eq(purchaseOrderLines.orderId, id))
    .orderBy(asc(materials.code));

  const approverIds = [o.managerApprovedBy, o.boardApprovedBy].filter((x): x is string => x !== null);
  const names = new Map<string, string>();
  if (approverIds.length > 0) {
    for (const u of await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, approverIds))) names.set(u.id, u.name);
  }

  const receiptRows = await db
    .select({ receipt: goodsReceipts, receivedByName: users.name })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .where(eq(goodsReceipts.purchaseOrderId, id))
    .orderBy(desc(goodsReceipts.createdAt), desc(goodsReceipts.code));
  const counts = new Map<string, number>();
  if (receiptRows.length > 0) {
    const sums = await db
      .select({ receiptId: goodsReceiptLines.receiptId, count: sql<number>`count(*)::int` })
      .from(goodsReceiptLines)
      .where(inArray(goodsReceiptLines.receiptId, receiptRows.map((r) => r.receipt.id)))
      .groupBy(goodsReceiptLines.receiptId);
    for (const s of sums) counts.set(s.receiptId, Number(s.count));
  }

  return {
    ...toRow(record, totals, now),
    note: o.note,
    cancelReason: o.cancelReason,
    submittedAt: o.submittedAt,
    sentAt: o.sentAt,
    managerApprovedByName: o.managerApprovedBy ? (names.get(o.managerApprovedBy) ?? null) : null,
    boardApprovedByName: o.boardApprovedBy ? (names.get(o.boardApprovedBy) ?? null) : null,
    lines: lineRows.map((r) => ({
      ...r.line,
      materialCode: r.materialCode,
      materialName: r.materialName,
      unit: r.unit as Unit,
      remainingMilli: r.line.qtyMilli - r.line.receivedMilli,
      lineNetMinor: lineValueKurus(r.line.qtyMilli, r.line.unitPriceMinor),
    })),
    receipts: receiptRows.map((r) => ({
      id: r.receipt.id,
      code: r.receipt.code,
      deliveryNote: r.receipt.deliveryNote,
      createdAt: r.receipt.createdAt,
      receivedByName: r.receivedByName,
      lineCount: counts.get(r.receipt.id) ?? 0,
    })),
  };
}
