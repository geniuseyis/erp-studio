// Satın alma siparişinin eşiğe göre gönderimi ve iki kademeli onayı.
// Müdür kademesi: Satın Alma müdürü (purchasing:approve) ya da Yönetim; Yönetim kademesi: yalnızca Yönetim.
import { eq } from "drizzle-orm";
import { purchaseOrderLines, purchaseOrders, suppliers, users } from "@/db/schema";
import { auditDay, logAudit } from "../audit";
import { type Ctx, type SessionUser, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan, can } from "../permissions";
import { addWorkdays, istanbulDayStart } from "../production/calendar";
import { type ApprovalThresholds, approvalThresholds } from "../settings";
import { formatMoney, formatNumber, lineValueKurus } from "../units";
import { type ApprovalTier, asPurchaseOrder, type PurchaseOrder } from "./types";

/**
 * Siparişin KDV hariç tutarına (kuruş) göre gereken onay kademesi: eşiğe kadar (eşik dahil) onay yok, müdür eşiğinden
 * Yönetim eşiğine kadar müdür, üstü müdür + Yönetim.
 */
export function requiredTier(netKurus: number, t: ApprovalThresholds): ApprovalTier {
  if (netKurus <= t.managerKurus) return 0;
  if (netKurus <= t.boardKurus) return 1;
  return 2;
}

type OrderApproval = Pick<PurchaseOrder, "status" | "requiredTier" | "managerApprovedBy" | "boardApprovedBy">;

/** Sırada bekleyen kademe; onay beklemiyorsa ya da gereken onaylar tamamsa null. */
export function pendingTier(po: OrderApproval): "manager" | "board" | null {
  if (po.status !== "pending_approval") return null;
  if (po.requiredTier >= 1 && po.managerApprovedBy === null) return "manager";
  if (po.requiredTier === 2 && po.boardApprovedBy === null) return "board";
  return null;
}

const isBoard = (user: Pick<SessionUser, "departmentCode">) => user.departmentCode === "yonetim";

/** Kullanıcı bu siparişin bekleyen kademesini onaylayabilir mi (arayüzde düğmeyi, serviste kuralı belirler). */
export function canApprove(
  user: Pick<SessionUser, "id" | "departmentCode" | "level">,
  po: Pick<PurchaseOrder, "status" | "createdBy" | "requiredTier" | "managerApprovedBy" | "boardApprovedBy">,
): boolean {
  if (po.createdBy === user.id) return false;
  const tier = pendingTier(po);
  if (tier === "manager") return can(user, "purchasing", "approve");
  if (tier === "board") return isBoard(user);
  return false;
}

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

async function lockOrder(tx: Ctx, purchaseOrderId: string) {
  const [po] = isUuid(purchaseOrderId) ? await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId)).for("update") : [];
  if (!po) throw new DomainError("NOT_FOUND", "Sipariş bulunamadı");
  return po;
}

/** Siparişi gönderilmiş yapar: gönderim zamanı ve tedarikçinin teslim süresine göre beklenen gün. Beklenen günü döndürür. */
async function release(tx: Ctx, po: typeof purchaseOrders.$inferSelect): Promise<Date> {
  const [supplier] = await tx.db.select().from(suppliers).where(eq(suppliers.id, po.supplierId));
  if (!supplier) throw new DomainError("NOT_FOUND", "Tedarikçi bulunamadı");
  const expectedAt = addWorkdays(istanbulDayStart(tx.now), supplier.leadTimeDays);
  await tx.db.update(purchaseOrders).set({ status: "sent", sentAt: tx.now, expectedAt }).where(eq(purchaseOrders.id, po.id));
  return expectedAt;
}

async function reload(tx: Ctx, id: string): Promise<PurchaseOrder> {
  const [row] = await tx.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!row) throw new Error("sipariş okunamadı");
  return asPurchaseOrder(row);
}

/** Oluşturandan başka etkin bir kullanıcı gereken kademeyi karşılayabilir mi? Yönetim iki kademeyi de karşılar. */
async function hasOtherApprover(tx: Ctx, tier: ApprovalTier, creatorId: string): Promise<boolean> {
  const rows = await tx.db.select({ id: users.id, departmentCode: users.departmentCode, level: users.level, active: users.active }).from(users);
  return rows.some(
    (u) => u.active && u.id !== creatorId && (tier === 1 ? can({ departmentCode: u.departmentCode as SessionUser["departmentCode"], level: u.level as SessionUser["level"] }, "purchasing", "approve") : u.departmentCode === "yonetim"),
  );
}

const thresholdText = (kurus: number) => `${formatNumber(kurus / 100)} TL`;

