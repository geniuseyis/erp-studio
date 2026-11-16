import { expect, test } from "vitest";
import { COUNT_STATUSES, MATERIAL_CATEGORIES, MOVEMENT_TYPES } from "@/db/schema";
import { DomainError, type DomainErrorCode } from "@/domain/errors";
import { CATEGORY_LABEL, COUNT_STATUS, errorMessage, MOVEMENT_LABEL, stockScale, stockTone } from "@/features/inventory/labels";

const CODES: DomainErrorCode[] = ["FORBIDDEN", "NOT_FOUND", "VALIDATION", "INSUFFICIENT_STOCK", "INVALID_STATE", "LOGIN_FAILED", "DUPLICATE"];

test("her hareket türü, kategori ve sayım durumunun Türkçe adı var", () => {
  for (const t of MOVEMENT_TYPES) expect(MOVEMENT_LABEL[t], t).toBeTruthy();
  for (const c of MATERIAL_CATEGORIES) expect(CATEGORY_LABEL[c], c).toBeTruthy();
  for (const s of COUNT_STATUSES) expect(COUNT_STATUS[s].label, s).toBeTruthy();
  expect(MOVEMENT_LABEL).toMatchObject({ receipt: "Giriş", issue: "Çıkış", count_adjust: "Sayım farkı", consume: "Üretim tüketimi" });
  expect(CATEGORY_LABEL.kenar_bandi).toBe("Kenar bandı");
});

test.each(CODES)("%s için okunur bir ileti üretilir", (code) => {
  const message = errorMessage(new DomainError(code, "Kullanılabilir stok yetersiz"));
  expect(message.length).toBeGreaterThan(5);
  expect(message.endsWith(".")).toBe(true);
});

test("iş kuralı iletisi kullanıcıya olduğu gibi gösterilir", () => {
  expect(errorMessage(new DomainError("INSUFFICIENT_STOCK", "Kullanılabilir stok yetersiz"))).toBe("Kullanılabilir stok yetersiz.");
  expect(errorMessage(new DomainError("VALIDATION", "Ad boş olamaz."))).toBe("Ad boş olamaz.");
});

test("yetki hatası iç ayrıntıyı sızdırmaz", () => {
  const message = errorMessage(new DomainError("FORBIDDEN", "elif.karaca@baltacioglus.example: inventory:write yetkisi yok"));
  expect(message).toBe("Bu işlem için yetkiniz yok.");
});

test("bilinmeyen hata genel iletiye çevrilir", () => {
  expect(errorMessage(new Error("relation does not exist"))).toBe("Beklenmeyen bir hata oluştu.");
  expect(errorMessage("x")).toBe("Beklenmeyen bir hata oluştu.");
});

test("stok rengi: sipariş noktasının altı kritik, %25 yakını uyarı, gerisi yeterli", () => {
  expect(stockTone({ isCritical: true, availableMilli: 10, reorderPointMilli: 100 })).toBe("danger");
  expect(stockTone({ isCritical: false, availableMilli: 120, reorderPointMilli: 100 })).toBe("warn");
  expect(stockTone({ isCritical: false, availableMilli: 125, reorderPointMilli: 100 })).toBe("ok");
});

test("cetvel sonu eldeki miktar ya da sipariş noktasının iki katıdır", () => {
  expect(stockScale({ onHandMilli: 500, reorderPointMilli: 100 })).toBe(500);
  expect(stockScale({ onHandMilli: 50, reorderPointMilli: 100 })).toBe(200);
  expect(stockScale({ onHandMilli: 0, reorderPointMilli: 0 })).toBe(1);
});
