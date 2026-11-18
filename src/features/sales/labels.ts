import { type DomainErrorCode, isDomainError } from "@/domain/errors";
import { istanbulDayStart } from "@/domain/production/calendar";
import type { ProductFinish, Shortage } from "@/domain/production/types";
import type { CustomerKind, LineStatus, OrderStatus } from "@/domain/sales/types";
import { orderTotals, type OrderTotals, type TotalsLine } from "@/domain/sales/money";
import { formatMoney, formatNumber, formatQty, parseDecimal } from "@/domain/units";
import { type Change, diffFields } from "@/ui/changes";
import type { Tone } from "@/ui/StatusChip";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Taslak",
  confirmed: "Onaylandı",
  in_production: "Üretimde",
  ready: "Hazır",
  shipped: "Sevk edildi",
  cancelled: "İptal",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: "neutral",
  confirmed: "info",
  in_production: "warn",
  ready: "ok",
  shipped: "neutral",
  cancelled: "danger",
};

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  draft: "Taslak",
  waiting_material: "Malzeme bekliyor",
  in_production: "Üretimde",
  ready: "Hazır",
  shipped: "Sevk edildi",
  cancelled: "İptal",
};

export const LINE_STATUS_TONE: Record<LineStatus, Tone> = {
  draft: "neutral",
  waiting_material: "warn",
  in_production: "warn",
  ready: "ok",
  shipped: "neutral",
  cancelled: "danger",
};

/** Siparişin genel rengi (çekmece rozeti): açık sipariş malzeme bekliyorsa uyarı, değilse durumun rengi. */
export function orderTone(status: OrderStatus, waitingMaterial: boolean): Tone {
  const open = status === "confirmed" || status === "in_production" || status === "ready";
  return open && waitingMaterial ? "warn" : ORDER_STATUS_TONE[status];
}

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  bireysel: "Bireysel",
  kurumsal: "Kurumsal",
};

export const FINISH_LABEL: Record<ProductFinish, string> = {
  beyaz: "Beyaz",
  ahsap: "Ahşap",
};

const QTY_ERROR = "Adet 1 ile 9999 arasında tam sayı olmalı";

/** Sipariş adedi: 1–9999 arası tam sayı. Geçerliyse milli, değilse alan hatası. */
export function parseOrderQty(input: string): { qtyMilli: number } | { error: string } {
  const n = parseDecimal(input);
  if (n === null || !Number.isInteger(n) || n < 1 || n > 9999) return { error: QTY_ERROR };
  return { qtyMilli: n * 1000 };
}

const DISCOUNT_ERROR = "İskonto 0 ile 50 arasında, en çok bir ondalıkla yazılmalı";

/**
 * İskonto yüzde olarak yazılır (12,5), binde olarak saklanır (125). Boş giriş "verilmedi"dir
 * (undefined): yeni satır iskontosuz açılır, aynı ürün yeniden eklenince eski iskonto korunur.
 */
export function parseDiscount(input: string): { permille: number | undefined } | { error: string } {
  if (input.trim() === "") return { permille: undefined };
  const n = parseDecimal(input);
  if (n === null) return { error: DISCOUNT_ERROR };
  const permille = Math.round(n * 10);
  if (Math.abs(n * 10 - permille) > 1e-9 || permille < 0 || permille > 500) return { error: DISCOUNT_ERROR };
  return { permille };
}

// Termin bir İstanbul günüdür ve o günün başlangıç anıyla saklanır (örnek veri ve takvim de böyle).
const DAY_MS = 24 * 60 * 60 * 1000;
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const DUE = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Istanbul" });

/** Tarih kutusunun varsayılanı: İstanbul'a göre bugün + 14 takvim günü, "YYYY-AA-GG". */
export function defaultDueInput(now: Date): string {
  const istanbul = new Date(now.getTime() + ISTANBUL_OFFSET_MS + 14 * DAY_MS);
  return istanbul.toISOString().slice(0, 10);
}

/** "YYYY-AA-GG" → o İstanbul gününün başlangıç anı. Boş ya da takvimde olmayan gün null. */
export function dueFromInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - ISTANBUL_OFFSET_MS);
}

/** Termin günü, tarayıcının saat diliminden bağımsız olarak İstanbul'a göre: 30.11.2026. */
export function formatDue(date: Date): string {
  return DUE.format(date);
}

/** "MLZ-0009 MDF Lam 8 mm Beyaz Arkalık: 14 plaka gerekli, 3 plaka var" */
export function formatShortage(s: Shortage): string {
  return `${s.code} ${s.name}: ${formatQty(s.neededMilli, s.unit)} gerekli, ${formatQty(s.availableMilli, s.unit)} var`;
}

