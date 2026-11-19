import { expect, test } from "vitest";
import { PURCHASE_ORDER_STATUSES } from "@/db/schema";
import type { PurchaseOrderDetail, PurchaseOrderLineRow } from "@/domain/purchasing/queries";
import {
  approvalLabel,
  approvalReleases,
  approvalView,
  approveText,
  asPoStatus,
  cancelText,
  parseLineEdit,
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  previewLineEdit,
  purchaseTotals,
  submitText,
  TIER_LABEL,
  userCanApprove,
} from "@/features/purchasing/labels";

import { requiredTier } from "@/domain/settings";
const THRESHOLDS = { managerKurus: 5_000_000, boardKurus: 25_000_000 };
const buyer = { id: "buyer", departmentCode: "satinalma", level: "uzman" } as const;
const manager = { id: "manager", departmentCode: "satinalma", level: "mudur" } as const;
const board = { id: "board", departmentCode: "yonetim", level: "mudur" } as const;
const sales = { id: "sales", departmentCode: "satis", level: "mudur" } as const;

function po(over: Partial<PurchaseOrderDetail>): PurchaseOrderDetail {
  return {
    id: "po1",
    code: "SAS-2026-0001",
    supplierId: "s1",
    supplierCode: "TED-0001",
    supplierName: "Karadeniz Panel",
    supplierLeadDays: 5,
    status: "pending_approval",
    currency: "TRY",
    netMinor: 9_250_020,
    netKurus: 9_250_020,
    openNetKurus: 9_250_020,
    lineCount: 1,
    createdAt: new Date("2026-11-19T09:00:00Z"),
    createdById: "buyer",
    createdByName: "Kerem Uysal",
    requiredTier: 1,
    managerApprovedBy: null,
    boardApprovedBy: null,
    expectedAt: null,
    late: false,
    lines: [],
    note: "",
    cancelReason: "",
    submittedAt: null,
    sentAt: null,
    managerApprovedByName: null,
    managerApprovedAt: null,
    boardApprovedByName: null,
    boardApprovedAt: null,
    receipts: [],
    ...over,
  };
}

test("durum etiketleri ve tonları her durum için tanımlı", () => {
  expect(PURCHASE_ORDER_STATUSES.map((s) => PO_STATUS_LABEL[s])).toEqual(["Taslak", "Onay bekliyor", "Gönderildi", "Kısmi teslim", "Teslim alındı", "İptal"]);
  expect(PURCHASE_ORDER_STATUSES.map((s) => PO_STATUS_TONE[s])).toEqual(["neutral", "warn", "info", "info", "ok", "danger"]);
  expect([0, 1, 2].map((t) => TIER_LABEL[t as 0 | 1 | 2])).toEqual(["Doğrudan gönderilir", "Müdür onayı", "Müdür + Yönetim onayı"]);
  expect(asPoStatus("sent")).toBe("sent");
  expect(asPoStatus("yok")).toBeUndefined();
  expect(asPoStatus(null)).toBeUndefined();
});

test("kademe eşiklerde: 50.000 TL dahil onaysız, üstü müdür, 250.000 TL üstü müdür + Yönetim", () => {
  expect([5_000_000, 5_000_001, 25_000_000, 25_000_001].map((n) => requiredTier(n, THRESHOLDS))).toEqual([0, 1, 1, 2]);
});

test("onay ekranı: oluşturan kendi siparişini onaylayamaz ve bekleneni görür", () => {
  const v = approvalView(buyer, po({}), THRESHOLDS);
  expect(v.can).toBe(false);
  expect(v.waiting).toBe("Onay bekleniyor: Satın Alma müdürü");
  expect(v.note).toBe("Kendi siparişinizi onaylayamazsınız");
  expect(v.required).toBe("Bu sipariş Müdür onayı ister");
  expect(v.steps).toEqual([{ key: "manager", label: "Satın Alma müdürü", done: false, text: "Bekleniyor" }]);
});

