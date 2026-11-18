import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditLog, salesOrderLines, salesOrders, stockCounts, workOrders } from "@/db/schema";
import { type Ctx, isUuid } from "./context";
import { lookupSearchLabel, searchText } from "./audit-labels";
import { searchKey } from "./text";

/**
 * İşlem geçmişine "kim, neyi, ne yaptı" satırı yazar. Değişikliği yapan transaction içinde çağrılır.
 * Arama anahtarı özet, kişi adı ve (özet içermiyorsa) `code`: kaydın kodu ile oluşur.
 */
export async function logAudit(
  ctx: Ctx,
  e: { entity: string; entityId: string; action: string; summary: string; code?: string },
): Promise<void> {
  const { code, ...row } = e;
  const label = await lookupSearchLabel(ctx.db, e.entity, e.entityId);
  await ctx.db.insert(auditLog).values({
    ...row,
    searchKey: searchKey(searchText({ summary: e.summary, userName: ctx.user.name, label, code })),
    userId: ctx.user.id,
    createdAt: ctx.now,
  });
}

/** Özet için alan tanımı: Türkçe etiket ve değeri yazma biçimi (verilmezse metin olarak; boş metin "boş"). */
export type FieldSpec<T> = { [K in keyof T]?: { label: string; format?: (value: NonNullable<T[K]>) => string } };

function show(value: unknown, format?: (value: never) => string): string {
  if (format && value !== null && value !== undefined) return format(value as never);
  if (typeof value === "boolean") return value ? "etkin" : "pasif";
  if (value === null || value === undefined || value === "") return "boş";
  return String(value);
}

/**
 * Yalnızca değişen alanları "<alan> eski → yeni" biçiminde yazar, tanım sırasıyla. Tanımda olmayan alan
 * (parola özeti gibi) hiçbir zaman yazılmaz. Değişen alan yoksa boş dizi döner.
 */
export function describeChanges<T extends object>(fields: FieldSpec<T>, before: T, patch: Partial<T>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(fields) as (keyof T)[]) {
    const spec = fields[key];
    if (!spec || !(key in patch) || patch[key] === undefined) continue;
    const next = patch[key];
    const prev = before[key];
    if (Object.is(prev, next)) continue;
    out.push(`${spec.label} ${show(prev, spec.format)} → ${show(next, spec.format)}`);
  }
  return out;
}

/** Defter hareketinin bağlı olduğu belgenin kodu: iş emri, sayım fişi ya da sipariş satırının siparişi. Bulunmazsa null. */
export async function refCode(db: Db, ref: { type: string; id: string } | undefined): Promise<string | null> {
  if (!ref || !isUuid(ref.id)) return null;
  if (ref.type === "work_order") {
    const [row] = await db.select({ code: workOrders.code }).from(workOrders).where(eq(workOrders.id, ref.id));
    return row?.code ?? null;
  }
  if (ref.type === "stock_count") {
    const [row] = await db.select({ code: stockCounts.code }).from(stockCounts).where(eq(stockCounts.id, ref.id));
    return row?.code ?? null;
  }
  if (ref.type === "sales_order_line") {
    const [row] = await db
      .select({ code: salesOrders.code })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
      .where(eq(salesOrderLines.id, ref.id));
    return row?.code ?? null;
  }
  return null;
}

/** "Kod listesi" kısaltması: ilk `max` kod, fazlası "ve N diğer". */
export function codeList(codes: string[], max = 5): string {
  const head = codes.slice(0, max).join(", ");
  return codes.length > max ? `${head} ve ${codes.length - max} diğer` : head;
}

/** İstanbul günü: 01.12.2026. */
export function auditDay(date: Date): string {
  return date.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" });
}
