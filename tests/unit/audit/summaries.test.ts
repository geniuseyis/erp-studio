// İşlem geçmişi özetleri: kayda bakmadan neyin değiştiğini söyler (ürün kodu, adı, adet, tutar; alanların eski → yeni değeri).
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, workOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { approveCount, cancelCount, createCount, setCountLine } from "@/domain/inventory/counts";
import { issueStock, receiveStock } from "@/domain/inventory/ledger";
import { createMaterial, updateMaterial } from "@/domain/inventory/materials";
import { finishCurrentStep, planWorkOrder, retryMaterials, startNextStep } from "@/domain/production/workOrders";
import { createCustomer, updateCustomer } from "@/domain/sales/customers";
import { addLine, cancelOrder, confirmOrder, createOrder, removeLine, shipOrder, updateLine } from "@/domain/sales/orders";
import { createUser, resetPassword, setUserActive, updateUser } from "@/domain/users";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let satisMudur: Ctx;
let planlama: Ctx;
let depo: Ctx;
let depoMudur: Ctx;
let atolye: Ctx;
let bt: Ctx;

const DUE = new Date("2026-12-01T12:00:00+03:00");

/** Bir kaydın verilen işlemdeki özetleri, yazılış sırasıyla. */
async function summaries(entityId: string, action: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((r) => r.summary);
}

async function only(entityId: string, action: string): Promise<string> {
  const all = await summaries(entityId, action);
  expect(all).toHaveLength(1);
  return all[0] ?? "";
}

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  satisMudur = ctxFor(db, await addUser(db, "satis", "mudur"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  depoMudur = ctxFor(db, await addUser(db, "depo", "mudur"));
  atolye = ctxFor(db, await addUser(db, "atolye", "operator"));
  bt = ctxFor(db, await addUser(db, "bt", "uzman"));
});

test("sipariş: açılış müşteri ve termini, satır ekleme ürün kodu, adı, adedi ve tutarı yazar", async () => {
  const customer = await addCustomer(db, { name: "Deneme Ev Mobilyası" });
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık", priceKurus: 1_250_000 });
  const o = await createOrder(satis, { customerId: customer.id, dueAt: DUE });
  expect(await only(o.id, "create")).toBe(`${o.code} taslağı açıldı: Deneme Ev Mobilyası, termin 01.12.2026`);

  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  expect(await only(o.id, "add_line")).toBe(`${o.code}: satır eklendi — URN-0031 Adım Ayakkabılık × 2 (₺25.000,00)`);
});

test("sipariş: iskontolu satır iskontoyu ve iskontolu tutarı yazar", async () => {
  const product = await addProduct(db, { code: "URN-0040", name: "Kare Sehpa", priceKurus: 100_000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 3000, discountPermille: 125 });
  expect(await only(o.id, "add_line")).toBe(`${o.code}: satır eklendi — URN-0040 Kare Sehpa × 3, iskonto %12,5 (₺2.625,00)`);
});

test("sipariş: satır güncelleme yalnızca değişeni eski → yeni yazar, tutarı da", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık", priceKurus: 1_250_000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  const line = await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await updateLine(satis, { lineId: line.id, qtyMilli: 3000, discountPermille: 0 });
  expect(await only(o.id, "update_line")).toBe(
    `${o.code}: satır güncellendi — URN-0031 Adım Ayakkabılık: adet 2 → 3, tutar ₺25.000,00 → ₺37.500,00`,
  );
});

test("sipariş: aynı ürün yeniden eklenince adet ve tutar değişimi yazılır", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık", priceKurus: 1_250_000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000, discountPermille: 100 });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 1000, discountPermille: 125 });
  expect(await only(o.id, "update_line")).toBe(
    `${o.code}: satır güncellendi — URN-0031 Adım Ayakkabılık: adet 2 → 3, iskonto %10 → %12,5, tutar ₺22.500,00 → ₺32.812,50`,
  );
});

test("sipariş: silinen satırın ürün kodu, adı, adedi ve tutarı yazılır", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık", priceKurus: 1_250_000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  const line = await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await removeLine(satis, line.id);
  expect(await only(o.id, "remove_line")).toBe(`${o.code}: satır silindi — URN-0031 Adım Ayakkabılık × 2 (₺25.000,00)`);
});

