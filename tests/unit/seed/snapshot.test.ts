import { statSync } from "node:fs";
import { asc, desc, getTableColumns, getTableName } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  auditLog,
  customers,
  departments,
  productMovements,
  products,
  salesOrderLines,
  salesOrders,
  stockCountLines,
  stockCounts,
  stockMovements,
  users,
  workOrders,
  workOrderSteps,
} from "@/db/schema";
import { login } from "@/domain/auth";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { listCounts, listMaterials } from "@/domain/inventory/queries";
import { verifyProductLedger } from "@/domain/production/productLedger";
import { DEMO_PASSWORD, seedBase } from "@/seed/base";
import { seedSales } from "@/seed/sales";
import {
  deterministicUuid,
  exportSnapshot,
  loadSnapshot,
  makeDateShift,
  SNAPSHOT_NOW,
  SNAPSHOT_TABLES,
  type Snapshot,
} from "@/seed/snapshot";
import committed from "@/seed/snapshot.generated.json";
import { ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

const DAY = 86_400_000;
const now = new Date("2027-03-02T14:30:00+03:00");
const snapshot = committed as Snapshot;
let loaded: Db;
let generated: Db;

const projection = async (db: Db) => ({
  materials: (await listMaterials(db)).map((m) => [m.code, m.name, m.onHandMilli, m.reservedMilli, m.avgCostKurus, m.reorderPointMilli, m.shelf]),
  users: (await db.select().from(users)).map((u) => [u.email, u.name, u.departmentCode, u.level, u.title]).sort(),
  products: (await db.select().from(products).orderBy(asc(products.code))).map((p) => [p.code, p.name, p.onHandMilli, p.reservedMilli]),
  customers: (await db.select().from(customers).orderBy(asc(customers.code))).map((c) => [c.code, c.name, c.phone]),
  orders: (await db.select().from(salesOrders).orderBy(asc(salesOrders.code))).map((o) => [o.code, o.status]),
  workOrders: (await db.select().from(workOrders).orderBy(asc(workOrders.code))).map((w) => [w.code, w.status, w.materialsReserved, w.qtyMilli]),
  counts: {
    departments: (await db.select().from(departments)).length,
    movements: (await db.select().from(stockMovements)).length,
    productMovements: (await db.select().from(productMovements)).length,
    stockCounts: (await db.select().from(stockCounts)).length,
    countLines: (await db.select().from(stockCountLines)).length,
    lines: (await db.select().from(salesOrderLines)).length,
    steps: (await db.select().from(workOrderSteps)).length,
    audit: (await db.select().from(auditLog)).length,
  },
});

beforeAll(async () => {
  loaded = await createTestDb({ fresh: true });
  await loadSnapshot(loaded, snapshot, now);
  generated = await createTestDb({ fresh: true });
  await seedBase(generated, { now: SNAPSHOT_NOW });
  await seedSales(generated, { now: SNAPSHOT_NOW });
}, 300_000);

test("depodaki anlık görüntü güncel: seedBase ve seedSales çıktısıyla aynı veriyi taşır", async () => {
  // Bu test kırılırsa: npm run seed:snapshot
  expect(await projection(loaded)).toEqual(await projection(generated));
  expect(snapshot.takenAt).toBe(SNAPSHOT_NOW.toISOString());
});

test("anlık görüntü 700 KB'ın altında", () => {
  expect(statSync("src/seed/snapshot.generated.json").size).toBeLessThan(700_000);
});

test("anlık görüntü kimlik tablosu taşımaz", () => {
  expect("ids" in snapshot).toBe(false);
});

test("deterministicUuid geçerli v4 biçiminde ve ilk 20.000 değerde çakışmasız", () => {
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const seen = new Set<string>();
  for (let n = 0; n < 20_000; n++) {
    const id = deterministicUuid(n);
    if (!v4.test(id)) throw new Error(`geçersiz: ${n} → ${id}`);
    seen.add(id);
  }
  expect(seen.size).toBe(20_000);
  // Aynı sıra numarası her zaman aynı kimliği verir.
  expect(deterministicUuid(7)).toBe(deterministicUuid(7));
});

test("dışa aktar → yükle: bütün tablolar kimlikler sıra numarasına eşlenince birebir aynı", async () => {
  const copy = await createTestDb({ fresh: true });
  await loadSnapshot(copy, await exportSnapshot(generated, SNAPSHOT_NOW), SNAPSHOT_NOW);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const shift = makeDateShift(SNAPSHOT_NOW, SNAPSHOT_NOW);
  // Beklenen eşleme: tablolar yükleme sırasıyla gezilir, her farklı kimlik ilk görüldüğü sırada numara alır.
  const order = new Map<string, number>();
  const mapped = (value: string) => {
    let i = order.get(value);
    if (i === undefined) {
      i = order.size;
      order.set(value, i);
    }
    return deterministicUuid(i);
  };
  const canon = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(r)).sort();
  let textIds = 0;
  for (const table of SNAPSHOT_TABLES) {
    const all = getTableColumns(table);
    // Dışa aktarma birincil anahtara göre sıralı numaralar; beklenen eşleme de aynı sırayla kurulur (heap sırasına bağlı değil).
    const primary = Object.values(all).find((column) => column.primary);
    const read = generated.select().from(table).$dynamic();
    const original = (await (primary ? read.orderBy(primary) : read)) as Record<string, unknown>[];
    const expected = original.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          const type = all[key]?.columnType;
          if (value instanceof Date) return [key, new Date(shift(value.getTime()))];
          if ((type === "PgUUID" || type === "PgText") && typeof value === "string" && UUID.test(value)) {
            if (type === "PgText") textIds += 1;
            return [key, mapped(value)];
          }
          return [key, value];
        }),
      ),
    );
    const copied = (await copy.select().from(table)) as Record<string, unknown>[];
    expect(canon(copied), getTableName(table)).toEqual(canon(expected));
  }
  // ref_id ve entity_id gibi metin sütunlarındaki kimlikler de aynı eşlemeden geçti.
  expect(textIds).toBeGreaterThan(1_000);
});

