import { expect, test } from "vitest";
import { orderTotals } from "@/domain/sales/money";
import { formatMoney } from "@/domain/units";
import { countApproveText, stockChangeText } from "@/features/inventory/labels";
import { planText, stepText } from "@/features/production/labels";
import { confirmOrderText, previewAddLine, removeLineText, shipOrderText } from "@/features/sales/labels";
import { diffFields } from "@/ui/changes";

const line = (id: string, productId: string, qty: number, price: number, discount = 0, vat = 10) => ({
  id,
  productId,
  productCode: `URN-00${id}`,
  productName: `Ürün ${id}`,
  qtyMilli: qty * 1000,
  unitPriceKurus: price,
  discountPermille: discount,
  vatRate: vat,
  status: "draft",
});

const order = (lines: ReturnType<typeof line>[]) => ({ code: "SIP-2026-0042", lines, totals: orderTotals(lines) });

test("diffFields yalnızca değişen alanları döner; baştaki ve sondaki boşluk değişiklik sayılmaz", () => {
  expect(
    diffFields([
      { label: "Ad", before: "Kestane Evi", after: " Kestane Evi " },
      { label: "Telefon", before: "0212 555 01 23", after: "0212 555 01 24" },
      { label: "İl", before: "Bursa", after: "Bursa" },
    ]),
  ).toEqual([{ label: "Telefon", from: "0212 555 01 23", to: "0212 555 01 24" }]);
  expect(diffFields([{ label: "Raf", before: "", after: "A-09" }])).toEqual([{ label: "Raf", from: "—", to: "A-09" }]);
});

test("satır silme metni ürünü, adedi ve kalan satırlarla yeni tutarı söyler", () => {
  const a = line("31", "p31", 2, 150_000);
  const b = line("12", "p12", 1, 40_000, 0, 20);
  const o = order([a, b]);
  const after = orderTotals([b]).totalKurus;
  expect(removeLineText(o, { ...a, productName: "Adım Ayakkabılık" })).toBe(
    `URN-0031 Adım Ayakkabılık × 2 satırı silinecek. Sipariş tutarı ${formatMoney(o.totals.totalKurus)} → ${formatMoney(after)} olacak.`,
  );
});

test("satır ekleme önizlemesi: yeni ürün eklenir, aynı ürün adedi ve verilen iskontoyu değiştirir", () => {
  const a = line("31", "p31", 2, 150_000, 100);
  const o = order([a]);
  const fresh = previewAddLine(o.lines, { id: "p9", priceKurus: 10_000, vatRate: 20 }, 3000, undefined);
  expect(fresh.merged).toBe(false);
  expect(fresh.changes).toEqual([]);
  expect(fresh.beforeKurus).toBe(o.totals.totalKurus);
  expect(fresh.afterKurus).toBe(orderTotals([...o.lines, { qtyMilli: 3000, unitPriceKurus: 10_000, discountPermille: 0, vatRate: 20, status: "draft" }]).totalKurus);

  const kept = previewAddLine(o.lines, { id: "p31", priceKurus: 150_000, vatRate: 10 }, 1000, undefined);
  expect(kept.merged).toBe(true);
  expect(kept.changes).toEqual([{ label: "Adet", from: "2", to: "3" }]);
  expect(kept.afterKurus).toBe(orderTotals([{ ...a, qtyMilli: 3000 }]).totalKurus);

  const both = previewAddLine(o.lines, { id: "p31", priceKurus: 150_000, vatRate: 10 }, 1000, 50);
  expect(both.changes).toEqual([
    { label: "Adet", from: "2", to: "3" },
    { label: "İskonto", from: "%10", to: "%5" },
  ]);
});

test("onay ve sevk metinleri kalem sayısını, KDV dahil tutarı ve sonucu söyler", () => {
  const o = order([line("31", "p31", 2, 150_000), line("12", "p12", 1, 40_000)]);
  expect(confirmOrderText(o)).toBe(`SIP-2026-0042 onaylanacak: 2 kalem, KDV dahil ${formatMoney(o.totals.totalKurus)}. Stok ayrılır, stokta olmayan ürünler için iş emri açılır.`);
  expect(shipOrderText(o)).toBe("SIP-2026-0042 sevk edilecek; mamul stoktan düşer. Geri alınamaz.");
});

test("planlama metni başlangıç gününü ve adım sayısını söyler; hafta sonu pazartesiye kayar", () => {
  // 2026-11-21 cumartesi (İstanbul) → 23.11.2026 pazartesi
  const saturday = new Date(Date.parse("2026-11-21T00:00:00Z") - 3 * 3600_000);
  expect(planText("IE-2026-0007", saturday, 4)).toBe("IE-2026-0007, 23.11.2026 gününden başlayarak 4 adım olarak planlanacak.");
});

test("atölye metni iş emri, istasyon ve adımı yazar; ilk başlatma tüketimi, son bitiş tamamlanmayı söyler", () => {
  const base = { code: "IE-2026-0007", station: "Kesim", seq: 1, totalSteps: 4, qtyMilli: 2000 };
  expect(stepText({ ...base, kind: "start" })).toBe("IE-2026-0007 · Kesim adımı başlatılacak (adım 1/4). Ayrılan malzemeler tüketilecek.");
  expect(stepText({ ...base, seq: 2, kind: "start" })).toBe("IE-2026-0007 · Kesim adımı başlatılacak (adım 2/4).");
  expect(stepText({ ...base, seq: 2, kind: "finish" })).toBe("IE-2026-0007 · Kesim adımı bitirilecek (adım 2/4).");
  expect(stepText({ ...base, seq: 4, kind: "finish" })).toBe("IE-2026-0007 · Kesim adımı bitirilecek (adım 4/4). İş emri tamamlanır, 2 adet mamul stoğa girer.");
});

test("stok metni eldeki miktarın öncesini ve sonrasını yazar", () => {
  const m = { code: "MLZ-0001", name: "MDF Lam 18 mm", unit: "plaka" as const, onHandMilli: 120_000 };
  expect(stockChangeText(m, "receipt", 12_500)).toBe("MLZ-0001 MDF Lam 18 mm: eldeki 120 plaka → 132,5 plaka");
  expect(stockChangeText(m, "issue", 2000)).toBe("MLZ-0001 MDF Lam 18 mm: eldeki 120 plaka → 118 plaka");
});

test("sayım onay metni farklı satır sayısını söyler", () => {
  expect(countApproveText(2)).toBe("2 satırdaki fark stok hareketi olarak yazılacak.");
  expect(countApproveText(0)).toBe("Sayılan miktarlar stokla aynı; stok hareketi yazılmaz.");
});
