import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, materials, purchaseOrderLines, purchaseOrders, workOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { refCode } from "@/domain/audit";
import {
  cancelPurchaseOrder,
  createFromSuggestion,
  createPurchaseOrder,
  removePurchaseLine,
  updatePurchaseLine,
} from "@/domain/purchasing/orders";
import { addBomLine, addMaterial, addProduct, addSupplier, addSupplierItem, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let alim: Ctx;
let depo: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  alim = ctxFor(db, await addUser(db, "satinalma", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
});

async function history(entityId: string, action?: string): Promise<string[]> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.filter((r) => !action || r.action === action).map((r) => r.summary);
}

async function setup() {
  const supplier = await addSupplier(db, { code: "TED-0001", name: "Sapanca Yonga Levha" });
  const mdf = await addMaterial(db, { code: "MLZ-0005", name: "MDF Lam 8 mm", unit: "plaka" });
  await addSupplierItem(db, { supplierId: supplier.id, materialId: mdf.id, unitPriceMinor: 154_167 });
  return { supplier, mdf };
}

test("createPurchaseOrder SAS-2026-0001 verir, fiyatı tedarikçi kaleminden kopyalar, durum taslak", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 60_000 }], note: "acil" });
  expect(po).toMatchObject({ code: "SAS-2026-0001", status: "draft", currency: "TRY", requiredTier: 0, note: "acil", createdBy: alim.user.id });
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ materialId: mdf.id, qtyMilli: 60_000, unitPriceMinor: 154_167, receivedMilli: 0 });
  expect(await history(po.id, "create")).toEqual(["SAS-2026-0001 taslak: TED-0001 Sapanca Yonga Levha, 1 kalem, ₺92.500,20 KDV hariç"]);

  const second = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 1000 }] });
  expect(second.code).toBe("SAS-2026-0002");
  expect(await refCode(db, { type: "purchase_order", id: po.id })).toBe("SAS-2026-0001");
});

test("aynı malzeme iki kez verilirse miktarlar birleşir; sıfır, kesirli ve boş giriş reddedilir", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, {
    supplierId: supplier.id,
    lines: [
      { materialId: mdf.id, qtyMilli: 2000 },
      { materialId: mdf.id, qtyMilli: 3000 },
    ],
  });
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  expect(lines.map((l) => l.qtyMilli)).toEqual([5000]);
  for (const lines of [[], [{ materialId: mdf.id, qtyMilli: 0 }], [{ materialId: mdf.id, qtyMilli: 1500 }]]) {
    await expect(createPurchaseOrder(alim, { supplierId: supplier.id, lines })).rejects.toMatchObject({ code: "VALIDATION" });
  }
});

test("tedarikçide olmayan malzeme ve pasif tedarikçi reddedilir", async () => {
  const { supplier } = await setup();
  const other = await addMaterial(db, { code: "MLZ-0009", unit: "plaka" });
  await expect(createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: other.id, qtyMilli: 1000 }] })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "MLZ-0009 bu tedarikçiden alınmıyor",
  });
  const dead = await addSupplier(db, { active: false });
  await addSupplierItem(db, { supplierId: dead.id, materialId: other.id, unitPriceMinor: 100 });
  await expect(createPurchaseOrder(alim, { supplierId: dead.id, lines: [{ materialId: other.id, qtyMilli: 1000 }] })).rejects.toMatchObject({
    code: "VALIDATION",
  });
  expect(await db.select().from(purchaseOrders)).toHaveLength(0);
});

test("createFromSuggestion grubu taslağa çevirir; ikinci çağrı 'Bu tedarikçi için öneri kalmadı'", async () => {
  const { supplier, mdf } = await setup();
  await db.update(materials).set({ reorderPointMilli: 10_000 }).where(eq(materials.id, mdf.id));
  const p = await addProduct(db);
  await addBomLine(db, { productId: p.id, materialId: mdf.id, qtyMilli: 1000 });
  for (const code of ["IE-2026-0041", "IE-2026-0044"]) {
    await db.insert(workOrders).values({ code, productId: p.id, qtyMilli: 1000, createdBy: alim.user.id });
  }

  const po = await createFromSuggestion(alim, supplier.id);
  expect(po).toMatchObject({ code: "SAS-2026-0001", status: "draft" });
  const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));
  expect(lines[0]).toMatchObject({ materialId: mdf.id, qtyMilli: 12_000, unitPriceMinor: 154_167 }); // 10 sipariş noktası + 2 bekleyen
  expect(await history(po.id, "create")).toEqual([
    "SAS-2026-0001 taslak: TED-0001 Sapanca Yonga Levha, 1 kalem, ₺18.500,04 KDV hariç (öneriden: IE-2026-0041, IE-2026-0044)",
  ]);
  await expect(createFromSuggestion(alim, supplier.id)).rejects.toMatchObject({ code: "VALIDATION", message: "Bu tedarikçi için öneri kalmadı" });
  expect(await db.select().from(purchaseOrders)).toHaveLength(1);
});