test("yüklenen veri tutarlı: iki defter de tutar, demo girişi çalışır", async () => {
  expect(await verifyLedger(loaded)).toEqual([]);
  expect(await verifyProductLedger(loaded)).toEqual([]);
  expect((await login(loaded, "onur.tekin@baltacioglus.example", DEMO_PASSWORD)).departmentCode).toBe("depo");
  expect(await listCounts(loaded)).toHaveLength(1);
});

test("tarihler yükleme gününe iş günü olarak kaydırılır: saatler korunur, hiçbiri gelecekte değil", async () => {
  const istanbulHour = (d: Date) => (d.getUTCHours() + 3) % 24;
  const movements = await loaded.select().from(stockMovements);
  const newest = Math.max(...movements.map((m) => m.createdAt.getTime()));
  const oldest = Math.min(...movements.map((m) => m.createdAt.getTime()));
  expect(newest).toBeLessThanOrEqual(now.getTime());
  expect(newest).toBeGreaterThan(now.getTime() - 4 * DAY);
  expect(oldest).toBeGreaterThanOrEqual(now.getTime() - 31 * DAY);
  for (const m of movements) {
    expect(istanbulHour(m.createdAt)).toBeGreaterThanOrEqual(8);
    expect(istanbulHour(m.createdAt)).toBeLessThan(18);
  }
  const [count] = await loaded.select().from(stockCounts);
  expect(count?.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
  expect(count?.createdAt.getTime()).toBeGreaterThan(now.getTime() - 3 * DAY);
});

test("yüklemeden sonra yeni hareketin sıra numarası en büyüğün üstünde olur", async () => {
  const [last] = await loaded.select().from(stockMovements).orderBy(desc(stockMovements.seq)).limit(1);
  const user = await login(loaded, "onur.tekin@baltacioglus.example", DEMO_PASSWORD);
  const [material] = await listMaterials(loaded);
  const mv = await receiveStock(ctxFor(loaded, user, now), { materialId: material?.id ?? "", qtyMilli: 1000, unitCostKurus: 100 });
  expect(mv.seq).toBeGreaterThan(last?.seq ?? 0);
  expect(await verifyLedger(loaded)).toEqual([]);
});

test("dışa aktarma ve yükleme aynı veriyi geri verir; hafta içi tarihler aynı anda yüklenince değişmez", async () => {
  // Satır satır karşılaştırma (kimlik eşlemesi ve tarih kaydırmasıyla) aşağıdaki "birebir aynı" testinde.
  const copy = await createTestDb({ fresh: true });
  await loadSnapshot(copy, await exportSnapshot(generated, SNAPSHOT_NOW), SNAPSHOT_NOW);
  expect(await projection(copy)).toEqual(await projection(generated));
  const shift = makeDateShift(SNAPSHOT_NOW, SNAPSHOT_NOW);
  const weekday = (await generated.select().from(salesOrders)).map((o) => o.createdAt.getTime());
  expect(weekday.map(shift)).toEqual(weekday);
});
