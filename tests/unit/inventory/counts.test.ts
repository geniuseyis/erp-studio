import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { stockMovements } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { approveCount, cancelCount, createCount, setCountLine } from "@/domain/inventory/counts";
import { receiveStock, reserveStock, verifyLedger } from "@/domain/inventory/ledger";
import { getCount, getMaterial, listCounts } from "@/domain/inventory/queries";
import { addMaterial, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let uzman: Ctx;
let mudur: Ctx;
let a: string;
let b: string;

const onHand = async (id: string) => (await getMaterial(db, id))?.onHandMilli;
const adjustments = async () => (await db.select().from(stockMovements)).filter((m) => m.type === "count_adjust");

beforeEach(async () => {
  db = await createTestDb();
  uzman = ctxFor(db, await addUser(db, "depo", "uzman", { name: "Onur Tekin" }));
  mudur = ctxFor(db, await addUser(db, "depo", "mudur", { name: "Sevgi Polat" }));
  a = (await addMaterial(db)).id;
  b = (await addMaterial(db)).id;
  await receiveStock(uzman, { materialId: a, qtyMilli: 10_000, unitCostKurus: 100 });
  await receiveStock(uzman, { materialId: b, qtyMilli: 5_000, unitCostKurus: 100 });
});

test("sayım açılır, sayılır, onaylanır: fark hareket olarak yazılır", async () => {
  const count = await createCount(uzman, { materialIds: [a, b], note: "ay sonu" });
  expect(count.code).toMatch(/^SYM-2026-0001$/);
  expect(count.status).toBe("open");
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 8_000 });
  await setCountLine(uzman, { countId: count.id, materialId: b, countedMilli: 5_000 });
  const approved = await approveCount(mudur, count.id);
  expect(approved.status).toBe("approved");
  expect(approved.approvedBy).toBe(mudur.user.id);
  expect(await onHand(a)).toBe(8_000);
  expect(await onHand(b)).toBe(5_000);
  const adj = await adjustments();
  expect(adj).toHaveLength(1);
  expect(adj[0]).toMatchObject({ materialId: a, deltaOnHandMilli: -2_000, refType: "stock_count", refId: count.id });
  expect(await verifyLedger(db)).toEqual([]);
});

test("fark, onay anındaki eldekiye göre hesaplanır", async () => {
  const count = await createCount(uzman, { materialIds: [a] });
  await receiveStock(uzman, { materialId: a, qtyMilli: 3_000, unitCostKurus: 100 });
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 12_000 });
  await approveCount(mudur, count.id);
  expect(await onHand(a)).toBe(12_000);
  expect((await adjustments())[0]?.deltaOnHandMilli).toBe(-1_000);
});

test("sayılmamış satır varken onaylanamaz", async () => {
  const count = await createCount(uzman, { materialIds: [a, b] });
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 9_000 });
  await expect(approveCount(mudur, count.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(await onHand(a)).toBe(10_000);
});

test("uzman onaylayamaz, operatör sayım açamaz ama sayabilir", async () => {
  const op = ctxFor(db, await addUser(db, "depo", "operator"));
  await expect(createCount(op, { materialIds: [a] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const count = await createCount(uzman, { materialIds: [a] });
  await setCountLine(op, { countId: count.id, materialId: a, countedMilli: 10_000 });
  await expect(approveCount(uzman, count.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("sayılan miktar ayrılmışın altındaysa onay reddedilir ve hiçbir satır değişmez", async () => {
  await reserveStock(uzman, { materialId: b, qtyMilli: 4_000, ref: { type: "work_order", id: "WO-1" } });
  const count = await createCount(uzman, { materialIds: [a, b] });
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 7_000 });
  await setCountLine(uzman, { countId: count.id, materialId: b, countedMilli: 3_000 });
  await expect(approveCount(mudur, count.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  expect(await onHand(a)).toBe(10_000);
  expect(await onHand(b)).toBe(5_000);
  expect(await adjustments()).toHaveLength(0);
  expect((await getCount(db, count.id))?.status).toBe("open");
});

test("onaylanmış ya da iptal edilmiş sayım değiştirilemez", async () => {
  const c1 = await createCount(uzman, { materialIds: [a] });
  await setCountLine(uzman, { countId: c1.id, materialId: a, countedMilli: 10_000 });
  await approveCount(mudur, c1.id);
  await expect(setCountLine(uzman, { countId: c1.id, materialId: a, countedMilli: 1 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(approveCount(mudur, c1.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  await expect(cancelCount(uzman, c1.id)).rejects.toMatchObject({ code: "INVALID_STATE" });

  const c2 = await createCount(uzman, { materialIds: [a] });
  expect(c2.code).toBe("SYM-2026-0002");
  await cancelCount(uzman, c2.id);
  await expect(setCountLine(uzman, { countId: c2.id, materialId: a, countedMilli: 1 })).rejects.toMatchObject({ code: "INVALID_STATE" });
});

test("geçersiz girişler", async () => {
  await expect(createCount(uzman, { materialIds: [] })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(createCount(uzman, { materialIds: ["00000000-0000-0000-0000-000000000000"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const count = await createCount(uzman, { materialIds: [a, a] });
  expect((await getCount(db, count.id))?.lines).toHaveLength(1);
  await expect(setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 1.5 })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(setCountLine(uzman, { countId: count.id, materialId: b, countedMilli: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 0 });
});

test("liste ve ayrıntı sorguları", async () => {
  const count = await createCount(uzman, { materialIds: [a, b] });
  await setCountLine(uzman, { countId: count.id, materialId: a, countedMilli: 9_500 });
  const [summary] = await listCounts(db);
  expect(summary).toMatchObject({ code: "SYM-2026-0001", status: "open", lineCount: 2, countedCount: 1, createdByName: "Onur Tekin" });
  const detail = await getCount(db, count.id);
  const line = detail?.lines.find((l) => l.materialId === a);
  expect(line).toMatchObject({ systemMilli: 10_000, countedMilli: 9_500, currentOnHandMilli: 10_000, diffMilli: -500, unit: "adet" });
  expect(detail?.lines.find((l) => l.materialId === b)?.diffMilli).toBeNull();
});
