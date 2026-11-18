// Haftalık plan ekranının metinleri ve özeti. React içermez; birim testiyle denetlenir.
import { istanbulDayStart } from "@/domain/production/calendar";
import { type PlanStep, type WeekPlan, weekStartOf } from "@/domain/production/schedule";
import { formatNumber } from "@/domain/units";

const OFFSET_MS = 3 * 60 * 60 * 1000;
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"];
export const WEEKDAY_SHORT = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

/** İstanbul duvar saatinde gün, ay, yıl ve haftanın günü. */
function wall(d: Date) {
  const w = new Date(d.getTime() + OFFSET_MS);
  return { day: w.getUTCDate(), month: w.getUTCMonth(), year: w.getUTCFullYear(), weekday: w.getUTCDay() };
}

/** Adresteki `hafta` değeri ve hücre anahtarı: "2026-11-16". */
export function weekKey(d: Date): string {
  return new Date(istanbulDayStart(d).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** `?hafta=` değerinden haftanın pazartesisi. Değer yoksa ya da geçerli bir gün değilse bu hafta. */
export function parseWeek(value: string | null, now: Date): Date {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (m) {
    const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // 2026-13-01 gibi taşan değerler Date.UTC'de sonraki aya kayar; geri çevirince aynı metin çıkmalı.
    if (new Date(at).toISOString().slice(0, 10) === value) return weekStartOf(new Date(at - OFFSET_MS));
  }
  return weekStartOf(now);
}

/** "16–20 Kasım 2026", "30 Kasım – 4 Aralık 2026", "28 Aralık 2026 – 1 Ocak 2027". */
export function weekLabel(weekStart: Date): string {
  const a = wall(weekStart);
  const b = wall(new Date(weekStart.getTime() + 4 * 24 * 60 * 60 * 1000));
  if (a.year !== b.year) return `${a.day} ${MONTHS[a.month]} ${a.year} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${MONTHS[a.month]} – ${b.day} ${MONTHS[b.month]} ${b.year}`;
  return `${a.day}–${b.day} ${MONTHS[a.month]} ${a.year}`;
}

/** "21.11" */
export function dayMonth(d: Date): string {
  const w = wall(d);
  return `${String(w.day).padStart(2, "0")}.${String(w.month + 1).padStart(2, "0")}`;
}

/** "21 Kasım cuma" */
export function longDay(d: Date): string {
  const w = wall(d);
  return `${w.day} ${MONTHS[w.month]} ${WEEKDAYS[w.weekday]}`;
}

/** Sütun başlığı: "Pzt" ve "16 Kas". */
export function dayHeader(d: Date): { weekday: string; date: string } {
  const w = wall(d);
  return { weekday: WEEKDAY_SHORT[w.weekday]!, date: `${w.day} ${MONTHS[w.month]!.slice(0, 3)}` };
}

/** "1.020 / 960 dk" */
export function loadText(load: number, capacity: number): string {
  return `${formatNumber(load)} / ${formatNumber(capacity)} dk`;
}

/** Onay penceresindeki kapasite uyarısı: "Montaj 21.11: 1.020 / 960 dk (%106)". */
export function capacityWarning(station: string, day: Date, load: number, capacity: number): string {
  return `${station} ${dayMonth(day)}: ${loadText(load, capacity)} (%${Math.round((load * 100) / capacity)})`;
}

/** "IE-2026-0042 Montaj adımı 20.11 → 23.11 taşınsın mı?" */
export function moveQuestion(code: string, station: string, from: Date, to: Date): string {
  return `${code} ${station} adımı ${dayMonth(from)} → ${dayMonth(to)} taşınsın mı?`;
}

/** Klavyeyle taşırken duyurulan konum: "IE-2026-0042 Montaj, 21 Kasım cuma üzerinde". */
export function announceDay(code: string, station: string, day: Date): string {
  return `${code} ${station}, ${longDay(day)} üzerinde`;
}

/** Kartın erişilebilir adı: görünen her bilgi, kısaltılmamış ürün adıyla. */
export function stepLabel(s: PlanStep, station: string): string {
  const parts = [`${s.code} ${station}`, s.productName, `${formatNumber(s.qtyMilli / 1000)} adet`, `${formatNumber(s.minutes)} dk`, `adım ${s.position}/${s.totalSteps}`];
  if (s.state === "running") parts.push("çalışıyor");
  if (s.state === "done") parts.push("bitti");
  if (s.late && s.dueAt) parts.push(`termin ${dayMonth(s.dueAt)} geçiyor`);
  return parts.join(", ");
}

export type WeekSummary = { loadMinutes: number; capacityMin: number; overCells: number; lateOrders: number; unscheduled: number };

/** Başlıktaki sayılar: haftanın toplam yükü ve kapasitesi, kapasiteyi aşan hücre, termini geçen iş emri (tekil), planlanmamış. */
export function weekSummary(plan: WeekPlan): WeekSummary {
  const late = new Set<string>();
  let loadMinutes = 0;
  let capacityMin = 0;
  let overCells = 0;
  for (const c of plan.cells) {
    loadMinutes += c.loadMinutes;
    capacityMin += c.capacityMin;
    if (c.loadMinutes > c.capacityMin) overCells += 1;
    for (const s of c.steps) if (s.late) late.add(s.workOrderId);
  }
  return { loadMinutes, capacityMin, overCells, lateOrders: late.size, unscheduled: plan.unscheduled };
}