test("taslak dışında kalem düzenleme ve silme INVALID_STATE; taslakta özetler yazılır", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 60_000 }] });
  const [line] = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, po.id));

  await updatePurchaseLine(alim, { lineId: line!.id, qtyMilli: 80_000 });
  expect(await history(po.id, "update_line")).toEqual(["SAS-2026-0001: MLZ-0005 miktar 60 → 80 plaka, tutar ₺92.500,20 → ₺123.333,60"]);
  await updatePurchaseLine(alim, { lineId: line!.id, qtyMilli: 80_000 }); // değişiklik yok: yazılmaz
  expect(await history(po.id, "update_line")).toHaveLength(1);
  await expect(updatePurchaseLine(alim, { lineId: line!.id, qtyMilli: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updatePurchaseLine(alim, { lineId: line!.id, unitPriceMinor: -1 })).rejects.toMatchObject({ code: "VALIDATION" });

  await db.update(purchaseOrders).set({ status: "sent" }).where(eq(purchaseOrders.id, po.id));
  const stale = { code: "INVALID_STATE", message: "Yalnızca taslak sipariş düzenlenir" };
  await expect(updatePurchaseLine(alim, { lineId: line!.id, qtyMilli: 1000 })).rejects.toMatchObject(stale);
  await expect(removePurchaseLine(alim, line!.id)).rejects.toMatchObject(stale);

  await db.update(purchaseOrders).set({ status: "draft" }).where(eq(purchaseOrders.id, po.id));
  await removePurchaseLine(alim, line!.id); // son kalem de silinebilir
  expect(await db.select().from(purchaseOrderLines)).toHaveLength(0);
  expect(await history(po.id, "remove_line")).toHaveLength(1);
});

test("iptal gerekçesiz reddedilir; kısmi teslimde iptal teslim alınanı özette yazar", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 60_000 }] });
  await expect(cancelPurchaseOrder(alim, { purchaseOrderId: po.id, reason: "  " })).rejects.toMatchObject({ code: "VALIDATION" });

  await db.update(purchaseOrders).set({ status: "partial" }).where(eq(purchaseOrders.id, po.id));
  await db.update(purchaseOrderLines).set({ receivedMilli: 20_000 }).where(eq(purchaseOrderLines.orderId, po.id));
  const cancelled = await cancelPurchaseOrder(alim, { purchaseOrderId: po.id, reason: "Tedarikçi fiyatı değişti" });
  expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Tedarikçi fiyatı değişti" });
  expect(cancelled.cancelledAt).toEqual(alim.now);
  expect(await history(po.id, "cancel")).toEqual([
    "SAS-2026-0001 iptal edildi: Tedarikçi fiyatı değişti; teslim alınan MLZ-0005 20/60 plaka stokta kalır",
  ]);
  await expect(cancelPurchaseOrder(alim, { purchaseOrderId: po.id, reason: "yine" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await db.update(purchaseOrders).set({ status: "received" }).where(eq(purchaseOrders.id, po.id));
  await expect(cancelPurchaseOrder(alim, { purchaseOrderId: po.id, reason: "yine" })).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("depo uzmanı sipariş açamaz: FORBIDDEN", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 1000 }] });
  const [line] = await db.select().from(purchaseOrderLines);
  await expect(createPurchaseOrder(depo, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 1000 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(createFromSuggestion(depo, supplier.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(updatePurchaseLine(depo, { lineId: line!.id, qtyMilli: 2000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(removePurchaseLine(depo, line!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(cancelPurchaseOrder(depo, { purchaseOrderId: po.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("aynı kalemin ikinci silinmesi NOT_FOUND olur ve ikinci denetim kaydı yazılmaz", async () => {
  const { supplier, mdf } = await setup();
  const po = await createPurchaseOrder(alim, { supplierId: supplier.id, lines: [{ materialId: mdf.id, qtyMilli: 1000 }] });
  const [line] = await db.select().from(purchaseOrderLines);
  const results = await Promise.allSettled([removePurchaseLine(alim, line!.id), removePurchaseLine(alim, line!.id)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(failed.reason).toMatchObject({ code: "NOT_FOUND" });
  expect(await history(po.id, "remove_line")).toHaveLength(1);
  await expect(removePurchaseLine(alim, line!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await history(po.id, "remove_line")).toHaveLength(1);
});
