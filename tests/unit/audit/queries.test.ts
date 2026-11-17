import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, workOrders } from "@/db/schema";
import { listHistory, listOrderHistory, listWorkOrderHistory } from "@/domain/audit-queries";
import type { Ctx } from "@/domain/context";
import { startNextStep } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder, removeLine } from "@/domain/sales/orders";
import { addCustomer, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let userId: string;

const at = (hhmm: string) => new Date(`2026-11-15T${hhmm}:00+03:00`);

async function log(entity: string, entityId: string, summary: string, createdAt: Date, action = "update") {
  await db.insert(auditLog).values({ entity, entityId, action, summary, userId, createdAt });
}

beforeEach(async () => {
  db = await createTestDb();
  const user = await addUser(db, "satis", "uzman", { name: "Ayşe Demir" });
  userId = user.id;
  satis = ctxFor(db, user);
});

test("listHistory yeniden eskiye sıralar, birden çok kaydı birleştirir, başkalarını almaz", async () => {
  await log("customer", "a", "a-1", at("09:00"));
  await log("customer", "b", "b-1", at("10:00"));
  await log("customer", "a", "a-2", at("11:00"));
  await log("customer", "c", "c-1", at("12:00"));
  await log("material", "a", "aynı kimlik başka tür", at("13:00"));

  const rows = await listHistory(db, [
    { entity: "customer", entityId: "a" },
    { entity: "customer", entityId: "b" },
  ]);
  expect(rows.map((r) => r.summary)).toEqual(["a-2", "b-1", "a-1"]);
  expect(rows[0]).toMatchObject({ at: at("11:00"), userName: "Ayşe Demir", departmentName: "Satış", action: "update" });
  expect(typeof rows[0]?.id).toBe("string");
});

test("listHistory varsayılan 50 kayıt döner; sınır verilebilir; boş liste boş döner", async () => {
  for (let i = 0; i < 55; i += 1) await log("customer", "a", `kayıt ${i}`, new Date(at("09:00").getTime() + i * 60_000));
  expect(await listHistory(db, [{ entity: "customer", entityId: "a" }])).toHaveLength(50);
  const three = await listHistory(db, [{ entity: "customer", entityId: "a" }], 3);
  expect(three.map((r) => r.summary)).toEqual(["kayıt 54", "kayıt 53", "kayıt 52"]);
  expect(await listHistory(db, [])).toEqual([]);
});

test("aynı anda yazılan kayıtlar yazılış sırasının tersiyle gelir", async () => {
  for (const s of ["ilk", "ikinci", "üçüncü"]) await log("customer", "a", s, at("09:00"));
  expect((await listHistory(db, [{ entity: "customer", entityId: "a" }])).map((r) => r.summary)).toEqual(["üçüncü", "ikinci", "ilk"]);
});

test("sipariş geçmişi siparişin ve iş emirlerinin kayıtlarını birlikte gösterir; silinen satırın ürünü görünür", async () => {
  const product = await addProduct(db, { code: "URN-0031", name: "Adım Ayakkabılık" });
  const other = await addProduct(db, { code: "URN-0099", name: "Silinecek Raf" });
  await addRouting(db, { productId: product.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: new Date("2026-12-01T12:00:00+03:00") });
  await addLine(ctxFor(db, satis.user, at("09:10")), { orderId: o.id, productId: product.id, qtyMilli: 1000 });
  const removed = await addLine(ctxFor(db, satis.user, at("09:20")), { orderId: o.id, productId: other.id, qtyMilli: 1000 });
  await removeLine(ctxFor(db, satis.user, at("09:30")), removed.id);
  await confirmOrder(ctxFor(db, satis.user, at("09:40")), o.id);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");
  const atolye = ctxFor(db, await addUser(db, "atolye", "operator", { name: "Usta" }), at("10:00"));
  await startNextStep(atolye, wo.id);

  const rows = await listOrderHistory(db, o.id);
  const summaries = rows.map((r) => r.summary);
  expect(summaries[0]).toMatch(new RegExp(`^${wo.code} .*başladı$`));
  expect(rows[0]).toMatchObject({ userName: "Usta", departmentName: "Atölye" });
  expect(summaries).toContain(`${o.code}: satır silindi — URN-0099 Silinecek Raf × 1 (₺1.000,00)`);
  expect(summaries.some((s) => s.startsWith(`${wo.code} açıldı`))).toBe(true);
  expect(summaries.at(-1)).toMatch(/taslağı açıldı/);
  // Mamul ve malzeme hareketleri kendi kayıtlarında kalır.
  expect(rows.every((r) => r.summary.startsWith(o.code) || r.summary.startsWith(wo.code))).toBe(true);
});

test("iş emri geçmişi kendi kayıtlarını ve siparişin onay kaydını gösterir", async () => {
  const product = await addProduct(db);
  await addRouting(db, { productId: product.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: new Date("2026-12-01T12:00:00+03:00") });
  await addLine(satis, { orderId: o.id, productId: product.id, qtyMilli: 1000 });
  await confirmOrder(ctxFor(db, satis.user, at("09:40")), o.id);
  const [wo] = await db.select().from(workOrders);
  if (!wo) throw new Error("iş emri açılmadı");

  const rows = await listWorkOrderHistory(db, wo.id);
  expect(rows.map((r) => r.action).sort()).toEqual(["confirm", "create"]);
  expect(rows.find((r) => r.action === "confirm")?.summary).toMatch(new RegExp(`^${o.code} onaylandı`));
});

test("stok için açılmış ya da bulunmayan iş emrinde yalnızca kendi kayıtları", async () => {
  expect(await listWorkOrderHistory(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  expect(await listOrderHistory(db, "bozuk")).toEqual([]);
});
