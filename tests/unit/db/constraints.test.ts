import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { departments, materials, users } from "@/db/schema";
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
