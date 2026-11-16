import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import type { Ctx } from "@/domain/context";
import { createCount } from "@/domain/inventory/counts";
import { issueStock, receiveStock, reserveStock } from "@/domain/inventory/ledger";
import { createMaterial, updateMaterial } from "@/domain/inventory/materials";
import { getMaterial, inventorySummary, listMaterials, listMovements } from "@/domain/inventory/queries";
import { addMaterial, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  ctx = ctxFor(db, await addUser(db, "depo", "uzman", { name: "Onur Tekin" }));
});

test.each(["mese", "MEŞE", "meşe", "Mese", " meşe "])("arama '%s' Meşe masifi bulur", async (search) => {
  await addMaterial(db, { name: "Meşe masif 40 mm", category: "masif", unit: "m3" });
  await addMaterial(db, { name: "Ceviz masif 40 mm", category: "masif", unit: "m3" });
  const rows = await listMaterials(db, { search });
  expect(rows.map((r) => r.name)).toEqual(["Meşe masif 40 mm"]);
});

test.each(["ISIL", "ısıl", "isil", "İŞLEMLİ", "islemli"])("arama '%s' Isıl işlemli kayını bulur", async (search) => {
  await addMaterial(db, { name: "Isıl işlemli kayın", category: "masif", unit: "m3" });
  await addMaterial(db, { name: "Ceviz masif", category: "masif", unit: "m3" });
  expect((await listMaterials(db, { search })).map((r) => r.name)).toEqual(["Isıl işlemli kayın"]);
});

test("arama kodda da çalışır; boş arama hepsini döner; kod sırasıyla gelir", async () => {
  await addMaterial(db, { code: "MLZ-0002", name: "B" });
  await addMaterial(db, { code: "MLZ-0001", name: "A" });
  expect((await listMaterials(db, { search: "mlz-0002" })).map((r) => r.name)).toEqual(["B"]);
  expect((await listMaterials(db, { search: "  " })).map((r) => r.code)).toEqual(["MLZ-0001", "MLZ-0002"]);
  expect((await listMaterials(db)).length).toBe(2);
});

test("kritik: kullanılabilir miktar yeniden sipariş noktasının altındaysa; eşitse kritik değil", async () => {
  const under = await addMaterial(db, { name: "Altında", reorderPointMilli: 5_000 });
  const equal = await addMaterial(db, { name: "Eşit", reorderPointMilli: 5_000 });
  const reserved = await addMaterial(db, { name: "Ayrılmış", reorderPointMilli: 5_000 });
  await receiveStock(ctx, { materialId: under.id, qtyMilli: 4_999, unitCostKurus: 100 });
  await receiveStock(ctx, { materialId: equal.id, qtyMilli: 5_000, unitCostKurus: 100 });
  await receiveStock(ctx, { materialId: reserved.id, qtyMilli: 9_000, unitCostKurus: 100 });
  await reserveStock(ctx, { materialId: reserved.id, qtyMilli: 4_500, ref: { type: "work_order", id: "1" } });
  const crit = await listMaterials(db, { criticalOnly: true });
  expect(crit.map((r) => r.name).sort()).toEqual(["Altında", "Ayrılmış"]);
  expect((await getMaterial(db, equal.id))?.isCritical).toBe(false);
  expect((await getMaterial(db, reserved.id))?.availableMilli).toBe(4_500);
});

test("kategori süzgeci", async () => {
  await addMaterial(db, { name: "MDF", category: "panel", unit: "plaka" });
  await addMaterial(db, { name: "Menteşe", category: "hirdavat" });
  expect((await listMaterials(db, { category: "panel" })).map((r) => r.name)).toEqual(["MDF"]);
});

