import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  auditLog,
  goodsReceiptLines,
  goodsReceipts,
  materials,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  stockMovements,
  workOrders,
} from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { createPurchaseOrder } from "@/domain/purchasing/orders";
import { listReceivable } from "@/domain/purchasing/queries";
import { receiveGoods } from "@/domain/purchasing/receiving";
import type { PurchaseOrderStatus } from "@/domain/purchasing/types";
import { addBomLine, addCustomer, addMaterial, addProduct, addSupplier, addSupplierItem, addUser, ctxFor, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let alim: Ctx; // satın alma uzmanı
let depo: Ctx; // depo operatörü
let supplierId: string;
let mdf: typeof materials.$inferSelect;
let kapak: typeof materials.$inferSelect;

beforeEach(async () => {
  db = await createTestDb();
  alim = ctxFor(db, await addUser(db, "satinalma", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "operator"));
  supplierId = (await addSupplier(db, { code: "TED-0001" })).id;
  mdf = await addMaterial(db, { code: "MLZ-0005", name: "MDF Lam 8 mm", unit: "plaka" });
  await receiveStock(depo, { materialId: mdf.id, qtyMilli: 40_000, unitCostKurus: 100_000 }); // açılış stoğu defterden girer
  kapak = await addMaterial(db, { code: "MLZ-0006", name: "Kapak", unit: "adet" });
  await addSupplierItem(db, { supplierId, materialId: mdf.id, unitPriceMinor: 154_167 });
  await addSupplierItem(db, { supplierId, materialId: kapak.id, unitPriceMinor: 5000 });
});

async function history(entityId: string, action?: string): Promise<string[]> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.filter((r) => !action || r.action === action).map((r) => r.summary);
}

/** Gönderilmiş sipariş: mdf 60 plaka (+ isteğe bağlı kapak 10 adet). */
async function sentOrder(opts: { withCover?: boolean; status?: PurchaseOrderStatus; supplier?: string; expectedAt?: Date } = {}) {
  const sid = opts.supplier ?? supplierId;
  if (sid !== supplierId) await addSupplierItem(db, { supplierId: sid, materialId: mdf.id, unitPriceMinor: 154_167 });
  const lines = [{ materialId: mdf.id, qtyMilli: 60_000 }, ...(opts.withCover ? [{ materialId: kapak.id, qtyMilli: 10_000 }] : [])];
  const po = await createPurchaseOrder(alim, { supplierId: sid, lines });
  await db
    .update(purchaseOrders)
    .set({ status: opts.status ?? "sent", sentAt: NOW, expectedAt: opts.expectedAt ?? NOW })
    .where(eq(purchaseOrders.id, po.id));
  const rows = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  const lineOf = (materialId: string) => rows.find((l) => l.materialId === materialId)!.id;
  return { po, lineMdf: lineOf(mdf.id), lineKapak: opts.withCover ? lineOf(kapak.id) : "" };
}

async function stock(id: string) {
  const [m] = await db.select().from(materials).where(eq(materials.id, id));
  return m!;
}

test("tam teslim: stok artar, ortalama maliyet ağırlıklı güncellenir, durum teslim alındı, defter tutarlı", async () => {
  const { po, lineMdf } = await sentOrder();
  const result = await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "  A-1234 ", lines: [{ lineId: lineMdf, qtyMilli: 60_000 }] });
  expect(result.status).toBe("received");
  expect(result.receipt).toMatchObject({ code: "MK-2026-0001", deliveryNote: "A-1234", purchaseOrderId: po.id, receivedBy: depo.user.id });
  expect(result.readyWorkOrders).toEqual([]);

  const m = await stock(mdf.id);
  expect(m.onHandMilli).toBe(100_000);
  expect(m.avgCostKurus).toBe(Math.round((40_000 * 100_000 + 60_000 * 154_167) / 100_000));
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
  expect(order).toMatchObject({ status: "received", receivedAt: NOW });
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, lineMdf));
  expect(line?.receivedMilli).toBe(60_000);
  const [rl] = await db.select().from(goodsReceiptLines);
  expect(rl).toMatchObject({ purchaseOrderLineId: lineMdf, materialId: mdf.id, qtyMilli: 60_000, unitCostKurus: 154_167 });
  const [movement] = await db.select().from(stockMovements).where(eq(stockMovements.refId, po.id));
  expect(movement).toMatchObject({ type: "receipt", refType: "purchase_order", refId: po.id, unitCostKurus: 154_167 });
  expect(await verifyLedger(db)).toEqual([]);
  expect(await history(po.id, "receive")).toEqual([
    `${po.code} mal kabul MK-2026-0001 (irsaliye A-1234): MLZ-0005 60 plaka × ₺1.541,67; teslim alındı`,
  ]);
});

