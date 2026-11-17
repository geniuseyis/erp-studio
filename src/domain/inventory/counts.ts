import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, stockCountLines, stockCounts } from "@/db/schema";
import { codeList, logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { formatQty, type Unit } from "../units";
import { postMovement } from "./ledger";
import { asCount, type StockCount } from "./types";

async function mustFindOpen(db: Db, countId: string): Promise<typeof stockCounts.$inferSelect> {
  const [count] = isUuid(countId) ? await db.select().from(stockCounts).where(eq(stockCounts.id, countId)).for("update") : [];
  if (!count) throw new DomainError("NOT_FOUND", "Sayım fişi bulunamadı");
  if (count.status !== "open") throw new DomainError("INVALID_STATE", "Kapanmış sayım fişi değiştirilemez");
  return count;
}

/** Seçilen malzemeler için sayım fişi açar; her satıra o andaki eldeki miktarı yazar. */
export async function createCount(ctx: Ctx, i: { materialIds: string[]; note?: string }): Promise<StockCount> {
  assertCan(ctx.user, "inventory", "write");
  const ids = [...new Set(i.materialIds)];
  if (ids.length === 0) throw new DomainError("VALIDATION", "En az bir malzeme seçin");

  return inTx(ctx, async (tx) => {
    const found = ids.every(isUuid) ? await tx.db.select().from(materials).where(inArray(materials.id, ids)) : [];
    if (found.length !== ids.length) throw new DomainError("NOT_FOUND", "Malzeme bulunamadı");

    const prefix = `SYM-${tx.now.getFullYear()}-`;
    const existing = await tx.db.select({ code: stockCounts.code }).from(stockCounts).where(like(stockCounts.code, `${prefix}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(prefix.length)) || 0), 0);
    const code = `${prefix}${String(max + 1).padStart(4, "0")}`;

    const [count] = await tx.db
      .insert(stockCounts)
      .values({ code, note: i.note?.trim() ?? "", createdBy: tx.user.id, createdAt: tx.now })
      .returning();
    if (!count) throw new Error("sayım fişi açılamadı");
    const codes = found.map((m) => m.code).sort((a, b) => a.localeCompare(b, "tr"));
    await tx.db
      .insert(stockCountLines)
      .values(found.map((m) => ({ countId: count.id, materialId: m.id, systemMilli: m.onHandMilli })));
    await logAudit(tx, { entity: "stock_count", entityId: count.id, action: "create", summary: `${code} açıldı: ${ids.length} kalem (${codeList(codes)})` });
    return asCount(count);
  });
}

/** Bir satırın sayılan miktarını yazar. Sıfır geçerlidir. */
export async function setCountLine(ctx: Ctx, i: { countId: string; materialId: string; countedMilli: number }): Promise<void> {
  assertCan(ctx.user, "inventory", "execute");
  if (!Number.isInteger(i.countedMilli) || i.countedMilli < 0) {
    throw new DomainError("VALIDATION", "Sayılan miktar sıfır ya da daha büyük olmalı");
  }
  await inTx(ctx, async (tx) => {
    const count = await mustFindOpen(tx.db, i.countId);
    const [row] = await tx.db
      .select({ lineId: stockCountLines.id, counted: stockCountLines.countedMilli, code: materials.code, name: materials.name, unit: materials.unit })
      .from(stockCountLines)
      .innerJoin(materials, eq(materials.id, stockCountLines.materialId))
      .where(and(eq(stockCountLines.countId, i.countId), eq(stockCountLines.materialId, i.materialId)));
    if (!row) throw new DomainError("NOT_FOUND", "Bu malzeme sayım fişinde yok");
    if (row.counted === i.countedMilli) return;
    await tx.db.update(stockCountLines).set({ countedMilli: i.countedMilli }).where(eq(stockCountLines.id, row.lineId));
    const unit = row.unit as Unit;
    await logAudit(tx, {
      entity: "stock_count",
      entityId: count.id,
      action: "count_line",
      summary:
        row.counted === null
          ? `${count.code}: ${row.code} ${row.name} sayıldı: ${formatQty(i.countedMilli, unit)}`
          : `${count.code}: ${row.code} ${row.name} sayılan ${formatQty(row.counted, unit)} → ${formatQty(i.countedMilli, unit)}`,
    });
  });
}

/**
 * Sayımı onaylar: her satır için (sayılan − onay anındaki eldeki) farkını stok hareketi olarak yazar.
 * Herhangi bir satır reddedilirse hiçbiri yazılmaz.
 */
export async function approveCount(ctx: Ctx, countId: string): Promise<StockCount> {
  assertCan(ctx.user, "inventory", "approve");
  return inTx(ctx, async (tx) => {
    const count = await mustFindOpen(tx.db, countId);
    const lines = await tx.db
      .select({ line: stockCountLines, onHand: materials.onHandMilli, code: materials.code, unit: materials.unit })
      .from(stockCountLines)
      .innerJoin(materials, eq(materials.id, stockCountLines.materialId))
      .where(eq(stockCountLines.countId, countId));
    if (lines.some((l) => l.line.countedMilli === null)) {
      throw new DomainError("INVALID_STATE", "Sayılmamış satırlar var");
    }
    const diffs: string[] = [];
    for (const { line, onHand, code, unit } of [...lines].sort((a, b) => a.code.localeCompare(b.code, "tr"))) {
      const diff = (line.countedMilli ?? 0) - onHand;
      if (diff === 0) continue;
      diffs.push(`${code} ${diff > 0 ? "+" : "−"}${formatQty(Math.abs(diff), unit as Unit)}`);
      await postMovement(tx, {
        materialId: line.materialId,
        type: "count_adjust",
        deltaOnHand: diff,
        deltaReserved: 0,
        ref: { type: "stock_count", id: count.id },
        note: count.code,
      });
    }
    const [row] = await tx.db
      .update(stockCounts)
      .set({ status: "approved", approvedBy: tx.user.id, approvedAt: tx.now })
      .where(eq(stockCounts.id, countId))
      .returning();
    if (!row) throw new Error("sayım fişi güncellenemedi");
    await logAudit(tx, {
      entity: "stock_count",
      entityId: countId,
      action: "approve",
      summary:
        diffs.length === 0
          ? `${count.code} onaylandı: fark yok (${lines.length} kalem)`
          : `${count.code} onaylandı: ${diffs.length} kalemde fark — ${codeList(diffs)}`,
    });
    return asCount(row);
  });
}

export async function cancelCount(ctx: Ctx, countId: string): Promise<void> {
  assertCan(ctx.user, "inventory", "write");
  await inTx(ctx, async (tx) => {
    const count = await mustFindOpen(tx.db, countId);
    const lines = await tx.db.select({ counted: stockCountLines.countedMilli }).from(stockCountLines).where(eq(stockCountLines.countId, countId));
    const counted = lines.filter((l) => l.counted !== null).length;
    await tx.db.update(stockCounts).set({ status: "cancelled" }).where(eq(stockCounts.id, countId));
    await logAudit(tx, {
      entity: "stock_count",
      entityId: countId,
      action: "cancel",
      summary: `${count.code} iptal edildi: ${lines.length} kalem, ${counted} sayıldı`,
    });
  });
}
