import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { workOrders, workOrderSteps } from "@/db/schema";
import type { Ctx } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { getProduct, getWorkOrder, kanbanColumns, listProducts, listStations, listWorkOrders, stationQueue } from "@/domain/production/queries";
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

test("birim maliyet = malzeme (ortalama maliyet, fire dahil) + rota dakikası × 2,91 TL × 2; kuruşa bir kez yuvarlanır", async () => {
  const p = await addProduct(db, { name: "Maliyet" });
  const m1 = await addMaterial(db, { unit: "plaka", avgCostKurus: 10_000 });
  const m2 = await addMaterial(db, { unit: "adet", avgCostKurus: 333 });
  const m3 = await addMaterial(db, { unit: "adet", avgCostKurus: 1 });
  await addBomLine(db, { productId: p.id, materialId: m1.id, qtyMilli: 2500, scrapPermille: 100 });
  await addBomLine(db, { productId: p.id, materialId: m2.id, qtyMilli: 3000 });
  await addBomLine(db, { productId: p.id, materialId: m3.id, qtyMilli: 400 });
  await addRouting(db, { productId: p.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 12 });
  await addRouting(db, { productId: p.id, seq: 2, stationId: (await addStation(db)).id, minutesPerUnit: 3 });
  // Malzeme: 2,5 x 1,1 x 10000 = 27500; 3 x 333 = 999; 0,4 x 1 = 0,4 → 28499,4 → 28499
  // İşçilik ve genel gider: 15 dk x 291 x 2 = 8730 → toplam 28499,4 + 8730 = 37229,4 → 37229
  const detail = await getProduct(db, p.id);
  expect(detail?.materialCostKurus).toBe(28_499);
  expect(detail?.unitCostKurus).toBe(37_229);
  expect((await listProducts(db, { search: "Maliyet" }))[0]).toMatchObject({ materialCostKurus: 28_499, unitCostKurus: 37_229 });
  // Ortak ürün: 2 x 100 = 200 malzeme; 3 x 20 dk x 582 = 34920
  expect((await listProducts(db)).find((x) => x.id === productId)).toMatchObject({ materialCostKurus: 200, unitCostKurus: 35_120 });
});