test("kısmi teslim: durum kısmi, kalan doğru; ikinci teslimle teslim alındı", async () => {
  const { po, lineMdf, lineKapak } = await sentOrder({ withCover: true });
  const first = await receiveGoods(depo, {
    purchaseOrderId: po.id,
    deliveryNote: "A-1",
    lines: [
      { lineId: lineMdf, qtyMilli: 20_000 },
      { lineId: lineKapak, qtyMilli: 0 },
    ],
  });
  expect(first.status).toBe("partial");
  expect(await db.select().from(goodsReceiptLines)).toHaveLength(1); // sıfır miktarlı kalem atlandı
  expect((await history(po.id, "receive"))[0]).toBe(`${po.code} mal kabul MK-2026-0001 (irsaliye A-1): MLZ-0005 20 plaka × ₺1.541,67; kısmi teslim, 0/2 kalem tamam`);
  const [open] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
  expect(open?.receivedAt).toBeNull();

  const second = await receiveGoods(depo, {
    purchaseOrderId: po.id,
    deliveryNote: "A-2",
    lines: [
      { lineId: lineMdf, qtyMilli: 40_000 },
      { lineId: lineKapak, qtyMilli: 4000 },
    ],
  });
  expect(second.status).toBe("partial");
  expect((await history(po.id, "receive"))[1]).toContain("kısmi teslim, 1/2 kalem tamam");
  const third = await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-3", lines: [{ lineId: lineKapak, qtyMilli: 6000 }] });
  expect(third.status).toBe("received");
  expect(third.receipt.code).toBe("MK-2026-0003");
  expect(await verifyLedger(db)).toEqual([]);
});

test("kısmi tesliminde ortalama maliyet her seferinde değişmez değerle güncellenir", async () => {
  // Stok 40 plaka × ₺1.000,00. 20 plaka × ₺1.541,67: (40·100000 + 20·154167) / 60 = 118055,67 → 118056 kuruş.
  const { po, lineMdf } = await sentOrder();
  await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "K-1", lines: [{ lineId: lineMdf, qtyMilli: 20_000 }] });
  expect(await stock(mdf.id)).toMatchObject({ onHandMilli: 60_000, avgCostKurus: 118_056 });

  // Kalan 40 plaka başka fiyatla (₺1.600,00) gelir: (60·118056 + 40·160000) / 100 = 134833,6 → 134834 kuruş.
  await db.update(purchaseOrderLines).set({ unitPriceMinor: 160_000 }).where(eq(purchaseOrderLines.id, lineMdf));
  const rest = await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "K-2", lines: [{ lineId: lineMdf, qtyMilli: 40_000 }] });
  expect(rest.status).toBe("received");
  expect(await stock(mdf.id)).toMatchObject({ onHandMilli: 100_000, avgCostKurus: 134_834 });
  expect(await verifyLedger(db)).toEqual([]);
});

test("kalandan fazlası malzeme kodu ve kalanla reddedilir; hiçbir şey yazılmaz", async () => {
  const { po, lineMdf, lineKapak } = await sentOrder({ withCover: true });
  await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 20_000 }] });
  const before = await stock(kapak.id);
  await expect(
    receiveGoods(depo, {
      purchaseOrderId: po.id,
      deliveryNote: "A-2",
      lines: [
        { lineId: lineKapak, qtyMilli: 3000 },
        { lineId: lineMdf, qtyMilli: 41_000 },
      ],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION", message: "MLZ-0005 için kalan 40 plaka; daha fazlası teslim alınamaz" });
  expect(await db.select().from(goodsReceipts)).toHaveLength(1);
  expect(await stock(kapak.id)).toMatchObject({ onHandMilli: before.onHandMilli });
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, lineKapak));
  expect(line?.receivedMilli).toBe(0);
});

