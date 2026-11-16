import { expect, test } from "vitest";
import { addWorkdays, istanbulDayStart, istanbulYear, isWorkday, prevWorkday, shiftWorkdays, workdaysBetween } from "@/domain/production/calendar";

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

test("istanbulDayStart İstanbul gününün başlangıcını verir", () => {
  expect(istanbulDayStart(new Date("2026-11-15T09:00:00+03:00"))).toEqual(day("2026-11-15"));
  // 15 Kasım 23:30 UTC = İstanbul'da 16 Kasım 02:30
  expect(istanbulDayStart(new Date("2026-11-15T23:30:00Z"))).toEqual(day("2026-11-16"));
  // 15 Kasım 20:59 UTC = İstanbul'da 15 Kasım 23:59
  expect(istanbulDayStart(new Date("2026-11-15T20:59:00Z"))).toEqual(day("2026-11-15"));
  expect(istanbulDayStart(day("2026-11-15"))).toEqual(day("2026-11-15"));
});

test("istanbulYear yılbaşı gecesinde İstanbul yılını verir", () => {
  expect(istanbulYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
  expect(istanbulYear(new Date("2026-12-31T20:59:00Z"))).toBe(2026);
});

test.each([
  ["2026-11-13T09:00:00+03:00", true], // cuma
  ["2026-11-14T09:00:00+03:00", false], // cumartesi
  ["2026-11-15T09:00:00+03:00", false], // pazar
  ["2026-11-16T00:00:00+03:00", true], // pazartesi
  ["2026-11-13T22:30:00Z", false], // UTC'de cuma, İstanbul'da cumartesi 01:30
  ["2026-11-15T21:30:00Z", true], // UTC'de pazar, İstanbul'da pazartesi 00:30
])("isWorkday(%s) = %s", (at, expected) => {
  expect(isWorkday(new Date(at))).toBe(expected);
});

test.each([
  ["2026-11-14", 0, "2026-11-16"], // cumartesi + 0 → pazartesi
  ["2026-11-15", 0, "2026-11-16"], // pazar + 0 → pazartesi
  ["2026-11-12", 2, "2026-11-16"], // perşembe + 2 → pazartesi
  ["2026-11-13", 0, "2026-11-13"], // cuma + 0 → cuma
  ["2026-11-13", 1, "2026-11-16"], // cuma + 1 → pazartesi
  ["2026-11-13", 4, "2026-11-19"], // cuma + 4 → perşembe
  ["2026-11-14", 1, "2026-11-17"], // cumartesi + 1 → salı
  ["2026-11-16", 5, "2026-11-23"], // pazartesi + 5 → gelecek pazartesi
  ["2026-12-31", 1, "2027-01-01"], // perşembe + 1 → cuma, yıl dönümü
])("addWorkdays(%s, %s) = %s", (from, n, expected) => {
  expect(addWorkdays(day(from), n)).toEqual(day(expected));
});

test.each([
  ["2026-11-13", 0, "2026-11-13"], // cuma + 0
  ["2026-11-14", 0, "2026-11-16"], // cumartesi önce pazartesiye geçer
  ["2026-11-13", 1, "2026-11-16"], // cuma + 1 → pazartesi
  ["2026-11-16", -1, "2026-11-13"], // pazartesi − 1 → cuma
  ["2026-11-14", -1, "2026-11-13"], // cumartesi → pazartesi − 1 → cuma
  ["2026-11-18", -3, "2026-11-13"], // çarşamba − 3 → geçen cuma
  ["2026-11-18", -12, "2026-11-02"], // iki hafta geri
  ["2027-01-01", -1, "2026-12-31"], // yıl dönümü geri
  ["2026-11-16", 260, "2027-11-15"], // bir yıl ileri: 52 hafta
])("shiftWorkdays(%s, %s) = %s", (from, n, expected) => {
  expect(shiftWorkdays(day(from), n)).toEqual(day(expected));
});

test("shiftWorkdays sıfır ve pozitif n için addWorkdays ile aynıdır; gün içindeki saat atılır", () => {
  for (let d = 0; d < 21; d += 1) {
    const from = new Date(day("2026-11-09").getTime() + d * 86_400_000 + 13 * 3_600_000);
    for (const n of [0, 1, 4, 7]) expect(shiftWorkdays(from, n)).toEqual(addWorkdays(from, n));
  }
});

test.each([
  ["2026-11-13", "2026-11-13", 0],
  ["2026-11-13", "2026-11-16", 1], // cuma → pazartesi
  ["2026-11-16", "2026-11-13", -1],
  ["2026-11-02", "2026-11-18", 12],
  ["2026-11-18", "2026-11-02", -12],
  ["2026-12-31", "2027-01-04", 2],
])("workdaysBetween(%s, %s) = %s", (from, to, expected) => {
  expect(workdaysBetween(day(from), day(to))).toBe(expected);
  expect(shiftWorkdays(day(from), expected)).toEqual(day(to));
});

test.each([
  ["2026-11-15T09:00:00+03:00", "2026-11-13"], // pazar → cuma
  ["2026-11-14T23:00:00+03:00", "2026-11-13"], // cumartesi → cuma
  ["2026-11-16T10:00:00+03:00", "2026-11-13"], // pazartesi → cuma (aynı gün sayılmaz)
  ["2026-11-18T00:00:00+03:00", "2026-11-17"], // çarşamba → salı
  ["2026-11-16T21:30:00Z", "2026-11-16"], // UTC'de pazartesi, İstanbul'da salı 00:30 → pazartesi
])("prevWorkday(%s) = %s", (at, expected) => {
  expect(prevWorkday(new Date(at))).toEqual(day(expected));
});
