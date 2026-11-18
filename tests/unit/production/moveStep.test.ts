import { and, asc, eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { moveStep, previewMove } from "@/domain/production/schedule";
import { planWorkOrder } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addCustomer, addProduct, addRouting, addStation, addUser, ctxFor, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let planlama: Ctx;
let productId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

// NOW: pazar 15 Kasım 2026. Rota Kesim (100 dk) → Montaj (960 dk) → Boya (300 dk), birim başına 20 dk.
beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  productId = (await addProduct(db)).id;
  const route = [
    { name: "Kesim", dailyCapacityMin: 100 },
    { name: "Montaj", dailyCapacityMin: 960 },
    { name: "Boya", dailyCapacityMin: 300 },
  ];
  for (const [index, st] of route.entries()) {
    const station = await addStation(db, st);
    await addRouting(db, { productId, seq: index + 1, stationId: station.id, minutesPerUnit: 20 });
  }
});

/** Malzeme bekleyen iş emri açar ve `start` gününden planlar: adımlar art arda iş günlerine düşer. */
async function plannedOrder(start: Date, qtyMilli = 1000) {
  const before = new Set((await db.select({ id: workOrders.id }).from(workOrders)).map((w) => w.id));
  const o = await createOrder(satis, { customerId: (await addCustomer(db)).id, dueAt: day("2026-12-15") });
  await addLine(satis, { orderId: o.id, productId, qtyMilli });
  await confirmOrder(satis, o.id);
  const wo = (await db.select().from(workOrders)).find((w) => !before.has(w.id))!;
  await planWorkOrder(planlama, { workOrderId: wo.id, start });
  return wo;
}
async function stepsOf(workOrderId: string) {
  return db.select().from(workOrderSteps).where(eq(workOrderSteps.workOrderId, workOrderId)).orderBy(asc(workOrderSteps.seq));
}
async function moves() {
  return db.select().from(auditLog).where(eq(auditLog.action, "move_step"));
}

test("geçmiş güne ve cumartesiye taşıma reddedilir", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  const cases = [
    [day("2026-11-13"), "Geçmiş bir güne taşınamaz"],
    [new Date("2026-11-21T10:00:00+03:00"), "Hafta sonu iş günü değil"],
    [day("2026-11-15"), "Hafta sonu iş günü değil"], // bugün pazar: geçmiş değil ama hafta sonu
  ] as const;
  for (const [toDay, message] of cases) {
    await expect(moveStep(planlama, { workOrderId: wo.id, seq: 1, toDay })).rejects.toMatchObject({ code: "VALIDATION", message });
    expect((await previewMove(db, { workOrderId: wo.id, seq: 1, toDay, now: NOW })).error).toBe(message);
  }
  await expect(moveStep(planlama, { workOrderId: wo.id, seq: 1, toDay: new Date("geçersiz") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Gün geçersiz",
  });
  expect((await stepsOf(wo.id))[0]?.plannedDay).toEqual(day("2026-11-16"));
  expect(await moves()).toHaveLength(0);
});

