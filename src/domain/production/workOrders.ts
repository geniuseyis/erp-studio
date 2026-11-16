// İş emirleri: açılış (rota adımları ve hepsi-ya-hiçbiri malzeme ayırma), planlama ve malzemeyi yeniden deneme.
// Bağımlılık yönü: sales/orders → production/workOrders → sales/status.
import { asc, eq, inArray, like } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bomLines, materials, products, routings, salesOrderLines, workOrders, workOrderSteps } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { reserveStock } from "../inventory/ledger";
import { assertCan } from "../permissions";
import { refreshOrderStatus, setLineStatus } from "../sales/status";
import { roundUpToStep, type Unit } from "../units";
import { addWorkdays, istanbulDayStart, istanbulYear } from "./calendar";
import { asWorkOrder, type Shortage, type WorkOrder } from "./types";

const CODE_PREFIX = "IE-";

export type MaterialNeed = { materialId: string; neededMilli: number };

/**
 * Ürünün `qtyMilli` adedi için malzeme ihtiyacı: Σ reçete miktarı × adet × (1000 + fire) / 1000,
 * malzemenin birim adımına yukarı yuvarlanır (0,782 plaka → 1 plaka). Malzeme koduna göre sıralı.
 */
export async function materialNeeds(db: Db, productId: string, qtyMilli: number): Promise<MaterialNeed[]> {
  const rows = await db
    .select({ materialId: bomLines.materialId, qtyMilli: bomLines.qtyMilli, scrapPermille: bomLines.scrapPermille, unit: materials.unit })
    .from(bomLines)
    .innerJoin(materials, eq(materials.id, bomLines.materialId))
    .where(eq(bomLines.productId, productId))
    .orderBy(asc(materials.code));
  // Pay tam sayıdır (reçete milli × sipariş milli × binde); 1000 × 1000'e bölünüp tam milliye, sonra adıma yukarı yuvarlanır.
  return rows.map((r) => ({
    materialId: r.materialId,
    neededMilli: roundUpToStep(Math.ceil((r.qtyMilli * qtyMilli * (1000 + r.scrapPermille)) / 1_000_000), r.unit as Unit),
  }));
}

/** İhtiyaçlardan kullanılabilir stoğu (eldeki − ayrılmış) yetmeyenler. Aynı malzemenin ihtiyaçları toplanır. */
export async function findShortages(db: Db, needs: MaterialNeed[]): Promise<Shortage[]> {
  const total = new Map<string, number>();
  for (const n of needs) total.set(n.materialId, (total.get(n.materialId) ?? 0) + n.neededMilli);
  if (total.size === 0) return [];
  const rows = await db
    .select()
    .from(materials)
    .where(inArray(materials.id, [...total.keys()]))
    .orderBy(asc(materials.code));
  const out: Shortage[] = [];
  for (const m of rows) {
    const neededMilli = total.get(m.id) ?? 0;
    const availableMilli = m.onHandMilli - m.reservedMilli;
    if (availableMilli < neededMilli) {
      out.push({ materialId: m.id, code: m.code, name: m.name, unit: m.unit as Unit, neededMilli, availableMilli });
    }
  }
  return out;
}

/** Hepsi ya da hiçbiri: bir kalem bile yetmiyorsa hiçbir şey ayrılmaz ve eksikler döner. */
async function reserveMaterials(ctx: Ctx, wo: typeof workOrders.$inferSelect): Promise<Shortage[]> {
  const needs = await materialNeeds(ctx.db, wo.productId, wo.qtyMilli);
  const shortages = await findShortages(ctx.db, needs);
  if (shortages.length > 0) return shortages;
  for (const n of needs) {
    await reserveStock(ctx, { materialId: n.materialId, qtyMilli: n.neededMilli, ref: { type: "work_order", id: wo.id } });
  }
  await ctx.db.update(workOrders).set({ materialsReserved: true }).where(eq(workOrders.id, wo.id));
  return [];
}

async function mustFindWorkOrder(db: Db, workOrderId: string): Promise<typeof workOrders.$inferSelect> {
  const [wo] = isUuid(workOrderId) ? await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)).for("update") : [];
  if (!wo) throw new DomainError("NOT_FOUND", "İş emri bulunamadı");
  return wo;
}

async function reload(db: Db, workOrderId: string): Promise<WorkOrder> {
  const [row] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!row) throw new Error("iş emri okunamadı");
  return asWorkOrder(row);
}

/**
 * Modül içi (yetkiyi çağıran denetler): iş emri açar, rotadan adımları kurar (dakika = birim dakika × adet,
 * gün boş) ve malzemeleri hepsi-ya-hiçbiri ayırır. Bağlı satırın durumunu çağıran yazar.
 */
