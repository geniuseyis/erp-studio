import { expect, test } from "vitest";
import {
  decimalError,
  formatMoney,
  formatQty,
  isAmbiguousDecimal,
  lineValueKurus,
  parseDecimal,
  roundUpToStep,
  toKurus,
  toMilli,
  UNIT_STEP_MILLI,
} from "@/domain/units";

test.each([
  ["1,5", 1.5],
  ["1.5", 1.5],
  ["1.250,75", 1250.75],
  ["12", 12],
  [" 3,0 ", 3],
  ["0", 0],
  ["12.345.678,9", 12345678.9],
])("parseDecimal(%s) = %s", (input, expected) => {
  expect(parseDecimal(input)).toBe(expected);
});

test.each(["abc", "", "   ", "-2", "1,2,3", "1e5", "1.2.3", "12a", ",5", "5,"])("parseDecimal(%s) geçersiz", (input) => {
  expect(parseDecimal(input)).toBeNull();
});

// Türkçede nokta binlik ayracıdır ve uygulama da miktarları "1.250 adet" diye gösterir. Virgülsüz "1.250"
// hem 1250 hem 1,25 olabilir; sessizce 1,25 okumak 1000 kat hatalı kayıt demek. Bu yüzden reddedilir.
test.each(["1.250", "12.500", "1.250.000", " 999.000 "])("parseDecimal(%s) belirsiz, reddedilir", (input) => {
  expect(parseDecimal(input)).toBeNull();
  expect(isAmbiguousDecimal(input)).toBe(true);
});

test("belirsiz girişte kullanıcıya iki yazımı da gösteren ileti", () => {
  expect(decimalError("1.250", "miktar")).toBe("“1.250” belirsiz: 1250 ya da 1,25 yazın");
  expect(decimalError("12.500", "tutar")).toBe("“12.500” belirsiz: 12500 ya da 12,5 yazın");
  expect(decimalError("abc", "miktar")).toBe("Geçerli bir miktar girin");
  expect(decimalError("1,25", "miktar")).toBeNull();
  expect(isAmbiguousDecimal("1.25")).toBe(false);
  expect(parseDecimal("1.25")).toBe(1.25);
});

test("para ve miktar biçimlendirme", () => {
  expect(formatMoney(123450)).toBe("₺1.234,50");
  expect(formatMoney(0)).toBe("₺0,00");
  expect(formatQty(1250, "m3")).toBe("1,25 m³");
  expect(formatQty(3000, "adet")).toBe("3 adet");
  expect(formatQty(1500, "m2")).toBe("1,5 m²");
  expect(formatQty(1234567, "m")).toBe("1.234,567 m");
});

test("tam sayı birimlere çevirme kayan nokta hatası taşımaz", () => {
  expect(toMilli(0.1 + 0.2)).toBe(300);
  expect(toMilli(1.25)).toBe(1250);
  expect(toKurus(12.5)).toBe(1250);
  expect(toKurus(19.99)).toBe(1999);
});

test("satır değeri: miktar × birim maliyet, kuruşa yuvarlanır", () => {
  expect(lineValueKurus(1500, 20000)).toBe(30000);
  expect(lineValueKurus(333, 1000)).toBe(333);
  expect(lineValueKurus(1, 1499)).toBe(1);
});

test("birim adımı: adet, plaka ve metre tam; litre, kilo ve m² onda bir; m³ yüzde bir", () => {
  expect(UNIT_STEP_MILLI).toEqual({ adet: 1000, plaka: 1000, m: 1000, L: 100, kg: 100, m2: 100, m3: 10 });
});

test.each([
  [782, "plaka", 1000],
  [1000, "plaka", 1000],
  [1001, "adet", 2000],
  [0, "adet", 0],
  [1, "m", 1000],
  [1250, "kg", 1300],
  [1300, "L", 1300],
  [101, "m2", 200],
  [1251, "m3", 1260],
  [1250, "m3", 1250],
] as const)("roundUpToStep(%s, %s) = %s", (milli, unit, expected) => {
  expect(roundUpToStep(milli, unit)).toBe(expected);
});
