import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import type { Ctx } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { getProduct, getWorkOrder, listProducts, listStations, listWorkOrders, stationQueue } from "@/domain/production/queries";
import { finishCurrentStep, planWorkOrder, retryMaterials, startNextStep } from "@/domain/production/workOrders";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let planlama: Ctx;
let depo: Ctx;
let atolye: Ctx;
let productId: string;
let materialId: string;
let stationCodes: string[];

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman"));
  planlama = ctxFor(db, await addUser(db, "planlama", "uzman"));
  depo = ctxFor(db, await addUser(db, "depo", "uzman"));
  atolye = ctxFor(db, await addUser(db, "atolye", "operator", { name: "Kemal Usta" }));
  productId = (await addProduct(db, { name: "Sükût Komodin", category: "komodin" })).id;
  stationCodes = [];
  for (let seq = 1; seq <= 3; seq += 1) {
    const st = await addStation(db);
    stationCodes.push(st.code);
    await addRouting(db, { productId, seq, stationId: st.id, minutesPerUnit: 20 });
  }
  materialId = (await addMaterial(db, { unit: "plaka", avgCostKurus: 100 })).id;
  await addBomLine(db, { productId, materialId, qtyMilli: 2000 });
});

async function order(qty = 1000, customerName = "Ayşe") {
  const o = await createOrder(satis, { customerId: (await addCustomer(db, { name: customerName })).id, dueAt: day("2026-12-15") });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: qty });
  await confirmOrder(satis, o.id);
  return o;
}
async function firstWorkOrder() {
  const [wo] = await listWorkOrders(db);
  if (!wo) throw new Error("iş emri yok");
  return wo;
}
async function reserve(workOrderId: string, qtyMilli = 3000) {
  await receiveStock(depo, { materialId, qtyMilli, unitCostKurus: 100 });
  await retryMaterials(planlama, workOrderId);
}

test.each(["sukut", "SÜKÛT", "Sükût", "sükût"])("ürün araması %s Sükût komodini bulur", async (search) => {
  await addProduct(db, { name: "Ceviz sehpa" });
  expect((await listProducts(db, { search })).map((p) => p.name)).toEqual(["Sükût Komodin"]);
});

test("ürün araması kategoride de çalışır; koleksiyon ve kaplama süzer", async () => {
  await addProduct(db, { name: "Diğer", collection: "Nordik", finish: "ahsap", category: "sehpa" });
  expect((await listProducts(db, { search: "KOMODİN" })).length).toBe(1);
  expect((await listProducts(db, { collection: "Nordik" })).map((p) => p.name)).toEqual(["Diğer"]);
  expect((await listProducts(db, { finish: "ahsap" })).map((p) => p.name)).toEqual(["Diğer"]);
});

test("ürün maliyeti reçete × ortalama maliyet, fire dahil, kuruşa bir kez yuvarlanır", async () => {
  const p = await addProduct(db, { name: "Maliyet" });
  const m1 = await addMaterial(db, { unit: "plaka", avgCostKurus: 10_000 });
  const m2 = await addMaterial(db, { unit: "adet", avgCostKurus: 333 });
  await addBomLine(db, { productId: p.id, materialId: m1.id, qtyMilli: 2500, scrapPermille: 100 });
  await addBomLine(db, { productId: p.id, materialId: m2.id, qtyMilli: 3000 });
  // 2,5 x 1,1 x 10000 = 27500; 3 x 333 = 999
  expect((await getProduct(db, p.id))?.unitCostKurus).toBe(28_499);
  expect((await listProducts(db, { search: "Maliyet" }))[0]?.unitCostKurus).toBe(28_499);
  expect((await listProducts(db)).find((x) => x.id === productId)?.unitCostKurus).toBe(200);
});

test("ürün detayı: reçete, rota ve kullanılabilir miktar", async () => {
  await receiveStock(depo, { materialId, qtyMilli: 5000, unitCostKurus: 100 });
  const p = await getProduct(db, productId);
  expect(p?.bom).toHaveLength(1);
  expect(p?.bom[0]).toMatchObject({ materialId, qtyMilli: 2000, scrapPermille: 0, availableMilli: 5000, unit: "plaka", category: "hirdavat" });
  expect(p?.routing.map((r) => [r.seq, r.stationCode, r.minutesPerUnit])).toEqual([
    [1, stationCodes[0], 20],
    [2, stationCodes[1], 20],
    [3, stationCodes[2], 20],
  ]);
  expect(p?.availableMilli).toBe(0);
  expect(await getProduct(db, "xyz")).toBeNull();
});