test("özet, tek tek malzemelerin toplamına eşittir", async () => {
  const a = await addMaterial(db, { reorderPointMilli: 100_000 });
  const b = await addMaterial(db);
  await receiveStock(ctx, { materialId: a.id, qtyMilli: 1_500, unitCostKurus: 20_000 });
  await receiveStock(ctx, { materialId: b.id, qtyMilli: 2_000, unitCostKurus: 5_050 });
  await createCount(ctx, { materialIds: [a.id] });
  const rows = await listMaterials(db);
  expect(await inventorySummary(db)).toEqual({
    totalValueKurus: rows.reduce((s, r) => s + r.stockValueKurus, 0),
    materialCount: 2,
    criticalCount: 1,
    openCounts: 1,
  });
  expect((await inventorySummary(db)).totalValueKurus).toBe(30_000 + 10_100);
});

test("hareket listesi yeniden eskiye sıralı, malzeme ve kullanıcı adıyla; süzgeçler çalışır", async () => {
  const a = await addMaterial(db, { name: "A", unit: "m" });
  const b = await addMaterial(db, { name: "B" });
  const t = (iso: string) => ({ ...ctx, now: new Date(iso) });
  await receiveStock(t("2026-11-01T10:00:00Z"), { materialId: a.id, qtyMilli: 5_000, unitCostKurus: 100 });
  await receiveStock(t("2026-11-02T10:00:00Z"), { materialId: b.id, qtyMilli: 5_000, unitCostKurus: 100 });
  await issueStock(t("2026-11-03T10:00:00Z"), { materialId: a.id, qtyMilli: 1_000 });
  await issueStock(t("2026-11-03T10:00:00Z"), { materialId: a.id, qtyMilli: 2_000 });

  const all = await listMovements(db);
  expect(all.map((m) => m.deltaOnHandMilli)).toEqual([-2_000, -1_000, 5_000, 5_000]);
  expect(all[0]).toMatchObject({ materialName: "A", materialCategory: "hirdavat", unit: "m", userName: "Onur Tekin", type: "issue" });

  expect((await listMovements(db, { materialId: b.id })).length).toBe(1);
  expect((await listMovements(db, { type: "receipt" })).length).toBe(2);
  expect((await listMovements(db, { from: new Date("2026-11-02T00:00:00Z"), to: new Date("2026-11-02T23:59:59Z") })).length).toBe(1);
  expect((await listMovements(db, { limit: 3 })).length).toBe(3);
});

test("malzeme oluşturma: kod sırayla verilir, yetki ve doğrulama", async () => {
  const m1 = await createMaterial(ctx, { name: " MDF 18 mm ", category: "panel", unit: "plaka", reorderPointMilli: 20_000 });
  const m2 = await createMaterial(ctx, { name: "Sunta", category: "panel", unit: "plaka" });
  expect([m1.code, m2.code]).toEqual(["MLZ-0001", "MLZ-0002"]);
  expect(m1).toMatchObject({ name: "MDF 18 mm", onHandMilli: 0, reorderPointMilli: 20_000 });
  await expect(createMaterial(ctx, { name: "X", category: "panel", unit: "plaka", code: "MLZ-0001" })).rejects.toMatchObject({ code: "DUPLICATE" });
  await expect(createMaterial(ctx, { name: " ", category: "panel", unit: "plaka" })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(createMaterial(ctx, { name: "X", category: "panel", unit: "plaka", reorderPointMilli: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
  const op = ctxFor(db, await addUser(db, "depo", "operator"));
  await expect(createMaterial(op, { name: "X", category: "panel", unit: "plaka" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("malzeme düzenleme stok ve maliyet alanlarına dokunmaz", async () => {
  const m = await createMaterial(ctx, { name: "MDF", category: "panel", unit: "plaka" });
  await receiveStock(ctx, { materialId: m.id, qtyMilli: 3_000, unitCostKurus: 500 });
  await updateMaterial(ctx, m.id, { name: "MDF 18 mm", shelf: "A-03", reorderPointMilli: 10_000, leadTimeDays: 5 });
  expect(await getMaterial(db, m.id)).toMatchObject({
    name: "MDF 18 mm",
    shelf: "A-03",
    reorderPointMilli: 10_000,
    leadTimeDays: 5,
    onHandMilli: 3_000,
    avgCostKurus: 500,
  });
  await expect(updateMaterial(ctx, m.id, { name: "" })).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(updateMaterial(ctx, "00000000-0000-0000-0000-000000000000", { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
