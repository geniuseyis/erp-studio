import { expect, test } from "vitest";
import { CUSTOMER_KINDS, LINE_STATUSES, ORDER_STATUSES } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import {
  CUSTOMER_KIND_LABEL,
  defaultDueInput,
  dueFromInput,
  formatDue,
  formatShortage,
  LINE_STATUS_LABEL,
  lineErrorField,
  orderErrorField,
  LINE_STATUS_TONE,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  orderTone,
  parseDiscount,
  parseOrderQty,
} from "@/features/sales/labels";

test("sipariş durumlarının Türkçe adları", () => {
  for (const s of ORDER_STATUSES) expect(ORDER_STATUS_LABEL[s], s).toBeTruthy();
  expect(Object.values(ORDER_STATUS_LABEL)).toEqual(["Taslak", "Onaylandı", "Üretimde", "Hazır", "Sevk edildi", "İptal"]);
});

test("satır durumlarının Türkçe adları; malzeme bekleyen satır ayrı adlandırılır", () => {
  for (const s of LINE_STATUSES) {
    expect(LINE_STATUS_LABEL[s], s).toBeTruthy();
    expect(LINE_STATUS_TONE[s], s).toBeTruthy();
  }
  expect(LINE_STATUS_LABEL.waiting_material).toBe("Malzeme bekliyor");
  expect(LINE_STATUS_TONE.waiting_material).toBe("warn");
});

test("durum renkleri: taslak nötr, onay bilgi, üretim uyarı, hazır iyi, iptal tehlike", () => {
  expect(ORDER_STATUS_TONE).toEqual({
    draft: "neutral",
    confirmed: "info",
    in_production: "warn",
    ready: "ok",
    shipped: "neutral",
    cancelled: "danger",
  });
});

test("siparişin genel rengi: açık sipariş malzeme bekliyorsa uyarı, değilse durumun rengi", () => {
  expect(orderTone("confirmed", false)).toBe("info");
  expect(orderTone("confirmed", true)).toBe("warn");
  expect(orderTone("ready", false)).toBe("ok");
  expect(orderTone("cancelled", true)).toBe("danger");
  expect(orderTone("shipped", false)).toBe("neutral");
});

test("müşteri türlerinin adları", () => {
  for (const k of CUSTOMER_KINDS) expect(CUSTOMER_KIND_LABEL[k], k).toBeTruthy();
  expect(CUSTOMER_KIND_LABEL).toEqual({ bireysel: "Bireysel", kurumsal: "Kurumsal" });
});

test.each(["1,5", "0", "abc", "10000", "", "-2", "1.250"])("adet %s reddedilir", (input) => {
  expect(parseOrderQty(input)).toEqual({ error: "Adet 1 ile 9999 arasında tam sayı olmalı" });
});

test("geçerli adet milli olarak döner", () => {
  expect(parseOrderQty("1")).toEqual({ qtyMilli: 1000 });
  expect(parseOrderQty(" 12 ")).toEqual({ qtyMilli: 12_000 });
  expect(parseOrderQty("9999")).toEqual({ qtyMilli: 9_999_000 });
  expect(parseOrderQty("3,0")).toEqual({ qtyMilli: 3000 });
});

test("iskonto yüzde olarak yazılır, binde olarak döner; boş verilmemiş sayılır", () => {
  // Boş kutu "iskonto verilmedi" demektir: yeni satırda 0, birleşen satırda eskisi korunur.
  expect(parseDiscount("")).toEqual({ permille: undefined });
  expect(parseDiscount("  ")).toEqual({ permille: undefined });
  expect(parseDiscount("0")).toEqual({ permille: 0 });
  expect(parseDiscount("10")).toEqual({ permille: 100 });
  expect(parseDiscount("12,5")).toEqual({ permille: 125 });
  expect(parseDiscount("50")).toEqual({ permille: 500 });
  for (const bad of ["51", "abc", "-1", "2,25"]) expect(parseDiscount(bad), bad).toEqual({ error: "İskonto 0 ile 50 arasında, en çok bir ondalıkla yazılmalı" });
});

test("termin: varsayılan İstanbul'a göre bugün + 14 gün; giriş İstanbul gün başlangıcına çevrilir", () => {
  // 16 Kasım 2026 23:30 İstanbul = 20:30 UTC: İstanbul'da hâlâ 16'sı.
  expect(defaultDueInput(new Date("2026-11-16T20:30:00Z"))).toBe("2026-11-30");
  // 17 Kasım 00:30 İstanbul = 16 Kasım 21:30 UTC: İstanbul'da 17'si.
  expect(defaultDueInput(new Date("2026-11-16T21:30:00Z"))).toBe("2026-12-01");
  expect(dueFromInput("2026-11-30")?.toISOString()).toBe("2026-11-29T21:00:00.000Z");
  expect(dueFromInput("")).toBeNull();
  expect(dueFromInput("2026-02-30")).toBeNull();
  expect(formatDue(new Date("2026-11-29T21:00:00.000Z"))).toBe("30.11.2026");
});

test("satır formu hatası doğru alana gider; adetle ilgisi olmayan hata Adet'in altına düşmez", () => {
  const v = (message: string) => new DomainError("VALIDATION", message);
  expect(lineErrorField(v("Adet 1 ile 9999 arasında tam sayı olmalı"))).toBe("qty");
  expect(lineErrorField(v("İskonto 0 ile 500 binde arasında olmalı"))).toBe("discount");
  expect(lineErrorField(v("Pasif ürün siparişe eklenemez"))).toBe("product");
  expect(lineErrorField(new DomainError("NOT_FOUND", "Ürün bulunamadı"))).toBe("product");
  // Başka her şey bildirime gider.
  expect(lineErrorField(v("Yalnızca taslak siparişin satırları değiştirilebilir"))).toBeNull();
  expect(lineErrorField(new DomainError("INVALID_STATE", "Yalnızca taslak siparişin satırları değiştirilebilir"))).toBeNull();
  expect(lineErrorField(new DomainError("FORBIDDEN", "x: sales:write yetkisi yok"))).toBeNull();
  expect(lineErrorField(new Error("Adet"))).toBeNull();
});

test("yeni sipariş hatası: yalnızca termin iletileri Termin alanına gider", () => {
  expect(orderErrorField(new DomainError("VALIDATION", "Termin geçmiş bir gün olamaz"))).toBe("due");
  expect(orderErrorField(new DomainError("VALIDATION", "Termin geçersiz"))).toBe("due");
  expect(orderErrorField(new DomainError("NOT_FOUND", "Müşteri bulunamadı"))).toBeNull();
  expect(orderErrorField(new DomainError("VALIDATION", "Başka bir kural"))).toBeNull();
  expect(orderErrorField(new Error("Termin"))).toBeNull();
});

test("eksik malzeme satırı birimleriyle yazılır", () => {
  const text = formatShortage({ materialId: "x", code: "MLZ-0009", name: "MDF Lam 8 mm Beyaz Arkalık", unit: "plaka", neededMilli: 14_000, availableMilli: 3_000 });
  expect(text).toBe("MLZ-0009 MDF Lam 8 mm Beyaz Arkalık: 14 plaka gerekli, 3 plaka var");
});
