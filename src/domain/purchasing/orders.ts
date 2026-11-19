// Satın alma siparişi: taslak açma (elle ya da öneriden), kalem düzenleme ve silme (yalnızca taslakta), iptal.
// Gönderim ve onay approval.ts'te, mal kabul receiving.ts'tedir.
import { eq, inArray, like } from "drizzle-orm";
import { materials, purchaseOrderLines, purchaseOrders, supplierItems, suppliers } from "@/db/schema";
import { codeList, logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { istanbulYear } from "../production/calendar";
import { formatMoney, formatNumber, formatQty, lineValueKurus, UNIT_STEP_MILLI, type Unit } from "../units";
import { purchaseSuggestions } from "./suggestions";
import { asPurchaseOrder, type PurchaseOrder } from "./types";

const CODE_PREFIX = "SAS-";
const CANCELLABLE = ["draft", "pending_approval", "sent", "partial"];

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

type DraftLine = { materialId: string; qtyMilli: number; unitPriceMinor: number };

/** Modül içi (yetkiyi çağıran denetler): sıradaki SAS kodunu verir, siparişi ve kalemlerini taslak olarak yazar. */
async function insertDraft(
  tx: Ctx,
  supplier: typeof suppliers.$inferSelect,
  lines: DraftLine[],
  note: string,
  fromWorkOrders: string[],
): Promise<PurchaseOrder> {
  const prefix = `${CODE_PREFIX}${istanbulYear(tx.now)}-`;
  const existing = await tx.db.select({ code: purchaseOrders.code }).from(purchaseOrders).where(like(purchaseOrders.code, `${prefix}%`));
  const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
  const code = `${prefix}${String(max + 1).padStart(4, "0")}`;

  const [po] = await tx.db
    .insert(purchaseOrders)
    .values({ code, supplierId: supplier.id, currency: supplier.currency, note, createdBy: tx.user.id, createdAt: tx.now })
    .returning();
  if (!po) throw new Error("sipariş açılamadı");
  await tx.db.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, orderId: po.id })));

  const net = lines.reduce((sum, l) => sum + lineValueKurus(l.qtyMilli, l.unitPriceMinor), 0);
  const origin = fromWorkOrders.length > 0 ? ` (öneriden: ${codeList(fromWorkOrders)})` : "";
  await logAudit(tx, {
    entity: "purchase_order",
    entityId: po.id,
    action: "create",
    summary: `${code} taslak: ${supplier.code} ${supplier.name}, ${lines.length} kalem, ${formatMoney(net)} KDV hariç${origin}`,
  });
  return asPurchaseOrder(po);
}

async function mustFindSupplier(tx: Ctx, supplierId: string): Promise<typeof suppliers.$inferSelect> {
  const [supplier] = isUuid(supplierId) ? await tx.db.select().from(suppliers).where(eq(suppliers.id, supplierId)).for("update") : [];
  if (!supplier) throw new DomainError("NOT_FOUND", "Tedarikçi bulunamadı");
  if (!supplier.active) throw invalid("Pasif tedarikçiye sipariş açılmaz");
  return supplier;
}

