// Sipariş ve satır durumu. Hem satış (onay) hem üretim (iş emri) servisleri buradan yazar;
// bu yüzden bu modül yalnızca şemaya ve bağlama dayanır, hiçbir servis modülünü içe aktarmaz.
// Yetki denetlemez; çağıran servis denetler.
import { eq } from "drizzle-orm";
import { salesOrderLines, salesOrders } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import type { LineStatus, OrderStatus } from "./types";

/** Satır durumlarının ilerleme sırası ve siparişe yansıması. Taslak ve iptal satırlar sayılmaz. */
const LINE_RANK: Partial<Record<LineStatus, { rank: number; order: OrderStatus }>> = {
  waiting_material: { rank: 0, order: "confirmed" },
  in_production: { rank: 1, order: "in_production" },
  ready: { rank: 2, order: "ready" },
  shipped: { rank: 3, order: "shipped" },
};

const ORDER_LABEL: Record<OrderStatus, string> = {
  draft: "taslak",
  confirmed: "onaylandı",
  in_production: "üretimde",
  ready: "sevke hazır",
  shipped: "sevk edildi",
  cancelled: "iptal",
};

/** Modül içi: satırın durumunu (ve verilirse ayrılmış mamul miktarını) yazar. */
export async function setLineStatus(ctx: Ctx, lineId: string, status: LineStatus, reservedMilli?: number): Promise<void> {
  const set: { status: LineStatus; reservedMilli?: number } = { status };
  if (reservedMilli !== undefined) set.reservedMilli = reservedMilli;
  const updated = isUuid(lineId)
    ? await ctx.db.update(salesOrderLines).set(set).where(eq(salesOrderLines.id, lineId)).returning({ id: salesOrderLines.id })
    : [];
  if (updated.length === 0) throw new DomainError("NOT_FOUND", "Sipariş satırı bulunamadı");
}

/**
 * Modül içi: sipariş durumunu iptal edilmemiş satırların en geridekinden türetir
 * (waiting_material → confirmed < in_production < ready < shipped). Taslak ya da iptal sipariş değişmez.
 */
export async function refreshOrderStatus(ctx: Ctx, orderId: string): Promise<OrderStatus> {
  return inTx(ctx, async (tx) => {
    const [order] = isUuid(orderId) ? await tx.db.select().from(salesOrders).where(eq(salesOrders.id, orderId)) : [];
    if (!order) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
    const current = order.status as OrderStatus;
    if (current === "draft" || current === "cancelled") return current;

    const lines = await tx.db.select({ status: salesOrderLines.status }).from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
    let slowest: { rank: number; order: OrderStatus } | undefined;
    for (const line of lines) {
      const r = LINE_RANK[line.status as LineStatus];
      if (r && (!slowest || r.rank < slowest.rank)) slowest = r;
    }
    if (!slowest || slowest.order === current) return current;

    await tx.db.update(salesOrders).set({ status: slowest.order }).where(eq(salesOrders.id, order.id));
    await logAudit(tx, {
      entity: "sales_order",
      entityId: order.id,
      action: "status",
      summary: `${order.code}: ${ORDER_LABEL[current]} → ${ORDER_LABEL[slowest.order]}`,
    });
    return slowest.order;
  });
}