export async function openWorkOrder(
  ctx: Ctx,
  i: { productId: string; qtyMilli: number; salesOrderLineId?: string },
): Promise<{ workOrder: WorkOrder; shortages: Shortage[] }> {
  if (!Number.isInteger(i.qtyMilli) || i.qtyMilli <= 0 || i.qtyMilli % 1000 !== 0) {
    throw new DomainError("VALIDATION", "Adet sıfırdan büyük ve tam sayı olmalı");
  }
  return inTx(ctx, async (tx) => {
    const [product] = isUuid(i.productId) ? await tx.db.select().from(products).where(eq(products.id, i.productId)) : [];
    if (!product) throw new DomainError("NOT_FOUND", "Ürün bulunamadı");

    const prefix = `${CODE_PREFIX}${istanbulYear(tx.now)}-`;
    const existing = await tx.db.select({ code: workOrders.code }).from(workOrders).where(like(workOrders.code, `${prefix}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
    const code = `${prefix}${String(max + 1).padStart(4, "0")}`;

    const [wo] = await tx.db
      .insert(workOrders)
      .values({
        code,
        productId: product.id,
        qtyMilli: i.qtyMilli,
        salesOrderLineId: i.salesOrderLineId ?? null,
        createdBy: tx.user.id,
        createdAt: tx.now,
      })
      .returning();
    if (!wo) throw new Error("iş emri açılamadı");

    const route = await tx.db.select().from(routings).where(eq(routings.productId, product.id)).orderBy(asc(routings.seq));
    if (route.length > 0) {
      await tx.db.insert(workOrderSteps).values(
        route.map((r) => ({ workOrderId: wo.id, seq: r.seq, stationId: r.stationId, minutes: r.minutesPerUnit * (i.qtyMilli / 1000) })),
      );
    }

    const shortages = await reserveMaterials(tx, wo);
    await logAudit(tx, {
      entity: "work_order",
      entityId: wo.id,
      action: "create",
      summary: `${code} açıldı: ${product.code} × ${i.qtyMilli / 1000}${shortages.length > 0 ? " (malzeme bekliyor)" : ""}`,
    });
    return { workOrder: await reload(tx.db, wo.id), shortages };
  });
}

/** Malzemesi ayrılamamış iş emri için ayırmayı yeniden dener. Başarıda bağlı satır üretime geçer. */
export async function retryMaterials(ctx: Ctx, workOrderId: string): Promise<{ workOrder: WorkOrder; shortages: Shortage[] }> {
  assertCan(ctx.user, "planning", "execute");
  return inTx(ctx, async (tx) => {
    const wo = await mustFindWorkOrder(tx.db, workOrderId);
    if (wo.status !== "planned" || wo.materialsReserved) {
      throw new DomainError("INVALID_STATE", "Yalnızca malzemesi ayrılmamış planlı iş emri yeniden denenir");
    }
    const shortages = await reserveMaterials(tx, wo);
    if (shortages.length > 0) return { workOrder: asWorkOrder(wo), shortages };

    await logAudit(tx, { entity: "work_order", entityId: wo.id, action: "reserve_materials", summary: `${wo.code}: malzemeler ayrıldı` });
    if (wo.salesOrderLineId) {
      const [line] = await tx.db.select().from(salesOrderLines).where(eq(salesOrderLines.id, wo.salesOrderLineId));
      if (line?.status === "waiting_material") {
        await setLineStatus(tx, line.id, "in_production");
        await refreshOrderStatus(tx, line.orderId);
      }
    }
    return { workOrder: await reload(tx.db, wo.id), shortages: [] };
  });
}

/**
 * Adım i'nin günü = addWorkdays(başlangıç günü, i). Hafta sonu başlangıç sonraki iş gününden başlar.
 * Yalnızca planlı iş emri; yeniden planlama önceki günlerin yerine yazar.
 */
export async function planWorkOrder(ctx: Ctx, i: { workOrderId: string; start: Date }): Promise<WorkOrder> {
  assertCan(ctx.user, "planning", "write");
  if (!(i.start instanceof Date) || Number.isNaN(i.start.getTime())) throw new DomainError("VALIDATION", "Başlangıç geçersiz");
  const startDay = istanbulDayStart(i.start);
  if (startDay.getTime() < istanbulDayStart(ctx.now).getTime()) {
    throw new DomainError("VALIDATION", "Başlangıç geçmiş bir gün olamaz");
  }
  return inTx(ctx, async (tx) => {
    const wo = await mustFindWorkOrder(tx.db, i.workOrderId);
    if (wo.status !== "planned") throw new DomainError("INVALID_STATE", "Yalnızca planlı iş emri planlanabilir");

    const steps = await tx.db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, wo.id)).orderBy(asc(workOrderSteps.seq));
    for (const [index, step] of steps.entries()) {
      await tx.db.update(workOrderSteps).set({ plannedDay: addWorkdays(startDay, index) }).where(eq(workOrderSteps.id, step.id));
    }
    const plannedStart = addWorkdays(startDay, 0);
    await tx.db.update(workOrders).set({ plannedStart }).where(eq(workOrders.id, wo.id));
    await logAudit(tx, {
      entity: "work_order",
      entityId: wo.id,
      action: "plan",
      summary: `${wo.code} planlandı: ${plannedStart.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })} başlangıç`,
    });
    return reload(tx.db, wo.id);
  });
}