export async function createPurchaseOrder(
  ctx: Ctx,
  i: { supplierId: string; lines: { materialId: string; qtyMilli: number }[]; note?: string },
): Promise<PurchaseOrder> {
  assertCan(ctx.user, "purchasing", "write");
  if (i.lines.length === 0) throw invalid("Siparişe en az bir kalem ekleyin");
  const wanted = new Map<string, number>();
  for (const l of i.lines) {
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) throw invalid("Miktar sıfırdan büyük olmalı");
    wanted.set(l.materialId, (wanted.get(l.materialId) ?? 0) + l.qtyMilli);
  }

  return inTx(ctx, async (tx) => {
    const supplier = await mustFindSupplier(tx, i.supplierId);
    const ids = [...wanted.keys()].filter(isUuid);
    const mats = ids.length > 0 ? await tx.db.select().from(materials).where(inArray(materials.id, ids)) : [];
    const items = ids.length > 0 ? await tx.db.select().from(supplierItems).where(eq(supplierItems.supplierId, supplier.id)) : [];
    const lines: DraftLine[] = [];
    for (const [materialId, qtyMilli] of wanted) {
      const m = mats.find((x) => x.id === materialId);
      if (!m) throw new DomainError("NOT_FOUND", "Malzeme bulunamadı");
      const item = items.find((x) => x.materialId === materialId);
      if (!item) throw invalid(`${m.code} bu tedarikçiden alınmıyor`);
      const step = UNIT_STEP_MILLI[m.unit as Unit];
      if (qtyMilli % step !== 0) throw invalid(`${m.code} miktarı ${formatQty(step, m.unit as Unit)} katı olmalı`);
      lines.push({ materialId, qtyMilli, unitPriceMinor: item.unitPriceMinor });
    }
    return insertDraft(tx, supplier, lines, (i.note ?? "").trim(), []);
  });
}

/** Öneriyi transaction içinde yeniden hesaplar ve verilen tedarikçinin grubunu taslağa çevirir (eski ekran ya da ikinci sekme güvenli). */
export async function createFromSuggestion(ctx: Ctx, supplierId: string): Promise<PurchaseOrder> {
  assertCan(ctx.user, "purchasing", "write");
  return inTx(ctx, async (tx) => {
    const supplier = await mustFindSupplier(tx, supplierId); // satır kilidi: aynı anda gelen ikinci çağrı sırada bekler
    const group = (await purchaseSuggestions(tx.db)).find((g) => g.supplierId === supplier.id);
    if (!group || group.lines.length === 0) throw invalid("Bu tedarikçi için öneri kalmadı");
    const lines = group.lines.map((l) => ({ materialId: l.materialId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor }));
    const workOrders = [...new Set(group.lines.flatMap((l) => l.waitingWorkOrders))].sort();
    return insertDraft(tx, supplier, lines, "", workOrders);
  });
}

/** Önce siparişi kilitler, sonra kalemi okur (eşzamanlı düzenleme eski değer yazmaz); yalnızca taslakta düzenlenir. */
async function draftLine(tx: Ctx, lineId: string) {
  const [owner] = isUuid(lineId)
    ? await tx.db.select({ orderId: purchaseOrderLines.orderId }).from(purchaseOrderLines).where(eq(purchaseOrderLines.id, lineId))
    : [];
  if (!owner) throw new DomainError("NOT_FOUND", "Sipariş kalemi bulunamadı");
  const [order] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, owner.orderId)).for("update");
  // Kilit alındıktan sonra yeniden okunur: bu arada silinen kalem için hiçbir şey yazılmaz.
  const [found] = await tx.db
    .select({ line: purchaseOrderLines, code: materials.code, unit: materials.unit })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
    .where(eq(purchaseOrderLines.id, lineId));
  if (!order || !found) throw new DomainError("NOT_FOUND", "Sipariş kalemi bulunamadı");
  if (order.status !== "draft") throw new DomainError("INVALID_STATE", "Yalnızca taslak sipariş düzenlenir");
  return { line: found.line, order, materialCode: found.code, unit: found.unit as Unit };
}

export async function orderNet(tx: Ctx, orderId: string): Promise<number> {
  const rows = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
  return rows.reduce((sum, l) => sum + lineValueKurus(l.qtyMilli, l.unitPriceMinor), 0);
}