test("sipariş: onay, sevk ve iptal satır sayısını ve KDV dahil tutarı yazar; iptal gerekçeyi de", async () => {
  // Stokta mamul var: onay iş emri açmadan ayırır ve sipariş hazır olur.
  const product = await addProduct(db, { code: "URN-0050", name: "Dolap", priceKurus: 100_000, vatRate: 10, onHandMilli: 5000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await confirmOrder(satis, o.id);
  expect(await only(o.id, "confirm")).toBe(`${o.code} onaylandı: 1 kalem, KDV dahil ₺2.200,00`);
  await shipOrder(depo, o.id);
  expect(await only(o.id, "ship")).toBe(`${o.code} sevk edildi: 1 kalem, KDV dahil ₺2.200,00`);

  const other = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: other.id, productId: product.id, qtyMilli: 1000 });
  await cancelOrder(satisMudur, { orderId: other.id, reason: "Müşteri vazgeçti" });
  expect(await only(other.id, "cancel")).toBe(`${other.code} iptal edildi: Müşteri vazgeçti (1 kalem, KDV dahil ₺1.100,00)`);
});

test("sipariş: onayda açılan iş emri sayısı yazılır", async () => {
  const product = await addProduct(db, { code: "URN-0060", name: "Komodin", priceKurus: 100_000 });
  await addRouting(db, { productId: product.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 1000 });
  await confirmOrder(satis, o.id);
  expect(await only(o.id, "confirm")).toBe(`${o.code} onaylandı: 1 kalem, KDV dahil ₺1.100,00; 1 iş emri açıldı`);
});

test("müşteri: ekleme kartı, güncelleme yalnızca değişen alanları eski → yeni yazar", async () => {
  const c = await createCustomer(satis, {
    name: "Deneme Ltd.",
    kind: "kurumsal",
    city: "Ankara",
    district: "Çankaya",
    phone: "0 532 000 00 07",
    paymentTermDays: 30,
  });
  expect(await only(c.id, "create")).toBe(`${c.code} Deneme Ltd. eklendi: kurumsal, Ankara / Çankaya, 0 532 000 00 07, vade 30 gün`);

  await updateCustomer(satis, c.id, { phone: "0 532 000 00 17", city: "Ankara", paymentTermDays: 45 });
  expect(await only(c.id, "update")).toBe(`${c.code} güncellendi: telefon 0 532 000 00 07 → 0 532 000 00 17, vade 30 gün → 45 gün`);
});

test("müşteri: hiçbir alan değişmezse geçmişe yazılmaz", async () => {
  const c = await addCustomer(db, { phone: "0212 000 00 00" });
  await updateCustomer(satis, c.id, { phone: "0212 000 00 00" });
  expect(await summaries(c.id, "update")).toEqual([]);
});

test("malzeme: ekleme kategori ve birimi, güncelleme değişen alanları yazar; etkinlik etkin → pasif okunur", async () => {
  const m = await createMaterial(depo, { name: "Kontrplak 18 mm", category: "panel", unit: "plaka", reorderPointMilli: 10_000 });
  expect(await only(m.id, "create")).toBe(`${m.code} Kontrplak 18 mm eklendi: panel, plaka`);

  await updateMaterial(depo, m.id, { reorderPointMilli: 12_500, shelf: "A-12", active: false, name: "Kontrplak 18 mm" });
  expect(await only(m.id, "update")).toBe(
    `${m.code} güncellendi: yeniden sipariş noktası 10 plaka → 12,5 plaka, raf boş → A-12, durum etkin → pasif`,
  );
});

