import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { createCustomer, updateCustomer } from "@/domain/sales/customers";
import { addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;

const valid = { name: "Örnek Mobilya Ltd.", kind: "kurumsal" as const, city: "Ankara", district: "Çankaya", phone: "+90 312 555 00 00", paymentTermDays: 30 };

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
});

test("müşteri MUS-0001 koduyla eklenir; sıradaki MUS-0002 olur", async () => {
  const a = await createCustomer(satis, valid);
  const b = await createCustomer(satis, { ...valid, name: "İkinci" });
  expect(a.code).toBe("MUS-0001");
  expect(b.code).toBe("MUS-0002");
  expect(a).toMatchObject({ name: "Örnek Mobilya Ltd.", kind: "kurumsal", paymentTermDays: 30 });
  expect((await db.select().from(auditLog)).some((r) => r.entity === "customer" && r.action === "create")).toBe(true);
});

test("boş ad reddedilir", async () => {
  await expect(createCustomer(satis, { ...valid, name: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
});

test.each(["abc", "12345", "0212-555-00-00", "+90 312 555 00 00 00 00", ""])("geçersiz telefon %j reddedilir", async (phone) => {
  await expect(createCustomer(satis, { ...valid, phone })).rejects.toMatchObject({ code: "VALIDATION" });
});

test.each(["0212 555 00 00", "+905321234567"])("geçerli telefon %j kabul edilir", async (phone) => {
  expect((await createCustomer(satis, { ...valid, phone })).phone).toBe(phone);
});

test("geçersiz tür ve negatif vade reddedilir", async () => {
  await expect(createCustomer(satis, { ...valid, kind: "x" as never })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(createCustomer(satis, { ...valid, paymentTermDays: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
});

test("depo kullanıcısı müşteri ekleyemez: FORBIDDEN", async () => {
  const depo = ctxFor(db, await addUser(db, "depo", "mudur"));
  await expect(createCustomer(depo, valid)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("müşteri güncellenir; bilinmeyen müşteri NOT_FOUND", async () => {
  const c = await createCustomer(satis, valid);
  await updateCustomer(satis, c.id, { city: "İzmir", phone: "0232 111 22 33" });
  const { customers } = await import("@/db/schema");
  const [row] = await db.select().from(customers);
  expect(row).toMatchObject({ city: "İzmir", phone: "0232 111 22 33", name: valid.name });
  await expect(updateCustomer(satis, c.id, { phone: "12" })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updateCustomer(satis, "00000000-0000-4000-8000-000000000000", { city: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
