import { and, asc, eq, like } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, products, salesOrderLines, salesOrders } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { istanbulDayStart, istanbulYear } from "../production/calendar";
import { releaseProduct, reserveProduct, shipProduct } from "../production/productLedger";
import type { Shortage } from "../production/types";
import { cancelWorkOrderForLine, findShortages, materialNeeds, type MaterialNeed, openWorkOrder } from "../production/workOrders";
import { refreshOrderStatus, setLineStatus } from "./status";
import { asOrder, asOrderLine, type LineStatus, type SalesOrder, type SalesOrderLine } from "./types";

const CODE_PREFIX = "SIP-";
const MIN_QTY_MILLI = 1_000;
const MAX_QTY_MILLI = 9_999_000;

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
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
  if (i.dueAt.getTime() < istanbulDayStart(ctx.now).getTime()) throw invalid("Termin geçmiş bir gün olamaz");

  return inTx(ctx, async (tx) => {
    const [customer] = isUuid(i.customerId) ? await tx.db.select().from(customers).where(eq(customers.id, i.customerId)) : [];
    if (!customer) throw new DomainError("NOT_FOUND", "Müşteri bulunamadı");

    const prefix = `${CODE_PREFIX}${istanbulYear(ctx.now)}-`;
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

/**
 * Siparişi onaylar; satırlar sırayla, tek transaction içinde işlenir. Her satıra kullanılabilir mamul
 * ayrılır; kalan adet için iş emri açılır (malzemeler hepsi-ya-hiçbiri ayrılır). Önceki satırların
 * ayırdıkları sonrakilerden düşülür. Dönen eksikler, bütün satırlar işlendikten sonraki stoğa göre
 * malzemesini bekleyen iş emirlerinin toplam ihtiyacıdır.
 */
export async function confirmOrder(ctx: Ctx, orderId: string): Promise<{ order: SalesOrder; shortages: Shortage[] }> {
  assertCan(ctx.user, "sales", "write");
  return inTx(ctx, async (tx) => {
    const [order] = isUuid(orderId) ? await tx.db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).for("update") : [];
    if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    if (order.status !== "draft") throw new DomainError("INVALID_STATE", "Sipariş zaten onaylanmış");
    const lines = await tx.db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(asc(salesOrderLines.createdAt), asc(salesOrderLines.id));
    if (lines.length === 0) throw invalid("Satırsız sipariş onaylanamaz");

    const waitingNeeds: MaterialNeed[] = [];
    for (const line of lines) {
      const [product] = await tx.db.select().from(products).where(eq(products.id, line.productId));
      if (!product) throw new DomainError("NOT_FOUND", "Ürün bulunamadı");
      const reserve = Math.min(Math.max(product.onHandMilli - product.reservedMilli, 0), line.qtyMilli);
      if (reserve > 0) {
        await reserveProduct(tx, { productId: product.id, qtyMilli: reserve, ref: { type: "sales_order_line", id: line.id } });
      }

      let status: LineStatus = "ready";
      const remaining = line.qtyMilli - reserve;
      if (remaining > 0) {
        const { workOrder } = await openWorkOrder(tx, { productId: product.id, qtyMilli: remaining, salesOrderLineId: line.id });
        if (workOrder.materialsReserved) {
          status = "in_production";
        } else {
          status = "waiting_material";
          waitingNeeds.push(...(await materialNeeds(tx.db, product.id, remaining)));
        }
      }
      await setLineStatus(tx, line.id, status, line.reservedMilli + reserve);
    }

    await tx.db.update(salesOrders).set({ status: "confirmed", confirmedAt: tx.now }).where(eq(salesOrders.id, order.id));
    await logAudit(tx, { entity: "sales_order", entityId: order.id, action: "confirm", summary: `${order.code} onaylandı` });
    await refreshOrderStatus(tx, order.id);

    const [row] = await tx.db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    if (!row) throw new Error("sipariş okunamadı");
    return { order: asOrder(row), shortages: await findShortages(tx.db, waitingNeeds) };
  });
}

/** Hazır siparişi sevk eder (Depo): her satırın ayrılmış mamulü çıkar, satırlar ve sipariş sevk edilmiş olur. */
export async function shipOrder(ctx: Ctx, orderId: string): Promise<SalesOrder> {
  assertCan(ctx.user, "inventory", "execute");
  return inTx(ctx, async (tx) => {
    const [order] = isUuid(orderId) ? await tx.db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).for("update") : [];
    if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    const all = await tx.db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(asc(salesOrderLines.createdAt), asc(salesOrderLines.id));
    const lines = all.filter((l) => l.status !== "cancelled");
    if (order.status !== "ready" || lines.length === 0 || lines.some((l) => l.status !== "ready")) {
      throw new DomainError("INVALID_STATE", "Sevk için bütün kalemler hazır olmalı");
    }
    for (const line of lines) {
      await shipProduct(tx, { productId: line.productId, qtyMilli: line.qtyMilli, ref: { type: "sales_order_line", id: line.id } });
      await setLineStatus(tx, line.id, "shipped", 0);
    }
    await tx.db.update(salesOrders).set({ status: "shipped", shippedAt: tx.now }).where(eq(salesOrders.id, order.id));
    await logAudit(tx, { entity: "sales_order", entityId: order.id, action: "ship", summary: `${order.code} sevk edildi` });
    const [row] = await tx.db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    if (!row) throw new Error("sipariş okunamadı");
    return asOrder(row);
  });
}

/**
 * Siparişi iptal eder. Taslağı satış uzmanı, onaylı siparişi müdür iptal eder. Her satırın ayrılmış mamulü
 * serbest kalır; planlı iş emirleri iptal olur ve malzemeleri serbest kalır, üretimdeki iş emri sürer.
 */
export async function cancelOrder(ctx: Ctx, i: { orderId: string; reason: string }): Promise<SalesOrder> {
  assertCan(ctx.user, "sales", "write");
  const reason = i.reason?.trim() ?? "";
  if (reason === "") throw invalid("İptal gerekçesi boş olamaz");

  return inTx(ctx, async (tx) => {
    const [order] = isUuid(i.orderId) ? await tx.db.select().from(salesOrders).where(eq(salesOrders.id, i.orderId)).for("update") : [];
    if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    if (order.status !== "draft") assertCan(tx.user, "sales", "approve");
    if (order.status === "shipped" || order.status === "cancelled") {
      throw new DomainError("INVALID_STATE", order.status === "shipped" ? "Sevk edilmiş sipariş iptal edilemez" : "Sipariş zaten iptal edilmiş");
    }

    const lines = await tx.db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(asc(salesOrderLines.createdAt), asc(salesOrderLines.id));
    for (const line of lines) {
      if (line.reservedMilli > 0) {
        await releaseProduct(tx, { productId: line.productId, qtyMilli: line.reservedMilli, ref: { type: "sales_order_line", id: line.id } });
      }
      await setLineStatus(tx, line.id, "cancelled", 0);
      await cancelWorkOrderForLine(tx, line.id, `${order.code} iptal edildi`);
    }

    await tx.db.update(salesOrders).set({ status: "cancelled", cancelledAt: tx.now }).where(eq(salesOrders.id, order.id));
    await logAudit(tx, { entity: "sales_order", entityId: order.id, action: "cancel", summary: `${order.code} iptal edildi: ${reason}` });
    const [row] = await tx.db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    if (!row) throw new Error("sipariş okunamadı");
    return asOrder(row);
  });
}
