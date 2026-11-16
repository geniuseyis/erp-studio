// İş günü takvimi. Saf işlevler; saatler İstanbul'a göredir (UTC+3 sabit, yaz/kış saati yok).
// Günler, o İstanbul gününün başladığı UTC anıyla temsil edilir.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ISTANBUL_OFFSET_MS = 3 * HOUR_MS;

/** Anı İstanbul duvar saatine kaydırır; UTC alanları İstanbul'daki tarih ve saati gösterir. */
function shifted(d: Date): Date {
  return new Date(d.getTime() + ISTANBUL_OFFSET_MS);
}

/** Verilen anın İstanbul gününün başlangıcı. */
export function istanbulDayStart(d: Date): Date {
  return new Date(Math.floor(shifted(d).getTime() / DAY_MS) * DAY_MS - ISTANBUL_OFFSET_MS);
}

/** Verilen anın İstanbul'daki yılı. */
export function istanbulYear(d: Date): number {
  return shifted(d).getUTCFullYear();
}

/** Pazartesi–cuma. Gün İstanbul saatine göre belirlenir. */
export function isWorkday(d: Date): boolean {
  const weekday = shifted(d).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * Günden `n` iş günü sonrası (gün başlangıcından gün başlangıcına). Hafta sonundan başlanırsa önce
 * sonraki iş gününe geçilir: cumartesi + 0 → pazartesi, perşembe + 2 → pazartesi.
 */
export function addWorkdays(day: Date, n: number): Date {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("n sıfır ya da pozitif tam sayı olmalı");
  let current = istanbulDayStart(day);
  while (!isWorkday(current)) current = new Date(current.getTime() + DAY_MS);
  for (let left = n; left > 0; ) {
    current = new Date(current.getTime() + DAY_MS);
    if (isWorkday(current)) left -= 1;
  }
  return current;
}

// İş günü sıra numarası: hafta başına beş gün. Gün numarası = 1970-01-01'den bu yana İstanbul günü (perşembe).
const mod = (a: number, b: number) => ((a % b) + b) % b;
const dayNumber = (d: Date) => Math.round((istanbulDayStart(d).getTime() + ISTANBUL_OFFSET_MS) / DAY_MS);
const fromDayNumber = (e: number) => new Date(e * DAY_MS - ISTANBUL_OFFSET_MS);

/** Gün numarasının iş günü sırası; hafta sonu sonraki pazartesinin sırasını alır. */
function workdayIndex(d: Date): number {
  const e = dayNumber(d);
  const weekday = mod(e + 3, 7); // 0 pazartesi … 6 pazar
  const week = Math.floor((e + 3) / 7);
  return weekday < 5 ? week * 5 + weekday : (week + 1) * 5;
}

/**
 * Günden `n` iş günü ileri (n < 0 ise geri). Hafta sonundan başlanırsa önce sonraki iş gününe geçilir;
 * n ≥ 0 için addWorkdays ile aynıdır. Saat atılır, gün başlangıcı döner.
 */
export function shiftWorkdays(day: Date, n: number): Date {
  if (!Number.isInteger(n)) throw new RangeError("n tam sayı olmalı");
  const i = workdayIndex(day) + n;
  return fromDayNumber(Math.floor(i / 5) * 7 + mod(i, 5) - 3);
}

/** `from`dan `to`ya kaç iş günü (işaretli). Hafta sonu günleri sonraki iş günü sayılır: shiftWorkdays(from, sonuç) = to. */
export function workdaysBetween(from: Date, to: Date): number {
  return workdayIndex(to) - workdayIndex(from);
}

/** Verilen anın İstanbul gününden kesinlikle önceki son iş günü (gün başlangıcı). */
export function prevWorkday(d: Date): Date {
  let e = dayNumber(d) - 1;
  while (mod(e + 3, 7) >= 5) e -= 1;
  return fromDayNumber(e);
}
