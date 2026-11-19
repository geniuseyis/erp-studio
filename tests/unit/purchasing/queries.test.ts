import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { createPurchaseOrder } from "@/domain/purchasing/orders";
import { getPurchaseOrder, listPurchaseOrders, listReceivable, listSuppliers } from "@/domain/purchasing/queries";
import { addMaterial, addSupplier, addSupplierItem, addUser, ctxFor, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let alim: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  alim = ctxFor(db, await addUser(db, "satinalma", "uzman", { name: "Ayla Güneş" }));
});

async function draft(supplierId: string, materialId: string, qtyMilli: number, at = NOW) {
  return createPurchaseOrder({ ...alim, now: at }, { supplierId, lines: [{ materialId, qtyMilli }] });
}

test("listPurchaseOrders: late yalnızca açık ve beklenen günü geçmiş siparişte; durum ve arama süzgeci", async () => {
  const a = await addSupplier(db, { code: "TED-0001", name: "Sapanca Yonga" });
  const b = await addSupplier(db, { code: "TED-0002", name: "Bursa Kereste" });
  const m = await addMaterial(db, { unit: "plaka" });
  await addSupplierItem(db, { supplierId: a.id, materialId: m.id, unitPriceMinor: 10_000 });
  await addSupplierItem(db, { supplierId: b.id, materialId: m.id, unitPriceMinor: 20_000 });

  const sentLate = await draft(a.id, m.id, 2000, new Date("2026-11-01T10:00:00+03:00"));
  const sentToday = await draft(a.id, m.id, 3000, new Date("2026-11-02T10:00:00+03:00"));
  const draftPast = await draft(b.id, m.id, 1000, new Date("2026-11-03T10:00:00+03:00"));
  const receivedPast = await draft(b.id, m.id, 1000, new Date("2026-11-04T10:00:00+03:00"));
  const expected = (id: string, status: string, at: string) =>
    db.update(purchaseOrders).set({ status, expectedAt: new Date(at) }).where(eq(purchaseOrders.id, id));
  await expected(sentLate.id, "partial", "2026-11-14T00:00:00+03:00");
  await expected(sentToday.id, "sent", "2026-11-15T00:00:00+03:00"); // beklenen gün bugün: gecikmedi
  await expected(draftPast.id, "draft", "2026-11-01T00:00:00+03:00");
  await expected(receivedPast.id, "received", "2026-11-01T00:00:00+03:00");

  const all = await listPurchaseOrders(db, { now: NOW });
  expect(all.map((r) => r.code)).toEqual(["SAS-2026-0004", "SAS-2026-0003", "SAS-2026-0002", "SAS-2026-0001"]); // yeniden eskiye
  expect(Object.fromEntries(all.map((r) => [r.code, r.late]))).toEqual({
    "SAS-2026-0001": true,
    "SAS-2026-0002": false,
    "SAS-2026-0003": false,
    "SAS-2026-0004": false,
  });
  expect(all.find((r) => r.code === "SAS-2026-0001")).toMatchObject({
    supplierCode: "TED-0001",
    supplierName: "Sapanca Yonga",
    lineCount: 1,
    netMinor: 20_000,
    netKurus: 20_000,
    createdByName: "Ayla Güneş",
    createdById: alim.user.id,
  });

  expect((await listPurchaseOrders(db, { status: "draft", now: NOW })).map((r) => r.code)).toEqual(["SAS-2026-0003"]);
  expect((await listPurchaseOrders(db, { supplierId: b.id, now: NOW })).map((r) => r.code)).toEqual(["SAS-2026-0004", "SAS-2026-0003"]);
  expect((await listPurchaseOrders(db, { search: "sapanca", now: NOW })).map((r) => r.code)).toEqual(["SAS-2026-0002", "SAS-2026-0001"]);
  expect((await listPurchaseOrders(db, { search: "0004", now: NOW })).map((r) => r.code)).toEqual(["SAS-2026-0004"]);
});

test("listPurchaseOrders sabit sayıda sorgu çalıştırır (≤ 3)", async () => {
  const s = await addSupplier(db);
  const m = await addMaterial(db, { unit: "plaka" });
  await addSupplierItem(db, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100 });
  for (let i = 0; i < 6; i += 1) await draft(s.id, m.id, 1000);
  const spy = vi.spyOn(db, "select");
  try {
    expect(await listPurchaseOrders(db)).toHaveLength(6);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
  } finally {
    spy.mockRestore();
  }
});