test("irsaliye ve miktar doğrulaması: boş, 40 karakterden uzun, hepsi sıfır, birim adımına uymayan, başka siparişin kalemi", async () => {
  const { po, lineMdf, lineKapak } = await sentOrder({ withCover: true });
  const other = await sentOrder();
  const base = { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 1000 }] };
  await expect(receiveGoods(depo, { ...base, deliveryNote: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(receiveGoods(depo, { ...base, deliveryNote: "x".repeat(41) })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(receiveGoods(depo, { ...base, lines: [{ lineId: lineMdf, qtyMilli: 0 }] })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "En az bir kalemde miktar girin",
  });
  await expect(receiveGoods(depo, { ...base, lines: [{ lineId: lineKapak, qtyMilli: 1500 }] })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(receiveGoods(depo, { ...base, lines: [{ lineId: lineMdf, qtyMilli: -1000 }] })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(receiveGoods(depo, { ...base, lines: [{ lineId: other.lineMdf, qtyMilli: 1000 }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(receiveGoods(depo, { ...base, purchaseOrderId: "yok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.select().from(goodsReceipts)).toHaveLength(0);
  await receiveGoods(depo, { ...base, deliveryNote: "x".repeat(40) });
});

test("aynı tedarikçide aynı irsaliye no DUPLICATE; başka tedarikçide serbest", async () => {
  const a = await sentOrder();
  const b = await sentOrder();
  const otherSupplier = (await addSupplier(db, { code: "TED-0002" })).id;
  const c = await sentOrder({ supplier: otherSupplier });
  await receiveGoods(depo, { purchaseOrderId: a.po.id, deliveryNote: "A-1234", lines: [{ lineId: a.lineMdf, qtyMilli: 10_000 }] });
  await expect(receiveGoods(depo, { purchaseOrderId: b.po.id, deliveryNote: "a-1234", lines: [{ lineId: b.lineMdf, qtyMilli: 10_000 }] })).rejects.toMatchObject({
    code: "DUPLICATE",
    message: "Bu irsaliye zaten girildi (MK-2026-0001)",
  });
  await expect(receiveGoods(depo, { purchaseOrderId: a.po.id, deliveryNote: "A-1234", lines: [{ lineId: a.lineMdf, qtyMilli: 10_000 }] })).rejects.toMatchObject({
    code: "DUPLICATE",
  });
  await receiveGoods(depo, { purchaseOrderId: c.po.id, deliveryNote: "A-1234", lines: [{ lineId: c.lineMdf, qtyMilli: 10_000 }] });
  expect(await db.select().from(goodsReceipts)).toHaveLength(2);
});

test("aynı anda aynı irsaliye iki siparişe girilirse yalnızca biri geçer, MK kodları çakışmaz", async () => {
  const a = await sentOrder();
  const b = await sentOrder();
  const results = await Promise.allSettled([
    receiveGoods(depo, { purchaseOrderId: a.po.id, deliveryNote: "Y-77", lines: [{ lineId: a.lineMdf, qtyMilli: 10_000 }] }),
    receiveGoods(depo, { purchaseOrderId: b.po.id, deliveryNote: "y-77", lines: [{ lineId: b.lineMdf, qtyMilli: 10_000 }] }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "DUPLICATE" } });
  expect(await db.select().from(goodsReceipts)).toHaveLength(1);
});
test("iptal ve teslim alınmış sipariş INVALID_STATE; taslak ve onay bekleyen de", async () => {
  for (const status of ["cancelled", "received", "draft", "pending_approval"] as const) {
    const { po, lineMdf } = await sentOrder({ status });
    await expect(receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: `N-${status}`, lines: [{ lineId: lineMdf, qtyMilli: 1000 }] })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Bu sipariş mal kabule açık değil",
    });
  }
  expect(await db.select().from(goodsReceipts)).toHaveLength(0);
});

test("satın alma uzmanı mal kabul edemez: FORBIDDEN; depo operatörü edebilir", async () => {
  const { po, lineMdf } = await sentOrder();
  const input = { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 1000 }] };
  await expect(receiveGoods(alim, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.select().from(goodsReceipts)).toHaveLength(0);
  await expect(receiveGoods(depo, input)).resolves.toMatchObject({ status: "partial" });
});

test("mal kabul malzeme bekleyen iş emrini ayırır, satır üretimde, sipariş durumu ilerler; readyWorkOrders kodu döner", async () => {
  const product = await addProduct(db);
  await addBomLine(db, { productId: product.id, materialId: mdf.id, qtyMilli: 50_000 }); // 1 adet = 50 plaka; eldeki 40
  const customer = await addCustomer(db);
  const [so] = await db
    .insert(salesOrders)
    .values({ code: "SIP-2026-0001", customerId: customer.id, status: "confirmed", dueAt: new Date("2026-12-01T00:00:00+03:00"), createdBy: alim.user.id })
    .returning();
  const [sl] = await db.insert(salesOrderLines).values({ orderId: so!.id, productId: product.id, qtyMilli: 1000, vatRate: 10, status: "waiting_material" }).returning();
  const [wo] = await db.insert(workOrders).values({ code: "IE-2026-0001", productId: product.id, qtyMilli: 1000, salesOrderLineId: sl!.id, createdBy: alim.user.id }).returning();

  const { po, lineMdf } = await sentOrder();
  const result = await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 60_000 }] });
  expect(result.readyWorkOrders).toEqual(["IE-2026-0001"]);
  const [after] = await db.select().from(workOrders).where(eq(workOrders.id, wo!.id));
  expect(after?.materialsReserved).toBe(true);
  expect((await stock(mdf.id)).reservedMilli).toBe(50_000);
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, sl!.id));
  expect(line?.status).toBe("in_production");
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, so!.id));
  expect(order?.status).toBe("in_production");
  expect(await history(wo!.id, "reserve_materials")).toEqual([`IE-2026-0001: malzemeler ayrıldı — MLZ-0005 50 plaka (${po.code} mal kabulü)`]);
  expect(await verifyLedger(db)).toEqual([]);
});

