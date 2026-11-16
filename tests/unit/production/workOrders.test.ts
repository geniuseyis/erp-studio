import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { materialNeeds, openWorkOrder } from "@/domain/production/workOrders";
import { addBomLine, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let ctx: Ctx;
let productId: string;

beforeEach(async () => {
  db = await createTestDb();
  ctx = ctxFor(db, await addUser(db, "planlama", "uzman"));
  productId = (await addProduct(db)).id;
});

test("malzeme ihtiyacı fire dahil hesaplanır ve birim adımına yukarı yuvarlanır", async () => {
  const panel = await addMaterial(db, { unit: "plaka", code: "A-PNL" });
  const vernik = await addMaterial(db, { unit: "L", code: "B-VRN" });
  const kereste = await addMaterial(db, { unit: "m3", code: "C-KRS" });
  await addBomLine(db, { productId, materialId: panel.id, qtyMilli: 340, scrapPermille: 150 });
  await addBomLine(db, { productId, materialId: vernik.id, qtyMilli: 125 });
  await addBomLine(db, { productId, materialId: kereste.id, qtyMilli: 12, scrapPermille: 100 });

  expect(await materialNeeds(db, productId, 2000)).toEqual([
    { materialId: panel.id, neededMilli: 1000 }, // 0,34 × 2 × 1,15 = 0,782 → 1 plaka
    { materialId: vernik.id, neededMilli: 300 }, // 0,125 × 2 = 0,25 → 0,3 L
    { materialId: kereste.id, neededMilli: 30 }, // 0,012 × 2 × 1,1 = 0,0264 → 0,03 m³
  ]);
  expect(await materialNeeds(db, productId, 10_000)).toEqual([
    { materialId: panel.id, neededMilli: 4000 }, // 3,91 → 4 plaka
    { materialId: vernik.id, neededMilli: 1300 }, // 1,25 → 1,3 L
    { materialId: kereste.id, neededMilli: 140 }, // 0,132 → 0,14 m³
  ]);
});

test("reçetesiz ve rotasız ürünün iş emri malzemesi ayrılmış sayılır", async () => {
  const { workOrder, shortages } = await openWorkOrder(ctx, { productId, qtyMilli: 1000 });
  expect(shortages).toEqual([]);
  expect(workOrder).toMatchObject({ code: "IE-2026-0001", salesOrderLineId: null, materialsReserved: true, status: "planned" });
  expect(await db.select().from(workOrderSteps)).toHaveLength(0);
});

test("iş emri kodları yıl içinde sırayla artar ve açılış kaydı düşer", async () => {
  const station = await addStation(db);
  await addRouting(db, { productId, seq: 1, stationId: station.id, minutesPerUnit: 15 });
  await openWorkOrder(ctx, { productId, qtyMilli: 1000 });
  const second = await openWorkOrder(ctx, { productId, qtyMilli: 2000 });
  expect(second.workOrder.code).toBe("IE-2026-0002");
  const nextYear = ctxFor(db, ctx.user, new Date("2026-12-31T22:00:00Z"));
  expect((await openWorkOrder(nextYear, { productId, qtyMilli: 1000 })).workOrder.code).toBe("IE-2027-0001");
  const log = (await db.select().from(auditLog)).filter((r) => r.entity === "work_order" && r.action === "create");
  expect(log).toHaveLength(3);
});

test("geçersiz adet VALIDATION, bilinmeyen ürün NOT_FOUND", async () => {
  await expect(openWorkOrder(ctx, { productId, qtyMilli: 1500 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(openWorkOrder(ctx, { productId, qtyMilli: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(openWorkOrder(ctx, { productId: "00000000-0000-4000-8000-000000000000", qtyMilli: 1000 })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
