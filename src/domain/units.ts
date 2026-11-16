// Para tam sayı kuruş, miktar tam sayı binde birim ("milli") olarak tutulur: 1,250 m³ = 1250.
// Kayan noktalı para ya da miktar saklanmaz; bu dosya giriş ve gösterim sınırındaki çevirileri yapar.

export const UNITS = ["plaka", "m2", "m", "m3", "adet", "L", "kg"] as const;
export type Unit = (typeof UNITS)[number];

const UNIT_LABEL: Record<Unit, string> = { plaka: "plaka", m2: "m²", m: "m", m3: "m³", adet: "adet", L: "L", kg: "kg" };

export function unitLabel(unit: Unit): string {
  return UNIT_LABEL[unit];
}

/** Birimin en küçük anlamlı adımı (milli): adet, plaka ve metre tam; litre, kilo ve m² onda bir; m³ yüzde bir. */
export const UNIT_STEP_MILLI: Record<Unit, number> = { adet: 1000, plaka: 1000, m: 1000, L: 100, kg: 100, m2: 100, m3: 10 };

/** Miktarı birimin adımının katına yukarı yuvarlar: 782, "plaka" → 1000. */
export function roundUpToStep(milli: number, unit: Unit): number {
  const step = UNIT_STEP_MILLI[unit];
  return Math.ceil(milli / step) * step;
}

/**
 * Kullanıcının yazdığı sayıyı okur. Virgül varsa ondalık ayracıdır ve noktalar binlik ayracı sayılır
 * ("1.250,75" → 1250.75); virgül yoksa tek nokta ondalık ayracıdır ("1.5" → 1.5).
 * Belirsiz yazım ("1.250": bin iki yüz elli mi, bir virgül yirmi beş mi?) reddedilir.
 * Geçersiz, boş, belirsiz ya da negatif girişte null döner.
 */
export function parseDecimal(input: string): number | null {
  const s = input.trim();
  let normalized: string;
  if (s.includes(",")) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    if (isAmbiguousDecimal(s) || !/^\d+(\.\d+)?$/.test(s)) return null;
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Virgülsüz ve noktadan sonra tam üç rakamlı gruplar: "1.250", "12.500", "1.250.000".
 * Türkçede nokta binlik ayracıdır (uygulama da "1.250 adet" diye gösterir); bu yazım hem binlik hem ondalık okunabilir.
 */
export function isAmbiguousDecimal(input: string): boolean {
  return /^\d{1,3}(\.\d{3})+$/.test(input.trim());
}

/** Sayı alanının hata iletisi; geçerliyse null. Belirsiz yazımda iki doğru yazımı da gösterir. */
export function decimalError(input: string, what: "miktar" | "tutar"): string | null {
  const s = input.trim();
  if (isAmbiguousDecimal(s)) {
    const whole = s.replace(/\./g, "");
    const [head, ...rest] = s.split(".");
    // Birden çok nokta ancak binlik olabilir; tek noktada ondalık okunuşu da önerilir.
    if (rest.length > 1) return `“${s}” belirsiz: ${whole} yazın`;
    const fraction = (rest[0] ?? "").replace(/0+$/, "");
    return `“${s}” belirsiz: ${whole} ya da ${fraction ? `${head},${fraction}` : head} yazın`;
  }
  return parseDecimal(s) === null ? `Geçerli bir ${what} girin` : null;
}

export function toMilli(n: number): number {
  return Math.round(n * 1000);
}

export function toKurus(n: number): number {
  return Math.round(n * 100);
}

export function fromMilli(milli: number): number {
  return milli / 1000;
}

export function fromKurus(kurus: number): number {
  return kurus / 100;
}

/** Birimsiz sayı: tr-TR, en çok `maxDecimals` ondalık. */
export function formatNumber(n: number, maxDecimals = 3): string {
  return n.toLocaleString("tr-TR", { maximumFractionDigits: maxDecimals });
}

/** Miktarı birimiyle yazar: 1250, "m3" → "1,25 m³". */
export function formatQty(milli: number, unit: Unit): string {
  return `${formatNumber(milli / 1000, 3)} ${UNIT_LABEL[unit]}`;
}

/** 123450 → "₺1.234,50". */
export function formatMoney(kurus: number): string {
  const abs = (Math.abs(kurus) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${kurus < 0 ? "-" : ""}₺${abs}`;
}

/** Miktar (milli) × birim maliyet (kuruş / 1 birim) = tutar (kuruş), en yakın kuruşa yuvarlanır. */
export function lineValueKurus(qtyMilli: number, unitCostKurus: number): number {
  return Math.round((qtyMilli * unitCostKurus) / 1000);
}
