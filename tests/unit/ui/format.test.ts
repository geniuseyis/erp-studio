import { expect, test } from "vitest";
import { formatDate, formatDateTime, formatMoneyWhole, formatSignedQty, formatTime } from "@/ui/format";

test("özet tutarı kuruşsuz ve binlik ayraçlı yazılır", () => {
  expect(formatMoneyWhole(423188012)).toBe("₺4.231.880");
  expect(formatMoneyWhole(-15050)).toBe("-₺151");
  expect(formatMoneyWhole(0)).toBe("₺0");
});

test("işaretli miktar", () => {
  expect(formatSignedQty(12500, "plaka")).toBe("+12,5 plaka");
  expect(formatSignedQty(-4000, "adet")).toBe("−4 adet");
});

test("iş günü İstanbul günüdür: UTC'de bir önceki güne düşen an doğru günü yazar", () => {
  // 27.11.2026 İstanbul gün başlangıcı = 26.11.2026 21:00 UTC; tarayıcı UTC olsa da 27.11 görünmeli.
  const dayStart = new Date("2026-11-26T21:00:00Z");
  expect(formatDate(dayStart)).toBe("27.11.2026");
  expect(formatDateTime(dayStart)).toBe("27.11.2026 00:00");
  expect(formatTime(dayStart)).toBe("00:00");
});