test("getPurchaseOrder kalemleri, kalan miktarı ve mal kabulleri verir", async () => {
  const s = await addSupplier(db, { code: "TED-0001" });
  const a = await addMaterial(db, { code: "MLZ-0002", name: "Vernik", unit: "L" });
  const b = await addMaterial(db, { code: "MLZ-0001", name: "MDF", unit: "plaka" });
  await addSupplierItem(db, { supplierId: s.id, materialId: a.id, unitPriceMinor: 5000 });
  await addSupplierItem(db, { supplierId: s.id, materialId: b.id, unitPriceMinor: 154_167 });
  const po = await createPurchaseOrder(alim, {
    supplierId: s.id,
    lines: [
      { materialId: a.id, qtyMilli: 10_000 },
      { materialId: b.id, qtyMilli: 60_000 },
    ],
  });
  await db.update(purchaseOrders).set({ status: "partial" }).where(eq(purchaseOrders.id, po.id));
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  const mdfLine = lines.find((l) => l.materialId === b.id)!;
  await db.update(purchaseOrderLines).set({ receivedMilli: 20_000 }).where(eq(purchaseOrderLines.id, mdfLine.id));
  const [receipt] = await db
    .insert(goodsReceipts)
    .values({ code: "MK-2026-0001", purchaseOrderId: po.id, deliveryNote: "IRS-77", receivedBy: alim.user.id })
    .returning();
  await db.insert(goodsReceiptLines).values({ receiptId: receipt!.id, purchaseOrderLineId: mdfLine.id, materialId: b.id, qtyMilli: 20_000, unitCostKurus: 154_167 });

  const detail = await getPurchaseOrder(db, po.id, NOW);
  expect(detail).toMatchObject({ code: po.code, status: "partial", lineCount: 2, netMinor: 9_250_020 + 50_000, note: "", managerApprovedByName: null, managerApprovedAt: null, boardApprovedByName: null, boardApprovedAt: null });
  expect(detail?.supplierLeadDays).toBeGreaterThan(0);
  expect(detail!.lines.map((l) => [l.materialCode, l.materialName, l.unit, l.qtyMilli, l.remainingMilli, l.lineNetMinor])).toEqual([
    ["MLZ-0001", "MDF", "plaka", 60_000, 40_000, 9_250_020],
    ["MLZ-0002", "Vernik", "L", 10_000, 10_000, 50_000],
  ]);
  expect(detail!.receipts).toEqual([
    { id: receipt!.id, code: "MK-2026-0001", deliveryNote: "IRS-77", createdAt: receipt!.createdAt, receivedByName: "Ayla Güneş", lineCount: 1 },
  ]);
  expect(await getPurchaseOrder(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  expect(await getPurchaseOrder(db, "x")).toBeNull();
});

test("açık tutar her yerde aynı: kısmi teslimde yalnızca kalan; sipariş listesi toplamı = Σ tedarikçi açık tutarı", async () => {
  const a = await addSupplier(db, { code: "TED-0001" });
  const b = await addSupplier(db, { code: "TED-0002" });
  const m = await addMaterial(db, { unit: "plaka" });
  await addSupplierItem(db, { supplierId: a.id, materialId: m.id, unitPriceMinor: 154_167 });
  await addSupplierItem(db, { supplierId: b.id, materialId: m.id, unitPriceMinor: 100_001 });
  const partial = await draft(a.id, m.id, 60_000);
  const sent = await draft(b.id, m.id, 3000);
  const pending = await draft(a.id, m.id, 5000);
  const cancelled = await draft(b.id, m.id, 1000);
  await db.update(purchaseOrders).set({ status: "partial" }).where(eq(purchaseOrders.id, partial.id));
  await db.update(purchaseOrderLines).set({ receivedMilli: 20_000 }).where(eq(purchaseOrderLines.orderId, partial.id));
  await db.update(purchaseOrders).set({ status: "sent", expectedAt: NOW }).where(eq(purchaseOrders.id, sent.id));
  await db.update(purchaseOrders).set({ status: "pending_approval" }).where(eq(purchaseOrders.id, pending.id));
  await db.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, cancelled.id));

  const rows = await listPurchaseOrders(db, { now: NOW });
  const row = (id: string) => rows.find((r) => r.id === id)!;
  expect(row(partial.id)).toMatchObject({ netKurus: 9_250_020, openNetKurus: 6_166_680 }); // 40 plaka × ₺1.541,67
  expect(row(sent.id).openNetKurus).toBe(row(sent.id).netKurus);

  const open = rows.filter((r) => ["pending_approval", "sent", "partial"].includes(r.status));
  const hero = open.reduce((n, r) => n + r.openNetKurus, 0);
  const suppliers = await listSuppliers(db);
  expect(hero).toBe(suppliers.reduce((n, s) => n + s.openNetMinor, 0));
  expect(hero).toBe(6_166_680 + 300_003 + 770_835);
  // Mal kabul listesi aynı kalan tutarı gösterir.
  const receivable = await listReceivable(db, NOW);
  expect(receivable.find((r) => r.id === partial.id)?.openNetKurus).toBe(6_166_680);
});