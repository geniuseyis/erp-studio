import { beforeAll, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { MATERIAL_CATEGORIES, departments, stockMovements } from "@/db/schema";
import { login } from "@/domain/auth";
import { verifyLedger } from "@/domain/inventory/ledger";
import { getCount, listCounts, listMaterials } from "@/domain/inventory/queries";
import { listUsers } from "@/domain/users";
import { DEMO_PASSWORD, seedBase } from "@/seed/base";
import { createTestDb } from "../../helpers/testDb";

const now = new Date("2026-11-15T09:00:00+03:00");
const DAY = 86_400_000;
let a: Db;
let b: Db;

beforeAll(async () => {
  a = await createTestDb({ fresh: true });
  b = await createTestDb({ fresh: true });
  await seedBase(a, { now });
  await seedBase(b, { now });
}, 120_000);

test("örnek veri tutarlı: hareketlerin toplamı eldeki stoğa eşit", async () => {
  expect(await verifyLedger(a)).toEqual([]);
});

test("aynı tohum aynı veriyi üretir", async () => {
  const key = (rows: Awaited<ReturnType<typeof listMaterials>>) =>
    rows.map((m) => [m.code, m.name, m.onHandMilli, m.reservedMilli, m.avgCostKurus]);
  expect(key(await listMaterials(a))).toEqual(key(await listMaterials(b)));
  expect((await a.select().from(stockMovements)).length).toBe((await b.select().from(stockMovements)).length);
});

test("en az 36 malzeme, her kategoride en az 3; kodlar MLZ-#### biçiminde", async () => {
  const rows = await listMaterials(a);
  expect(rows.length).toBeGreaterThanOrEqual(36);
  for (const c of MATERIAL_CATEGORIES) {
    expect(rows.filter((m) => m.category === c).length, c).toBeGreaterThanOrEqual(3);
  }
  expect(rows.every((m) => /^MLZ-\d{4}$/.test(m.code))).toBe(true);
  expect(rows.every((m) => m.avgCostKurus > 0 && m.reorderPointMilli > 0 && m.shelf !== "")).toBe(true);
});

test("4 ile 7 arasında malzeme kritik seviyede", async () => {
  const critical = (await listMaterials(a)).filter((m) => m.isCritical).length;
  expect(critical).toBeGreaterThanOrEqual(4);
  expect(critical).toBeLessThanOrEqual(7);
});

test("7 departman, 14 kullanıcı; her departmanda tam bir müdür", async () => {
  expect((await a.select().from(departments)).length).toBe(7);
  const users = await listUsers(a);
  expect(users).toHaveLength(14);
  const byDept = new Map<string, number>();
  for (const u of users.filter((x) => x.level === "mudur")) {
    byDept.set(u.departmentCode, (byDept.get(u.departmentCode) ?? 0) + 1);
  }
  expect([...byDept.values()]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  expect(users.every((u) => u.email.endsWith("@baltacioglus.example") && u.active)).toBe(true);
  expect(users.every((u) => /^[a-z.]+@/.test(u.email))).toBe(true);
});

test("demo parolasıyla giriş yapılır", async () => {
  const user = await login(a, "ayla.gunes@baltacioglus.example", DEMO_PASSWORD);
  expect(user).toMatchObject({ name: "Ayla Güneş", departmentCode: "satinalma", level: "mudur", title: "Satın Alma Müdürü" });
  expect((await login(a, "burak.sen@baltacioglus.example", DEMO_PASSWORD)).level).toBe("operator");
});

test("hareketler son 30 gün içinde, gelecekte değil; depo çalışanları yapmış", async () => {
  const movements = await a.select().from(stockMovements);
  const depo = new Set((await listUsers(a)).filter((u) => u.departmentCode === "depo").map((u) => u.id));
  expect(movements.length).toBeGreaterThan(36 * 4);
  for (const m of movements) {
    expect(m.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(m.createdAt.getTime()).toBeGreaterThanOrEqual(now.getTime() - 30 * DAY);
    expect(depo.has(m.userId)).toBe(true);
  }
});

test("bir açık sayım fişi var: 5 satır, 2'si sayılmış", async () => {
  const counts = await listCounts(a);
  expect(counts).toHaveLength(1);
  expect(counts[0]).toMatchObject({ status: "open", lineCount: 5, countedCount: 2 });
  expect((await getCount(a, counts[0]?.id ?? ""))?.lines).toHaveLength(5);
});

const istanbulHour = (d: Date) => (d.getUTCHours() + 3) % 24;

test("miktarlar birime uygun yuvarlanmış: adet, plaka ve metre tam; litre ve kilo tek ondalık", async () => {
  const rows = await listMaterials(a);
  const byId = new Map(rows.map((m) => [m.id, m]));
  const step = { adet: 1000, plaka: 1000, m: 1000, L: 100, kg: 100, m2: 100, m3: 10 } as const;
  for (const mv of await a.select().from(stockMovements)) {
    const unit = byId.get(mv.materialId)?.unit ?? "adet";
    expect(Math.abs(mv.deltaOnHandMilli) % step[unit], `${byId.get(mv.materialId)?.name}: ${mv.deltaOnHandMilli}`).toBe(0);
  }
});

test("hiçbir çıkış malzemenin yeniden sipariş noktasını aşmaz (tek seferde gerçek dışı miktar yok)", async () => {
  const byId = new Map((await listMaterials(a)).map((m) => [m.id, m]));
  for (const mv of (await a.select().from(stockMovements)).filter((m) => m.type === "issue")) {
    const material = byId.get(mv.materialId);
    expect(Math.abs(mv.deltaOnHandMilli), material?.name).toBeLessThanOrEqual(material?.reorderPointMilli ?? 0);
  }
});

test("hareketler mesai saatlerinde (08:00–18:00, İstanbul)", async () => {
  for (const mv of await a.select().from(stockMovements)) {
    expect(istanbulHour(mv.createdAt), mv.createdAt.toISOString()).toBeGreaterThanOrEqual(8);
    expect(istanbulHour(mv.createdAt), mv.createdAt.toISOString()).toBeLessThan(18);
  }
});
