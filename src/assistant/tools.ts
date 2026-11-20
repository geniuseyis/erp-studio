// Asistan araçlarının tarayıcıdaki yürütücüleri. Hepsi giriş yapmış kişinin bağlamıyla ve mevcut iş kuralı
// servisleriyle çalışır; yetki ve doğrulama hataları (DomainError) çağırana olduğu gibi iletilir.
import type { Ctx } from "@/domain/context";
import { DomainError } from "@/domain/errors";
import { listMaterials } from "@/domain/inventory/queries";
import { assertCan } from "@/domain/permissions";
import { listWorkOrders } from "@/domain/production/queries";
import { listPurchaseOrders } from "@/domain/purchasing/queries";
import { createFromSuggestion } from "@/domain/purchasing/orders";
import { purchaseSuggestions } from "@/domain/purchasing/suggestions";
import type { PurchaseOrderStatus } from "@/domain/purchasing/types";
import { confirmOrder } from "@/domain/sales/orders";
import { listOrders } from "@/domain/sales/queries";
import type { OrderStatus } from "@/domain/sales/types";
import type { WorkOrderStatus } from "@/domain/production/types";
import { formatMoney, formatQty } from "@/domain/units";
import { WO_STATUS_LABEL } from "@/features/production/labels";
import { draftFromSuggestionText, PO_STATUS_LABEL, TIER_LABEL } from "@/features/purchasing/labels";
import { ORDER_STATUS_LABEL } from "@/features/sales/labels";
import { formatDate } from "@/ui/format";
import { TOOL_DEFS } from "./toolDefs";

const LIMIT = 10;
const bad = (message: string) => new DomainError("VALIDATION", message);

function text(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function required(input: Record<string, unknown>, key: string, what: string): string {
  const v = text(input, key);
  if (!v) throw bad(`${what} gerekli`);
  return v;
}
function oneOf<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const v = text(input, key);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw bad(`${key} değeri geçersiz`);
  return v as T;
}
const page = <T>(rows: T[]) => ({ toplam: rows.length, gosterilen: Math.min(rows.length, LIMIT), kayitlar: rows.slice(0, LIMIT) });

export function isActionTool(name: string): boolean {
  return TOOL_DEFS.find((t) => t.name === name)?.kind === "action";
}

/** Okuma aracını çalıştırır; sonuç JSON'a çevrilip Claude'a gider. `href` alanları kayıt bağlantısıdır. */
export async function runReadTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "siparis_bul": {
      const status = oneOf<OrderStatus>(input, "durum", ["draft", "confirmed", "in_production", "ready", "shipped", "cancelled"]);
      let rows = await listOrders(ctx.db, { search: text(input, "arama"), status, now: ctx.now });
      if (input.sadece_geciken === true) rows = rows.filter((o) => o.overdue);
      return page(
        rows.map((o) => ({
          kod: o.code,
          musteri: o.customerName,
          durum: ORDER_STATUS_LABEL[o.status],
          termin: formatDate(o.dueAt),
          gecikmis: o.overdue,
          malzeme_bekliyor: o.waitingMaterial,
          toplam_tutar: formatMoney(o.totalKurus),
          href: `/satis/siparisler?ac=${o.id}`,
        })),
      );
    }
    case "is_emri_durumu": {
      const status = oneOf<WorkOrderStatus>(input, "durum", ["planned", "in_progress", "completed", "cancelled"]);
      const rows = await listWorkOrders(ctx.db, { search: text(input, "arama"), status });
      return page(
        rows.map((w) => ({
          kod: w.code,
          urun: w.productName,
          durum: WO_STATUS_LABEL[w.status],
          istasyon: w.currentStation,
          biten_adim: `${w.doneSteps}/${w.totalSteps}`,
          siparis: w.orderCode,
          malzeme_ayrildi: w.materialsReserved,
          href: `/uretim/is-emirleri?ac=${w.id}`,
        })),
      );
    }
    case "malzeme_stok": {
      const rows = await listMaterials(ctx.db, { search: text(input, "arama"), criticalOnly: input.sadece_kritik === true });
      return page(
        rows.map((m) => ({
          kod: m.code,
          ad: m.name,
          eldeki: formatQty(m.onHandMilli, m.unit),
          ayrilmis: formatQty(m.reservedMilli, m.unit),
          kullanilabilir: formatQty(m.availableMilli, m.unit),
          siparis_noktasi: formatQty(m.reorderPointMilli, m.unit),
          kritik: m.isCritical,
          href: `/stok/malzemeler?ac=${m.id}`,
        })),
      );
    }
    case "satin_alma_siparisleri": {
      const status = oneOf<PurchaseOrderStatus>(input, "durum", ["draft", "pending_approval", "sent", "partial", "received", "cancelled"]);
      const rows = await listPurchaseOrders(ctx.db, { search: text(input, "arama"), status, now: ctx.now });
      return page(
        rows.map((p) => ({
          kod: p.code,
          tedarikci: p.supplierName,
          durum: PO_STATUS_LABEL[p.status],
          kdv_haric_tutar: formatMoney(p.netKurus),
          gereken_onay: TIER_LABEL[p.requiredTier],
          gecikmis: p.late,
          href: `/satin-alma/siparisler?ac=${p.id}`,
        })),
      );
    }
    case "oneri_ozeti": {
      const groups = await purchaseSuggestions(ctx.db);
      return {
        tedarikci_sayisi: groups.length,
        gruplar: groups.map((g) => ({
          tedarikci_kodu: g.supplierCode,
          tedarikci: g.supplierName,
          kalem_sayisi: g.lines.length,
          kdv_haric_tutar: formatMoney(g.netMinor),
          gereken_onay: TIER_LABEL[g.requiredTier],
          href: "/satin-alma/oneriler",
        })),
      };
    }
    default:
      throw bad(`Bilinmeyen araç: ${name}`);
  }
}

