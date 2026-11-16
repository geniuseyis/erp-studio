import { desc } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { auditLog, departments, stockCountLines, stockCounts, stockMovements, users } from "@/db/schema";
import { login } from "@/domain/auth";
import { receiveStock, verifyLedger } from "@/domain/inventory/ledger";
import { listCounts, listMaterials } from "@/domain/inventory/queries";
import { DEMO_PASSWORD, seedBase } from "@/seed/base";
import { exportSnapshot, loadSnapshot, type Snapshot, SNAPSHOT_NOW } from "@/seed/snapshot";
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
  counts: {
    departments: (await db.select().from(departments)).length,
    movements: (await db.select().from(stockMovements)).length,
    stockCounts: (await db.select().from(stockCounts)).length,
    countLines: (await db.select().from(stockCountLines)).length,
    audit: (await db.select().from(auditLog)).length,
  },
});

beforeAll(async () => {
  loaded = await createTestDb({ fresh: true });
  await loadSnapshot(loaded, snapshot, now);
  generated = await createTestDb({ fresh: true });
  await seedBase(generated, { now: SNAPSHOT_NOW });
}, 120_000);

test("depodaki anlık görüntü güncel: seedBase çıktısıyla aynı veriyi taşır", async () => {
  // Bu test kırılırsa: npm run seed:snapshot
  expect(await projection(loaded)).toEqual(await projection(generated));
  expect(snapshot.takenAt).toBe(SNAPSHOT_NOW.toISOString());
});

test("yüklenen veri tutarlı: defter toplamları tutar, demo girişi çalışır", async () => {
  expect(await verifyLedger(loaded)).toEqual([]);
  expect((await login(loaded, "onur.tekin@baltacioglus.example", DEMO_PASSWORD)).departmentCode).toBe("depo");
  expect(await listCounts(loaded)).toHaveLength(1);
});

test("tarihler yükleme gününe tam gün kaydırılır: saatler korunur, hiçbiri gelecekte değil", async () => {
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

test("dışa aktarma ve yükleme aynı veriyi geri verir", async () => {
  const copy = await createTestDb({ fresh: true });
  await loadSnapshot(copy, await exportSnapshot(generated, SNAPSHOT_NOW), SNAPSHOT_NOW);
  expect(await projection(copy)).toEqual(await projection(generated));
  const original = await generated.select().from(stockMovements).orderBy(stockMovements.seq);
  const copied = await copy.select().from(stockMovements).orderBy(stockMovements.seq);
  expect(copied).toEqual(original);
});
