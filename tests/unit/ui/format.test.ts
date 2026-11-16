import { expect, test } from "vitest";
import { formatMoneyWhole, formatSignedQty } from "@/ui/format";

test("özet tutarı kuruşsuz ve binlik ayraçlı yazılır", () => {
  expect(formatMoneyWhole(423188012)).toBe("₺4.231.880");
  expect(formatMoneyWhole(-15050)).toBe("-₺151");
  expect(formatMoneyWhole(0)).toBe("₺0");
});

test("işaretli miktar", () => {
  expect(formatSignedQty(12500, "plaka")).toBe("+12,5 plaka");
  expect(formatSignedQty(-4000, "adet")).toBe("−4 adet");
});
