import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, products, salesOrderLines, salesOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { addLine, createOrder, removeLine, updateLine } from "@/domain/sales/orders";
import { addCustomer, addProduct, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let customerId: string;
let productId: string;
const DUE = new Date("2026-12-01T12:00:00+03:00");

const lines = (orderId: string) => db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  customerId = (await addCustomer(db)).id;
  productId = (await addProduct(db, { priceKurus: 1_250_000, vatRate: 10 })).id;
});

test("taslak sipariş SIP-2026-0001 koduyla açılır", async () => {
  const a = await createOrder(satis, { customerId, dueAt: DUE, note: " acele " });
  const b = await createOrder(satis, { customerId, dueAt: DUE });
  expect(a).toMatchObject({ code: "SIP-2026-0001", status: "draft", note: "acele", createdBy: satis.user.id });
  expect(b.code).toBe("SIP-2026-0002");
  expect((await db.select().from(auditLog)).some((r) => r.entity === "sales_order" && r.action === "create")).toBe(true);
});

test("sipariş kodu İstanbul yılını kullanır", async () => {
  const newYear = ctxFor(db, satis.user, new Date("2026-12-31T22:30:00Z")); // İstanbul'da 1 Ocak 2027
  const o = await createOrder(newYear, { customerId, dueAt: new Date("2027-02-01T12:00:00+03:00") });
  expect(o.code).toBe("SIP-2027-0001");
});

test("bilinmeyen müşteri NOT_FOUND", async () => {
  await expect(createOrder(satis, { customerId: "00000000-0000-4000-8000-000000000000", dueAt: DUE })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("geçmiş termin reddedilir; bugün kabul edilir", async () => {
  await expect(createOrder(satis, { customerId, dueAt: new Date("2026-11-14T23:59:00+03:00") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Termin geçmiş bir gün olamaz",
  });
  const todayEarly = await createOrder(satis, { customerId, dueAt: new Date("2026-11-15T00:00:00+03:00") });
  expect(todayEarly.status).toBe("draft");
  // Bu İstanbul gününün sonu: UTC'de hâlâ 15 Kasım, İstanbul'da da 15 Kasım
  await createOrder(satis, { customerId, dueAt: new Date("2026-11-15T23:59:00+03:00") });
});

test("bugün sınırı İstanbul gününe göredir", async () => {
  // 15 Kasım 23:30 UTC = İstanbul'da 16 Kasım 02:30; dünün sonu artık geçmiştir
  const late = ctxFor(db, satis.user, new Date("2026-11-15T23:30:00Z"));
  await expect(createOrder(late, { customerId, dueAt: new Date("2026-11-15T20:00:00+03:00") })).rejects.toMatchObject({ code: "VALIDATION" });
  await createOrder(late, { customerId, dueAt: new Date("2026-11-16T00:00:00+03:00") });
});

test("satır fiyatı ve KDV ürünün o anki değerinden kopyalanır; sonradan değişse de kalır", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const line = await addLine(satis, { orderId: o.id, productId, qtyMilli: 2000, discountPermille: 50 });
  expect(line).toMatchObject({ unitPriceKurus: 1_250_000, vatRate: 10, qtyMilli: 2000, discountPermille: 50, status: "draft" });
  await db.update(products).set({ priceKurus: 9_999_999, vatRate: 20 }).where(eq(products.id, productId));
  const [stored] = await lines(o.id);
  expect(stored).toMatchObject({ unitPriceKurus: 1_250_000, vatRate: 10 });
});

test("aynı ürün ikinci kez eklenince adet artar", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const first = await addLine(satis, { orderId: o.id, productId, qtyMilli: 2000 });
  const second = await addLine(satis, { orderId: o.id, productId, qtyMilli: 3000 });
  expect(second.id).toBe(first.id);
  const all = await lines(o.id);
  expect(all).toHaveLength(1);
  expect(all[0]?.qtyMilli).toBe(5000);
});

test("aynı ürün iskontosuz yeniden eklenince iskonto korunur; yeni satır merged=false, birleşen merged=true", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const first = await addLine(satis, { orderId: o.id, productId, qtyMilli: 2000, discountPermille: 100 });
  expect(first.merged).toBe(false);
  const second = await addLine(satis, { orderId: o.id, productId, qtyMilli: 1000 });
  expect(second).toMatchObject({ id: first.id, qtyMilli: 3000, discountPermille: 100, merged: true });
  const all = await lines(o.id);
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ qtyMilli: 3000, discountPermille: 100 });
  const summaries = (await db.select().from(auditLog)).filter((r) => r.action === "update_line").map((r) => r.summary);
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).not.toContain("iskonto");
});