/** Onay kartında gösterilecek: tam olarak neyin değişeceği. */
export type ActionPreview = { title: string; lines: string[]; confirmLabel: string };

async function findDraftOrder(ctx: Ctx, input: Record<string, unknown>) {
  const code = required(input, "siparis_kodu", "Sipariş kodu").toUpperCase();
  const order = (await listOrders(ctx.db, { search: code, now: ctx.now })).find((o) => o.code === code);
  if (!order) throw new DomainError("NOT_FOUND", `${code} bulunamadı`);
  if (order.status !== "draft") throw new DomainError("INVALID_STATE", `${code} taslak değil (${ORDER_STATUS_LABEL[order.status]}), onaylanamaz`);
  return order;
}

async function findSuggestion(ctx: Ctx, input: Record<string, unknown>) {
  const code = required(input, "tedarikci_kodu", "Tedarikçi kodu").toUpperCase();
  const group = (await purchaseSuggestions(ctx.db)).find((g) => g.supplierCode === code);
  if (!group || !group.supplierId) throw new DomainError("NOT_FOUND", `${code} için öneri yok`);
  return { group, supplierId: group.supplierId };
}

/** İşlem aracının onay kartını hazırlar. Hiçbir şey yazmaz; yetkisi olmayana kart hiç gösterilmez. */
export async function previewActionTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<ActionPreview> {
  if (name === "onayla_siparis") {
    assertCan(ctx.user, "sales", "write");
    const o = await findDraftOrder(ctx, input);
    return {
      title: `${o.code} onaylansın mı?`,
      confirmLabel: "Onayla",
      lines: [
        `Müşteri: ${o.customerName}`,
        `Durum: ${ORDER_STATUS_LABEL[o.status]} → ${ORDER_STATUS_LABEL.confirmed}`,
        `${o.lineCount} satır, KDV dahil ${formatMoney(o.totalKurus)}, termin ${formatDate(o.dueAt)}`,
        "Her satıra eldeki mamul ayrılır; kalan adet için iş emri açılır.",
      ],
    };
  }
  if (name === "satin_alma_taslagi") {
    assertCan(ctx.user, "purchasing", "write");
    const { group } = await findSuggestion(ctx, input);
    return {
      title: `${group.supplierCode} için taslak açılsın mı?`,
      confirmLabel: "Taslak aç",
      lines: [draftFromSuggestionText(group), ...group.lines.slice(0, 6).map((l) => `${l.code} ${l.name}: ${formatQty(l.qtyMilli, l.unit)}`)],
    };
  }
  throw bad(`Bilinmeyen işlem aracı: ${name}`);
}

/** Kullanıcı "Onayla" dedikten sonra işlemi çalıştırır; servis yetkiyi ve durumu yeniden denetler. */
export async function runActionTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name === "onayla_siparis") {
    const o = await findDraftOrder(ctx, input);
    const { order, shortages } = await confirmOrder(ctx, o.id);
    return { sonuc: "Sipariş onaylandı", kod: order.code, durum: ORDER_STATUS_LABEL[order.status], eksik_malzeme_sayisi: shortages.length, href: `/satis/siparisler?ac=${order.id}` };
  }
  if (name === "satin_alma_taslagi") {
    const { supplierId } = await findSuggestion(ctx, input);
    const po = await createFromSuggestion(ctx, supplierId);
    return { sonuc: "Satın alma taslağı açıldı", kod: po.code, href: `/satin-alma/siparisler?ac=${po.id}` };
  }
  throw bad(`Bilinmeyen işlem aracı: ${name}`);
}
