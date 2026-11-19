// Mal kabul: gönderilmiş siparişin teslim alınan kalemleri stoğa girer (stok defteri üzerinden, ortalama maliyet güncellenir),
// ardından bu malzemeleri bekleyen iş emirlerine termin sırasıyla ayrılır.
import { and, eq, like, sql } from "drizzle-orm";
import { goodsReceiptLines, goodsReceipts, materials, purchaseOrderLines, purchaseOrders } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { receiveStock } from "../inventory/ledger";
import { assertCan } from "../permissions";
import { istanbulYear } from "../production/calendar";
import { reserveWaitingWorkOrdersInternal } from "../production/workOrders";
import { formatMoney, formatQty, UNIT_STEP_MILLI, type Unit } from "../units";
import { asGoodsReceipt, type GoodsReceipt, type PurchaseOrderStatus } from "./types";

const CODE_PREFIX = "MK-";
const MAX_NOTE = 40;

export type ReceiptInput = { purchaseOrderId: string; deliveryNote: string; lines: { lineId: string; qtyMilli: number }[] };
/** `readyWorkOrders`: bu teslimle malzemesi ayrılıp üretime hazır olan iş emri kodları. */
export type ReceiptResult = { receipt: GoodsReceipt; status: PurchaseOrderStatus; readyWorkOrders: string[] };

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

export async function receiveGoods(ctx: Ctx, i: ReceiptInput): Promise<ReceiptResult> {
  assertCan(ctx.user, "inventory", "execute");
  const deliveryNote = i.deliveryNote.trim();
  if (!deliveryNote) throw invalid("İrsaliye numarası yazın");
  if (deliveryNote.length > MAX_NOTE) throw invalid(`İrsaliye numarası en çok ${MAX_NOTE} karakter olabilir`);
  const wanted = new Map<string, number>();
  for (const l of i.lines) {
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli < 0) throw invalid("Miktar sıfır ya da daha büyük olmalı");
    wanted.set(l.lineId, (wanted.get(l.lineId) ?? 0) + l.qtyMilli);
  }

  return inTx(ctx, async (tx) => {
    // Sipariş satır kilidi: aynı anda gelen ikinci mal kabul sırada bekler ve kalanı yeniden görür.
    const [po] = isUuid(i.purchaseOrderId)
      ? await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, i.purchaseOrderId)).for("update")
      : [];
    if (!po) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    if (po.status !== "sent" && po.status !== "partial") throw new DomainError("INVALID_STATE", "Bu sipariş mal kabule açık değil");

    // Tedarikçi başına danışma kilidi: aynı irsaliyeyi aynı anda giren iki işlem sırayla çalışır, ikincisi kopyayı görür.
    // Kilit işlem bitince kendiliğinden kalkar. MK kodu için ayrı, genel bir kilit aşağıdadır (farklı tedarikçiler çakışabilir).
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${po.supplierId}))`);
    const [dup] = await tx.db
      .select({ code: goodsReceipts.code })
      .from(goodsReceipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
      .where(and(eq(purchaseOrders.supplierId, po.supplierId), sql`lower(${goodsReceipts.deliveryNote}) = lower(${deliveryNote})`))
      .limit(1);
    if (dup) throw new DomainError("DUPLICATE", `Bu irsaliye zaten girildi (${dup.code})`);

    const lines = await tx.db
      .select({ line: purchaseOrderLines, code: materials.code, unit: materials.unit })
      .from(purchaseOrderLines)
      .innerJoin(materials, eq(materials.id, purchaseOrderLines.materialId))
      .where(eq(purchaseOrderLines.orderId, po.id))
      .orderBy(materials.code)
      .for("update", { of: purchaseOrderLines });
    for (const lineId of wanted.keys()) {
      if (!lines.some((l) => l.line.id === lineId)) throw new DomainError("NOT_FOUND", "Sipariş kalemi bulunamadı");
    }

    const incoming = lines
      .map((l) => ({ ...l, qtyMilli: wanted.get(l.line.id) ?? 0 }))
      .filter((l) => l.qtyMilli > 0);
    if (incoming.length === 0) throw invalid("En az bir kalemde miktar girin");
    for (const l of incoming) {
      const remaining = l.line.qtyMilli - l.line.receivedMilli;
      const unit = l.unit as Unit;
      if (l.qtyMilli > remaining) throw invalid(`${l.code} için kalan ${formatQty(remaining, unit)}; daha fazlası teslim alınamaz`);
      if (l.qtyMilli % UNIT_STEP_MILLI[unit] !== 0) throw invalid(`${l.code} miktarı ${formatQty(UNIT_STEP_MILLI[unit], unit)} katı olmalı`);
    }

    // MK kodu max+1 ile üretilir: farklı tedarikçilere aynı anda yapılan mal kabuller aynı kodu görmesin diye tüm kodlar tek kilitle seri.
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext('goods_receipt_code'))`);
    const prefix = `${CODE_PREFIX}${istanbulYear(tx.now)}-`;
    const existing = await tx.db.select({ code: goodsReceipts.code }).from(goodsReceipts).where(like(goodsReceipts.code, `${prefix}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
    const receiptCode = `${prefix}${String(max + 1).padStart(4, "0")}`;
    const [receipt] = await tx.db
      .insert(goodsReceipts)
      .values({ code: receiptCode, purchaseOrderId: po.id, deliveryNote, receivedBy: tx.user.id, createdAt: tx.now })
      .returning();
    if (!receipt) throw new Error("mal kabul yazılamadı");

    for (const l of incoming) {
      await tx.db.insert(goodsReceiptLines).values({
        receiptId: receipt.id,
        purchaseOrderLineId: l.line.id,
        materialId: l.line.materialId,
        qtyMilli: l.qtyMilli,
        unitCostKurus: l.line.unitPriceMinor, // 3A'da yalnızca TL: sipariş fiyatı birim maliyettir
      });
      await receiveStock(tx, {
        materialId: l.line.materialId,
        qtyMilli: l.qtyMilli,
        unitCostKurus: l.line.unitPriceMinor,
        ref: { type: "purchase_order", id: po.id },
      });
      await tx.db
        .update(purchaseOrderLines)
        .set({ receivedMilli: l.line.receivedMilli + l.qtyMilli })
        .where(eq(purchaseOrderLines.id, l.line.id));
    }

    const complete = lines.filter((l) => l.line.receivedMilli + (wanted.get(l.line.id) ?? 0) === l.line.qtyMilli).length;
    const done = complete === lines.length;
    const status: PurchaseOrderStatus = done ? "received" : "partial";
    await tx.db
      .update(purchaseOrders)
      .set(done ? { status, receivedAt: tx.now } : { status })
      .where(eq(purchaseOrders.id, po.id));

    const what = incoming.map((l) => `${l.code} ${formatQty(l.qtyMilli, l.unit as Unit)} × ${formatMoney(l.line.unitPriceMinor)}`).join(", ");
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: po.id,
      action: "receive",
      summary: `${po.code} mal kabul ${receiptCode} (irsaliye ${deliveryNote}): ${what}; ${done ? "teslim alındı" : `kısmi teslim, ${complete}/${lines.length} kalem tamam`}`,
    });

    const reserved = await reserveWaitingWorkOrdersInternal(tx, {
      materialIds: incoming.map((l) => l.line.materialId),
      source: `${po.code} mal kabulü`,
    });
    return { receipt: asGoodsReceipt(receipt), status, readyWorkOrders: reserved.map((w) => w.code) };
  });
}
