import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, purchaseOrderLines, purchaseOrders, supplierItems } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { getSupplier, listSuppliers } from "@/domain/purchasing/queries";
import { createSupplier, removeSupplierItem, setSupplierItem, updateSupplier } from "@/domain/purchasing/suppliers";
import { addMaterial, addSupplier, addSupplierItem, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let alim: Ctx;
let satis: Ctx;

const valid = { name: "Sapanca Yonga Levha", city: "Sakarya", contact: "Kemal Aras", phone: "0264 555 00 00", paymentTermDays: 45, leadTimeDays: 5 };

async function history(entityId: string, action?: string): Promise<string[]> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.filter((r) => !action || r.action === action).map((r) => r.summary);
}

beforeEach(async () => {
  db = await createTestDb();
  alim = ctxFor(db, await addUser(db, "satinalma", "uzman"));
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
});

test("createSupplier sıradaki TED kodunu verir ve kartı geçmişe yazar", async () => {
  const a = await createSupplier(alim, valid);
  const b = await createSupplier(alim, { ...valid, name: "İkinci Tedarik" });
  expect(a.code).toBe("TED-0001");
  expect(b.code).toBe("TED-0002");
  expect(a).toMatchObject({ currency: "TRY", active: true, paymentTermDays: 45, leadTimeDays: 5 });
  expect(await history(a.id, "create")).toEqual(["TED-0001 Sapanca Yonga Levha eklendi: Sakarya, vade 45 gün, teslim 5 iş günü, TL"]);
});

