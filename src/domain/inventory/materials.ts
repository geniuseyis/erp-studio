import { eq, like } from "drizzle-orm";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS, materials } from "@/db/schema";
import { describeChanges, type FieldSpec, logAudit } from "../audit";
import { type Ctx, inTx, isUuid } from "../context";
import { DomainError } from "../errors";
import { assertCan } from "../permissions";
import { formatQty, type Unit, unitLabel } from "../units";
import { asMaterial, type Material, type MaterialCategory } from "./types";

export type NewMaterial = {
  /** Boş bırakılırsa sıradaki MLZ-#### verilir. */
  code?: string;
  name: string;
  category: MaterialCategory;
  unit: Unit;
  safetyStockMilli?: number;
  reorderPointMilli?: number;
  leadTimeDays?: number;
  shelf?: string;
};

/** Stok ve maliyet alanları burada yoktur: onlar yalnızca stok hareketleriyle değişir. */
export type EditableMaterial = {
  name: string;
  category: MaterialCategory;
  safetyStockMilli: number;
  reorderPointMilli: number;
  leadTimeDays: number;
  shelf: string;
  active: boolean;
};

const CODE_PREFIX = "MLZ-";

const CATEGORY_TEXT: Record<MaterialCategory, string> = {
  panel: "panel",
  masif: "masif",
  kenar_bandi: "kenar bandı",
  hirdavat: "hırdavat",
  boya: "boya ve kimyasal",
  kumas: "kumaş",
  ambalaj: "ambalaj",
};

/** Güncelleme özetinde alanların adı ve yazılışı; miktarlar malzemenin birimiyle. */
function fields(unit: Unit): FieldSpec<EditableMaterial> {
  const qty = (milli: number) => formatQty(milli, unit);
  return {
    name: { label: "ad" },
    category: { label: "kategori", format: (c) => CATEGORY_TEXT[c] },
    safetyStockMilli: { label: "güvenlik stoğu", format: qty },
    reorderPointMilli: { label: "yeniden sipariş noktası", format: qty },
    leadTimeDays: { label: "tedarik süresi", format: (n) => `${n} gün` },
    shelf: { label: "raf" },
    active: { label: "durum" },
  };
}

function invalid(message: string): DomainError {
  return new DomainError("VALIDATION", message);
}

function checkLevels(i: Partial<Pick<EditableMaterial, "safetyStockMilli" | "reorderPointMilli" | "leadTimeDays">>): void {
  for (const [label, value] of [
    ["Güvenlik stoğu", i.safetyStockMilli],
    ["Yeniden sipariş noktası", i.reorderPointMilli],
    ["Tedarik süresi", i.leadTimeDays],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw invalid(`${label} sıfır ya da daha büyük olmalı`);
  }
}

function checkKind(category: string | undefined, unit: string | undefined): void {
  if (category !== undefined && !(MATERIAL_CATEGORIES as readonly string[]).includes(category)) throw invalid("Geçersiz kategori");
  if (unit !== undefined && !(MATERIAL_UNITS as readonly string[]).includes(unit)) throw invalid("Geçersiz birim");
}

export async function createMaterial(ctx: Ctx, input: NewMaterial): Promise<Material> {
  assertCan(ctx.user, "inventory", "write");
  const name = input.name.trim();
  if (!name) throw invalid("Ad boş olamaz");
  checkKind(input.category, input.unit);
  checkLevels(input);

  return inTx(ctx, async (tx) => {
    let code = input.code?.trim().toUpperCase();
    if (code) {
      const [taken] = await tx.db.select({ id: materials.id }).from(materials).where(eq(materials.code, code));
      if (taken) throw new DomainError("DUPLICATE", "Bu malzeme kodu zaten kullanılıyor");
    } else {
      const existing = await tx.db.select({ code: materials.code }).from(materials).where(like(materials.code, `${CODE_PREFIX}%`));
      const max = existing.reduce((n, r) => Math.max(n, Number(r.code.slice(CODE_PREFIX.length)) || 0), 0);
      code = `${CODE_PREFIX}${String(max + 1).padStart(4, "0")}`;
    }
    const [row] = await tx.db
      .insert(materials)
      .values({
        code,
        name,
        category: input.category,
        unit: input.unit,
        safetyStockMilli: input.safetyStockMilli ?? 0,
        reorderPointMilli: input.reorderPointMilli ?? 0,
        leadTimeDays: input.leadTimeDays ?? 7,
        shelf: input.shelf?.trim() ?? "",
        createdAt: tx.now,
      })
      .returning();
    if (!row) throw new Error("malzeme eklenemedi");
    await logAudit(tx, {
      entity: "material",
      entityId: row.id,
      action: "create",
      summary: `${code} ${name} eklendi: ${CATEGORY_TEXT[input.category]}, ${unitLabel(input.unit)}`,
    });
    return asMaterial(row);
  });
}

export async function updateMaterial(ctx: Ctx, id: string, patch: Partial<EditableMaterial>): Promise<void> {
  assertCan(ctx.user, "inventory", "write");
  checkKind(patch.category, undefined);
  checkLevels(patch);
  const set: Partial<EditableMaterial> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw invalid("Ad boş olamaz");
    set.name = patch.name.trim();
  }
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.safetyStockMilli !== undefined) set.safetyStockMilli = patch.safetyStockMilli;
  if (patch.reorderPointMilli !== undefined) set.reorderPointMilli = patch.reorderPointMilli;
  if (patch.leadTimeDays !== undefined) set.leadTimeDays = patch.leadTimeDays;
  if (patch.shelf !== undefined) set.shelf = patch.shelf.trim();
  if (patch.active !== undefined) set.active = patch.active;

  await inTx(ctx, async (tx) => {
    const [row] = isUuid(id) ? await tx.db.select().from(materials).where(eq(materials.id, id)) : [];
    if (!row) throw new DomainError("NOT_FOUND", "Malzeme bulunamadı");
    const changes = describeChanges(fields(row.unit as Unit), asMaterial(row), set);
    if (changes.length === 0) return;
    await tx.db.update(materials).set(set).where(eq(materials.id, id));
    await logAudit(tx, { entity: "material", entityId: id, action: "update", summary: `${row.code} güncellendi: ${changes.join(", ")}` });
  });
}
