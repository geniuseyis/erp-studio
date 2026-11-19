import { and, eq, like, ne } from "drizzle-orm";
import { materials, supplierItems, suppliers } from "@/db/schema";
import { describeChanges, type FieldSpec, logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { formatMoney, formatQty, UNIT_STEP_MILLI, type Unit } from "../units";
import { asSupplier, asSupplierItem, type Currency, type Supplier, type SupplierItem } from "./types";

export type NewSupplier = {
  name: string;
  city: string;
  contact: string;
  phone: string;
  paymentTermDays: number;
  leadTimeDays: number;
  currency?: Currency;
};

const CODE_PREFIX = "TED-";
const MAX_LEAD_DAYS = 90;

const days = (n: number) => `${n} gün`;
const workdays = (n: number) => `${n} iş günü`;
const CURRENCY_TEXT: Record<Currency, string> = { TRY: "TL", EUR: "EUR", USD: "USD" };

/** Güncelleme özetinde alanların adı ve yazılışı, formdaki sırayla. */
const FIELDS: FieldSpec<NewSupplier> = {
  name: { label: "ad" },
  city: { label: "il" },
  contact: { label: "yetkili" },
  phone: { label: "telefon" },
  paymentTermDays: { label: "vade", format: days },
  leadTimeDays: { label: "teslim süresi", format: workdays },
  currency: { label: "para birimi", format: (c) => CURRENCY_TEXT[c] },
};

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

/** Verilen alanları doğrular ve temizler. Bu planda yalnızca TL ile çalışılır (döviz Plan 3B'de açılır). */
function clean(i: Partial<NewSupplier>): Partial<NewSupplier> {
  const out: Partial<NewSupplier> = {};
  if (i.name !== undefined) {
    if (!i.name.trim()) throw invalid("Ad boş olamaz");
    out.name = i.name.trim();
  }
  if (i.city !== undefined) {
    if (!i.city.trim()) throw invalid("İl boş olamaz");
    out.city = i.city.trim();
  }
  if (i.contact !== undefined) out.contact = i.contact.trim();
  if (i.phone !== undefined) {
    if (!i.phone.trim()) throw invalid("Telefon boş olamaz");
    out.phone = i.phone.trim();
  }
  if (i.paymentTermDays !== undefined) {
    if (!Number.isInteger(i.paymentTermDays) || i.paymentTermDays < 0) throw invalid("Vade sıfır ya da daha büyük gün olmalı");
    out.paymentTermDays = i.paymentTermDays;
  }
  if (i.leadTimeDays !== undefined) {
    if (!Number.isInteger(i.leadTimeDays) || i.leadTimeDays < 1 || i.leadTimeDays > MAX_LEAD_DAYS) {
      throw invalid(`Teslim süresi 1 ile ${MAX_LEAD_DAYS} iş günü arasında olmalı`);
    }
    out.leadTimeDays = i.leadTimeDays;
  }
  if (i.currency !== undefined) {
    if (i.currency !== "TRY") throw invalid("Döviz ile çalışan tedarikçi henüz desteklenmiyor");
    out.currency = i.currency;
  }
  return out;
}

export async function createSupplier(ctx: Ctx, input: NewSupplier): Promise<Supplier> {
  assertCan(ctx.user, "purchasing", "write");
  const v = clean(input) as NewSupplier;

  return inTx(ctx, async (tx) => {
    const existing = await tx.db.select({ code: suppliers.code }).from(suppliers).where(like(suppliers.code, `${CODE_PREFIX}%`));
    const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(CODE_PREFIX.length)) || 0), 0);
    const code = `${CODE_PREFIX}${String(max + 1).padStart(4, "0")}`;
    const currency = v.currency ?? "TRY";
    const [row] = await tx.db
      .insert(suppliers)
      .values({ ...v, currency, code, createdAt: tx.now })
      .returning();
    if (!row) throw new Error("tedarikçi eklenemedi");
    await logAudit(tx, {
      entity: "supplier",
      entityId: row.id,
      action: "create",
      summary: `${code} ${v.name} eklendi: ${v.city}, vade ${days(v.paymentTermDays)}, teslim ${workdays(v.leadTimeDays)}, ${CURRENCY_TEXT[currency]}`,
    });
    return asSupplier(row);
  });
}

export async function updateSupplier(ctx: Ctx, id: string, patch: Partial<NewSupplier>): Promise<void> {
  assertCan(ctx.user, "purchasing", "write");
  const set = clean(patch);
  await inTx(ctx, async (tx) => {
    const [row] = isUuid(id) ? await tx.db.select().from(suppliers).where(eq(suppliers.id, id)) : [];
    if (!row) throw new DomainError("NOT_FOUND", "Tedarikçi bulunamadı");
    const changes = describeChanges(FIELDS, asSupplier(row), set);
    if (changes.length === 0) return;
    await tx.db.update(suppliers).set(set).where(eq(suppliers.id, id));
    await logAudit(tx, { entity: "supplier", entityId: id, action: "update", summary: `${row.code} güncellendi: ${changes.join(", ")}` });
  });
}

export type SupplierItemInput = { supplierId: string; materialId: string; unitPriceMinor: number; moqMilli: number; preferred: boolean };

/**
 * Tedarikçinin bir malzeme için fiyatını ekler ya da (aynı tedarikçi ve malzeme varsa) günceller. `preferred: true`
 * aynı malzemenin diğer tercihli kalemini aynı transaction'da kaldırır. Değişiklik yoksa hiçbir şey yazılmaz.
 */