test("reçetesi ya da rotası olmayan üründe ilgili maliyet sıfırdır", async () => {
  const bare = await addProduct(db, { name: "Boş" });
  expect(await getProduct(db, bare.id)).toMatchObject({ materialCostKurus: 0, unitCostKurus: 0 });
  await addRouting(db, { productId: bare.id, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  expect(await getProduct(db, bare.id)).toMatchObject({ materialCostKurus: 0, unitCostKurus: 5_820 });
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
  expect(q[0]).toMatchObject({ workOrderId: wo.id, state: "waiting", seq: 1, position: 1, totalSteps: 3, minutes: 20, productName: "Sükût Komodin", qtyMilli: 1000 });
  expect(q[0]?.dueAt).toEqual(day("2026-12-15"));
});

test("seq 10, 20, 30 olan rotada konumlar 1, 2, 3", async () => {
  const gapped = (await addProduct(db, { name: "Boşluklu Rota" })).id;
  const codes: string[] = [];
  for (const seq of [10, 20, 30]) {
    const st = await addStation(db);
    codes.push(st.code);
    await addRouting(db, { productId: gapped, seq, stationId: st.id, minutesPerUnit: 5 });
  }
  await addBomLine(db, { productId: gapped, materialId, qtyMilli: 1000 });
  const o = await createOrder(satis, { customerId: (await addCustomer(db, { name: "Rota" })).id, dueAt: day("2026-12-15") });
  await addLine(satis, { orderId: o.id, productId: gapped, qtyMilli: 1000 });
  await confirmOrder(satis, o.id);
  const wo = (await listWorkOrders(db)).find((w) => w.productName === "Boşluklu Rota");
  if (!wo) throw new Error("iş emri yok");
  await reserve(wo.id);
  const positions: number[] = [];
  for (const code of codes) {
    const item = (await stationQueue(db, code))[0];
    positions.push(item?.position ?? 0);
    expect(item?.totalSteps).toBe(3);
    await startNextStep(atolye, wo.id);
    await finishCurrentStep(atolye, wo.id);
  }
  expect(positions).toEqual([1, 2, 3]);
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

test("iptal ya da tamamlanmış iş emrinde malzeme eksiği gösterilmez", async () => {
  await order();
  const wo = await firstWorkOrder();
  expect((await getWorkOrder(db, wo.id))?.shortages).toHaveLength(1);
  for (const status of ["cancelled", "completed"] as const) {
    await db.update(workOrders).set({ status }).where(eq(workOrders.id, wo.id));
    const detail = await getWorkOrder(db, wo.id);
    expect(detail?.materialsReserved, status).toBe(false);
    expect(detail?.shortages, status).toEqual([]);
  }
});

describe("kanbanColumns", () => {
  const NOW = new Date("2026-11-18T12:00:00+03:00");

  /** Onaylanmış siparişten gelen iş emirlerini kodla açar; her biri üç adımlıdır. */
  async function makeOrders(n: number) {
    for (let i = 0; i < n; i += 1) await order(1000, `Müşteri ${i}`);
    return [...(await listWorkOrders(db))].sort((a, b) => a.code.localeCompare(b.code));
  }
  const schedule = (id: string) => db.update(workOrderSteps).set({ plannedDay: day("2026-11-20") }).where(eq(workOrderSteps.workOrderId, id));
  const set = (id: string, patch: Partial<typeof workOrders.$inferInsert>) => db.update(workOrders).set(patch).where(eq(workOrders.id, id));
  const idsOf = (cols: Awaited<ReturnType<typeof kanbanColumns>>, key: string) => cols.find((c) => c.key === key)?.items.map((w) => w.id) ?? [];

  test("her açık iş emri tam bir sütunda; iptal hiçbir yerde, tamamlanan yalnızca son yedi günde", async () => {
    const wos = await makeOrders(8);
    const [planned, running, waiting, unplannedWaiting, unplanned, recent, old, cancelled] = wos.map((w) => w.id) as string[];
    // Planlı + malzemesi ayrılmış + günleri var: ilk adımın istasyonu.
    await set(planned!, { materialsReserved: true });
    await schedule(planned!);
    // Üretimde: ikinci adım çalışıyor.
    await set(running!, { status: "in_progress", materialsReserved: true });
    await schedule(running!);
    await db.update(workOrderSteps).set({ startedAt: NOW, finishedAt: NOW }).where(and(eq(workOrderSteps.workOrderId, running!), eq(workOrderSteps.seq, 1)));
    await db.update(workOrderSteps).set({ startedAt: NOW }).where(and(eq(workOrderSteps.workOrderId, running!), eq(workOrderSteps.seq, 2)));
    // Malzeme bekliyor, ama günleri var.
    await schedule(waiting!);
    // Hem malzeme bekliyor hem planlanmamış (adımların günü yok): Planlanmadı kazanır.
    // unplannedWaiting: varsayılan; malzeme ayrılmamış, gün yok. unplanned: malzeme ayrılmış, gün yok.
    await set(unplanned!, { materialsReserved: true });
    // Tamamlananlar: yedi günlük pencerenin içi (6 gün önce) ve dışı (7 gün önce).
    await set(recent!, { status: "completed", completedAt: new Date("2026-11-12T10:00:00+03:00") });
    await set(old!, { status: "completed", completedAt: new Date("2026-11-11T23:59:00+03:00") });
    await set(cancelled!, { status: "cancelled" });

    const cols = await kanbanColumns(db, NOW);
    expect(cols.map((c) => c.key)).toEqual(["waiting_material", "unplanned", ...stationCodes.map((c) => `station:${c}`), "completed"]);
    expect(cols.map((c) => c.title)).toEqual(["Malzeme bekliyor", "Planlanmadı", ...(await listStations(db)).map((s) => s.name), "Tamamlandı"]);

    expect(idsOf(cols, "waiting_material")).toEqual([waiting]);
    expect(idsOf(cols, "unplanned").sort()).toEqual([unplannedWaiting, unplanned].sort());
    expect(idsOf(cols, `station:${stationCodes[0]}`)).toEqual([planned]);
    expect(idsOf(cols, `station:${stationCodes[1]}`)).toEqual([running]);
    expect(idsOf(cols, `station:${stationCodes[2]}`)).toEqual([]);
    expect(idsOf(cols, "completed")).toEqual([recent]);

    // Her açık iş emri tam bir sütunda; iptal ve eski tamamlanan hiçbirinde.
    const placed = cols.flatMap((c) => c.items.map((w) => w.id));
    for (const id of [planned, running, waiting, unplannedWaiting, unplanned, recent]) expect(placed.filter((p) => p === id), id).toHaveLength(1);
    expect(placed).not.toContain(cancelled);
    expect(placed).not.toContain(old);
    expect(placed).toHaveLength(new Set(placed).size);
  });

  test("Planlanmadı sütunu planlanmamış süzgeciyle ve planın sayısıyla aynı koşulu kullanır", async () => {
    const wos = await makeOrders(4);
    await set(wos[0]!.id, { materialsReserved: true });
    await schedule(wos[0]!.id);
    await schedule(wos[1]!.id); // malzeme bekliyor ama planlı
    // wos[2], wos[3]: günsüz; biri malzeme bekliyor, biri ayrılmış
    await set(wos[3]!.id, { materialsReserved: true });
    const cols = await kanbanColumns(db, NOW);
    const listed = (await listWorkOrders(db, { unscheduled: true })).map((w) => w.id).sort();
    expect(idsOf(cols, "unplanned").sort()).toEqual(listed);
    expect(listed).toHaveLength(2);
    expect(idsOf(cols, "waiting_material")).toEqual([wos[1]!.id]);
  });

  test("tamamlandı yalnızca son 7 İstanbul günü: sınır gün başlangıcında", async () => {
    const wos = await makeOrders(4);
    // now = 18 Kasım; pencere 12 Kasım 00:00 (İstanbul) ile başlar.
    await set(wos[0]!.id, { status: "completed", completedAt: new Date("2026-11-12T00:00:00+03:00") });
    await set(wos[1]!.id, { status: "completed", completedAt: new Date("2026-11-11T23:59:59+03:00") });
    await set(wos[2]!.id, { status: "completed", completedAt: new Date("2026-11-18T09:00:00+03:00") });
    await set(wos[3]!.id, { status: "completed", completedAt: null });
    const done = idsOf(await kanbanColumns(db, NOW), "completed");
    expect(done.sort()).toEqual([wos[0]!.id, wos[2]!.id].sort());
    // Gün geçince pencere kayar.
    const later = idsOf(await kanbanColumns(db, new Date("2026-11-19T09:00:00+03:00")), "completed");
    expect(later).toEqual([wos[2]!.id]);
  });

  test("kartlar termin ve sipariş bilgisini taşır; açık sütunlar termine göre dizilir", async () => {
    const early = await createOrder(satis, { customerId: (await addCustomer(db, { name: "Erken" })).id, dueAt: day("2026-11-25") });
    await addLine(satis, { orderId: early.id, productId, qtyMilli: 2000 });
    await confirmOrder(satis, early.id);
    await order();
    const cols = await kanbanColumns(db, NOW);
    const items = cols.find((c) => c.key === "unplanned")!.items;
    expect(items.map((w) => w.dueAt)).toEqual([day("2026-11-25"), day("2026-12-15")]);
    expect(items[0]).toMatchObject({ orderCode: early.code, qtyMilli: 2000, doneSteps: 0, totalSteps: 3 });
  });
});
