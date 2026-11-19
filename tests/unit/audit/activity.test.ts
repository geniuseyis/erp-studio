import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, MOVEMENT_TYPES, PRODUCT_MOVEMENT_TYPES, purchaseOrders, salesOrders, stockCounts, workOrders } from "@/db/schema";
import { logAudit } from "@/domain/audit";
import { activityStats, listActivity } from "@/domain/audit-queries";
import type { SessionUser } from "@/domain/context";
import { searchKey } from "@/domain/text";
import { exportSnapshot, loadSnapshot } from "@/seed/snapshot";
import { actionLabel, ACTION_LABEL, ENTITY_LABEL } from "@/features/activity/labels";
import { addCustomer, addMaterial, addProduct, addSupplier, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let ayse: SessionUser;
let onur: SessionUser;
let bt: SessionUser;

const at = (iso: string) => new Date(`${iso}+03:00`);

async function log(user: SessionUser, entity: string, entityId: string, summary: string, createdAt: Date, action = "update") {
  await logAudit(ctxFor(db, user, createdAt), { entity, entityId, action, summary });
}

/** Doğrudan toplu ekleme: arama anahtarı logAudit'in yazdığıyla aynı biçimde elle doldurulur. */
const bulkRow = (user: SessionUser, entity: string, entityId: string, action: string, summary: string, createdAt: Date) => ({
  entity,
  entityId,
  action,
  summary,
  searchKey: searchKey(`${summary} ${user.name}`),
  userId: user.id,
  createdAt,
});

beforeEach(async () => {
  db = await createTestDb();
  ayse = await addUser(db, "satis", "uzman", { name: "Ayşe Demir", email: "ayse@baltacioglus.example" });
  onur = await addUser(db, "depo", "uzman", { name: "Onur Tekin", email: "onur@baltacioglus.example" });
  bt = await addUser(db, "bt", "uzman", { name: "Deniz Aydemir", email: "deniz@baltacioglus.example" });
});

test("listActivity bütün kayıtları yeniden eskiye verir; aynı anda yazılanlar yazılış sırasının tersiyle", async () => {
  await log(ayse, "customer", "a", "ilk", at("2026-11-15T09:00:00"));
  await log(onur, "material", "b", "ikinci", at("2026-11-15T10:00:00"));
  await log(ayse, "customer", "a", "aynı an 1", at("2026-11-15T11:00:00"));
  await log(ayse, "customer", "a", "aynı an 2", at("2026-11-15T11:00:00"));

  const rows = await listActivity(db, bt);
  expect(rows.map((r) => r.summary)).toEqual(["aynı an 2", "aynı an 1", "ikinci", "ilk"]);
  expect(rows[2]).toMatchObject({ entity: "material", entityId: "b", userName: "Onur Tekin", departmentName: "Depo ve Sevkiyat", action: "update" });
});

test("süzgeçler: kayıt türü, departman, kişi ve tarih aralığı (bitiş hariç)", async () => {
  await log(ayse, "customer", "a", "müşteri, ayşe, 14", at("2026-11-14T23:30:00"));
  await log(ayse, "sales_order", "s", "sipariş, ayşe, 15", at("2026-11-15T09:00:00"));
  await log(onur, "material", "m", "malzeme, onur, 15", at("2026-11-15T12:00:00"));
  await log(onur, "material", "m", "malzeme, onur, 16", at("2026-11-16T00:00:00"));

  const summaries = async (f: Parameters<typeof listActivity>[2]) => (await listActivity(db, bt, f)).map((r) => r.summary);
  expect(await summaries({ entity: "material" })).toEqual(["malzeme, onur, 16", "malzeme, onur, 15"]);
  expect(await summaries({ departmentCode: "satis" })).toEqual(["sipariş, ayşe, 15", "müşteri, ayşe, 14"]);
  expect(await summaries({ userId: onur.id })).toEqual(["malzeme, onur, 16", "malzeme, onur, 15"]);
  expect(await summaries({ from: at("2026-11-15T00:00:00"), to: at("2026-11-16T00:00:00") })).toEqual(["malzeme, onur, 15", "sipariş, ayşe, 15"]);
  expect(await summaries({ entity: "material", departmentCode: "satis" })).toEqual([]);
  expect(await summaries({ userId: "geçersiz" })).toEqual([]);
});

test("varsayılan sınır 500; sınır verilebilir", async () => {
  const base = at("2026-11-15T09:00:00").getTime();
  await db.insert(auditLog).values(
    Array.from({ length: 503 }, (_, i) => bulkRow(ayse, "customer", "a", "update", `kayıt ${i}`, new Date(base + i * 1000))),
  );
  const rows = await listActivity(db, bt);
  expect(rows).toHaveLength(500);
  expect(rows[0]?.summary).toBe("kayıt 502");
  expect((await listActivity(db, bt, { limit: 2 })).map((r) => r.summary)).toEqual(["kayıt 502", "kayıt 501"]);
});

test("metin araması özet, kayıt etiketi ve kişi adında Türkçe harf duyarsız arar; sınırdan önce uygulanır", async () => {
  const customer = await addCustomer(db, { code: "MUS-0042", name: "Kuzey Mobilya" });
  await log(ayse, "sales_order", "s", "SIP-2026-0001: satır silindi — URN-0031 Adım Ayakkabılık × 2", at("2026-11-10T09:00:00"), "remove_line");
  await log(ayse, "customer", customer.id, "MUS-0042 güncellendi: telefon boş → 0212", at("2026-11-11T09:00:00"));
  const base = at("2026-11-12T09:00:00").getTime();
  await db.insert(auditLog).values(
    Array.from({ length: 10 }, (_, i) => bulkRow(onur, "material", "m", "receipt", `MLZ-0001 giriş ${i}`, new Date(base + i * 1000))),
  );

  expect((await listActivity(db, bt, { search: "SATIR SILINDI", limit: 3 })).map((r) => r.summary)).toEqual([
    "SIP-2026-0001: satır silindi — URN-0031 Adım Ayakkabılık × 2",
  ]);
  // Müşterinin adı özette yok; kayıt adı arama anahtarına yazıldığı için bulunur.
  expect((await listActivity(db, bt, { search: "kuzey" })).map((r) => r.entityId)).toEqual([customer.id]);
  expect(await listActivity(db, bt, { search: "ayse demir" })).toHaveLength(2);
  expect(await listActivity(db, bt, { search: "onur", limit: 4 })).toHaveLength(4);
  expect(await listActivity(db, bt, { search: "   " })).toHaveLength(12);
});

test("kayıt etiketi ve bağlantısı her tür için çözülür; silinmiş kayıt özetteki koda ya da 'silinmiş kayıt'a düşer", async () => {
  const customer = await addCustomer(db, { code: "MUS-0042", name: "Kuzey Mobilya" });
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık" });
  const material = await addMaterial(db, { code: "MLZ-0007", name: "Meşe Masif" });
  const [order] = await db
    .insert(salesOrders)
    .values({ code: "SIP-2026-0009", customerId: customer.id, dueAt: at("2026-12-01T12:00:00"), createdBy: ayse.id })
    .returning();
  const [wo] = await db
    .insert(workOrders)
    .values({ code: "IE-2026-0004", productId: product.id, qtyMilli: 1000, createdBy: ayse.id })
    .returning();
  const [count] = await db.insert(stockCounts).values({ code: "SAY-2026-0002", createdBy: onur.id }).returning();
  const supplier = await addSupplier(db, { code: "TED-0003", name: "Sapanca Yonga" });
  const [po] = await db.insert(purchaseOrders).values({ code: "SAS-2026-0005", supplierId: supplier.id, createdBy: onur.id }).returning();
  if (!order || !wo || !count || !po) throw new Error("kayıt eklenemedi");

  const t = at("2026-11-15T09:00:00");
  await log(onur, "supplier", supplier.id, "x", t);
  await log(onur, "purchase_order", po.id, "x", t);
  await log(ayse, "sales_order", order.id, "x", t);
  await log(ayse, "customer", customer.id, "x", t);
  await log(ayse, "work_order", wo.id, "x", t);
  await log(ayse, "product", product.id, "x", t);
  await log(onur, "material", material.id, "x", t);
  await log(onur, "stock_count", count.id, "x", t);
  await log(ayse, "user", onur.id, "x", t);
  const gone = randomUUID();
  await log(ayse, "sales_order", gone, "SIP-2026-0077: satır silindi — URN-0001 Raf × 1", t);
  await log(ayse, "user", randomUUID(), "Eski Çalışan güncellendi: unvan", t);
  await log(ayse, "work_order", "uuid-değil", "IE-2026-0099 iptal edildi", t);
  await log(ayse, "settings", "x", "bilinmeyen tür", t);

  const rows = await listActivity(db, bt);
  const byId = new Map(rows.map((r) => [`${r.entity}:${r.entityId}`, r]));
  const pick = (entity: string, id: string) => {
    const r = byId.get(`${entity}:${id}`);
    return { label: r?.recordLabel, href: r?.recordHref };
  };
  expect(pick("sales_order", order.id)).toEqual({ label: "SIP-2026-0009", href: `/satis/siparisler?ac=${order.id}` });
  expect(pick("customer", customer.id)).toEqual({ label: "MUS-0042 Kuzey Mobilya", href: `/satis/musteriler?ac=${customer.id}` });
  expect(pick("work_order", wo.id)).toEqual({ label: "IE-2026-0004", href: `/uretim/is-emirleri?ac=${wo.id}` });
  expect(pick("product", product.id)).toEqual({ label: "URN-0031 Adım Ayakkabılık", href: `/uretim/urunler?ac=${product.id}` });
  expect(pick("material", material.id)).toEqual({ label: "MLZ-0007 Meşe Masif", href: `/stok/malzemeler?ac=${material.id}` });
  expect(pick("stock_count", count.id)).toEqual({ label: "SAY-2026-0002", href: `/stok/sayim?fis=${count.id}` });
  expect(pick("user", onur.id)).toEqual({ label: "Onur Tekin", href: `/yonetim/kullanicilar?q=${encodeURIComponent("Onur Tekin")}` });
  expect(pick("supplier", supplier.id)).toEqual({ label: "TED-0003 Sapanca Yonga", href: `/satin-alma/tedarikciler?ac=${supplier.id}` });
  expect(pick("purchase_order", po.id)).toEqual({ label: "SAS-2026-0005", href: `/satin-alma/siparisler?ac=${po.id}` });
  expect(pick("sales_order", gone)).toEqual({ label: "SIP-2026-0077", href: null });
  expect(rows.find((r) => r.summary.startsWith("Eski Çalışan"))).toMatchObject({ recordLabel: "silinmiş kayıt", recordHref: null });
  expect(pick("work_order", "uuid-değil")).toEqual({ label: "IE-2026-0099", href: null });
  expect(pick("settings", "x")).toEqual({ label: null, href: null });
});

test("tedarikçi ve satın alma kayıtları kod ve tedarikçi adıyla aranır", async () => {
  const supplier = await addSupplier(db, { code: "TED-0003", name: "Sapanca Yonga" });
  const [po] = await db.insert(purchaseOrders).values({ code: "SAS-2026-0005", supplierId: supplier.id, createdBy: onur.id }).returning();
  const t = at("2026-11-15T09:00:00");
  await log(onur, "supplier", supplier.id, "kart işlemi", t);
  await log(onur, "purchase_order", po?.id ?? "", "sipariş işlemi", t);
  expect((await listActivity(db, bt, { search: "sapanca" })).map((r) => r.entity).sort()).toEqual(["purchase_order", "supplier"]);
  expect((await listActivity(db, bt, { search: "SAS-2026-0005" })).map((r) => r.entity)).toEqual(["purchase_order"]);
  expect((await listActivity(db, bt, { search: "TED-0003" })).map((r) => r.entity)).toEqual(["supplier"]);
});

test("kayıt etiketleri satır başına sorguyla değil, tür başına toplu okunur", async () => {
  const customers = await Promise.all(Array.from({ length: 12 }, (_, i) => addCustomer(db, { code: `MUS-${String(i + 1).padStart(4, "0")}`, name: `Firma ${i}` })));
  const materials = await Promise.all(Array.from({ length: 12 }, () => addMaterial(db)));
  const t = at("2026-11-15T09:00:00");

  async function selectsFor(n: number): Promise<number> {
    await db.delete(auditLog);
    for (let i = 0; i < n; i += 1) {
      await log(ayse, "customer", customers[i]?.id ?? "", "x", t);
      await log(onur, "material", materials[i]?.id ?? "", "x", t);
    }
    const spy = vi.spyOn(db, "select");
    try {
      const rows = await listActivity(db, bt);
      expect(rows).toHaveLength(n * 2);
      expect(rows.every((r) => r.recordHref !== null)).toBe(true);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  const few = await selectsFor(2);
  const many = await selectsFor(12);
  expect(many).toBe(few);
  expect(many).toBeLessThanOrEqual(3);
});

test("activityStats: bugün, son 7 gün ve bu hafta (pazartesi–pazar, İstanbul) en çok işlem yapan departman", async () => {
  const now = at("2026-11-18T15:00:00"); // çarşamba
  await log(ayse, "customer", "a", "bugün", at("2026-11-18T00:10:00"));
  await log(onur, "material", "m", "bugün", at("2026-11-18T14:00:00"));
  await log(ayse, "customer", "a", "dün gece", at("2026-11-17T23:59:00"));
  await log(onur, "material", "m", "pazartesi", at("2026-11-16T00:00:00"));
  await log(onur, "material", "m", "pazartesi", at("2026-11-16T08:00:00"));
  // Geçen pazar: son 7 günde var, bu haftada yok.
  await log(ayse, "customer", "a", "pazar", at("2026-11-15T23:00:00"));
  await log(ayse, "customer", "a", "pazar", at("2026-11-15T22:00:00"));
  await log(ayse, "customer", "a", "pazar", at("2026-11-15T21:00:00"));
  await log(ayse, "customer", "a", "8 gün önce", at("2026-11-11T23:00:00"));
  await log(ayse, "customer", "a", "7 gün önce", at("2026-11-12T00:00:00"));

  const s = await activityStats(db, bt, now);
  expect(s.today).toBe(2);
  expect(s.last7Days).toBe(9);
  expect(s.topDepartment).toEqual({ code: "depo", name: "Depo ve Sevkiyat", count: 3 });

  await db.delete(auditLog);
  expect(await activityStats(db, bt, now)).toEqual({ today: 0, last7Days: 0, topDepartment: null });
});

test("kullanıcı kayıtları yalnızca Kullanıcılar modülünü görenlere gelir; sayılar ve sınır dışlamadan sonra hesaplanır", async () => {
  const t = at("2026-11-18T09:00:00");
  await log(bt, "user", onur.id, "Onur Tekin pasife alındı", t, "deactivate");
  await log(bt, "user", ayse.id, "Ayşe Demir eklendi: Uzman", t, "create");
  await log(ayse, "customer", "a", "müşteri", at("2026-11-18T08:00:00"));
  const now = at("2026-11-18T15:00:00");

  for (const viewer of [ayse, onur]) {
    expect((await listActivity(db, viewer)).map((r) => r.summary)).toEqual(["müşteri"]);
    expect(await listActivity(db, viewer, { entity: "user" })).toEqual([]);
    expect(await listActivity(db, viewer, { limit: 1 })).toHaveLength(1);
    expect(await activityStats(db, viewer, now)).toMatchObject({ today: 1, last7Days: 1, topDepartment: { code: "satis", count: 1 } });
  }
  expect((await listActivity(db, bt)).map((r) => r.summary)).toEqual(["Ayşe Demir eklendi: Uzman", "Onur Tekin pasife alındı", "müşteri"]);
  expect(await activityStats(db, bt, now)).toMatchObject({ today: 3, last7Days: 3, topDepartment: { code: "bt", count: 2 } });
  const yonetim = await addUser(db, "yonetim", "mudur", { name: "Nermin Aksoy", email: "nermin@baltacioglus.example" });
  expect(await listActivity(db, yonetim, { entity: "user" })).toHaveLength(2);
});

test("arama SQL'de: 15.000 kayıtta 'satır silindi' 100 ms altında ve doğru sayıda", async () => {
  const base = at("2026-11-01T09:00:00").getTime();
  const rows = Array.from({ length: 15_000 }, (_, i) =>
    bulkRow(
      i % 2 === 0 ? ayse : onur,
      "sales_order",
      "s",
      "update",
      i % 50 === 0 ? `SIP-2026-${i}: satır silindi — URN-0031 Adım Ayakkabılık × 1` : `SIP-2026-${i}: satır güncellendi — URN-${i}`,
      new Date(base + i * 1000),
    ),
  );
  for (let i = 0; i < rows.length; i += 2000) await db.insert(auditLog).values(rows.slice(i, i + 2000));

  await listActivity(db, bt, { search: "satır silindi", limit: 20_000 });
  const started = performance.now();
  const found = await listActivity(db, bt, { search: "satır silindi", limit: 20_000 });
  const elapsed = performance.now() - started;
  expect(found).toHaveLength(300);
  expect(elapsed).toBeLessThan(100);
});

test.each(["URN-0031", "urn-0031", "ADIM", "adım"])("arama %s silinen satırı bulur", async (query) => {
  await log(ayse, "sales_order", "s", "SIP-2026-0001: satır silindi — URN-0031 Adım Ayakkabılık × 2", at("2026-11-10T09:00:00"), "remove_line");
  await log(ayse, "sales_order", "s", "SIP-2026-0001: satır eklendi — URN-0044 Raf × 1", at("2026-11-10T10:00:00"), "add_line");
  const rows = await listActivity(db, bt, { search: query });
  expect(rows.map((r) => r.summary)).toEqual(["SIP-2026-0001: satır silindi — URN-0031 Adım Ayakkabılık × 2"]);
});

test("aramada limit SQL'de uygulanır: limit 3 en yeni 3 eşleşmeyi döner", async () => {
  const base = at("2026-11-12T09:00:00").getTime();
  const rows = Array.from({ length: 40 }, (_, i) => bulkRow(onur, "material", "m", "receipt", i % 2 === 0 ? `MLZ-0001 giriş ${i}` : `MLZ-0002 çıkış ${i}`, new Date(base + i * 1000)));
  await db.insert(auditLog).values(rows);
  const found = await listActivity(db, bt, { search: "giriş", limit: 3 });
  expect(found.map((r) => r.summary)).toEqual(["MLZ-0001 giriş 38", "MLZ-0001 giriş 36", "MLZ-0001 giriş 34"]);
});

/** Kayıt adıyla aranabilen satırlar: özet adı içermez; ad kayıttan çözülür. */
async function seedNamedRows() {
  const customer = await addCustomer(db, { code: "MUS-0042", name: "Kuzey Mobilya" });
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık" });
  const material = await addMaterial(db, { code: "MLZ-0007", name: "Lacivert Kum" });
  const [order] = await db.insert(salesOrders).values({ code: "SIP-2026-0009", customerId: customer.id, dueAt: at("2026-12-01T12:00:00"), createdBy: ayse.id }).returning();
  const [wo] = await db.insert(workOrders).values({ code: "IE-2026-0004", productId: product.id, qtyMilli: 1000, createdBy: ayse.id }).returning();
  const [count] = await db.insert(stockCounts).values({ code: "SAY-2026-0002", createdBy: onur.id }).returning();
  if (!order || !wo || !count) throw new Error("kayıt eklenemedi");
  const t = at("2026-11-15T09:00:00");
  await log(ayse, "sales_order", order.id, "SIP-2026-0009 sevk edildi: 2 kalem", t, "ship");
  await log(ayse, "work_order", wo.id, "IE-2026-0004 Kesim başladı", t, "step_start");
  await log(onur, "product", product.id, "URN-0031 üretimden giriş: 3 adet", t, "production_in");
  await log(onur, "material", material.id, "MLZ-0007 Stok girişi: 5 kg", t, "receipt");
  await log(onur, "stock_count", count.id, "SAY-2026-0002 iptal edildi: 4 kalem", t, "cancel");
  await log(ayse, "customer", customer.id, "MUS-0042 güncellendi: telefon boş → 0212", t);
  return { order, wo, product, material, count, customer };
}

async function expectNamedSearches() {
  const entities = async (search: string) => (await listActivity(db, bt, { search })).map((r) => r.entity).sort();
  expect(await entities("Adım Ayakkabılık")).toEqual(["product", "work_order"]);
  expect(await entities("adim ayakkabilik")).toEqual(["product", "work_order"]);
  expect(await entities("kuzey mobilya")).toEqual(["customer", "sales_order"]);
  expect(await entities("lacivert kum")).toEqual(["material"]);
  expect(await entities("SAY-2026-0002")).toEqual(["stock_count"]);
}

test("kayıt adıyla arama: ürün adı ürün defteri ve iş emri adımını, müşteri adı siparişin sevk satırını bulur", async () => {
  await seedNamedRows();
  await expectNamedSearches();
});

test("anlık görüntüden yüklenen veritabanında da kayıt adıyla arama aynı sonucu verir", async () => {
  await seedNamedRows();
  const copy = await createTestDb({ fresh: true });
  const now = new Date("2026-11-15T09:00:00+03:00");
  await loadSnapshot(copy, await exportSnapshot(db, now), now);
  db = copy;
  await expectNamedSearches();
});

test("arama joker karakterleri düz metin sayılır; kullanıcı kayıtları aramada da gizli kalır", async () => {
  await log(ayse, "customer", "a", "yüzde %50 indirim", at("2026-11-10T09:00:00"));
  await log(ayse, "customer", "a", "yüzde 50 indirim", at("2026-11-10T10:00:00"));
  await log(ayse, "customer", "a", "alt_çizgi kodu", at("2026-11-10T11:00:00"));
  await log(ayse, "customer", "a", "altXçizgi kodu", at("2026-11-10T12:00:00"));
  expect((await listActivity(db, bt, { search: "%50" })).map((r) => r.summary)).toEqual(["yüzde %50 indirim"]);
  expect((await listActivity(db, bt, { search: "alt_cizgi" })).map((r) => r.summary)).toEqual(["alt_çizgi kodu"]);
  expect(await listActivity(db, bt, { search: "\\" })).toEqual([]);
  await log(bt, "user", onur.id, "Onur Tekin pasife alındı", at("2026-11-10T13:00:00"), "deactivate");
  expect(await listActivity(db, ayse, { search: "Onur Tekin" })).toEqual([]);
  expect(await listActivity(db, bt, { search: "Onur Tekin" })).toHaveLength(1);
});

/** src/domain altındaki bütün logAudit çağrılarının işlem kodları (kaynaktan okunur). */
function domainActionCodes(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts")) files.push(path);
    }
  };
  walk(join(process.cwd(), "src", "domain"));

  const codes = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const call of text.split("logAudit(tx,").slice(1)) {
      const action = /action:\s*([^,\n}]+)/.exec(call)?.[1]?.trim();
      if (!action) throw new Error(`${file}: işlem kodu okunamadı`);
      if (action === "p.type") {
        const types: readonly string[] = file.includes("productLedger") ? PRODUCT_MOVEMENT_TYPES : MOVEMENT_TYPES;
        for (const t of types) codes.add(t);
        continue;
      }
      const literals = [...action.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] ?? "");
      if (literals.length === 0) throw new Error(`${file}: bilinmeyen işlem ifadesi ${action}`);
      for (const l of literals) codes.add(l);
    }
  }
  return codes;
}

test("koddaki her işlem kodunun Türkçe etiketi var; bilinmeyen kod olduğu gibi gösterilir", () => {
  const codes = domainActionCodes();
  for (const expected of ["set_item", "remove_item", "submit", "send", "receive", "create", "remove_line", "confirm", "ship", "step_start", "receipt", "production_in", "activate", "deactivate", "reset_password"]) {
    expect(codes).toContain(expected);
  }
  const missing = [...codes].filter((c) => !(c in ACTION_LABEL));
  expect(missing).toEqual([]);
  expect(actionLabel("remove_line")).toBe("Satır silindi");
  expect(actionLabel("receipt")).toBe("Stok girişi");
  expect(actionLabel("garip_kod")).toBe("garip_kod");
  expect(Object.keys(ENTITY_LABEL)).toEqual(["sales_order", "customer", "work_order", "product", "material", "purchase_order", "supplier", "stock_count", "user"]);
});
