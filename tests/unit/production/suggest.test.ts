import { sql } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { workOrders, workOrderSteps } from "@/db/schema";
import { addWorkdays } from "@/domain/production/calendar";
import { suggestDueDate } from "@/domain/production/schedule";
import { addBomLine, addMaterial, addProduct, addRouting, addStation, addUser, NOW } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let userId: string;
let product: Awaited<ReturnType<typeof addProduct>>;
let station: Record<"Kesim" | "Montaj" | "Boya", string>;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

// NOW: pazar 15 Kasım 2026 09:00; sonraki iş günü pazartesi 16.11.
// Rota Kesim (100 dk) → Montaj (960 dk) → Boya (300 dk), birim başına 20 dk.
async function routed(over: Parameters<typeof addProduct>[1] = {}) {
  const p = await addProduct(db, over);
  for (const [index, id] of [station.Kesim, station.Montaj, station.Boya].entries()) {
    await addRouting(db, { productId: p.id, seq: index + 1, stationId: id, minutesPerUnit: 20 });
  }
  return p;
}

beforeEach(async () => {
  db = await createTestDb();
  userId = (await addUser(db, "planlama", "uzman")).id;
  station = {
    Kesim: (await addStation(db, { name: "Kesim", dailyCapacityMin: 100 })).id,
    Montaj: (await addStation(db, { name: "Montaj", dailyCapacityMin: 960 })).id,
    Boya: (await addStation(db, { name: "Boya", dailyCapacityMin: 300 })).id,
  };
  product = await routed();
});

let loadSeq = 0;
/** İstasyona verilen günlerde planlı (bitmemiş) yük koyar: tek iş emri, gün başına bir adım. */
async function load(stationId: string, days: Date[], minutes: number) {
  loadSeq += 1;
  const [wo] = await db
    .insert(workOrders)
    .values({ code: `IE-YUK-${loadSeq}`, productId: product.id, qtyMilli: 1000, createdBy: userId, createdAt: NOW })
    .returning();
  await db.insert(workOrderSteps).values(days.map((d, i) => ({ workOrderId: wo!.id, seq: i + 1, stationId, minutes, plannedDay: d })));
}

test("mamul stoğu yeten ürün: sonraki iş günü, basis stok", async () => {
  const stocked = await routed({ onHandMilli: 5000, reservedMilli: 1000 });
  const s = await suggestDueDate(db, { lines: [{ productId: stocked.id, qtyMilli: 4000 }], now: NOW });
  expect(s).toEqual({ dueAt: day("2026-11-16"), basis: "stok", detail: "stokta var" });

  // Kullanılabilir 4 adet; 5 isteyince 1 adet üretilir: Kesim 16, Montaj 17, Boya 18 → termin 19.11.
  const partial = await suggestDueDate(db, { lines: [{ productId: stocked.id, qtyMilli: 5000 }], now: NOW });
  expect(partial).toEqual({ dueAt: day("2026-11-19"), basis: "kapasite", detail: `${stocked.code} × 5: üretim 3 iş günü` });
});

test("dolu Montaj gününü atlar; adımlar ardışık iş günlerine dizilir", async () => {
  await load(station.Montaj, [day("2026-11-17")], 950);
  const s = await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 1000 }], now: NOW });
  // Kesim 16, Montaj 17'de dolu → 18, Boya 19 → termin 20.11.
  expect(s).toEqual({ dueAt: day("2026-11-20"), basis: "kapasite", detail: `${product.code} × 1: Montaj 17.11'de dolu` });
});

test("önceki satırın geçici yükü sayılır; sipariş termini en geç satırdan, detail o satırı söyler", async () => {
  const other = await routed();
  const s = await suggestDueDate(db, {
    lines: [
      { productId: product.id, qtyMilli: 3000 }, // Kesim 60 dk, 16.11
      { productId: other.id, qtyMilli: 3000 }, // Kesim 60 dk: 16.11'de 120 > 100 → 17.11
    ],
    now: NOW,
  });
  // İkinci satır: Kesim 17, Montaj 18, Boya 19 → 20.11.
  expect(s).toEqual({ dueAt: day("2026-11-20"), basis: "kapasite", detail: `${other.code} × 3: Kesim 16.11'de dolu` });
});

