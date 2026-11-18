import { expect, test } from "vitest";
import type { PlanCell, PlanStep, WeekPlan } from "@/domain/production/schedule";
import {
  announceDay,
  capacityWarning,
  dayMonth,
  loadText,
  longDay,
  moveQuestion,
  parseWeek,
  stepLabel,
  weekKey,
  weekLabel,
  weekSummary,
} from "@/features/planning/labels";

const OFFSET = 3 * 60 * 60 * 1000;
/** "2026-11-16" → o İstanbul gününün başlangıcı. */
const day = (s: string) => new Date(Date.parse(`${s}T00:00:00Z`) - OFFSET);

test("hafta parametresi: geçerli gün o haftanın pazartesisine iner; bozuk ya da boşsa bu hafta", () => {
  const now = new Date("2026-11-18T09:00:00Z"); // çarşamba
  expect(parseWeek("2026-11-16", now)).toEqual(day("2026-11-16"));
  expect(parseWeek("2026-11-20", now)).toEqual(day("2026-11-16"));
  expect(parseWeek("2026-11-22", now)).toEqual(day("2026-11-16")); // pazar
  expect(parseWeek(null, now)).toEqual(day("2026-11-16"));
  for (const bad of ["", "2026-13-01", "16.11.2026", "2026-11-16x", "abc"]) expect(parseWeek(bad, now), bad).toEqual(day("2026-11-16"));
  expect(weekKey(day("2026-11-23"))).toBe("2026-11-23");
});

test("hafta etiketi aynı ayda ve ay geçişinde", () => {
  expect(weekLabel(day("2026-11-16"))).toBe("16–20 Kasım 2026");
  expect(weekLabel(day("2026-11-30"))).toBe("30 Kasım – 4 Aralık 2026");
  expect(weekLabel(day("2026-12-28"))).toBe("28 Aralık 2026 – 1 Ocak 2027");
});

test("gün biçimleri: 21.11 ve '21 Kasım cuma'", () => {
  expect(dayMonth(day("2026-11-21"))).toBe("21.11");
  expect(longDay(day("2026-11-20"))).toBe("20 Kasım cuma");
  expect(longDay(day("2026-11-23"))).toBe("23 Kasım pazartesi");
});

test("yük metni binlik ayırıcıyla; aşım uyarısı yüzdeyle", () => {
  expect(loadText(1020, 960)).toBe("1.020 / 960 dk");
  expect(capacityWarning("Montaj", day("2026-11-21"), 1020, 960)).toBe("Montaj 21.11: 1.020 / 960 dk (%106)");
});

test("onay sorusu ve klavye duyurusu", () => {
  expect(moveQuestion("IE-2026-0042", "Montaj", day("2026-11-20"), day("2026-11-23"))).toBe("IE-2026-0042 Montaj adımı 20.11 → 23.11 taşınsın mı?");
  expect(announceDay("IE-2026-0042", "Montaj", day("2026-11-21"))).toBe("IE-2026-0042 Montaj, 21 Kasım cumartesi üzerinde");
});

const step = (over: Partial<PlanStep>): PlanStep => ({
  workOrderId: "w1",
  code: "IE-2026-0042",
  productName: "Eksen Gardırop",
  qtyMilli: 3000,
  seq: 2,
  position: 2,
  totalSteps: 5,
  minutes: 120,
  state: "planned",
  orderCode: "SIP-2026-0007",
  dueAt: day("2026-12-12"),
  late: false,
  movable: true,
  ...over,
});

test("kart etiketi ekran okuyucuya bütün bilgiyi söyler", () => {
  expect(stepLabel(step({}), "Montaj")).toBe("IE-2026-0042 Montaj, Eksen Gardırop, 3 adet, 120 dk, adım 2/5");
  expect(stepLabel(step({ late: true, state: "running" }), "Montaj")).toBe("IE-2026-0042 Montaj, Eksen Gardırop, 3 adet, 120 dk, adım 2/5, çalışıyor, termin 12.12 geçiyor");
  expect(stepLabel(step({ state: "done" }), "Montaj")).toContain(", bitti");
});

test("hafta özeti: yük, kapasite, aşan hücre, termini geçen iş emri, planlanmamış", () => {
  const cell = (stationId: string, loadMinutes: number, capacityMin: number, steps: PlanStep[] = []): PlanCell => ({ stationId, day: day("2026-11-16"), steps, loadMinutes, capacityMin });
  const plan: WeekPlan = {
    weekStart: day("2026-11-16"),
    days: [day("2026-11-16")],
    stations: [],
    cells: [
      cell("a", 1020, 960, [step({ workOrderId: "w1", late: true })]),
      cell("b", 300, 480, [step({ workOrderId: "w1", late: true }), step({ workOrderId: "w2", late: true }), step({ workOrderId: "w3" })]),
      cell("c", 0, 480),
    ],
    unscheduled: 4,
  };
  expect(weekSummary(plan)).toEqual({ loadMinutes: 1320, capacityMin: 1920, overCells: 1, lateOrders: 2, unscheduled: 4 });
});
