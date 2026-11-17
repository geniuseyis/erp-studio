// Kayıt çekmecelerindeki "Geçmiş" bölümünün sorguları. Yalnızca okur.
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, departments, salesOrderLines, users, workOrders } from "@/db/schema";
import { isUuid } from "./context";

export type HistoryEntry = { id: string; at: Date; userName: string; departmentName: string; action: string; summary: string };

/** Geçmişi istenen kayıt. `actions` verilirse o kaydın yalnızca bu işlemleri alınır. */
export type HistoryRef = { entity: string; entityId: string; actions?: string[] };

export const HISTORY_LIMIT = 50;

/**
 * Verilen kayıtların işlem geçmişi, yeniden eskiye, en çok `limit` satır. Aynı anda (aynı transaction'da) yazılan
 * satırlar yazılış sırasının tersiyle gelir.
 */
export async function listHistory(db: Db, refs: HistoryRef[], limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (refs.length === 0) return [];
  const match = refs.map((r) =>
    and(
      eq(auditLog.entity, r.entity),
      eq(auditLog.entityId, r.entityId),
      r.actions && r.actions.length > 0 ? inArray(auditLog.action, r.actions) : undefined,
    ),
  );
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      userName: users.name,
      departmentName: departments.name,
      action: auditLog.action,
      summary: auditLog.summary,
    })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.userId))
    .innerJoin(departments, eq(departments.code, users.departmentCode))
    .where(or(...match))
    // Denetim satırı hiç güncellenmez; fiziksel konum (ctid) yazılış sırasıdır.
    .orderBy(desc(auditLog.createdAt), sql`${auditLog}.ctid desc`)
    .limit(limit);
  return rows;
}

/** Siparişin geçmişi: siparişin kendi kayıtları ve satırlarına açılmış iş emirlerinin kayıtları. */
export async function listOrderHistory(db: Db, orderId: string, limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (!isUuid(orderId)) return [];
  const linked = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .where(eq(salesOrderLines.orderId, orderId));
  return listHistory(
    db,
    [{ entity: "sales_order", entityId: orderId }, ...linked.map((w) => ({ entity: "work_order", entityId: w.id }))],
    limit,
  );
}

/** İş emrinin geçmişi: kendi kayıtları ve (siparişe bağlıysa) siparişin onay kaydı. */
export async function listWorkOrderHistory(db: Db, workOrderId: string, limit: number = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  if (!isUuid(workOrderId)) return [];
  const [line] = await db
    .select({ orderId: salesOrderLines.orderId })
    .from(workOrders)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, workOrders.salesOrderLineId))
    .where(eq(workOrders.id, workOrderId));
  const refs: HistoryRef[] = [{ entity: "work_order", entityId: workOrderId }];
  if (line) refs.push({ entity: "sales_order", entityId: line.orderId, actions: ["confirm"] });
  return listHistory(db, refs, limit);
}