test("birleşirken açıkça verilen iskonto eskisinin yerine geçer ve denetimde yazılır", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: 2000, discountPermille: 100 });
  const merged = await addLine(satis, { orderId: o.id, productId, qtyMilli: 1000, discountPermille: 125 });
  expect(merged).toMatchObject({ qtyMilli: 3000, discountPermille: 125, merged: true });
  const [summary] = (await db.select().from(auditLog)).filter((r) => r.action === "update_line").map((r) => r.summary);
  expect(summary).toMatch(/adet 2 → 3, iskonto %10 → %12,5, tutar ₺22\.500,00 → ₺32\.812,50$/);
});

test("birleşen adet 9999'u aşarsa reddedilir", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: 9_000_000 });
  await expect(addLine(satis, { orderId: o.id, productId, qtyMilli: 1_000_000 })).rejects.toMatchObject({ code: "VALIDATION" });
});

test.each([1500, 0, -1000, 10_000_000])("adet %s reddedilir", async (qtyMilli) => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await expect(addLine(satis, { orderId: o.id, productId, qtyMilli })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Adet 1 ile 9999 arasında tam sayı olmalı",
  });
});

test.each([-1, 501, 12.5])("iskonto %s reddedilir", async (discountPermille) => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await expect(addLine(satis, { orderId: o.id, productId, qtyMilli: 1000, discountPermille })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("pasif ürün eklenemez; bilinmeyen ürün NOT_FOUND", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const passive = await addProduct(db, { active: false });
  await expect(addLine(satis, { orderId: o.id, productId: passive.id, qtyMilli: 1000 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(addLine(satis, { orderId: o.id, productId: "00000000-0000-4000-8000-000000000000", qtyMilli: 1000 })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("satır güncellenir ve silinir", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const line = await addLine(satis, { orderId: o.id, productId, qtyMilli: 2000 });
  await updateLine(satis, { lineId: line.id, qtyMilli: 4000, discountPermille: 100 });
  expect((await lines(o.id))[0]).toMatchObject({ qtyMilli: 4000, discountPermille: 100 });
  await expect(updateLine(satis, { lineId: line.id, qtyMilli: 1500 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updateLine(satis, { lineId: line.id, discountPermille: 600 })).rejects.toMatchObject({ code: "VALIDATION" });
  await removeLine(satis, line.id);
  expect(await lines(o.id)).toHaveLength(0);
  await expect(removeLine(satis, line.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const actions = (await db.select().from(auditLog)).filter((r) => r.entity === "sales_order").map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(["add_line", "update_line", "remove_line"]));
});

test("onaylanmış siparişe satır eklenemez, değiştirilemez, silinemez", async () => {
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  const line = await addLine(satis, { orderId: o.id, productId, qtyMilli: 1000 });
  await db.update(salesOrders).set({ status: "confirmed" }).where(eq(salesOrders.id, o.id));
  await expect(addLine(satis, { orderId: o.id, productId, qtyMilli: 1000 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(updateLine(satis, { lineId: line.id, qtyMilli: 2000 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(removeLine(satis, line.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("depo kullanıcısı sipariş açamaz: FORBIDDEN", async () => {
  const depo = ctxFor(db, await addUser(db, "depo", "mudur"));
  await expect(createOrder(depo, { customerId, dueAt: DUE })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const o = await createOrder(satis, { customerId, dueAt: DUE });
  await expect(addLine(depo, { orderId: o.id, productId, qtyMilli: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