test("müdür müdür kademesini onaylar; satış müdürü onaylayamaz ve nedenini görür", () => {
  expect(approvalView(manager, po({}), THRESHOLDS)).toMatchObject({ can: true, note: null });
  expect(userCanApprove(manager, po({}))).toBe(true);
  expect(approvalView(sales, po({}), THRESHOLDS)).toMatchObject({ can: false, note: "Bu kademe Satın Alma müdürü onayı ister" });
});

test("Yönetim kademesi yalnızca Yönetim'e açık; müdür onayladıktan sonra müdür 'Bu kademe Yönetim onayı ister' görür", () => {
  const afterManager = po({ requiredTier: 2, managerApprovedBy: "manager", managerApprovedByName: "Ayla Güneş" });
  const v = approvalView(manager, afterManager, THRESHOLDS);
  expect(v).toMatchObject({ can: false, waiting: "Onay bekleniyor: Yönetim", note: "Bu kademe Yönetim onayı ister" });
  expect(v.steps.map((s) => [s.label, s.text])).toEqual([
    ["Satın Alma müdürü", "Onayladı: Ayla Güneş"],
    ["Yönetim", "Bekleniyor"],
  ]);
  expect(approvalView(board, afterManager, THRESHOLDS).can).toBe(true);
  // Tier 2'de müdür kademesi bekliyorken Yönetim onaylarsa sipariş gider; müdür onaylarsa Yönetim'i bekler.
  const fresh = po({ requiredTier: 2 });
  expect(approvalReleases(board, fresh)).toBe(true);
  expect(approvalReleases(manager, fresh)).toBe(false);
  expect(approvalReleases(manager, po({ requiredTier: 1 }))).toBe(true);
});

test("taslakta kademe eşiklerden tahmin edilir ve henüz onay istenmediği yazılır", () => {
  const draft = po({ status: "draft", requiredTier: 0 });
  const v = approvalView(buyer, draft, THRESHOLDS);
  expect(v.required).toBe("Bu sipariş Müdür onayı ister");
  expect(v.steps[0]?.text).toBe("Gönderimde istenecek");
  expect(v.waiting).toBeNull();
  expect(approvalView(buyer, po({ status: "draft", netKurus: 5_000_000 }), THRESHOLDS).required).toBe("Onay gerekmez, doğrudan gönderilir");
});

test("onay penceresi metinleri tutarı, kademeyi ve beklenen teslimi yazar", () => {
  const order = po({});
  expect(submitText(order, THRESHOLDS, null)).toBe("SAS-2026-0001: ₺92.500,20 KDV hariç 50.000 TL eşiğini aşıyor; Satın Alma müdürünün onayına gider.");
  expect(submitText(po({ netKurus: 30_000_000 }), THRESHOLDS, null)).toContain("250.000 TL eşiğini aşıyor; önce Satın Alma müdürünün, sonra Yönetim'in onayına gider");
  expect(submitText(po({ netKurus: 1_000_000 }), THRESHOLDS, new Date("2026-11-26T09:00:00Z"))).toContain("onay gerekmeden tedarikçiye gönderilir, beklenen teslim 26.11.2026");
  expect(approveText(manager, order, new Date("2026-11-26T09:00:00Z"))).toBe(
    "SAS-2026-0001: Müdür onayı gerekiyor; ₺92.500,20 KDV hariç, müdür kademesi onaylanacak. Onaylanınca tedarikçiye gönderilir, beklenen teslim 26.11.2026.",
  );
  expect(approveText(manager, po({ requiredTier: 2 }), null)).toContain("Sipariş ardından Yönetim onayı bekler");
});

const line = (over: Partial<PurchaseOrderLineRow>): PurchaseOrderLineRow =>
  ({
    id: "l1",
    materialCode: "MLZ-0005",
    materialName: "MDF Lam 8 mm",
    unit: "plaka",
    qtyMilli: 60_000,
    unitPriceMinor: 154_167,
    receivedMilli: 0,
    remainingMilli: 60_000,
    lineNetMinor: 9_250_020,
    ...over,
  }) as PurchaseOrderLineRow;