test("iş emri listesi: adım sayıları, güncel istasyon ve sipariş kodu", async () => {
  const o = await order();
  const wo = await firstWorkOrder();
  expect(wo).toMatchObject({ orderCode: o.code, productName: "Sükût Komodin", doneSteps: 0, totalSteps: 3, status: "planned", materialsReserved: false });
  expect(wo.currentStation).not.toBeNull();
  expect((await listWorkOrders(db, { search: "sukut" })).length).toBe(1);
  expect((await listWorkOrders(db, { search: o.code.toLowerCase() })).length).toBe(1);
  expect((await listWorkOrders(db, { search: wo.code })).length).toBe(1);
  expect((await listWorkOrders(db, { status: "completed" })).length).toBe(0);
});

test("iş emri detayı: malzeme bekleyince ihtiyaç ve eksik; ayrılınca net ayrılan, eksik yok", async () => {
  await order();
  const wo = await firstWorkOrder();
  const waiting = await getWorkOrder(db, wo.id);
  expect(waiting?.materials).toEqual([expect.objectContaining({ materialId, neededMilli: 2000, availableMilli: 0 })]);
  expect(waiting?.shortages).toHaveLength(1);
  expect(waiting?.steps).toHaveLength(3);

  await reserve(wo.id);
  const reserved = await getWorkOrder(db, wo.id);
  expect(reserved?.materialsReserved).toBe(true);
  expect(reserved?.shortages).toEqual([]);
  expect(reserved?.materials[0]).toMatchObject({ neededMilli: 2000, availableMilli: 1000 });
  expect(await getWorkOrder(db, "nope")).toBeNull();
});

test("iş emri adımları: planlı gün, başlatan ve bitiren adı", async () => {
  await order();
  const wo = await firstWorkOrder();
  await reserve(wo.id);
  await planWorkOrder(planlama, { workOrderId: wo.id, start: day("2026-11-16") });
  await startNextStep(atolye, wo.id);
  await finishCurrentStep(atolye, wo.id);
  await startNextStep(atolye, wo.id);
  const d = await getWorkOrder(db, wo.id);
  expect(d?.steps[0]).toMatchObject({ seq: 1, startedByName: "Kemal Usta", finishedByName: "Kemal Usta", minutes: 20 });
  expect(d?.steps[0]?.plannedDay).toBeInstanceOf(Date);
  expect(d?.steps[1]).toMatchObject({ startedByName: "Kemal Usta", finishedAt: null, finishedByName: null });
  expect(d).toMatchObject({ doneSteps: 1, status: "in_progress" });
  expect(d?.currentStation).toBe(d?.steps[1]?.stationName);
});

test("istasyon kuyruğu: ilk adımı bekleyen yalnızca malzemesi ayrılmış iş emri", async () => {
  await order();
  const wo = await firstWorkOrder();
  expect(await stationQueue(db, stationCodes[0] as string)).toEqual([]);
  await reserve(wo.id);
  const q = await stationQueue(db, stationCodes[0] as string);
  expect(q).toHaveLength(1);
  expect(q[0]).toMatchObject({ workOrderId: wo.id, state: "waiting", seq: 1, totalSteps: 3, minutes: 20, productName: "Sükût Komodin", qtyMilli: 1000 });
  expect(q[0]?.dueAt).toEqual(day("2026-12-15"));
});

test("kuyrukta önceki adımı bitmemiş iş görünmez; çalışan adım running olur", async () => {
  await order();
  const wo = await firstWorkOrder();
  await reserve(wo.id);
  await startNextStep(atolye, wo.id);
  expect((await stationQueue(db, stationCodes[0] as string))[0]?.state).toBe("running");
  expect(await stationQueue(db, stationCodes[1] as string)).toEqual([]);
  await finishCurrentStep(atolye, wo.id);
  expect(await stationQueue(db, stationCodes[0] as string)).toEqual([]);
  expect((await stationQueue(db, stationCodes[1] as string))[0]?.state).toBe("waiting");
  expect(await stationQueue(db, "yok")).toEqual([]);
});

test("kuyruk sırası: çalışan, sonra planlı gün, sonra kod", async () => {
  await receiveStock(depo, { materialId, qtyMilli: 20_000, unitCostKurus: 100 });
  for (const name of ["A", "B", "C"]) await order(1000, name);
  const ids = [...(await listWorkOrders(db))].sort((a, b) => a.code.localeCompare(b.code)).map((w) => w.id);
  // ids[0] plansız ama çalışıyor, ids[1] geç gün, ids[2] erken gün
  await planWorkOrder(planlama, { workOrderId: ids[1] as string, start: day("2026-11-20") });
  await planWorkOrder(planlama, { workOrderId: ids[2] as string, start: day("2026-11-17") });
  await startNextStep(atolye, ids[0] as string);
  const q = await stationQueue(db, stationCodes[0] as string);
  expect(q.map((i) => i.workOrderId)).toEqual([ids[0], ids[2], ids[1]]);
  expect(q.map((i) => i.state)).toEqual(["running", "waiting", "waiting"]);
});

test("listStations sıraya göre gelir", async () => {
  expect((await listStations(db)).map((s) => s.code)).toEqual(stationCodes);
});