export async function updatePurchaseLine(ctx: Ctx, i: { lineId: string; qtyMilli?: number; unitPriceMinor?: number }): Promise<void> {
  assertCan(ctx.user, "purchasing", "write");
  if (i.qtyMilli !== undefined && (!Number.isInteger(i.qtyMilli) || i.qtyMilli <= 0)) throw invalid("Miktar sıfırdan büyük olmalı");
  if (i.unitPriceMinor !== undefined && (!Number.isInteger(i.unitPriceMinor) || i.unitPriceMinor < 0)) {
    throw invalid("Fiyat sıfır ya da daha büyük olmalı");
  }
  await inTx(ctx, async (tx) => {
    const { line, order, materialCode, unit } = await draftLine(tx, i.lineId);
    const qtyMilli = i.qtyMilli ?? line.qtyMilli;
    const unitPriceMinor = i.unitPriceMinor ?? line.unitPriceMinor;
    if (qtyMilli % UNIT_STEP_MILLI[unit] !== 0) throw invalid(`Miktar ${formatQty(UNIT_STEP_MILLI[unit], unit)} katı olmalı`);
    if (qtyMilli === line.qtyMilli && unitPriceMinor === line.unitPriceMinor) return;

    const before = await orderNet(tx, order.id);
    await tx.db.update(purchaseOrderLines).set({ qtyMilli, unitPriceMinor }).where(eq(purchaseOrderLines.id, line.id));
    const after = await orderNet(tx, order.id);
    const parts: string[] = [];
    if (qtyMilli !== line.qtyMilli) parts.push(`miktar ${formatNumber(line.qtyMilli / 1000)} → ${formatQty(qtyMilli, unit)}`);
    if (unitPriceMinor !== line.unitPriceMinor) parts.push(`fiyat ${formatMoney(line.unitPriceMinor)} → ${formatMoney(unitPriceMinor)}`);
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: order.id,
      action: "update_line",
      summary: `${order.code}: ${materialCode} ${parts.join(", ")}, tutar ${formatMoney(before)} → ${formatMoney(after)}`,
    });
  });
}

export async function removePurchaseLine(ctx: Ctx, lineId: string): Promise<void> {
  assertCan(ctx.user, "purchasing", "write");
  await inTx(ctx, async (tx) => {
    const { line, order, materialCode } = await draftLine(tx, lineId);
    await tx.db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.id));
    const left = await tx.db.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: order.id,
      action: "remove_line",
      summary: `${order.code}: ${materialCode} kalemi silindi, ${left.length} kalem kaldı`,
    });
  });
}

/** Taslak, onay bekleyen, gönderilmiş ve kısmi siparişi iptal eder. Teslim alınan miktar stokta kalır. */
export async function cancelPurchaseOrder(ctx: Ctx, i: { purchaseOrderId: string; reason: string }): Promise<PurchaseOrder> {
  assertCan(ctx.user, "purchasing", "write");
  const reason = i.reason.trim();
  if (!reason) throw invalid("İptal gerekçesi yazın");
  return inTx(ctx, async (tx) => {
    const [po] = isUuid(i.purchaseOrderId)
      ? await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, i.purchaseOrderId)).for("update")
      : [];
    if (!po) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    if (!CANCELLABLE.includes(po.status)) throw new DomainError("INVALID_STATE", "Bu sipariş iptal edilemez");

    const received = await tx.db
      .select({ qtyMilli: purchaseOrderLines.qtyMilli, receivedMilli: purchaseOrderLines.receivedMilli, code: materials.code, unit: materials.unit })
      .from(purchaseOrderLines)
      .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
      .where(eq(purchaseOrderLines.orderId, po.id))
      .orderBy(materials.code);
    const kept = received
      .filter((l) => l.receivedMilli > 0)
      .map((l) => `${l.code} ${formatNumber(l.receivedMilli / 1000)}/${formatQty(l.qtyMilli, l.unit as Unit)}`);

    const [row] = await tx.db
      .update(purchaseOrders)
      .set({ status: "cancelled", cancelledAt: tx.now, cancelReason: reason })
      .where(eq(purchaseOrders.id, po.id))
      .returning();
    if (!row) throw new Error("sipariş iptal edilemedi");
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: po.id,
      action: "cancel",
      summary: `${po.code} iptal edildi: ${reason}${kept.length > 0 ? `; teslim alınan ${kept.join(", ")} stokta kalır` : ""}`,
    });
    return asPurchaseOrder(row);
  });
}
