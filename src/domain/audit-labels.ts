// İşlem aramasında kaydın insan okunur adı: audit_log.search_key'e özetin yanında yazılır.
// Yazma anı (logAudit) ve örnek veri yüklemesi (loadSnapshot) aynı biçimlendiriciyi kullanır; ayrışamazlar.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customers, materials, products, salesOrders, stockCounts, users, workOrders } from "@/db/schema";
import { isUuid } from "./context";

/**
 * Kayıt türüne göre aranacak ad: müşteri, ürün ve malzemede "kod ad"; iş emrinde "kod ürün adı"; siparişte "kod müşteri adı";
 * sayım fişinde kod; kullanıcıda ad. `primary` kod (kullanıcıda ad), `secondary` eşlik eden ad.
 */
export function recordSearchLabel(entity: string, primary: string, secondary?: string): string {
  if (entity === "stock_count" || entity === "user") return primary;
  return secondary ? `${primary} ${secondary}` : primary;
}

/** Kaydın aranacak adı; kayıt yoksa, kimlik uuid değilse ya da tür bilinmiyorsa boş metin. Kayıt başına tek dizinli okuma. */
export async function lookupSearchLabel(db: Db, entity: string, entityId: string): Promise<string> {
  if (!isUuid(entityId)) return "";
  switch (entity) {
    case "customer": {
      const [r] = await db.select({ a: customers.code, b: customers.name }).from(customers).where(eq(customers.id, entityId));
      return r ? recordSearchLabel(entity, r.a, r.b) : "";
    }
    case "product": {
      const [r] = await db.select({ a: products.code, b: products.name }).from(products).where(eq(products.id, entityId));
      return r ? recordSearchLabel(entity, r.a, r.b) : "";
    }
    case "material": {
      const [r] = await db.select({ a: materials.code, b: materials.name }).from(materials).where(eq(materials.id, entityId));
      return r ? recordSearchLabel(entity, r.a, r.b) : "";
    }
    case "work_order": {
      const [r] = await db
        .select({ a: workOrders.code, b: products.name })
        .from(workOrders)
        .innerJoin(products, eq(products.id, workOrders.productId))
        .where(eq(workOrders.id, entityId));
      return r ? recordSearchLabel(entity, r.a, r.b) : "";
    }
    case "sales_order": {
      const [r] = await db
        .select({ a: salesOrders.code, b: customers.name })
        .from(salesOrders)
        .innerJoin(customers, eq(customers.id, salesOrders.customerId))
        .where(eq(salesOrders.id, entityId));
      return r ? recordSearchLabel(entity, r.a, r.b) : "";
    }
    case "stock_count": {
      const [r] = await db.select({ a: stockCounts.code }).from(stockCounts).where(eq(stockCounts.id, entityId));
      return r ? recordSearchLabel(entity, r.a) : "";
    }
    case "user": {
      const [r] = await db.select({ a: users.name }).from(users).where(eq(users.id, entityId));
      return r ? recordSearchLabel(entity, r.a) : "";
    }
    default:
      return "";
  }
}

/** Arama anahtarının ham metni (searchKey'e verilmeden önce): özet, kişi adı, kayıt adı, isteğe bağlı kod. */
export function searchText(parts: { summary: string; userName: string; label: string; code?: string }): string {
  return `${parts.summary} ${parts.userName} ${parts.label} ${parts.code ?? ""}`;
}
