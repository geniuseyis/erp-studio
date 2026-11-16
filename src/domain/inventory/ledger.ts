// Stok defteri. Eldeki ve ayrılmış miktarı değiştirmenin TEK yolu buradaki postMovement'tır:
// hareket satırını yazar ve malzemedeki toplamları aynı transaction içinde günceller.
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, stockMovements } from "@/db/schema";
import { logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { formatQty, type Unit } from "../units";
import { asMovement, type MovementType, type StockMovement } from "./types";

export type Ref = { type: string; id: string };
type Base = { materialId: string; qtyMilli: number; note?: string; ref?: Ref };

const LABEL: Record<MovementType, string> = {
  receipt: "giriş",
  issue: "çıkış",
  reserve: "ayırma",
  unreserve: "ayırma iptali",
  consume: "üretim tüketimi",
  count_adjust: "sayım farkı",
};

function checkQty(qtyMilli: number): void {
  if (!Number.isInteger(qtyMilli) || qtyMilli <= 0) {
    throw new DomainError("VALIDATION", "Miktar sıfırdan büyük olmalı");
  }
}

type Posting = {
  materialId: string;
  type: MovementType;
  deltaOnHand: number;
  deltaReserved: number;
  unitCostKurus?: number;
  note?: string;
  ref?: Ref;
};

/** Modül içi: diğer stok servisleri (sayım gibi) de hareketi buradan yazar. */
export async function postMovement(ctx: Ctx, p: Posting): Promise<StockMovement> {
  return inTx(ctx, async (tx) => {
    const [m] = isUuid(p.materialId)
      ? await tx.db.select().from(materials).where(eq(materials.id, p.materialId)).for("update")
      : [];
    if (!m) throw new DomainError("NOT_FOUND", "Malzeme bulunamadı");

    const onHand = m.onHandMilli + p.deltaOnHand;
    const reserved = m.reservedMilli + p.deltaReserved;
    if (reserved < 0) throw new DomainError("INVALID_STATE", "Ayrılmış miktardan fazlası düşülemez");
    if (onHand < reserved) {
      // Ayırma iptali ve sayım dışındaki yollar buraya kullanılabilir stok yetmediğinde düşer.
      throw new DomainError(
        p.type === "count_adjust" ? "INVALID_STATE" : "INSUFFICIENT_STOCK",
        p.type === "count_adjust" ? "Sayılan miktar ayrılmış stoğun altında olamaz" : "Kullanılabilir stok yetersiz",
      );
    }

    let avgCost = m.avgCostKurus;
    if (p.type === "receipt" && p.unitCostKurus !== undefined) {
      avgCost = Math.round((m.onHandMilli * m.avgCostKurus + p.deltaOnHand * p.unitCostKurus) / onHand);
    }

    await tx.db
      .update(materials)
      .set({ onHandMilli: onHand, reservedMilli: reserved, avgCostKurus: avgCost })
      .where(eq(materials.id, m.id));
    const [row] = await tx.db
      .insert(stockMovements)
      .values({
        materialId: m.id,
        type: p.type,
        deltaOnHandMilli: p.deltaOnHand,
        deltaReservedMilli: p.deltaReserved,
        unitCostKurus: p.unitCostKurus ?? null,
        refType: p.ref?.type ?? null,
        refId: p.ref?.id ?? null,
        note: p.note?.trim() ?? "",
        userId: tx.user.id,
        createdAt: tx.now,
      })
      .returning();
    if (!row) throw new Error("hareket yazılamadı");

    const qty = Math.abs(p.deltaOnHand !== 0 ? p.deltaOnHand : p.deltaReserved);
    await logAudit(tx, {
      entity: "material",
      entityId: m.id,
      action: p.type,
      summary: `${m.code} ${LABEL[p.type]}: ${formatQty(qty, m.unit as Unit)}`,
    });
    return asMovement(row);
  });
}

/** Stok girişi. Ortalama maliyet, giren miktar ve birim maliyetle ağırlıklı olarak güncellenir. */
export async function receiveStock(ctx: Ctx, i: Base & { unitCostKurus: number }): Promise<StockMovement> {
  assertCan(ctx.user, "inventory", "execute");
  checkQty(i.qtyMilli);
  if (!Number.isInteger(i.unitCostKurus) || i.unitCostKurus < 0) {
    throw new DomainError("VALIDATION", "Birim maliyet sıfır ya da daha büyük olmalı");
  }
  return postMovement(ctx, { ...i, type: "receipt", deltaOnHand: i.qtyMilli, deltaReserved: 0 });
}

/** Stok çıkışı. Ayrılmış stok çıkılamaz. */
export async function issueStock(ctx: Ctx, i: Base): Promise<StockMovement> {
  assertCan(ctx.user, "inventory", "execute");
  checkQty(i.qtyMilli);
  return postMovement(ctx, { ...i, type: "issue", deltaOnHand: -i.qtyMilli, deltaReserved: 0, unitCostKurus: undefined });
}

// Aşağıdaki üçü başka modüllerin (sipariş, iş emri) servislerinden çağrılır; yetkiyi çağıran servis denetler.

/** Kullanılabilir stoktan bir belge için ayırır. */
export async function reserveStock(ctx: Ctx, i: Base & { ref: Ref }): Promise<StockMovement> {
  checkQty(i.qtyMilli);
  return postMovement(ctx, { ...i, type: "reserve", deltaOnHand: 0, deltaReserved: i.qtyMilli, unitCostKurus: undefined });
}

/** Ayırmayı geri alır. */
export async function releaseStock(ctx: Ctx, i: Base & { ref: Ref }): Promise<StockMovement> {
  checkQty(i.qtyMilli);
  return postMovement(ctx, { ...i, type: "unreserve", deltaOnHand: 0, deltaReserved: -i.qtyMilli, unitCostKurus: undefined });
}

/** Ayrılmış stoğu üretimde tüketir: eldeki ve ayrılmış birlikte düşer. */
export async function consumeStock(ctx: Ctx, i: Base & { ref: Ref }): Promise<StockMovement> {
  checkQty(i.qtyMilli);
  return postMovement(ctx, {
    ...i,
    type: "consume",
    deltaOnHand: -i.qtyMilli,
    deltaReserved: -i.qtyMilli,
    unitCostKurus: undefined,
  });
}

export type LedgerDiff = {
  materialId: string;
  code: string;
  field: "on_hand" | "reserved";
  expected: number;
  actual: number;
};

/** Hareketlerin toplamını malzemedeki toplamlarla karşılaştırır. Tutarlı defterde boş dizi döner. */
export async function verifyLedger(db: Db): Promise<LedgerDiff[]> {
  const rows = await db
    .select({
      materialId: materials.id,
      code: materials.code,
      onHand: materials.onHandMilli,
      reserved: materials.reservedMilli,
      sumOnHand: sql<number>`coalesce(sum(${stockMovements.deltaOnHandMilli}), 0)::float8`,
      sumReserved: sql<number>`coalesce(sum(${stockMovements.deltaReservedMilli}), 0)::float8`,
    })
    .from(materials)
    .leftJoin(stockMovements, eq(stockMovements.materialId, materials.id))
    .groupBy(materials.id);

  const out: LedgerDiff[] = [];
  for (const r of rows) {
    const base = { materialId: r.materialId, code: r.code };
    if (Number(r.sumOnHand) !== r.onHand) out.push({ ...base, field: "on_hand", expected: Number(r.sumOnHand), actual: r.onHand });
    if (Number(r.sumReserved) !== r.reserved) {
      out.push({ ...base, field: "reserved", expected: Number(r.sumReserved), actual: r.reserved });
    }
  }
  return out;
}
