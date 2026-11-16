import { and, eq, like } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, products, salesOrderLines, salesOrders } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { asOrder, asOrderLine, type SalesOrder, type SalesOrderLine } from "./types";

const CODE_PREFIX = "SIP-";
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3, yaz/kış saati yok
const MIN_QTY_MILLI = 1_000;
const MAX_QTY_MILLI = 9_999_000;

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

/** Verilen anın İstanbul takvim günü: yıl ve günün başlangıcı (UTC anı olarak). */
function istanbulDay(at: Date): { year: number; startsAt: Date } {
  const shifted = new Date(at.getTime() + ISTANBUL_OFFSET_MS);
  const startsAt = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - ISTANBUL_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), startsAt };
}

function checkQty(qtyMilli: number): void {
  if (!Number.isInteger(qtyMilli) || qtyMilli < MIN_QTY_MILLI || qtyMilli > MAX_QTY_MILLI || qtyMilli % 1000 !== 0) {
    throw invalid("Adet 1 ile 9999 arasında tam sayı olmalı");
  }
}

function checkDiscount(discountPermille: number): void {
  if (!Number.isInteger(discountPermille) || discountPermille < 0 || discountPermille > 500) {
    throw invalid("İskonto 0 ile 500 binde arasında olmalı");
  }
}

async function mustFindDraftOrder(db: Db, orderId: string): Promise<typeof salesOrders.$inferSelect> {
  const [order] = isUuid(orderId) ? await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).for("update") : [];
  if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
  if (order.status !== "draft") throw new DomainError("INVALID_STATE", "Yalnızca taslak siparişin satırları değiştirilebilir");
  return order;
}

async function mustFindLine(db: Db, lineId: string): Promise<typeof salesOrderLines.$inferSelect> {
  const [line] = isUuid(lineId) ? await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, lineId)) : [];
  if (!line) throw new DomainError("NOT_FOUND", "Sipariş satırı bulunamadı");
  return line;
}

export async function createOrder(ctx: Ctx, i: { customerId: string; dueAt: Date; note?: string }): Promise<SalesOrder> {
  assertCan(ctx.user, "sales", "write");
  if (!(i.dueAt instanceof Date) || Number.isNaN(i.dueAt.getTime())) throw invalid("Termin geçersiz");
  const today = istanbulDay(ctx.now);
  if (i.dueAt.getTime() < today.startsAt.getTime()) throw invalid("Termin geçmiş bir gün olamaz");

  return inTx(ctx, async (tx) => {
    const [customer] = isUuid(i.customerId) ? await tx.db.select().from(customers).where(eq(customers.id, i.customerId)) : [];
    if (!customer) throw new DomainError("NOT_FOUND", "Müşteri bulunamadı");

    const prefix = `${CODE_PREFIX}${today.year}-`;
    const existing = await tx.db.select({ code: salesOrders.code }).from(salesOrders).where(like(salesOrders.code, `${prefix}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
    const code = `${prefix}${String(max + 1).padStart(4, "0")}`;

    const [row] = await tx.db
      .insert(salesOrders)
      .values({ code, customerId: customer.id, dueAt: i.dueAt, note: i.note?.trim() ?? "", createdBy: tx.user.id, createdAt: tx.now })
      .returning();
    if (!row) throw new Error("sipariş açılamadı");
    await logAudit(tx, { entity: "sales_order", entityId: row.id, action: "create", summary: `${code} taslağı açıldı (${customer.name})` });
    return asOrder(row);
  });
}

/** Ürünün o anki fiyatı ve KDV oranı satıra kopyalanır. Aynı ürün varsa adet artar. */
export async function addLine(
  ctx: Ctx,
  i: { orderId: string; productId: string; qtyMilli: number; discountPermille?: number },
): Promise<SalesOrderLine> {
  assertCan(ctx.user, "sales", "write");
  checkQty(i.qtyMilli);
  if (i.discountPermille !== undefined) checkDiscount(i.discountPermille);

  return inTx(ctx, async (tx) => {
    const order = await mustFindDraftOrder(tx.db, i.orderId);
    const [product] = isUuid(i.productId) ? await tx.db.select().from(products).where(eq(products.id, i.productId)) : [];
    if (!product) throw new DomainError("NOT_FOUND", "Ürün bulunamadı");
    if (!product.active) throw invalid("Pasif ürün siparişe eklenemez");

    const [same] = await tx.db
      .select()
      .from(salesOrderLines)
      .where(and(eq(salesOrderLines.orderId, order.id), eq(salesOrderLines.productId, product.id)));
    if (same) {
      const qtyMilli = same.qtyMilli + i.qtyMilli;
      checkQty(qtyMilli);
      const [row] = await tx.db
        .update(salesOrderLines)
        .set({ qtyMilli, ...(i.discountPermille !== undefined ? { discountPermille: i.discountPermille } : {}) })
        .where(eq(salesOrderLines.id, same.id))
        .returning();
      if (!row) throw new Error("satır güncellenemedi");
      await logAudit(tx, {
        entity: "sales_order",
        entityId: order.id,
        action: "update_line",
        summary: `${order.code}: ${product.code} adedi ${same.qtyMilli / 1000} → ${qtyMilli / 1000}`,
      });
      return asOrderLine(row);
    }

    const [row] = await tx.db
      .insert(salesOrderLines)
      .values({
        orderId: order.id,
        productId: product.id,
        qtyMilli: i.qtyMilli,
        unitPriceKurus: product.priceKurus,
        discountPermille: i.discountPermille ?? 0,
        vatRate: product.vatRate,
        createdAt: tx.now,
      })
      .returning();
    if (!row) throw new Error("satır eklenemedi");
    await logAudit(tx, {
      entity: "sales_order",
      entityId: order.id,
      action: "add_line",
      summary: `${order.code}: ${product.code} × ${i.qtyMilli / 1000} eklendi`,
    });
    return asOrderLine(row);
  });
}

export async function updateLine(ctx: Ctx, i: { lineId: string; qtyMilli?: number; discountPermille?: number }): Promise<void> {
  assertCan(ctx.user, "sales", "write");
  if (i.qtyMilli !== undefined) checkQty(i.qtyMilli);
  if (i.discountPermille !== undefined) checkDiscount(i.discountPermille);

  await inTx(ctx, async (tx) => {
    const line = await mustFindLine(tx.db, i.lineId);
    const order = await mustFindDraftOrder(tx.db, line.orderId);
    const set: { qtyMilli?: number; discountPermille?: number } = {};
    if (i.qtyMilli !== undefined) set.qtyMilli = i.qtyMilli;
    if (i.discountPermille !== undefined) set.discountPermille = i.discountPermille;
    if (Object.keys(set).length === 0) return;
    await tx.db.update(salesOrderLines).set(set).where(eq(salesOrderLines.id, line.id));
    await logAudit(tx, { entity: "sales_order", entityId: order.id, action: "update_line", summary: `${order.code}: satır güncellendi` });
  });
}

export async function removeLine(ctx: Ctx, lineId: string): Promise<void> {
  assertCan(ctx.user, "sales", "write");
  await inTx(ctx, async (tx) => {
    const line = await mustFindLine(tx.db, lineId);
    const order = await mustFindDraftOrder(tx.db, line.orderId);
    await tx.db.delete(salesOrderLines).where(eq(salesOrderLines.id, line.id));
    await logAudit(tx, { entity: "sales_order", entityId: order.id, action: "remove_line", summary: `${order.code}: satır silindi` });
  });
}