test("önceki adımdan önceye taşıma komşu istasyonu ve günü söyler", async () => {
  const wo = await plannedOrder(day("2026-11-16")); // Kesim 16, Montaj 17, Boya 18
  const message = "Önce Montaj adımı (17.11) gelir";
  await expect(moveStep(planlama, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-16") })).rejects.toMatchObject({ code: "VALIDATION", message });
  expect((await previewMove(db, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-16"), now: NOW })).error).toBe(message);
  expect((await stepsOf(wo.id))[2]?.plannedDay).toEqual(day("2026-11-18"));
});

test("sonraki adımdan sonraya taşıma reddedilir; aynı gün izinli", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  await expect(moveStep(planlama, { workOrderId: wo.id, seq: 1, toDay: day("2026-11-18") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Montaj adımı (17.11) bundan önce olamaz",
  });
  const moved = await moveStep(planlama, { workOrderId: wo.id, seq: 1, toDay: new Date("2026-11-17T16:00:00+03:00") });
  expect(moved.step.plannedDay).toEqual(day("2026-11-17"));
  // Montaj da önceki adımla aynı güne çekilebilir.
  await moveStep(planlama, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-17") });
  expect((await stepsOf(wo.id)).map((s) => s.plannedDay)).toEqual([day("2026-11-17"), day("2026-11-17"), day("2026-11-17")]);
});

test("başlamış adım taşınmaz", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  const [s1, s2] = await stepsOf(wo.id);
  await db.update(workOrderSteps).set({ startedAt: NOW, finishedAt: NOW }).where(eq(workOrderSteps.id, s1!.id));
  await db.update(workOrderSteps).set({ startedAt: NOW }).where(eq(workOrderSteps.id, s2!.id));
  await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, wo.id));
  for (const seq of [1, 2]) {
    await expect(moveStep(planlama, { workOrderId: wo.id, seq, toDay: day("2026-11-17") })).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Başlamış adım taşınamaz",
    });
  }
  // Üretimdeki iş emrinin başlamamış adımı taşınır.
  await moveStep(planlama, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-19") });
  expect((await stepsOf(wo.id))[2]?.plannedDay).toEqual(day("2026-11-19"));
});

test("yalnızca açık iş emrinin adımı taşınır; bilinmeyen adım NOT_FOUND", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  await db.update(workOrders).set({ status: "cancelled" }).where(eq(workOrders.id, wo.id));
  await expect(moveStep(planlama, { workOrderId: wo.id, seq: 2, toDay: day("2026-11-16") })).rejects.toMatchObject({
    code: "VALIDATION",
    message: "Yalnızca açık iş emrinin adımı taşınır",
  });
  expect((await stepsOf(wo.id))[1]?.plannedDay).toEqual(day("2026-11-17"));
  expect(await moves()).toHaveLength(0);
  await expect(moveStep(planlama, { workOrderId: wo.id, seq: 9, toDay: day("2026-11-16") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(moveStep(planlama, { workOrderId: "yok", seq: 1, toDay: day("2026-11-16") })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("önizleme ve taşıma aynı sırayla denetler: olmayan adım + geçmiş gün ikisinde de geçmiş gün iletisi", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  const rejected = { code: "VALIDATION", message: "Geçmiş bir güne taşınamaz" };
  for (const workOrderId of [wo.id, "yok"]) {
    const input = { workOrderId, seq: 9, toDay: day("2026-11-13") };
    await expect(moveStep(planlama, input)).rejects.toMatchObject(rejected);
    await expect(previewMove(db, { ...input, now: NOW })).rejects.toMatchObject(rejected);
  }
});

test("planlanmamış adım taşınmaz", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  await db.update(workOrderSteps).set({ plannedDay: null }).where(eq(workOrderSteps.workOrderId, wo.id));
  await db.update(workOrders).set({ plannedStart: null }).where(eq(workOrders.id, wo.id));
  const input = { workOrderId: wo.id, seq: 1, toDay: day("2026-11-17") };
  await expect(moveStep(planlama, input)).rejects.toMatchObject({ code: "VALIDATION", message: "Önce iş emrini planlayın" });
  expect((await previewMove(db, { ...input, now: NOW })).error).toBe("Önce iş emrini planlayın");
  expect((await stepsOf(wo.id)).every((s) => s.plannedDay === null)).toBe(true);
});

test("erken biten önceki adımın sınırı gerçek bitiş günüdür", async () => {
  const wo = await plannedOrder(day("2026-11-18")); // Kesim 18, Montaj 19, Boya 20
  const [s1] = await stepsOf(wo.id);
  const finished = new Date("2026-11-16T11:00:00+03:00");
  await db.update(workOrderSteps).set({ startedAt: finished, finishedAt: finished }).where(eq(workOrderSteps.id, s1!.id));
  await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, wo.id));
  // 17.11: gerçek bitişten (16.11) sonra, eski planlı günden (18.11) önce.
  const moved = await moveStep(planlama, { workOrderId: wo.id, seq: 2, toDay: day("2026-11-17") });
  expect(moved.step.plannedDay).toEqual(day("2026-11-17"));
});

test("geç biten önceki adımın gerçek günü taşımayı reddeder ve iletide görünür", async () => {
  const wo = await plannedOrder(day("2026-11-17")); // Kesim 17, Montaj 18, Boya 19
  const [s1] = await stepsOf(wo.id);
  const finished = new Date("2026-11-18T14:00:00+03:00");
  await db.update(workOrderSteps).set({ startedAt: finished, finishedAt: finished }).where(eq(workOrderSteps.id, s1!.id));
  await db.update(workOrders).set({ status: "in_progress" }).where(eq(workOrders.id, wo.id));
  const input = { workOrderId: wo.id, seq: 2, toDay: day("2026-11-17") };
  const message = "Önce Kesim adımı (18.11) gelir";
  await expect(moveStep(planlama, input)).rejects.toMatchObject({ code: "VALIDATION", message });
  expect((await previewMove(db, { ...input, now: NOW })).error).toBe(message);
  expect((await stepsOf(wo.id))[1]?.plannedDay).toEqual(day("2026-11-18"));
});

test("kapasiteyi aşan taşıma yapılır ve overCapacity true döner", async () => {
  await plannedOrder(day("2026-11-17"), 50_000); // Montaj 18.11'de 1.000 dk
  const small = await plannedOrder(day("2026-11-16")); // Montaj 17.11'de 20 dk
  const result = await moveStep(planlama, { workOrderId: small.id, seq: 2, toDay: day("2026-11-18") });
  expect(result).toMatchObject({ loadMinutes: 1020, capacityMin: 960, overCapacity: true });
  expect(result.step.plannedDay).toEqual(day("2026-11-18"));
  const [log] = await moves();
  expect(log?.summary).toBe(`${small.code} Montaj adımı 17.11 → 18.11 taşındı (yük 1.020/960 dk)`);

  // Sığan taşıma overCapacity false (19.11'de Boya büyük iş emriyle dolu, 20.11 boş).
  const fits = await moveStep(planlama, { workOrderId: small.id, seq: 3, toDay: day("2026-11-20") });
  expect(fits).toMatchObject({ capacityMin: 300, overCapacity: false });
});

test("ilk adım taşınınca planned_start güncellenir; geçmişe ne değiştiği yazılır", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  await moveStep(planlama, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-19") });
  let [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
  expect(row?.plannedStart).toEqual(day("2026-11-16"));

  await moveStep(planlama, { workOrderId: wo.id, seq: 1, toDay: day("2026-11-17") });
  [row] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
  expect(row?.plannedStart).toEqual(day("2026-11-17"));

  const logs = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "move_step"), eq(auditLog.entityId, wo.id)))
    .orderBy(asc(auditLog.summary));
  expect(logs.map((l) => [l.entity, l.userId, l.summary])).toEqual([
    ["work_order", planlama.user.id, `${wo.code} Boya adımı 18.11 → 19.11 taşındı (yük 20/300 dk)`],
    ["work_order", planlama.user.id, `${wo.code} Kesim adımı 16.11 → 17.11 taşındı (yük 20/100 dk)`],
  ]);
});

test("satış kullanıcısı taşıyamaz: FORBIDDEN", async () => {
  const wo = await plannedOrder(day("2026-11-16"));
  await expect(moveStep(satis, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-19") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const operator = ctxFor(db, await addUser(db, "planlama", "operator"));
  await expect(moveStep(operator, { workOrderId: wo.id, seq: 3, toDay: day("2026-11-19") })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await stepsOf(wo.id))[2]?.plannedDay).toEqual(day("2026-11-18"));
  expect(await moves()).toHaveLength(0);
});

test("previewMove hiçbir şey yazmaz ve moveStep ile aynı yükü hesaplar", async () => {
  await plannedOrder(day("2026-11-17"), 50_000);
  const small = await plannedOrder(day("2026-11-16"));
  const input = { workOrderId: small.id, seq: 2, toDay: day("2026-11-18") };
  const before = await stepsOf(small.id);
  const preview = await previewMove(db, { ...input, now: NOW });
  expect(preview).toMatchObject({ error: null, loadMinutes: 1020, capacityMin: 960, overCapacity: true });
  expect(await stepsOf(small.id)).toEqual(before);
  expect(await moves()).toHaveLength(0);

  const moved = await moveStep(planlama, input);
  expect([moved.loadMinutes, moved.capacityMin, moved.overCapacity]).toEqual([preview.loadMinutes, preview.capacityMin, preview.overCapacity]);

  // Aynı güne taşıma bir şey yazmaz ve o günün yükünü döner.
  const again = await previewMove(db, { ...input, now: NOW });
  expect(again).toMatchObject({ error: null, loadMinutes: 1020, overCapacity: true });
  const same = await moveStep(planlama, input);
  expect(same).toMatchObject({ loadMinutes: 1020, capacityMin: 960, overCapacity: true });
  expect(await moves()).toHaveLength(1);
});
