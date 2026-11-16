import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  customers,
  departments,
  materials,
  products,
  salesOrderLines,
  salesOrders,
  stations,
  users,
  workOrderSteps,
  workOrders,
} from "@/db/schema";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
const material = (over: Partial<typeof materials.$inferInsert> = {}) => ({
  code: "MLZ-0001",
  name: "MDF 18 mm",
  category: "panel",
  unit: "plaka",
  ...over,
});
const user = (over: Partial<typeof users.$inferInsert> = {}) => ({
  name: "Onur Tekin",
  email: "onur.tekin@baltacioglus.example",
  passwordHash: "x",
  departmentCode: "depo",
  level: "uzman",
  title: "Depo Uzmanı",
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(departments).values({ code: "depo", name: "Depo ve Sevkiyat" });
});

test("geçerli malzeme ve kullanıcı eklenir, varsayılanlar dolar", async () => {
  const [m] = await db.insert(materials).values(material()).returning();
  expect(m).toMatchObject({ onHandMilli: 0, reservedMilli: 0, avgCostKurus: 0, active: true });
  expect(m?.id).toMatch(/^[0-9a-f-]{36}$/);
  const [u] = await db.insert(users).values(user()).returning();
  expect(u?.active).toBe(true);
});

test("eldeki stok negatif olamaz", async () => {
  await expect(db.insert(materials).values(material({ onHandMilli: -1 }))).rejects.toThrow();
});

test("ayrılmış stok eldekini aşamaz", async () => {
  await expect(db.insert(materials).values(material({ onHandMilli: 5, reservedMilli: 6 }))).rejects.toThrow();
});

test("aynı kodla ikinci malzeme eklenemez", async () => {
  await db.insert(materials).values(material());
  await expect(db.insert(materials).values(material({ name: "Başka" }))).rejects.toThrow();
});

test("geçersiz kategori ve birim reddedilir", async () => {
  await expect(db.insert(materials).values(material({ category: "mobilya" }))).rejects.toThrow();
  await expect(db.insert(materials).values(material({ unit: "koli" }))).rejects.toThrow();
});

test("aynı e-postayla ikinci kullanıcı eklenemez", async () => {
  await db.insert(users).values(user());
  await expect(db.insert(users).values(user({ name: "Başka" }))).rejects.toThrow();
});

test("olmayan departmana kullanıcı eklenemez", async () => {
  await expect(db.insert(users).values(user({ departmentCode: "pazarlama" }))).rejects.toThrow();
});

test("geçersiz yetki düzeyi reddedilir", async () => {
  await expect(db.insert(users).values(user({ level: "stajyer" }))).rejects.toThrow();
});

const product = (over: Partial<typeof products.$inferInsert> = {}) => ({
  code: "URN-0001",
  modelKey: "dolap-120",
  name: "Dolap 120",
  collection: "Nova",
  category: "dolap",
  widthMm: 1200,
  depthMm: 500,
  heightMm: 2000,
  finish: "beyaz",
  priceKurus: 1_000_000,
  vatRate: 10,
  ...over,
});

async function orderLineContext() {
  const [u] = await db.insert(users).values(user()).returning();
  const [c] = await db
    .insert(customers)
    .values({ code: "MUS-0001", name: "Deneme Ltd.", kind: "kurumsal", city: "Ankara", district: "Çankaya", phone: "0312" })
    .returning();
  const [o] = await db
    .insert(salesOrders)
    .values({ code: "SIP-2026-0001", customerId: c!.id, status: "draft", createdBy: u!.id })
    .returning();
  const [p] = await db.insert(products).values(product()).returning();
  return { u: u!, o: o!, p: p! };
}

test("mamulde ayrılmış eldekini aşamaz", async () => {
  await expect(db.insert(products).values(product({ onHandMilli: 1000, reservedMilli: 2000 }))).rejects.toThrow();
});

test("sipariş satırı adedi tam adet olmalı", async () => {
  const { o, p } = await orderLineContext();
  const line = (qtyMilli: number) => ({ orderId: o.id, productId: p.id, qtyMilli, unitPriceKurus: 100, vatRate: 10, status: "draft" });
  await expect(db.insert(salesOrderLines).values(line(1500))).rejects.toThrow();
  await expect(db.insert(salesOrderLines).values(line(0))).rejects.toThrow();
  await expect(db.insert(salesOrderLines).values(line(2000))).resolves.toBeDefined();
});

test("iskonto binde 500'ü aşamaz", async () => {
  const { o, p } = await orderLineContext();
  const line = (discountPermille: number) => ({
    orderId: o.id,
    productId: p.id,
    qtyMilli: 1000,
    unitPriceKurus: 100,
    vatRate: 10,
    status: "draft",
    discountPermille,
  });
  await expect(db.insert(salesOrderLines).values(line(501))).rejects.toThrow();
  await expect(db.insert(salesOrderLines).values(line(500))).resolves.toBeDefined();
});

test("ürün KDV oranı 10 ya da 20 olabilir", async () => {
  await expect(db.insert(products).values(product({ vatRate: 18 }))).rejects.toThrow();
  await expect(db.insert(products).values(product({ vatRate: 20 }))).resolves.toBeDefined();
});

test("aynı model ve kaplama iki kez eklenemez", async () => {
  await db.insert(products).values(product());
  await expect(db.insert(products).values(product({ code: "URN-0002" }))).rejects.toThrow();
  await expect(db.insert(products).values(product({ code: "URN-0003", finish: "ahsap" }))).resolves.toBeDefined();
});

test("bitmiş adımın başlangıcı boş olamaz", async () => {
  const { u, p } = await orderLineContext();
  const [st] = await db.insert(stations).values({ code: "KES", name: "Kesim", seq: 1, dailyCapacityMin: 480 }).returning();
  const [wo] = await db
    .insert(workOrders)
    .values({ code: "IE-2026-0001", productId: p.id, qtyMilli: 1000, status: "planned", createdBy: u.id })
    .returning();
  const step = (over: Partial<typeof workOrderSteps.$inferInsert>) => ({
    workOrderId: wo!.id,
    seq: 1,
    stationId: st!.id,
    minutes: 30,
    ...over,
  });
  await expect(db.insert(workOrderSteps).values(step({ finishedAt: new Date() }))).rejects.toThrow();
  await expect(db.insert(workOrderSteps).values(step({ startedAt: new Date(), finishedAt: new Date() }))).resolves.toBeDefined();
});
