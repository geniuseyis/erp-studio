import { formatQty, type Unit } from "@/domain/units";

const DATE = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** 15.11.2026 */
export function formatDate(date: Date): string {
  return DATE.format(date);
}

/** 15.11.2026 09:00 */
export function formatDateTime(date: Date): string {
  return DATE_TIME.format(date);
}

/** Artı ya da eksi işaretiyle miktar: +12,5 plaka, −4 adet. Sıfırda işaret yok. */
export function formatSignedQty(milli: number, unit: Unit): string {
  const sign = milli > 0 ? "+" : milli < 0 ? "−" : "";
  return `${sign}${formatQty(Math.abs(milli), unit)}`;
}

/** Kuruşsuz tutar, özet kutuları için: 423188012 → "₺4.231.880". */
export function formatMoneyWhole(kurus: number): string {
  const abs = Math.round(Math.abs(kurus) / 100).toLocaleString("tr-TR");
  return `${kurus < 0 ? "-" : ""}₺${abs}`;
}