test("iki bekleyen iş emrine yetmeyen teslim: termini erken olan ayrılır, diğeri bekler", async () => {
  const product = await addProduct(db);
  await addBomLine(db, { productId: product.id, materialId: mdf.id, qtyMilli: 30_000 }); // 1 adet = 30 plaka; eldeki 40 + 20 = 60 → ikisi 60'a yeter
  const make = async (code: string, due: string) => {
    const customer = await addCustomer(db);
    const [so] = await db.insert(salesOrders).values({ code: `S-${code}`, customerId: customer.id, status: "confirmed", dueAt: new Date(due), createdBy: alim.user.id }).returning();
    const [sl] = await db.insert(salesOrderLines).values({ orderId: so!.id, productId: product.id, qtyMilli: 2000, vatRate: 10, status: "waiting_material" }).returning();
    const [wo] = await db.insert(workOrders).values({ code, productId: product.id, qtyMilli: 2000, salesOrderLineId: sl!.id, createdBy: alim.user.id }).returning();
    return wo!;
  };
  const late = await make("IE-2026-0001", "2026-12-30T00:00:00+03:00");
  const early = await make("IE-2026-0002", "2026-12-02T00:00:00+03:00");
  // Her iş emri 60 plaka ister; teslimden sonra 40 + 60 = 100 plaka var: yalnız biri ayrılır.
  const { po, lineMdf } = await sentOrder();
  const result = await receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 60_000 }] });
  expect(result.readyWorkOrders).toEqual([early.code]);
  const [l] = await db.select().from(workOrders).where(eq(workOrders.id, late.id));
  expect(l?.materialsReserved).toBe(false);
  expect((await stock(mdf.id)).reservedMilli).toBe(60_000);
});

test("çift tıklama: aynı anda iki tam teslim yalnızca birini geçirir, stok iki kez artmaz", async () => {
  const { po, lineMdf } = await sentOrder();
  const results = await Promise.allSettled([
    receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-1", lines: [{ lineId: lineMdf, qtyMilli: 60_000 }] }),
    receiveGoods(depo, { purchaseOrderId: po.id, deliveryNote: "A-2", lines: [{ lineId: lineMdf, qtyMilli: 60_000 }] }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await stock(mdf.id)).onHandMilli).toBe(100_000);
  expect(await db.select().from(goodsReceipts)).toHaveLength(1);
  expect(await verifyLedger(db)).toEqual([]);
});

test("listReceivable: yalnızca gönderilmiş ve kısmi, beklenen güne göre (gecikenler önce)", async () => {
  const later = await sentOrder({ expectedAt: new Date("2026-11-25T00:00:00+03:00") });
  const overdue = await sentOrder({ status: "partial", expectedAt: new Date("2026-11-10T00:00:00+03:00") });
  await sentOrder({ status: "draft" });
  await sentOrder({ status: "received" });
  await sentOrder({ status: "cancelled" });
  const rows = await listReceivable(db, NOW);
  expect(rows.map((r) => r.id)).toEqual([overdue.po.id, later.po.id]);
  expect(rows.map((r) => r.late)).toEqual([true, false]);
});