async function writeSupplierItem(ctx: Ctx, i: SupplierItemInput): Promise<SupplierItem> {
  assertCan(ctx.user, "purchasing", "write");
  if (!Number.isInteger(i.unitPriceMinor) || i.unitPriceMinor < 0) throw invalid("Fiyat sıfır ya da daha büyük olmalı");
  if (!Number.isInteger(i.moqMilli) || i.moqMilli < 0) throw invalid("En az sipariş miktarı sıfır ya da daha büyük olmalı");

  return inTx(ctx, async (tx) => {
    const [supplier] = isUuid(i.supplierId) ? await tx.db.select().from(suppliers).where(eq(suppliers.id, i.supplierId)) : [];
    if (!supplier) throw new DomainError("NOT_FOUND", "Tedarikçi bulunamadı");
    const [material] = isUuid(i.materialId) ? await tx.db.select().from(materials).where(eq(materials.id, i.materialId)) : [];
    if (!material) throw new DomainError("NOT_FOUND", "Malzeme bulunamadı");
    if (!material.active) throw invalid("Pasif malzemeye fiyat eklenemez");
    const unit = material.unit as Unit;
    if (i.moqMilli % UNIT_STEP_MILLI[unit] !== 0) {
      throw invalid(`En az sipariş miktarı ${formatQty(UNIT_STEP_MILLI[unit], unit)} katı olmalı`);
    }

    const [current] = await tx.db
      .select()
      .from(supplierItems)
      .where(and(eq(supplierItems.supplierId, i.supplierId), eq(supplierItems.materialId, i.materialId)));
    if (
      current &&
      current.unitPriceMinor === i.unitPriceMinor &&
      current.moqMilli === i.moqMilli &&
      current.isPreferred === i.preferred
    ) {
      return asSupplierItem(current);
    }

    // Tek tercihli kalem kuralı: önce eskisi kalkar, sonra yenisi yazılır.
    let previousPreferred: string | null = null;
    if (i.preferred) {
      const [other] = await tx.db
        .select({ id: supplierItems.id, code: suppliers.code })
        .from(supplierItems)
        .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId))
        .where(and(eq(supplierItems.materialId, i.materialId), eq(supplierItems.isPreferred, true), ne(supplierItems.supplierId, i.supplierId)));
      if (other) {
        await tx.db.update(supplierItems).set({ isPreferred: false }).where(eq(supplierItems.id, other.id));
        previousPreferred = other.code;
      }
    }

    const values = { unitPriceMinor: i.unitPriceMinor, moqMilli: i.moqMilli, isPreferred: i.preferred };
    let row: typeof supplierItems.$inferSelect | undefined;
    if (current) {
      [row] = await tx.db.update(supplierItems).set(values).where(eq(supplierItems.id, current.id)).returning();
    } else {
      [row] = await tx.db.insert(supplierItems).values({ ...values, supplierId: i.supplierId, materialId: i.materialId }).returning();
    }
    if (!row) throw new Error("tedarikçi fiyatı yazılamadı");

    const price =
      current && current.unitPriceMinor !== i.unitPriceMinor
        ? `${formatMoney(current.unitPriceMinor)} → ${formatMoney(i.unitPriceMinor)}`
        : formatMoney(i.unitPriceMinor);
    const parts = [`fiyatı ${price}`, i.moqMilli > 0 ? `en az ${formatQty(i.moqMilli, unit)}` : "en az yok"];
    if (i.preferred) parts.push(previousPreferred ? `tercihli (önceki tercihli ${previousPreferred})` : "tercihli");
    await logAudit(tx, {
      entity: "supplier",
      entityId: supplier.id,
      action: "set_item",
      summary: `${supplier.code}: ${material.code} ${material.name} ${parts.join(", ")}`,
    });
    return asSupplierItem(row);
  });
}

/** PostgreSQL benzersizlik ihlali (23505) bu kısıt için mi? Sürücü hatayı `cause` içine sarmış olabilir. */
export function isPreferredConflict(e: unknown): boolean {
  for (let err = e as { code?: string; constraint?: string; message?: string; cause?: unknown } | undefined; err; err = err.cause as typeof err) {
    if (err.code === "23505" && (err.constraint === "supplier_items_preferred_idx" || err.message?.includes("supplier_items_preferred_idx"))) return true;
  }
  return false;
}

export async function setSupplierItem(ctx: Ctx, i: SupplierItemInput): Promise<SupplierItem> {
  try {
    return await writeSupplierItem(ctx, i);
  } catch (e) {
    // İki kullanıcı aynı anda aynı malzemeyi tercihli yaptı: ikincisi ham veritabanı hatası yerine açık ileti alır.
    if (isPreferredConflict(e)) throw new DomainError("CONFLICT", "Bu malzemenin tercihli tedarikçisi az önce başkası tarafından değiştirildi; sayfayı yenileyip tekrar deneyin");
    throw e;
  }
}

export async function removeSupplierItem(ctx: Ctx, itemId: string): Promise<void> {
  assertCan(ctx.user, "purchasing", "write");
  await inTx(ctx, async (tx) => {
    const [found] = isUuid(itemId)
      ? await tx.db
          .select({ item: supplierItems, supplierId: suppliers.id, supplierCode: suppliers.code, code: materials.code, name: materials.name })
          .from(supplierItems)
          .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId))
          .innerJoin(materials, eq(materials.id, supplierItems.materialId))
          .where(eq(supplierItems.id, itemId))
      : [];
    if (!found) throw new DomainError("NOT_FOUND", "Tedarikçi fiyatı bulunamadı");
    await tx.db.delete(supplierItems).where(eq(supplierItems.id, itemId));
    await logAudit(tx, {
      entity: "supplier",
      entityId: found.supplierId,
      action: "remove_item",
      summary: `${found.supplierCode}: ${found.code} ${found.name} fiyatı kaldırıldı (${formatMoney(found.item.unitPriceMinor)})`,
    });
  });
}
