import { expect, test } from "vitest";
import { lineNetKurus, orderTotals, vatKurus } from "@/domain/sales/money";

test("3 adet × 12.500 TL, %10 iskonto, KDV %10", () => {
  const t = orderTotals([{ qtyMilli: 3000, unitPriceKurus: 1_250_000, discountPermille: 100, vatRate: 10, status: "draft" }]);
  expect(t).toMatchObject({
    grossBeforeDiscountKurus: 3_750_000,
    discountKurus: 375_000,
    netKurus: 3_375_000,
    vatKurus: 337_500,
    totalKurus: 3_712_500,
  });
});

test("KDV oranlarına göre ayrı toplanır, iptal satır sayılmaz", () => {
  const t = orderTotals([
    { qtyMilli: 1000, unitPriceKurus: 100_000, discountPermille: 0, vatRate: 10, status: "draft" },
    { qtyMilli: 2000, unitPriceKurus: 50_000, discountPermille: 0, vatRate: 20, status: "draft" },
    { qtyMilli: 5000, unitPriceKurus: 999_999, discountPermille: 0, vatRate: 20, status: "cancelled" },
  ]);
  expect(t.vatByRate).toEqual({ "10": 10_000, "20": 20_000 });
  expect(t.netKurus).toBe(200_000);
  expect(t.vatKurus).toBe(30_000);
  expect(t.totalKurus).toBe(230_000);
});

test("satır net ve KDV tam sayı kuruşa yuvarlanır", () => {
  expect(lineNetKurus(1000, 333, 333)).toBe(222); // 333 × 667 / 1000 = 222.111
  expect(lineNetKurus(3000, 1_250_000, 100)).toBe(3_375_000);
  expect(vatKurus(105, 10)).toBe(11); // 10.5 → 11
  expect(vatKurus(104, 10)).toBe(10);
});

test("boş sipariş sıfırdır", () => {
  expect(orderTotals([])).toEqual({
    grossBeforeDiscountKurus: 0,
    discountKurus: 0,
    netKurus: 0,
    vatByRate: {},
    vatKurus: 0,
    totalKurus: 0,
  });
});
