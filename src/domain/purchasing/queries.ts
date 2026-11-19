import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, purchaseOrderLines, purchaseOrders, supplierItems, suppliers } from "@/db/schema";
import { isUuid } from "../context";
import { matchesSearch } from "../text";
import type { Unit } from "../units";
import { asSupplier, type PurchaseOrderStatus, type Supplier, type SupplierItem } from "./types";

/** Açık sipariş: onay bekleyen, gönderilmiş ya da kısmen teslim alınmış. Taslak, tamamlanmış ve iptal sayılmaz. */
const OPEN_STATUSES: readonly PurchaseOrderStatus[] = ["pending_approval", "sent", "partial"];

export type SupplierRow = Supplier & { itemCount: number; openOrderCount: number; openNetMinor: number };
export type SupplierItemRow = SupplierItem & { materialCode: string; materialName: string; unit: Unit };
export type SupplierDetail = SupplierRow & { items: SupplierItemRow[] };

/** Tutar, sipariş satırlarının toplamıdır (KDV hariç, tedarikçinin para biriminin küçük birimi). */
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
      unitPriceMinor: purchaseOrderLines.unitPriceMinor,
    })
    .from(purchaseOrders)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.orderId, purchaseOrders.id))
    .where(and(inArray(purchaseOrders.supplierId, ids), inArray(purchaseOrders.status, [...OPEN_STATUSES])));
  for (const l of lines) {
    const entry = open.get(l.supplierId) ?? { orders: new Set<string>(), net: 0 };
    entry.orders.add(l.orderId);
    entry.net += Math.round((l.qtyMilli * l.unitPriceMinor) / 1000);
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
