/**
 * Ekran başına kişisel ayarlar (özet bandı açık mı, tablo kaç piksel). Yalnızca bu tarayıcıda durur.
 * Depo kapalı, dolu ya da engelli olabilir; her okuma ve yazma istisnayı yutar ve ekran depo olmadan da doğru çizilir.
 */

export const HERO_KEY = "erp:hero:";
export const TABLE_HEIGHT_KEY = "erp:table-h:";

/** Tablo kabının en küçük ve en büyük yüksekliği (piksel). En küçüğü 16rem'dir. */
export const TABLE_MIN = 256;
export const TABLE_MAX = 2400;
/** Ayar yokken tablonun inebileceği en küçük yükseklik: 24rem. */
export const TABLE_AUTO_MIN_REM = 24;

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `null` ayarı siler. Yazılamazsa sessizce vazgeçer; dönüş değeri yazmanın başarısıdır. */
export function writePref(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function clampHeight(px: number): number {
  return Math.min(TABLE_MAX, Math.max(TABLE_MIN, Math.round(px)));
}

/** Kayıtlı yükseklik metnini sayıya çevirir; bozuk ya da yoksa `null` (otomatik boyut). */
export function parseHeight(raw: string | null): number | null {
  if (raw === null || !/^\d{2,5}$/.test(raw)) return null;
  return clampHeight(Number(raw));
}

/** Özet bandı varsayılanı: dar ekranda ve 820 px'ten alçak pencerede daraltılmış. */
export function defaultHeroCollapsed(width: number, height: number): boolean {
  return width < 768 || height < 820;
}

/** Kayıtlı seçim ("1" daraltılmış, "0" açık); yoksa ya da bozuksa varsayılan. */
export function resolveHeroCollapsed(raw: string | null, width: number, height: number): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return defaultHeroCollapsed(width, height);
}

/** Ekran anahtarı: yol adından, başındaki ve sonundaki eğik çizgiler atılarak. */
export function screenKey(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "") || "ana";
}