test("satış uzmanı tedarikçi açamaz: FORBIDDEN", async () => {
  await expect(createSupplier(satis, valid)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const s = await addSupplier(db);
  const m = await addMaterial(db);
  await expect(updateSupplier(satis, s.id, { city: "Bursa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    setSupplierItem(satis, { supplierId: s.id, materialId: m.id, unitPriceMinor: 100, moqMilli: 0, preferred: false }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("ad, il, telefon boş olamaz; vade ve teslim süresi sınırları", async () => {
  for (const bad of [{ name: " " }, { city: "" }, { phone: "  " }, { paymentTermDays: -1 }, { leadTimeDays: 0 }, { leadTimeDays: 91 }, { leadTimeDays: 2.5 }]) {
    await expect(createSupplier(alim, { ...valid, ...bad })).rejects.toMatchObject({ code: "VALIDATION" });
  }
  await expect(createSupplier(alim, { ...valid, paymentTermDays: 0, leadTimeDays: 90 })).resolves.toBeDefined();
});

test("updateSupplier yalnızca değişen alanları eski → yeni yazar; değişiklik yoksa yazmaz", async () => {
  const s = await createSupplier(alim, valid);
  await updateSupplier(alim, s.id, { city: "Bursa", paymentTermDays: 60, name: valid.name });
  expect(await history(s.id, "update")).toEqual(["TED-0001 güncellendi: il Sakarya → Bursa, vade 45 gün → 60 gün"]);
  await updateSupplier(alim, s.id, { city: "Bursa", paymentTermDays: 60 });
  expect(await history(s.id, "update")).toHaveLength(1);
  await expect(updateSupplier(alim, "yok", { city: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("setSupplierItem aynı malzemede günceller; tercihli yapılınca önceki tercihli kalkar ve özette yazar", async () => {
  const a = await createSupplier(alim, valid); // TED-0001
  const b = await createSupplier(alim, { ...valid, name: "Diğer" }); // TED-0002
  const m = await addMaterial(db, { code: "MLZ-0005", name: "MDF Lam 8 mm", unit: "plaka" });

  await setSupplierItem(alim, { supplierId: b.id, materialId: m.id, unitPriceMinor: 154_167, moqMilli: 0, preferred: true });
  const first = await setSupplierItem(alim, { supplierId: a.id, materialId: m.id, unitPriceMinor: 154_167, moqMilli: 0, preferred: false });
  expect(await history(a.id, "set_item")).toEqual(["TED-0001: MLZ-0005 MDF Lam 8 mm fiyatı ₺1.541,67, en az yok"]);

  const again = await setSupplierItem(alim, { supplierId: a.id, materialId: m.id, unitPriceMinor: 158_000, moqMilli: 10_000, preferred: true });
  expect(again.id).toBe(first.id);
  expect(await db.select().from(supplierItems).where(eq(supplierItems.materialId, m.id))).toHaveLength(2);
  const flags = Object.fromEntries((await db.select().from(supplierItems)).map((r) => [r.supplierId, r.isPreferred]));
  expect(flags).toEqual({ [a.id]: true, [b.id]: false });
  expect(await history(a.id, "set_item")).toContain(
    "TED-0001: MLZ-0005 MDF Lam 8 mm fiyatı ₺1.541,67 → ₺1.580,00, en az 10 plaka, tercihli (önceki tercihli TED-0002)",
  );

  // değişiklik yoksa yeni satır yazılmaz
  await setSupplierItem(alim, { supplierId: a.id, materialId: m.id, unitPriceMinor: 158_000, moqMilli: 10_000, preferred: true });
  expect(await history(a.id, "set_item")).toHaveLength(2);

  await removeSupplierItem(alim, again.id);
  expect(await history(a.id, "remove_item")).toEqual(["TED-0001: MLZ-0005 MDF Lam 8 mm fiyatı kaldırıldı (₺1.580,00)"]);
  await expect(removeSupplierItem(alim, again.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(removeSupplierItem(satis, first.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("en az sipariş miktarı birim adımının katı değilse ve fiyat negatifse VALIDATION; pasif malzemeye fiyat eklenmez", async () => {
  const s = await createSupplier(alim, valid);
  const plaka = await addMaterial(db, { unit: "plaka" });
  const base = { supplierId: s.id, materialId: plaka.id, unitPriceMinor: 100, moqMilli: 0, preferred: false };
  await expect(setSupplierItem(alim, { ...base, moqMilli: 1500 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setSupplierItem(alim, { ...base, moqMilli: -1000 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setSupplierItem(alim, { ...base, unitPriceMinor: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setSupplierItem(alim, { ...base, unitPriceMinor: 1.5 })).rejects.toMatchObject({ code: "VALIDATION" });
  // kilogram adımı 100 milli
  const kg = await addMaterial(db, { unit: "kg" });
  await expect(setSupplierItem(alim, { ...base, materialId: kg.id, moqMilli: 250 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setSupplierItem(alim, { ...base, materialId: kg.id, moqMilli: 2500 })).resolves.toBeDefined();
  const pasif = await addMaterial(db, { active: false });
  await expect(setSupplierItem(alim, { ...base, materialId: pasif.id })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setSupplierItem(alim, { ...base, materialId: "yok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(setSupplierItem(alim, { ...base, supplierId: "yok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("currency EUR verilirse VALIDATION", async () => {
  await expect(createSupplier(alim, { ...valid, currency: "EUR" })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Döviz ile çalışan tedarikçi henüz desteklenmiyor",
  });
  const s = await createSupplier(alim, { ...valid, currency: "TRY" });
  await expect(updateSupplier(alim, s.id, { currency: "USD" })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("getSupplier kalemleri malzeme koduna göre, açık sipariş sayısı ve tutarıyla verir", async () => {
  const s = await addSupplier(db, { code: "TED-0001", name: "Sapanca Yonga Levha" });
  const other = await addSupplier(db, { code: "TED-0002", name: "Başka" });
  const m2 = await addMaterial(db, { code: "MLZ-0002", name: "İkinci", unit: "adet" });
  const m1 = await addMaterial(db, { code: "MLZ-0001", name: "Birinci", unit: "plaka" });
  await addSupplierItem(db, { supplierId: s.id, materialId: m2.id, unitPriceMinor: 500 });
  await addSupplierItem(db, { supplierId: s.id, materialId: m1.id, unitPriceMinor: 10_000, moqMilli: 5000, isPreferred: true });
  await addSupplierItem(db, { supplierId: other.id, materialId: m1.id, unitPriceMinor: 9000 });

  const user = alim.user;
  const order = async (supplierId: string, status: string, code: string, lines: [string, number, number][]) => {
    const [po] = await db.insert(purchaseOrders).values({ code, supplierId, status, createdBy: user.id }).returning();
    for (const [materialId, qtyMilli, unitPriceMinor] of lines) {
      await db.insert(purchaseOrderLines).values({ orderId: po!.id, materialId, qtyMilli, unitPriceMinor });
    }
  };
  await order(s.id, "sent", "SAS-2026-0001", [[m1.id, 10_000, 10_000], [m2.id, 4000, 500]]); // 100.000 + 2.000
  await order(s.id, "partial", "SAS-2026-0002", [[m1.id, 2000, 10_000]]); // 20.000
  await order(s.id, "pending_approval", "SAS-2026-0003", [[m1.id, 1000, 10_000]]); // 10.000
  await order(s.id, "draft", "SAS-2026-0004", [[m1.id, 1000, 10_000]]); // açık sayılmaz
  await order(s.id, "received", "SAS-2026-0005", [[m1.id, 1000, 10_000]]);
  await order(s.id, "cancelled", "SAS-2026-0006", [[m1.id, 1000, 10_000]]);
  await order(other.id, "sent", "SAS-2026-0007", [[m1.id, 1000, 9000]]);

  const detail = await getSupplier(db, s.id);
  expect(detail).toMatchObject({ code: "TED-0001", itemCount: 2, openOrderCount: 3, openNetMinor: 132_000 });
  expect(detail?.items.map((i) => [i.materialCode, i.materialName, i.unit, i.unitPriceMinor, i.moqMilli, i.isPreferred])).toEqual([
    ["MLZ-0001", "Birinci", "plaka", 10_000, 5000, true],
    ["MLZ-0002", "İkinci", "adet", 500, 0, false],
  ]);
  expect(await getSupplier(db, "yok")).toBeNull();
  expect(await getSupplier(db, "00000000-0000-4000-8000-000000000000")).toBeNull();

  const rows = await listSuppliers(db);
  expect(rows.map((r) => [r.code, r.itemCount, r.openOrderCount, r.openNetMinor])).toEqual([
    ["TED-0001", 2, 3, 132_000],
    ["TED-0002", 1, 1, 9000],
  ]);
  expect((await listSuppliers(db, { search: "sapanca" })).map((r) => r.code)).toEqual(["TED-0001"]);
  expect((await listSuppliers(db, { search: "TED-0002" })).map((r) => r.code)).toEqual(["TED-0002"]);
  expect(await listSuppliers(db, { search: "yokyok" })).toEqual([]);
});