/** Taslağı gönderir: kademe 0 ise doğrudan gönderilir, değilse kademe donar ve sipariş onay bekler. */
export async function submitPurchaseOrder(ctx: Ctx, purchaseOrderId: string): Promise<{ order: PurchaseOrder; sent: boolean }> {
  assertCan(ctx.user, "purchasing", "write");
  return inTx(ctx, async (tx) => {
    const po = await lockOrder(tx, purchaseOrderId);
    if (po.status !== "draft") throw new DomainError("INVALID_STATE", "Yalnızca taslak sipariş gönderilir");
    const lineCount = (await tx.db.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id))).length;
    if (lineCount === 0) throw invalid("Boş sipariş gönderilemez; en az bir kalem ekleyin");

    const thresholds = await approvalThresholds(tx.db);
    const net = await orderNet(tx, po.id);
    const tier = requiredTier(net, thresholds);
    if (tier > 0 && !(await hasOtherApprover(tx, tier, po.createdBy))) throw invalid("Bu tutarı onaylayabilecek başka bir kullanıcı yok");

    await tx.db.update(purchaseOrders).set({ requiredTier: tier, submittedAt: tx.now }).where(eq(purchaseOrders.id, po.id));
    if (tier === 0) {
      const expectedAt = await release(tx, po);
      await logAudit(tx, {
        entity: "purchase_order",
        entityId: po.id,
        action: "send",
        summary: `${po.code} gönderildi: ${formatMoney(net)} KDV hariç, beklenen teslim ${auditDay(expectedAt)}`,
      });
      return { order: await reload(tx, po.id), sent: true };
    }
    await tx.db.update(purchaseOrders).set({ status: "pending_approval" }).where(eq(purchaseOrders.id, po.id));
    const who = tier === 1 ? "Satın Alma müdürü onayı" : "Satın Alma müdürü ve Yönetim onayı";
    const limit = tier === 1 ? thresholds.managerKurus : thresholds.boardKurus;
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: po.id,
      action: "submit",
      summary: `${po.code} onaya gönderildi: ${formatMoney(net)} KDV hariç, ${thresholdText(limit)} eşiği aşıldı → ${who}`,
    });
    return { order: await reload(tx, po.id), sent: false };
  });
}

/** Bekleyen kademeyi onaylar; son gereken onayla sipariş kendiliğinden gönderilir. Satır kilidi çift onayı engeller. */
export async function approvePurchaseOrder(ctx: Ctx, purchaseOrderId: string): Promise<{ order: PurchaseOrder; sent: boolean }> {
  assertCan(ctx.user, "purchasing", "approve");
  return inTx(ctx, async (tx) => {
    const po = await lockOrder(tx, purchaseOrderId);
    const tier = pendingTier(asPurchaseOrder(po));
    if (tier === null) throw new DomainError("INVALID_STATE", "Bu sipariş onay beklemiyor");
    if (po.createdBy === tx.user.id) throw new DomainError("FORBIDDEN", "Kendi siparişinizi onaylayamazsınız");
    if (tier === "board" && !isBoard(tx.user)) throw new DomainError("FORBIDDEN", "Bu kademe Yönetim onayı ister");

    const board = isBoard(tx.user);
    const set: Partial<typeof purchaseOrders.$inferInsert> = {};
    if (tier === "manager") {
      set.managerApprovedBy = tx.user.id;
      set.managerApprovedAt = tx.now;
    }
    // Yönetim'in onayı üst kademe olduğu için gerekiyorsa Yönetim kademesini de karşılar.
    if (board && (tier === "board" || po.requiredTier === 2)) {
      set.boardApprovedBy = tx.user.id;
      set.boardApprovedAt = tx.now;
    }
    await tx.db.update(purchaseOrders).set(set).where(eq(purchaseOrders.id, po.id));
    const updated = await reload(tx, po.id);

    const label = board ? `Yönetim onayı verdi (${tx.user.name})${tier === "manager" ? ", müdür kademesini de karşıladı" : ""}` : `müdür onayı verdi (${tx.user.name})`;
    if (pendingTier(updated) !== null) {
      await logAudit(tx, {
        entity: "purchase_order",
        entityId: po.id,
        action: "approve",
        summary: `${po.code} ${label}; Yönetim onayı bekleniyor`,
      });
      return { order: updated, sent: false };
    }
    const expectedAt = await release(tx, po);
    await logAudit(tx, {
      entity: "purchase_order",
      entityId: po.id,
      action: "approve",
      summary: `${po.code} ${label}; gönderildi, beklenen teslim ${auditDay(expectedAt)}`,
    });
    return { order: await reload(tx, po.id), sent: true };
  });
}

/** KDV hariç sipariş tutarı (kuruş): kalem başına kuruşa yuvarlanmış toplam. orders.ts'e bağımlılık döngüsü olmasın diye burada. */
async function orderNet(tx: Ctx, orderId: string): Promise<number> {
  const rows = await tx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
  return rows.reduce((sum, l) => sum + lineValueKurus(l.qtyMilli, l.unitPriceMinor), 0);
}
