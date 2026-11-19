import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { materials, purchaseOrderLines, purchaseOrders, settings, workOrders } from "@/db/schema";
import { createFromSuggestion } from "@/domain/purchasing/orders";
import { receiveGoods } from "@/domain/purchasing/receiving";
import { purchaseSuggestions, waitingWorkOrderCount } from "@/domain/purchasing/suggestions";
import type { PurchaseOrderStatus } from "@/domain/purchasing/types";
import { bomNeedMilli } from "@/domain/production/workOrders";
import { DEFAULT_THRESHOLDS, requiredTier } from "@/domain/settings";
import { addBomLine, addMaterial, addProduct, addSupplier, addSupplierItem, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let userId: string;
let woSeq = 0;

beforeEach(async () => {
  db = await createTestDb();
  userId = (await addUser(db, "satinalma", "uzman")).id;
  woSeq = 0;
});

/** Doğrudan tabloya malzeme ekler: eldeki, ayrılmış, sipariş noktası. */
async function stocked(over: Partial<typeof materials.$inferInsert>) {
  return addMaterial(db, over);
}

/** Malzemesi ayrılmamış planlı iş emri açar (rota ve servis gerekmez). */
async function waitingWo(productId: string, qtyMilli = 1000, over: Partial<typeof workOrders.$inferInsert> = {}) {
  woSeq += 1;
  const [row] = await db
    .insert(workOrders)
    .values({ code: `IE-2026-${String(woSeq).padStart(4, "0")}`, productId, qtyMilli, createdBy: userId, ...over })
    .returning();
  if (!row) throw new Error("iş emri eklenemedi");
  return row;
}

/** Doğrudan tabloya bir sipariş ve tek kalem ekler. */
async function order(supplierId: string, materialId: string, qtyMilli: number, status: PurchaseOrderStatus, receivedMilli = 0) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ code: `SAS-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, supplierId, status, createdBy: userId })
    .returning();
  if (!po) throw new Error("sipariş eklenemedi");
  await db.insert(purchaseOrderLines).values({ orderId: po.id, materialId, qtyMilli, unitPriceMinor: 100, receivedMilli });
  return po;
}

test("bomNeedMilli: reçete miktarı × adet × (1000 + fire) / 1000, birim adımına yukarı", () => {
  expect(bomNeedMilli(340, 2000, 150, "plaka")).toBe(1000);
  expect(bomNeedMilli(125, 2000, 0, "L")).toBe(300);
  expect(bomNeedMilli(12, 2000, 100, "m3")).toBe(30);
});

test("kritik malzeme: gap = sipariş noktası − kullanılabilir; neden 'kritik'", async () => {
  const m = await stocked({ unit: "plaka", onHandMilli: 8000, reservedMilli: 3000, reorderPointMilli: 10_000 });
  const s = await addSupplier(db);
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 150_000 });
  const groups = await purchaseSuggestions(db);
  expect(groups).toHaveLength(1);
  const line = groups[0]!.lines[0]!;
  expect(line).toMatchObject({
    materialId: m.id,
    availableMilli: 5000,
    reorderPointMilli: 10_000,
    waitingNeedMilli: 0,
    incomingMilli: 0,
    gapMilli: 5000,
    qtyMilli: 5000,
    reasons: ["kritik"],
    waitingWorkOrders: [],
    unitPriceMinor: 150_000,
    lineNetMinor: 750_000,
  });
});

test("yeterli stoklu malzeme önerilmez; pasif malzeme önerilmez", async () => {
  await stocked({ onHandMilli: 10_000, reorderPointMilli: 10_000 });
  await stocked({ onHandMilli: 0, reorderPointMilli: 5000, active: false });
  expect(await purchaseSuggestions(db)).toEqual([]);
});

test("malzeme bekleyen iki iş emrinin ihtiyacı toplanır, kodları listelenir; neden 'bekleyen_is'", async () => {
  const m = await stocked({ unit: "plaka", onHandMilli: 10_000, reorderPointMilli: 0 });
  const p = await addProduct(db);
  await addBomLine(db, { productId: p.id, materialId: m.id, qtyMilli: 2000 });
  const a = await waitingWo(p.id, 3000); // 6 plaka
  const b = await waitingWo(p.id, 4000); // 8 plaka
  await waitingWo(p.id, 5000, { materialsReserved: true }); // ayrılmış: sayılmaz
  await waitingWo(p.id, 5000, { status: "cancelled" }); // iptal: sayılmaz
  await waitingWo(p.id, 5000, { status: "in_progress" }); // üretimde: sayılmaz
  const s = await addSupplier(db);
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 1000 });

  const line = (await purchaseSuggestions(db))[0]!.lines[0]!;
  expect(line.waitingNeedMilli).toBe(14_000);
  expect(line.gapMilli).toBe(4000);
  expect(line.reasons).toEqual(["bekleyen_is"]);
  expect([...line.waitingWorkOrders].sort()).toEqual([a.code, b.code].sort());
});

test("en az sipariş miktarına yukarı yuvarlar: 7→10, 12→12 (moq 10); plaka adımına yuvarlar", async () => {
  const s = await addSupplier(db);
  const seven = await stocked({ code: "A-7", unit: "plaka", reorderPointMilli: 7000 });
  const twelve = await stocked({ code: "A-12", unit: "plaka", reorderPointMilli: 12_000 });
  const litre = await stocked({ code: "A-L", unit: "L", reorderPointMilli: 1250 });
  for (const m of [seven, twelve]) {
    await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100, moqMilli: 10_000 });
  }
  await addSupplierItem(db, { supplierId: s.id, materialId: litre.id, unitPriceMinor: 100 });
  const lines = (await purchaseSuggestions(db))[0]!.lines;
  expect(lines.map((l) => [l.code, l.gapMilli, l.qtyMilli])).toEqual([
    ["A-12", 12_000, 12_000],
    ["A-7", 7000, 10_000],
    ["A-L", 1250, 1300], // litre adımı 0,1: 1,25 → 1,3
  ]);
});

test("yoldaki taslak ve gönderilmiş siparişin kalanı ihtiyaçtan düşer; kısmi teslimde yalnız kalan", async () => {
  const s = await addSupplier(db);
  const m = await stocked({ unit: "plaka", reorderPointMilli: 20_000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100 });
  expect((await purchaseSuggestions(db))[0]!.lines[0]!.qtyMilli).toBe(20_000);

  await order(s.id, m.id, 5000, "draft");
  await order(s.id, m.id, 4000, "pending_approval");
  await order(s.id, m.id, 3000, "sent");
  await order(s.id, m.id, 10_000, "partial", 8000); // kalan 2000
  const line = (await purchaseSuggestions(db))[0]!.lines[0]!;
  expect(line.incomingMilli).toBe(14_000);
  expect(line.gapMilli).toBe(6000);
  expect(line.qtyMilli).toBe(6000);

  await order(s.id, m.id, 6000, "received", 6000); // tamamlanmış: yolda değil
  expect((await purchaseSuggestions(db))[0]!.lines[0]!.incomingMilli).toBe(14_000);
});

test("iptal edilen sipariş yolda sayılmaz, öneri geri gelir", async () => {
  const s = await addSupplier(db);
  const m = await stocked({ unit: "plaka", reorderPointMilli: 5000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100 });
  const po = await order(s.id, m.id, 5000, "draft");
  expect(await purchaseSuggestions(db)).toEqual([]);
  await db.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, po.id));
  expect((await purchaseSuggestions(db))[0]!.lines[0]!.qtyMilli).toBe(5000);
});

test("tercihli tedarikçi seçilir; tercihli yoksa en ucuz; pasif tedarikçi atlanır", async () => {
  const pricey = await addSupplier(db, { code: "TED-0001", name: "Pahalı" });
  const cheap = await addSupplier(db, { code: "TED-0002", name: "Ucuz" });
  const twin = await addSupplier(db, { code: "TED-0003", name: "İkiz" });
  const dead = await addSupplier(db, { code: "TED-0004", name: "Pasif", active: false });

  const preferred = await stocked({ code: "M-1", unit: "plaka", reorderPointMilli: 1000 });
  await addSupplierItem(db, { supplierId: pricey.id, materialId: preferred.id, unitPriceMinor: 900, isPreferred: true });
  await addSupplierItem(db, { supplierId: cheap.id, materialId: preferred.id, unitPriceMinor: 100 });

  const cheapest = await stocked({ code: "M-2", unit: "plaka", reorderPointMilli: 1000 });
  await addSupplierItem(db, { supplierId: pricey.id, materialId: cheapest.id, unitPriceMinor: 900 });
  await addSupplierItem(db, { supplierId: twin.id, materialId: cheapest.id, unitPriceMinor: 200 });
  await addSupplierItem(db, { supplierId: cheap.id, materialId: cheapest.id, unitPriceMinor: 200 }); // eşitlik: kod sırası TED-0002

  const skipDead = await stocked({ code: "M-3", unit: "plaka", reorderPointMilli: 1000 });
  await addSupplierItem(db, { supplierId: dead.id, materialId: skipDead.id, unitPriceMinor: 10, isPreferred: true });
  await addSupplierItem(db, { supplierId: pricey.id, materialId: skipDead.id, unitPriceMinor: 500 });

  const groups = await purchaseSuggestions(db);
  const where = (code: string) => groups.find((g) => g.lines.some((l) => l.code === code))?.supplierCode;
  expect(where("M-1")).toBe("TED-0001");
  expect(where("M-2")).toBe("TED-0002");
  expect(where("M-3")).toBe("TED-0001");
});

test("tedarikçisi olmayan malzeme 'Tedarikçisi tanımsız' grubunda, en sonda", async () => {
  const s = await addSupplier(db, { name: "Zeta" });
  const orphan = await stocked({ code: "A-ORFAN", unit: "plaka", reorderPointMilli: 1000 });
  const sourced = await stocked({ code: "Z-VAR", unit: "plaka", reorderPointMilli: 1000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: sourced.id, unitPriceMinor: 100 });
  const groups = await purchaseSuggestions(db);
  expect(groups.map((g) => g.supplierName)).toEqual(["Zeta", "Tedarikçisi tanımsız"]);
  expect(groups[1]).toMatchObject({ supplierId: null, supplierCode: null, leadTimeDays: null, netMinor: 0, requiredTier: 0 });
  expect(groups[1]!.lines[0]).toMatchObject({ materialId: orphan.id, unitPriceMinor: 0, lineNetMinor: 0, qtyMilli: 1000 });
});

test("bekleyen işi olan grup önce gelir, sonra tedarikçi adına göre", async () => {
  const a = await addSupplier(db, { name: "Akça" });
  const b = await addSupplier(db, { name: "Bora" });
  const crit = await stocked({ code: "M-A", unit: "plaka", reorderPointMilli: 1000 });
  const need = await stocked({ code: "M-B", unit: "plaka" });
  await addSupplierItem(db, { supplierId: a.id, materialId: crit.id, unitPriceMinor: 100 });
  await addSupplierItem(db, { supplierId: b.id, materialId: need.id, unitPriceMinor: 100 });
  const p = await addProduct(db);
  await addBomLine(db, { productId: p.id, materialId: need.id, qtyMilli: 1000 });
  await waitingWo(p.id, 2000);
  expect((await purchaseSuggestions(db)).map((g) => g.supplierName)).toEqual(["Bora", "Akça"]);
});

test.each([
  [5_000_000, 0],
  [5_000_001, 1],
  [25_000_000, 1],
  [25_000_001, 2],
])("requiredTier(%i) = %i", (net, tier) => {
  expect(requiredTier(net, DEFAULT_THRESHOLDS)).toBe(tier);
});

test("grup toplamı ve kademe: 60.000 TL'lik grup requiredTier 1; eşik ayarı okunur", async () => {
  const s = await addSupplier(db);
  const m = await stocked({ unit: "plaka", reorderPointMilli: 40_000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 150_000 }); // 40 plaka × 1.500 TL
  const group = (await purchaseSuggestions(db))[0]!;
  expect(group.netMinor).toBe(6_000_000);
  expect(group.requiredTier).toBe(1);

  await db.insert(settings).values({ key: "purchasing.approval_manager_kurus", value: 7_000_000 });
  expect((await purchaseSuggestions(db))[0]!.requiredTier).toBe(0);
});

test("sabit sayıda sorgu: 30 bekleyen iş emrinde ≤ 5 sorgu", async () => {
  const s = await addSupplier(db);
  const m = await stocked({ unit: "plaka", reorderPointMilli: 1000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100 });
  const p = await addProduct(db);
  await addBomLine(db, { productId: p.id, materialId: m.id, qtyMilli: 1000 });

  async function selects(): Promise<number> {
    const spy = vi.spyOn(db, "select");
    try {
      await purchaseSuggestions(db);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }
  for (let i = 0; i < 2; i += 1) await waitingWo(p.id);
  const few = await selects();
  for (let i = 0; i < 28; i += 1) await waitingWo(p.id);
  const many = await selects();
  expect(many).toBe(few);
  expect(many).toBeLessThanOrEqual(5);
  expect((await purchaseSuggestions(db))[0]!.lines[0]!.waitingWorkOrders).toHaveLength(30);
}, 60_000);

test("en az sipariş miktarı birim adımına yukarı yuvarlanır: 1,5 plaka MOQ 2 plaka olur", async () => {
  const m = await stocked({ unit: "plaka", onHandMilli: 0, reorderPointMilli: 500 });
  const s = await addSupplier(db);
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100, moqMilli: 1500 });
  const line = (await purchaseSuggestions(db))[0]!.lines[0]!;
  expect(line.qtyMilli).toBe(2000);
});

test("bekleyen iş emri sayısı bütün bekleyenleri sayar; taslak sipariş değiştirmez, mal kabul düşürür", async () => {
  const m = await stocked({ unit: "plaka", onHandMilli: 0, reorderPointMilli: 0 });
  const other = await stocked({ unit: "plaka", onHandMilli: 100_000, reorderPointMilli: 0 }); // yeterli stoklu malzeme
  const p = await addProduct(db);
  await addBomLine(db, { productId: p.id, materialId: m.id, qtyMilli: 2000 });
  await addBomLine(db, { productId: p.id, materialId: other.id, qtyMilli: 1000 });
  const q = await addProduct(db);
  await addBomLine(db, { productId: q.id, materialId: other.id, qtyMilli: 1000 });
  await waitingWo(p.id, 3000); // eksik malzemeyi bekler
  await waitingWo(q.id, 1000); // yalnızca yeterli stoklu malzeme: açığı yok ama malzemesi ayrılmamış, kanbanda bekliyor
  const s = await addSupplier(db);
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 1000 });
  expect(await waitingWorkOrderCount(db)).toBe(2);

  const buyer = ctxFor(db, await addUser(db, "satinalma", "uzman", { email: "alim@baltacioglus.example" }));
  const po = await createFromSuggestion(buyer, s.id);
  expect(await purchaseSuggestions(db)).toEqual([]); // yoldaki sipariş açığı kapattı
  expect(await waitingWorkOrderCount(db)).toBe(2); // ama iş emirleri hâlâ malzeme bekliyor

  await db.update(purchaseOrders).set({ status: "sent", sentAt: buyer.now, expectedAt: buyer.now }).where(eq(purchaseOrders.id, po.id));
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  const depo = ctxFor(db, await addUser(db, "depo", "uzman", { email: "depo@baltacioglus.example" }));
  await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "T-1", lines: [{ lineId: line!.id, qtyMilli: line!.qtyMilli }] });
  expect(await waitingWorkOrderCount(db)).toBe(1); // yalnızca malzemesi gelen iş emri düştü
});