test("satır düzenleme girişi: birim adımı ve boş değerler alan hatası verir", () => {
  expect(parseLineEdit("80", "1.541,67".replace(".", ""), "plaka")).toEqual({ qtyMilli: 80_000, unitPriceMinor: 154_167 });
  expect(parseLineEdit("1,5", "10", "plaka")).toEqual({ errors: { qty: "Miktar 1 plaka katı olmalı" } });
  expect(parseLineEdit("0", "x", "plaka")).toEqual({ errors: { qty: "Miktar sıfırdan büyük olmalı", price: "Geçerli bir tutar girin" } });
  expect(parseLineEdit("2,5", "10", "kg")).toEqual({ qtyMilli: 2_500, unitPriceMinor: 1_000 });
});

test("satır düzenleme önizlemesi eski → yeni miktarı ve yeni toplamı verir", () => {
  const order = po({ netKurus: 9_250_020, lines: [line({})] });
  const preview = previewLineEdit(order, line({}), { qtyMilli: 80_000, unitPriceMinor: 154_167 });
  expect(preview.beforeKurus).toBe(9_250_020);
  expect(preview.afterKurus).toBe(12_333_360);
  expect(preview.changes).toEqual([{ label: "Miktar", from: "60 plaka", to: "80 plaka" }]);
  expect(previewLineEdit(order, line({}), { qtyMilli: 60_000, unitPriceMinor: 160_000 }).changes).toEqual([
    { label: "Birim fiyat", from: "₺1.541,67 / plaka", to: "₺1.600,00 / plaka" },
  ]);
});

test("iptal metni teslim alınan miktarın stokta kaldığını söyler", () => {
  const partial = po({ status: "partial", lines: [line({ receivedMilli: 20_000, remainingMilli: 40_000 })] });
  expect(cancelText(partial)).toBe(
    "SAS-2026-0001, Karadeniz Panel: 1 kalem, ₺92.500,20 KDV hariç kısmi teslim sipariş iptal edilecek. Teslim alınan MLZ-0005 20 plaka stokta kalır. Geri alınamaz.",
  );
  expect(cancelText(po({ status: "draft", lines: [line({})] }))).not.toContain("stokta kalır");
});

test("liste onay durumu: sıradaki kademeyi, onaylandı ve onay gerekmedi ayrımını yazar", () => {
  expect(approvalLabel(po({}))).toBe("Müdür onayı bekliyor");
  expect(approvalLabel(po({ requiredTier: 2, managerApprovedBy: "manager" }))).toBe("Yönetim onayı bekliyor");
  expect(approvalLabel(po({ status: "sent", requiredTier: 1, managerApprovedBy: "manager" }))).toBe("Onaylandı");
  expect(approvalLabel(po({ status: "sent", requiredTier: 0 }))).toBe("Onay gerekmedi");
  expect(approvalLabel(po({ status: "draft" }))).toBe("—");
  expect(approvalLabel(po({ status: "cancelled" }))).toBe("—");
});

test("KDV oran başına toplamdan yuvarlanır; KDV dahil = hariç + KDV", () => {
  const totals = purchaseTotals([
    { lineNetMinor: 10_001, vatRate: 20 },
    { lineNetMinor: 10_002, vatRate: 20 },
    { lineNetMinor: 5_005, vatRate: 10 },
  ]);
  expect(totals.netKurus).toBe(25_008);
  expect(totals.vatByRate).toEqual({ "20": 4_001, "10": 501 });
  expect(totals.totalKurus).toBe(25_008 + 4_001 + 501);
  expect(purchaseTotals([])).toEqual({ netKurus: 0, vatByRate: {}, vatKurus: 0, totalKurus: 0 });
});
