import { and, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, salesOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { addLine, confirmOrder, createOrder, updateOrderDue } from "@/domain/sales/orders";
import { addCustomer, addProduct, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let customerId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);
const dueLogs = () => db.select().from(auditLog).where(eq(auditLog.action, "update_due"));

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  customerId = (await addCustomer(db)).id;
});

test("updateOrderDue yalnızca taslakta; geçmişe eski → yeni yazılır", async () => {
  const o = await createOrder(satis, { customerId, dueAt: day("2026-12-02") });
  const updated = await updateOrderDue(satis, { orderId: o.id, dueAt: new Date("2026-12-03T14:00:00+03:00") });
  expect(updated.dueAt).toEqual(day("2026-12-03"));
  const [row] = await db.select().from(salesOrders).where(eq(salesOrders.id, o.id));
  expect(row?.dueAt).toEqual(day("2026-12-03"));
  const logs = await dueLogs();
  expect(logs.map((l) => [l.entity, l.entityId, l.userId, l.summary])).toEqual([
    ["sales_order", o.id, satis.user.id, `${o.code}: termin 02.12.2026 → 03.12.2026`],
  ]);

  // Aynı gün: hiçbir şey yazılmaz.
  await updateOrderDue(satis, { orderId: o.id, dueAt: day("2026-12-03") });
  expect(await dueLogs()).toHaveLength(1);

  // Onaylı sipariş: INVALID_STATE, termin değişmez.
  const p = await addProduct(db, { onHandMilli: 5000 });
  await addLine(satis, { orderId: o.id, productId: p.id, qtyMilli: 1000 });
  await confirmOrder(satis, o.id);
  await expect(updateOrderDue(satis, { orderId: o.id, dueAt: day("2026-12-10") })).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect((await db.select().from(salesOrders).where(eq(salesOrders.id, o.id)))[0]?.dueAt).toEqual(day("2026-12-03"));
  expect(await dueLogs()).toHaveLength(1);
});

test("geçmiş gün ve geçersiz tarih VALIDATION; bugün kabul edilir", async () => {
  const o = await createOrder(satis, { customerId, dueAt: day("2026-12-02") });
  await expect(updateOrderDue(satis, { orderId: o.id, dueAt: new Date("2026-11-14T23:59:00+03:00") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Termin geçmiş bir gün olamaz",
  });
  await expect(updateOrderDue(satis, { orderId: o.id, dueAt: new Date("geçersiz") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Termin geçersiz",
  });
  await updateOrderDue(satis, { orderId: o.id, dueAt: day("2026-11-15") });
  expect(await dueLogs()).toHaveLength(1);
});

test("satış yetkisi olmayan değiştiremez; bilinmeyen sipariş NOT_FOUND", async () => {
  const o = await createOrder(satis, { customerId, dueAt: day("2026-12-02") });
  const planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  await expect(updateOrderDue(planlama, { orderId: o.id, dueAt: day("2026-12-05") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(updateOrderDue(satis, { orderId: "yok", dueAt: day("2026-12-05") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "update_due"), eq(auditLog.entityId, o.id)))).toHaveLength(0);
});
