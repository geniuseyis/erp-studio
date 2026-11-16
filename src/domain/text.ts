const FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/**
 * Arama için karşılaştırma anahtarı: Türkçe kurallarıyla küçük harfe çevirir (İ→i, I→ı),
 * sonra Türkçe harfleri ASCII karşılıklarına indirir. "MEŞE", "meşe" ve "mese" aynı anahtarı verir.
 */
export function searchKey(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

/** `query` boşsa her şey eşleşir; değilse alanlardan birinde geçmesi yeter. */
export function matchesSearch(fields: readonly string[], query: string | undefined): boolean {
  const q = searchKey(query ?? "");
  if (!q) return true;
  return fields.some((f) => searchKey(f).includes(q));
}
