import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, materials, salesOrderLines, salesOrders, workOrders } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { reserveWaitingWorkOrdersInternal, retryMaterials } from "@/domain/production/workOrders";
import { addBomLine, addCustomer, addMaterial, addProduct, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let planlama: Ctx;
let depo: Ctx;
let productId: string;
let seq = 0;

beforeEach(async () => {
  db = await createTestDb();
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  productId = (await addProduct(db)).id;
  seq = 0;
});

/** Malzemesi ayrılmamış planlı iş emri; `due` verilirse bağlı siparişin termini olur (satır "Malzeme bekliyor"). */
async function waiting(opts: { productId?: string; qtyMilli?: number; due?: string | null; linked?: boolean } = {}) {
  seq += 1;
  let salesOrderLineId: string | null = null;
  if (opts.linked !== false && opts.due !== undefined) {
    const customer = await addCustomer(db);
    const [so] = await db
      .insert(salesOrders)
      .values({
        code: `SIP-2026-${String(seq).padStart(4, "0")}`,
        customerId: customer.id,
        status: "confirmed",
        dueAt: opts.due ? new Date(opts.due) : null,
        createdBy: planlama.user.id,
      })
      .returning();
    const [line] = await db
      .insert(salesOrderLines)
      .values({ orderId: so!.id, productId: opts.productId ?? productId, qtyMilli: opts.qtyMilli ?? 1000, vatRate: 10, status: "waiting_material" })
      .returning();
    salesOrderLineId = line!.id;
  }
  const [wo] = await db
    .insert(workOrders)
    .values({
      code: `IE-2026-${String(seq).padStart(4, "0")}`,
      productId: opts.productId ?? productId,
      qtyMilli: opts.qtyMilli ?? 1000,
      salesOrderLineId,
      createdBy: planlama.user.id,
    })
    .returning();
  return wo!;
}

async function reservedOf(id: string) {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  return wo!.materialsReserved;
}

test("iki bekleyen iş emrine yetmeyen stok: termini erken olan ayrılır, diğeri bekler, yarım ayırma yok", async () => {
  const m = await addMaterial(db, { unit: "plaka" });
  await addBomLine(db, { productId, materialId: m.id, qtyMilli: 4000 }); // 1 adet = 4 plaka
  const late = await waiting({ due: "2026-12-20T00:00:00+03:00" });
  const early = await waiting({ due: "2026-12-01T00:00:00+03:00" });
  await receiveStock(depo, { materialId: m.id, qtyMilli: 6000, unitCostKurus: 100 });

  const reserved = await reserveWaitingWorkOrdersInternal(depo, { materialIds: [m.id], source: "SAS-2026-0001 mal kabulü" });
  expect(reserved.map((w) => w.id)).toEqual([early.id]);
  expect(await reservedOf(early.id)).toBe(true);
  expect(await reservedOf(late.id)).toBe(false);
  const [mat] = await db.select().from(materials).where(eq(materials.id, m.id));
  expect(mat).toMatchObject({ onHandMilli: 6000, reservedMilli: 4000 }); // 2 plaka yarım ayrılmadı
  const log = await db.select().from(auditLog).where(eq(auditLog.entityId, early.id));
  expect(log.map((r) => r.summary)).toContain(`${early.code}: malzemeler ayrıldı — ${m.code} 4 plaka (SAS-2026-0001 mal kabulü)`);
  expect(await verifyLedger(db)).toEqual([]);
});

test("termini olmayan iş emri sonda, termin eşitse iş emri koduna göre; satır üretime geçer", async () => {
  const m = await addMaterial(db, { unit: "plaka", onHandMilli: 3000 });
  await addBomLine(db, { productId, materialId: m.id, qtyMilli: 1000 });
  const none = await waiting({ linked: false });
  const b = await waiting({ due: "2026-12-05T00:00:00+03:00" });
  const a = await waiting({ due: "2026-12-05T00:00:00+03:00" });
  const reserved = await reserveWaitingWorkOrdersInternal(depo, { materialIds: [m.id], source: "x" });
  expect(reserved.map((w) => w.id)).toEqual([b.id, a.id, none.id]); // b kodu a'dan küçük (IE-0002 < IE-0003)
  const [line] = await db.select().from(salesOrderLines).where(eq(salesOrderLines.id, b.salesOrderLineId!));
  expect(line?.status).toBe("in_production");
});

test("başka malzemesi de eksik iş emri ayrılmaz; ilgisiz malzemeyi kullanan dokunulmaz", async () => {
  const m = await addMaterial(db, { unit: "plaka", onHandMilli: 5000 });
  const other = await addMaterial(db, { unit: "plaka", onHandMilli: 0 });
  await addBomLine(db, { productId, materialId: m.id, qtyMilli: 1000 });
  await addBomLine(db, { productId, materialId: other.id, qtyMilli: 1000 });
  const blocked = await waiting({ due: "2026-12-01T00:00:00+03:00" });
  const unrelated = await addProduct(db);
  const third = await addMaterial(db, { unit: "plaka", onHandMilli: 5000 });
  await addBomLine(db, { productId: unrelated.id, materialId: third.id, qtyMilli: 1000 });
  const free = await waiting({ productId: unrelated.id, due: "2026-12-01T00:00:00+03:00" });

  expect(await reserveWaitingWorkOrdersInternal(depo, { materialIds: [m.id], source: "x" })).toEqual([]);
  expect(await reservedOf(blocked.id)).toBe(false);
  expect(await reservedOf(free.id)).toBe(false);
  const [mat] = await db.select().from(materials).where(eq(materials.id, m.id));
  expect(mat?.reservedMilli).toBe(0);
});

test("retryMaterials eski davranışını korur: planlama yetkisi, aynı geçmiş metni, ayrılmışsa INVALID_STATE", async () => {
  const m = await addMaterial(db, { unit: "plaka", code: "MLZ-0009", onHandMilli: 5000 });
  await addBomLine(db, { productId, materialId: m.id, qtyMilli: 2000 });
  const wo = await waiting({ due: "2026-12-01T00:00:00+03:00" });
  await expect(retryMaterials(depo, wo.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const result = await retryMaterials(planlama, wo.id);
  expect(result.shortages).toEqual([]);
  expect(result.workOrder.materialsReserved).toBe(true);
  const log = await db.select().from(auditLog).where(eq(auditLog.entityId, wo.id));
  expect(log.map((r) => r.summary)).toEqual([`${wo.code}: malzemeler ayrıldı — MLZ-0009 2 plaka`]);
  await expect(retryMaterials(planlama, wo.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
});