/** İş kuralı hatasını, iletisine göre bir form alanına yönlendirir; eşleşmezse null (bildirim olarak gösterilir). */
function routeError<F extends string>(error: unknown, codes: readonly DomainErrorCode[], routes: readonly [RegExp, F][]): F | null {
  if (!isDomainError(error) || !codes.includes(error.code)) return null;
  return routes.find(([pattern]) => pattern.test(error.message))?.[1] ?? null;
}

/** Satır formu: adet, iskonto ve ürün hataları kendi alanına; gerisi bildirime. */
export function lineErrorField(error: unknown): "qty" | "discount" | "product" | null {
  return routeError(error, ["VALIDATION", "NOT_FOUND"], [
    [/^Adet\b/, "qty"],
    [/^İskonto\b/, "discount"],
    [/[Üü]rün/, "product"],
  ]);
}

/** Yeni sipariş: yalnızca termin iletileri Termin alanına; gerisi bildirime. */
export function orderErrorField(error: unknown): "due" | null {
  return routeError(error, ["VALIDATION"], [[/^Termin\b/, "due"]]);
}

/** İskonto binde → "%12,5". */
export function formatDiscount(permille: number): string {
  return `%${(permille / 10).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

// ---- Onay pencereleri: ekrandaki veriden somut sonuç metni --------------------------------------------

type ConfirmLine = TotalsLine & { id: string; productId: string };
type ConfirmOrder = { code: string; lines: ConfirmLine[]; totals: OrderTotals };

const adet = (qtyMilli: number) => formatNumber(qtyMilli / 1000);

/** "URN-0031 Adım Ayakkabılık × 2 satırı silinecek. Sipariş tutarı ₺X → ₺Y olacak." Y kalan satırlarla hesaplanır. */
export function removeLineText(order: ConfirmOrder, line: { id: string; productCode: string; productName: string; qtyMilli: number }): string {
  const after = orderTotals(order.lines.filter((l) => l.id !== line.id)).totalKurus;
  return `${line.productCode} ${line.productName} × ${adet(line.qtyMilli)} satırı silinecek. Sipariş tutarı ${formatMoney(order.totals.totalKurus)} → ${formatMoney(after)} olacak.`;
}

/**
 * Satır ekleme önizlemesi, servisteki kuralla aynı: ürün siparişte varsa adet eklenir ve iskonto yalnızca verildiyse
 * değişir (`merged`, değişen alanlar); yoksa yeni satır ürünün fiyatı ve KDV'siyle açılır.
 */
export function previewAddLine(
  lines: ConfirmLine[],
  product: { id: string; priceKurus: number; vatRate: number },
  qtyMilli: number,
  discountPermille: number | undefined,
): { merged: boolean; changes: Change[]; beforeKurus: number; afterKurus: number } {
  const beforeKurus = orderTotals(lines).totalKurus;
  const same = lines.find((l) => l.productId === product.id);
  if (!same) {
    const added = { qtyMilli, unitPriceKurus: product.priceKurus, discountPermille: discountPermille ?? 0, vatRate: product.vatRate, status: "draft" };
    return { merged: false, changes: [], beforeKurus, afterKurus: orderTotals([...lines, added]).totalKurus };
  }
  const next = { ...same, qtyMilli: same.qtyMilli + qtyMilli, discountPermille: discountPermille ?? same.discountPermille };
  const changes = diffFields([
    { label: "Adet", before: adet(same.qtyMilli), after: adet(next.qtyMilli) },
    { label: "İskonto", before: formatDiscount(same.discountPermille), after: formatDiscount(next.discountPermille) },
  ]);
  return { merged: true, changes, beforeKurus, afterKurus: orderTotals(lines.map((l) => (l.id === same.id ? next : l))).totalKurus };
}

export function confirmOrderText(order: ConfirmOrder): string {
  return `${order.code} onaylanacak: ${order.lines.length} kalem, KDV dahil ${formatMoney(order.totals.totalKurus)}. Stok ayrılır, stokta olmayan ürünler için iş emri açılır.`;
}

/** "SIP-2026-0012 termini 02.12.2026 → 03.12.2026 olacak." */
export function applyDueText(order: { code: string; dueAt: Date }, dueAt: Date): string {
  return `${order.code} termini ${formatDue(order.dueAt)} → ${formatDue(dueAt)} olacak.`;
}

/** Termin günü (İstanbul) önerilen günden önce mi? */
export function dueBeforeSuggestion(dueAt: Date, suggested: Date): boolean {
  return istanbulDayStart(dueAt).getTime() < istanbulDayStart(suggested).getTime();
}

/** Aynı İstanbul günü mü? */
export function sameDueDay(a: Date, b: Date): boolean {
  return istanbulDayStart(a).getTime() === istanbulDayStart(b).getTime();
}

export function shipOrderText(order: { code: string }): string {
  return `${order.code} sevk edilecek; mamul stoktan düşer. Geri alınamaz.`;
}
