import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { purchaseOrders, salesOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { isDomainError } from "@/domain/errors";
import { addLine, createOrder } from "@/domain/sales/orders";
import { isActionTool, previewActionTool, runActionTool, runReadTool } from "@/assistant/tools";
import { TOOL_DEFS } from "@/assistant/toolDefs";
import { addCustomer, addMaterial, addProduct, addSupplier, addSupplierItem, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let depo: Ctx;
let satinalma: Ctx;
let orderId: string;
let orderCode: string;
const DUE = new Date("2026-12-01T12:00:00+03:00");

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  satinalma = ctxFor(db, await addUser(db, "satinalma", "uzman"));
  const customer = await addCustomer(db, { name: "Ayhan Mobilya" });
  const product = await addProduct(db, { onHandMilli: 5000 });
  const order = await createOrder(satis, { customerId: customer.id, dueAt: DUE });
  await addLine(satis, { orderId: order.id, productId: product.id, qtyMilli: 1000 });
  orderId = order.id;
  orderCode = order.code;
});

const status = async () => (await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)))[0]!.status;

test("araç tanımları: ad tekil, eylem araçlarının zorunlu alanı var", () => {
  expect(new Set(TOOL_DEFS.map((t) => t.name)).size).toBe(TOOL_DEFS.length);
  expect(isActionTool("onayla_siparis")).toBe(true);
  expect(isActionTool("siparis_bul")).toBe(false);
  for (const t of TOOL_DEFS.filter((d) => d.kind === "action")) expect(t.input_schema.required?.length).toBeGreaterThan(0);
});

test("siparis_bul: Türkçe harf duyarsız arama, kayıt bağlantısı", async () => {
  const res = (await runReadTool(satis, "siparis_bul", { arama: "AYHAN" })) as { kayitlar: { kod: string; href: string; durum: string }[] };
  expect(res.kayitlar).toHaveLength(1);
  expect(res.kayitlar[0]).toMatchObject({ kod: orderCode, durum: "Taslak", href: `/satis/siparisler?ac=${orderId}` });
});

test("malzeme_stok: yalnızca kritik süzgeci", async () => {
  await addMaterial(db, { code: "MLZ-9101", name: "Az Meşe", onHandMilli: 100, reorderPointMilli: 5000 });
  await addMaterial(db, { code: "MLZ-9102", name: "Çok Meşe", onHandMilli: 9000, reorderPointMilli: 100 });
  const res = (await runReadTool(depo, "malzeme_stok", { arama: "mese", sadece_kritik: true })) as { toplam: number; kayitlar: { kod: string; kritik: boolean }[] };
  expect(res.kayitlar.map((r) => r.kod)).toEqual(["MLZ-9101"]);
  expect(res.kayitlar[0]!.kritik).toBe(true);
});

test("okuma araçları: bilinmeyen araç ve geçersiz süzgeç VALIDATION", async () => {
  await expect(runReadTool(satis, "yok_boyle_arac", {})).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(runReadTool(satis, "siparis_bul", { durum: "uydurma" })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("onayla_siparis: kart hiçbir şey yazmaz; çalıştırınca sipariş onaylanır", async () => {
  const preview = await previewActionTool(satis, "onayla_siparis", { siparis_kodu: orderCode.toLowerCase() });
  expect(preview.title).toContain(orderCode);
  expect(preview.lines.join("\n")).toContain("Ayhan Mobilya");
  expect(await status()).toBe("draft");

  const result = await runActionTool(satis, "onayla_siparis", { siparis_kodu: orderCode });
  expect(result).toMatchObject({ kod: orderCode, href: `/satis/siparisler?ac=${orderId}` });
  expect(await status()).not.toBe("draft");
});

test("onayla_siparis: yetkisiz kullanıcıya FORBIDDEN, sipariş değişmez", async () => {
  await expect(previewActionTool(depo, "onayla_siparis", { siparis_kodu: orderCode })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(runActionTool(depo, "onayla_siparis", { siparis_kodu: orderCode })).rejects.toSatisfy(isDomainError);
  expect(await status()).toBe("draft");
});

test("onayla_siparis: taslak olmayan ve bulunmayan sipariş", async () => {
  await runActionTool(satis, "onayla_siparis", { siparis_kodu: orderCode });
  await expect(previewActionTool(satis, "onayla_siparis", { siparis_kodu: orderCode })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(previewActionTool(satis, "onayla_siparis", { siparis_kodu: "SIP-2026-9999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(previewActionTool(satis, "onayla_siparis", {})).rejects.toMatchObject({ code: "VALIDATION" });
});

test("satin_alma_taslagi: öneri grubundan taslak açar, yetkisiz kişi açamaz", async () => {
  const material = await addMaterial(db, { unit: "adet", onHandMilli: 0, reorderPointMilli: 5000 });
  const supplier = await addSupplier(db);
  await addSupplierItem(db, { supplierId: supplier.id, materialId: material.id, unitPriceMinor: 1000 });

  await expect(previewActionTool(depo, "satin_alma_taslagi", { tedarikci_kodu: supplier.code })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const preview = await previewActionTool(satinalma, "satin_alma_taslagi", { tedarikci_kodu: supplier.code });
  expect(preview.title).toContain(supplier.code);
  expect(await db.select().from(purchaseOrders)).toHaveLength(0);

  const result = (await runActionTool(satinalma, "satin_alma_taslagi", { tedarikci_kodu: supplier.code })) as { kod: string };
  const rows = await db.select().from(purchaseOrders);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.code).toBe(result.kod);
  expect(rows[0]!.status).toBe("draft");
});