test("kapasiteden büyük adım yükü olmayan ilk güne kendi başına yerleşir", async () => {
  await load(station.Kesim, [day("2026-11-16")], 10);
  const s = await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 10_000 }], now: NOW });
  // Kesim 200 dk > 100: 16.11'de yük var → 17.11; Montaj 18, Boya (200 ≤ 300) 19 → 20.11.
  expect(s).toEqual({ dueAt: day("2026-11-20"), basis: "kapasite", detail: `${product.code} × 10: Kesim 16.11'de dolu` });
});

test("malzeme eksikse başlangıç en uzun tedarik süresi kadar kayar", async () => {
  const slow = await addMaterial(db, { name: "Meşe Tabla", leadTimeDays: 5 });
  const fast = await addMaterial(db, { name: "Vida", leadTimeDays: 2 });
  const stocked = await addMaterial(db, { name: "Menteşe", leadTimeDays: 9, onHandMilli: 10_000 });
  for (const m of [slow, fast, stocked]) await addBomLine(db, { productId: product.id, materialId: m.id, qtyMilli: 1000 });

  const s = await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 2000 }], now: NOW });
  // 15.11 + 5 iş günü = 23.11; üretim ertesi iş günü 24.11: Kesim 24, Montaj 25, Boya 26 → 27.11.
  expect(s).toEqual({ dueAt: day("2026-11-27"), basis: "malzeme", detail: `${slow.code} Meşe Tabla için 5 iş günü tedarik` });
});

test("cuma öğleden sonra istenen öneri hafta sonunu atlar", async () => {
  const friday = new Date("2026-11-20T15:30:00+03:00");
  const stocked = await routed({ onHandMilli: 1000 });
  expect((await suggestDueDate(db, { lines: [{ productId: stocked.id, qtyMilli: 1000 }], now: friday })).dueAt).toEqual(day("2026-11-23"));
  const s = await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 1000 }], now: friday });
  // Kesim pzt 23, Montaj 24, Boya 25 → 26.11.
  expect(s).toEqual({ dueAt: day("2026-11-26"), basis: "kapasite", detail: `${product.code} × 1: üretim 3 iş günü` });
});

test("60 iş günü içinde yer yoksa kapasite: 60 iş günü içinde yer yok", async () => {
  const first = day("2026-11-16");
  await load(
    station.Montaj,
    Array.from({ length: 61 }, (_, i) => addWorkdays(first, i)),
    960,
  );
  const s = await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 1000 }], now: NOW });
  expect(s).toEqual({ dueAt: addWorkdays(first, 60), basis: "kapasite", detail: "60 iş günü içinde yer yok" });
});

test("öneri hiçbir şey yazmaz", async () => {
  const m = await addMaterial(db, { leadTimeDays: 3 });
  await addBomLine(db, { productId: product.id, materialId: m.id, qtyMilli: 1000 });
  await load(station.Montaj, [day("2026-11-17")], 950);
  const counts = async () =>
    (
      await db.execute(sql`select
        (select count(*) from audit_log)::int as audit,
        (select count(*) from work_orders)::int as wos,
        (select count(*) from work_order_steps)::int as steps,
        (select count(*) from stock_movements)::int as moves,
        (select count(*) from product_movements)::int as pmoves,
        (select coalesce(sum(reserved_milli), 0) from materials)::int as mres,
        (select coalesce(sum(reserved_milli), 0) from products)::int as pres`)
    ).rows;
  const before = await counts();
  await suggestDueDate(db, { lines: [{ productId: product.id, qtyMilli: 2000 }], now: NOW });
  expect(await counts()).toEqual(before);
});