test("malzeme hareketi: girişte birim maliyet ve tutar, iş emri hareketinde iş emri kodu yazılır", async () => {
  const material = await addMaterial(db, { code: "MLZ-0007", unit: "plaka" });
  await receiveStock(depo, { materialId: material.id, qtyMilli: 10_000, unitCostKurus: 45_000 });
  expect(await only(material.id, "receipt")).toBe("MLZ-0007 giriş: 10 plaka × ₺450,00 (₺4.500,00)");
  await issueStock(depo, { materialId: material.id, qtyMilli: 2000 });
  expect(await only(material.id, "issue")).toBe("MLZ-0007 çıkış: 2 plaka");

  const product = await addProduct(db);
  await addRouting(db, { productId: product.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  await addBomLine(db, { productId: product.id, materialId: material.id, qtyMilli: 1000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await confirmOrder(satis, o.id);
  const [wo] = await db.select().from(workOrders);
  expect(await only(material.id, "reserve")).toBe(`MLZ-0007 ayırma: 2 plaka (${wo?.code})`);
});

test("sayım: açılış kalemleri, onay farkları, iptal sayılan kalemleri yazar", async () => {
  const a = await addMaterial(db, { code: "MLZ-0001", unit: "plaka", onHandMilli: 10_000 });
  const b = await addMaterial(db, { code: "MLZ-0002", unit: "adet", onHandMilli: 5000 });
  const count = await createCount(depo, { materialIds: [a.id, b.id] });
  expect(await only(count.id, "create")).toBe(`${count.code} açıldı: 2 kalem (MLZ-0001, MLZ-0002)`);

  await setCountLine(depo, { countId: count.id, materialId: a.id, countedMilli: 12_000 });
  await setCountLine(depo, { countId: count.id, materialId: b.id, countedMilli: 5000 });
  await approveCount(depoMudur, count.id);
  expect(await only(count.id, "approve")).toBe(`${count.code} onaylandı: 1 kalemde fark — MLZ-0001 +2 plaka`);
  expect(await only(a.id, "count_adjust")).toBe(`MLZ-0001 sayım farkı: +2 plaka (${count.code})`);

  const second = await createCount(depo, { materialIds: [a.id, b.id] });
  await setCountLine(depo, { countId: second.id, materialId: a.id, countedMilli: 12_000 });
  await cancelCount(depo, second.id);
  expect(await only(second.id, "cancel")).toBe(`${second.code} iptal edildi: 2 kalem, 1 sayıldı`);
});

test("sayım: satır ilk sayıldığında ve değiştiğinde işlem geçmişine yazılır; aynı değer yazılmaz", async () => {
  const a = await addMaterial(db, { code: "MLZ-0001", name: "MDF Lam", unit: "plaka", onHandMilli: 10_000 });
  const count = await createCount(depo, { materialIds: [a.id] });
  await setCountLine(depo, { countId: count.id, materialId: a.id, countedMilli: 12_000 });
  await setCountLine(depo, { countId: count.id, materialId: a.id, countedMilli: 12_000 });
  await setCountLine(depo, { countId: count.id, materialId: a.id, countedMilli: 10_000 });
  expect(await summaries(count.id, "count_line")).toEqual([
    `${count.code}: MLZ-0001 MDF Lam sayıldı: 12 plaka`,
    `${count.code}: MLZ-0001 MDF Lam sayılan 12 plaka → 10 plaka`,
  ]);
});

test("sayım: fark yoksa onay bunu söyler", async () => {
  const a = await addMaterial(db, { code: "MLZ-0001", unit: "plaka", onHandMilli: 10_000 });
  const count = await createCount(depo, { materialIds: [a.id] });
  await setCountLine(depo, { countId: count.id, materialId: a.id, countedMilli: 10_000 });
  await approveCount(depoMudur, count.id);
  expect(await only(count.id, "approve")).toBe(`${count.code} onaylandı: fark yok (1 kalem)`);
});

test("iş emri: açılış ürünü ve siparişi, atölye istasyonu, tamamlama mamul girişini, mamul hareketi belgeyi yazar", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık" });
  const station = await addStation(db, { name: "Kesim" });
  await addRouting(db, { productId: product.id, seq: 1, stationId: station.id, minutesPerUnit: 10 });
  const material = await addMaterial(db, { code: "MLZ-0009", unit: "plaka" });
  await addBomLine(db, { productId: product.id, materialId: material.id, qtyMilli: 1000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await confirmOrder(satis, o.id);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  expect(await only(wo.id, "create")).toBe(`${wo.code} açıldı: URN-0031 Adım Ayakkabılık × 2, ${o.code} için (malzeme bekliyor)`);

  await receiveStock(depo, { materialId: material.id, qtyMilli: 5000, unitCostKurus: 100 });
  await retryMaterials(planlama, wo.id);
  expect(await only(wo.id, "reserve_materials")).toBe(`${wo.code}: malzemeler ayrıldı — MLZ-0009 2 plaka`);

  await planWorkOrder(planlama, { workOrderId: wo.id, start: new Date("2026-11-16T09:00:00+03:00") });
  await planWorkOrder(planlama, { workOrderId: wo.id, start: new Date("2026-11-17T09:00:00+03:00") });
  expect(await summaries(wo.id, "plan")).toEqual([
    `${wo.code} planlandı: 16.11.2026 başlangıç, 1 adım`,
    `${wo.code} planlandı: 17.11.2026 başlangıç, 1 adım (önce 16.11.2026)`,
  ]);

  await startNextStep(atolye, wo.id);
  expect(await only(wo.id, "start")).toBe(`${wo.code} üretime başladı: 1 kalem malzeme tüketildi`);
  expect(await only(wo.id, "step_start")).toBe(`${wo.code} Kesim başladı`);
  await finishCurrentStep(atolye, wo.id);
  expect(await only(wo.id, "step_finish")).toBe(`${wo.code} Kesim bitti`);
  expect(await only(wo.id, "complete")).toBe(
    `${wo.code} tamamlandı: URN-0031 × 2 stoğa girdi; 2 adet ${o.code} satırına ayrıldı, satır hazır`,
  );
  expect(await only(product.id, "production_in")).toBe(`URN-0031 üretimden giriş: 2 adet (${wo.code})`);
  expect(await only(product.id, "reserve")).toBe(`URN-0031 ayırma: 2 adet (${wo.code})`);
});

test("iş emri iptali ürünü ve gerekçeyi yazar", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık" });
  await addRouting(db, { productId: product.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 1000 });
  await confirmOrder(satis, o.id);
  await cancelOrder(satisMudur, { orderId: o.id, reason: "Hata" });
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  expect(await only(wo.id, "cancel")).toBe(`${wo.code} iptal edildi (URN-0031 × 1): ${o.code} iptal edildi`);
});

test("mamul sevki sipariş kodunu yazar", async () => {
  const product = await addProduct(db, { code: "URN-0050", onHandMilli: 5000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: DUE });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 2000 });
  await confirmOrder(satis, o.id);
  await shipOrder(depo, o.id);
  expect(await only(product.id, "reserve")).toBe(`URN-0050 ayırma: 2 adet (${o.code})`);
  expect(await only(product.id, "ship")).toBe(`URN-0050 sevk: 2 adet (${o.code})`);
});

test("kullanıcı: ekleme departman ve düzeyi, güncelleme değişenleri yazar; parola hiçbir özete girmez", async () => {
  const password = "GizliParola123";
  const u = await createUser(bt, {
    name: "Yeni Kişi",
    email: "yeni.kisi@baltacioglus.example",
    password,
    departmentCode: "satis",
    level: "uzman",
    title: "Satış Uzmanı",
  });
  expect(await only(u.id, "create")).toBe("Yeni Kişi eklendi: Satış Uzmanı, Satış, Uzman");

  await updateUser(bt, u.id, { departmentCode: "depo", level: "mudur", title: "Satış Uzmanı" });
  expect(await only(u.id, "update")).toBe("Yeni Kişi güncellendi: departman Satış → Depo ve Sevkiyat, düzey Uzman → Departman müdürü");

  await setUserActive(bt, u.id, false);
  expect(await only(u.id, "deactivate")).toBe("Yeni Kişi pasife alındı");
  await resetPassword(bt, u.id, "YeniParola456");
  expect(await only(u.id, "reset_password")).toBe("Yeni Kişi parolası sıfırlandı");

  const all = (await db.select().from(auditLog)).map((r) => r.summary).join("\n");
  expect(all).not.toContain(password);
  expect(all).not.toContain("YeniParola456");
  expect(all).not.toMatch(/scrypt|pbkdf2|\$argon|hash|salt/i);
});
