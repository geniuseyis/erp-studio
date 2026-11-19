import type { PurchaseOrderLineRow } from "@/domain/purchasing/queries";
import { decimalError, formatQty, parseDecimal, toMilli, UNIT_STEP_MILLI } from "@/domain/units";

/** Çekmecedeki miktar alanının varsayılanı: kalan miktar, virgüllü yazım (4,5). */
export function remainingText(line: Pick<PurchaseOrderLineRow, "remainingMilli">): string {
  return String(line.remainingMilli / 1000).replace(".", ",");
}

export type ReceiptEntry = { line: PurchaseOrderLineRow; qtyMilli: number };

/**
 * Alanlardaki yazıyı okur. Boş alan sıfırdır (o kalem bu teslimde yok). Hata kalem kimliğiyle döner; tek hata bile varsa
 * `entries` boş kalır. Hiç miktar girilmediyse `none` doludur.
 */
export function parseReceipt(lines: PurchaseOrderLineRow[], values: Record<string, string>): { errors: Record<string, string>; entries: ReceiptEntry[]; none: boolean } {
  const errors: Record<string, string> = {};
  const entries: ReceiptEntry[] = [];
  for (const line of lines) {
    const raw = (values[line.id] ?? "").trim();
    if (raw === "") continue;
    const bad = decimalError(raw, "miktar");
    const q = bad ? null : parseDecimal(raw);
    if (bad || q === null) {
      errors[line.id] = bad ?? "Geçerli bir miktar girin";
      continue;
    }
    const qtyMilli = toMilli(q);
    if (qtyMilli > line.remainingMilli) errors[line.id] = `Kalan ${formatQty(line.remainingMilli, line.unit)}; daha fazlası teslim alınamaz`;
    else if (qtyMilli % UNIT_STEP_MILLI[line.unit] !== 0) errors[line.id] = `Miktar ${formatQty(UNIT_STEP_MILLI[line.unit], line.unit)} katı olmalı`;
    else if (qtyMilli > 0) entries.push({ line, qtyMilli });
  }
  const none = entries.length === 0 && Object.keys(errors).length === 0;
  return { errors, entries: Object.keys(errors).length > 0 ? [] : entries, none };
}

/** Bu teslimle sipariş tamamlanır mı (her kalemin kalanı karşılanır)? */
export function completesOrder(lines: PurchaseOrderLineRow[], entries: ReceiptEntry[]): boolean {
  return lines.every((l) => l.remainingMilli - (entries.find((e) => e.line.id === l.id)?.qtyMilli ?? 0) === 0);
}
