// Mamul defteri. Eldeki ve ayrılmış mamulü değiştirmenin TEK yolu buradaki postProductMovement'tır
// (malzeme tarafında inventory/ledger.ts'teki postMovement'ın aynası).
// Buradaki servisler yetki denetlemez; çağıran servis (sipariş, iş emri, sevkiyat) denetler.
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { productMovements, products } from "@/db/schema";
import { logAudit, refCode } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { type Ref } from "../inventory/ledger";
import { formatQty } from "../units";
import { asProductMovement, type ProductMovement, type ProductMovementType } from "./types";

type Base = { productId: string; qtyMilli: number; ref: Ref; note?: string };

const LABEL: Record<ProductMovementType, string> = {
  production_in: "üretimden giriş",
  reserve: "ayırma",
  unreserve: "ayırma iptali",
  ship: "sevk",
};

function checkQty(qtyMilli: number): void {
  if (!Number.isInteger(qtyMilli) || qtyMilli <= 0 || qtyMilli % 1000 !== 0) {
    throw new DomainError("VALIDATION", "Adet sıfırdan büyük ve tam sayı olmalı");
  }
}

type Posting = {
  productId: string;
  type: ProductMovementType;
  deltaOnHand: number;
  deltaReserved: number;
  ref?: Ref;
  note?: string;
};

/** Modül içi: mamul hareketini yazar ve üründeki toplamları aynı transaction içinde günceller. */
export async function postProductMovement(ctx: Ctx, p: Posting): Promise<ProductMovement> {
  return inTx(ctx, async (tx) => {
    const [pr] = isUuid(p.productId)
      ? await tx.db.select().from(products).where(eq(products.id, p.productId)).for("update")
      : [];
    if (!pr) throw new DomainError("NOT_FOUND", "Ürün bulunamadı");

    const onHand = pr.onHandMilli + p.deltaOnHand;
    const reserved = pr.reservedMilli + p.deltaReserved;
    if (reserved < 0) throw new DomainError("INVALID_STATE", "Ayrılmış adetten fazlası düşülemez");
    if (onHand < reserved) throw new DomainError("INSUFFICIENT_STOCK", "Kullanılabilir mamul yetersiz");

    await tx.db.update(products).set({ onHandMilli: onHand, reservedMilli: reserved }).where(eq(products.id, pr.id));
    const [row] = await tx.db
      .insert(productMovements)
      .values({
        productId: pr.id,
        type: p.type,
        deltaOnHandMilli: p.deltaOnHand,
        deltaReservedMilli: p.deltaReserved,
        refType: p.ref?.type ?? null,
        refId: p.ref?.id ?? null,
        note: p.note?.trim() ?? "",
        userId: tx.user.id,
        createdAt: tx.now,
      })
      .returning();
    if (!row) throw new Error("hareket yazılamadı");

    const qty = Math.abs(p.deltaOnHand !== 0 ? p.deltaOnHand : p.deltaReserved);
    const ref = await refCode(tx.db, p.ref);
    await logAudit(tx, {
      entity: "product",
      entityId: pr.id,
      action: p.type,
      summary: `${pr.code} ${LABEL[p.type]}: ${formatQty(qty, "adet")}${ref ? ` (${ref})` : ""}`,
    });
    return asProductMovement(row);
  });
}

/** Üretimden mamul girişi: eldeki artar. */
export async function produceIn(ctx: Ctx, i: Base): Promise<ProductMovement> {
  checkQty(i.qtyMilli);
  return postProductMovement(ctx, { ...i, type: "production_in", deltaOnHand: i.qtyMilli, deltaReserved: 0 });
}

/** Kullanılabilir mamulden bir sipariş için ayırır. */
export async function reserveProduct(ctx: Ctx, i: Base): Promise<ProductMovement> {
  checkQty(i.qtyMilli);
  return postProductMovement(ctx, { ...i, type: "reserve", deltaOnHand: 0, deltaReserved: i.qtyMilli });
}

/** Ayırmayı geri alır. */
export async function releaseProduct(ctx: Ctx, i: Base): Promise<ProductMovement> {
  checkQty(i.qtyMilli);
  return postProductMovement(ctx, { ...i, type: "unreserve", deltaOnHand: 0, deltaReserved: -i.qtyMilli });
}

/** Sevk: ayrılmış mamul çıkar, eldeki ve ayrılmış birlikte düşer. */
export async function shipProduct(ctx: Ctx, i: Base): Promise<ProductMovement> {
  checkQty(i.qtyMilli);
  return postProductMovement(ctx, { ...i, type: "ship", deltaOnHand: -i.qtyMilli, deltaReserved: -i.qtyMilli });
}

export type ProductLedgerDiff = {
  productId: string;
  code: string;
  field: "on_hand" | "reserved";
  expected: number;
  actual: number;
};

/** Hareketlerin toplamını ürünlerdeki toplamlarla karşılaştırır. Tutarlı defterde boş dizi döner. */
export async function verifyProductLedger(db: Db): Promise<ProductLedgerDiff[]> {
  const rows = await db
    .select({
      productId: products.id,
      code: products.code,
      onHand: products.onHandMilli,
      reserved: products.reservedMilli,
      sumOnHand: sql<number>`coalesce(sum(${productMovements.deltaOnHandMilli}), 0)::float8`,
      sumReserved: sql<number>`coalesce(sum(${productMovements.deltaReservedMilli}), 0)::float8`,
    })
    .from(products)
    .leftJoin(productMovements, eq(productMovements.productId, products.id))
    .groupBy(products.id);

  const out: ProductLedgerDiff[] = [];
  for (const r of rows) {
    const base = { productId: r.productId, code: r.code };
    if (Number(r.sumOnHand) !== r.onHand) out.push({ ...base, field: "on_hand", expected: Number(r.sumOnHand), actual: r.onHand });
    if (Number(r.sumReserved) !== r.reserved) {
      out.push({ ...base, field: "reserved", expected: Number(r.sumReserved), actual: r.reserved });
    }
  }
  return out;
}
