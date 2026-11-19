import { statSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { goodsReceipts, materials, purchaseOrderLines, purchaseOrders, stockMovements, supplierItems, suppliers, users } from "@/db/schema";
import { verifyLedger } from "@/domain/inventory/ledger";
import { verifyProductLedger } from "@/domain/production/productLedger";
import { isWorkday } from "@/domain/production/calendar";
import { listPurchaseOrders } from "@/domain/purchasing/queries";
import { purchaseSuggestions } from "@/domain/purchasing/suggestions";
import { DEFAULT_THRESHOLDS, approvalThresholds } from "@/domain/settings";
import { toKurus } from "@/domain/units";
import { SEED_MATERIALS } from "@/seed/data/materials";
import { SEED_SUPPLIERS } from "@/seed/data/suppliers";
import { seedBase } from "@/seed/base";
import { seedPurchasing } from "@/seed/purchasing";
import { seedSales } from "@/seed/sales";
import { loadSnapshot, SNAPSHOT_NOW, type Snapshot } from "@/seed/snapshot";
import committed from "@/seed/snapshot.generated.json";
import { createTestDb } from "../../helpers/testDb";

const ARKALIK = "MDF Lam 8 mm Beyaz Arkalık 2100×2800";
const OPEN = ["draft", "pending_approval", "sent", "partial"];
let db: Db;

beforeAll(async () => {
  db = await createTestDb({ fresh: true });
  await seedBase(db, { now: SNAPSHOT_NOW });
  await seedSales(db, { now: SNAPSHOT_NOW });
  await seedPurchasing(db, { now: SNAPSHOT_NOW });
}, 300_000);

const istanbulHour = (d: Date) => (d.getUTCHours() + 3) % 24;
const workHours = (d: Date) => isWorkday(new Date(Math.floor((d.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000)) && istanbulHour(d) >= 8 && istanbulHour(d) < 18;

test("7 tedarikçi; her malzemenin tam bir tercihli kalemi var; fiyatlar kaynaklı fiyatla tutarlı", async () => {
  expect(SEED_SUPPLIERS).toHaveLength(7);
  const rows = await db.select().from(suppliers);
  expect(rows).toHaveLength(7);
  for (const s of rows) expect(s.phone).toMatch(/^0 2\d\d 000 00 \d\d$/);
  const mats = await db.select().from(materials);
  const items = await db.select().from(supplierItems);
  const nameOf = new Map(mats.map((m) => [m.id, m.name]));
  const spec = new Map(SEED_MATERIALS.map((m) => [m.name, m]));
  for (const m of mats) expect(items.filter((i) => i.materialId === m.id && i.isPreferred), m.name).toHaveLength(1);
  for (const i of items) {
    const m = spec.get(nameOf.get(i.materialId) ?? "");
    if (!m) throw new Error("malzeme yok");
    const base = toKurus(m.price);
    if (i.isPreferred) expect(i.unitPriceMinor, m.name).toBe(base);
    else {
      expect(i.unitPriceMinor / base, m.name).toBeGreaterThanOrEqual(1.04 - 0.001);
      expect(i.unitPriceMinor / base, m.name).toBeLessThanOrEqual(1.08 + 0.001);
    }
    expect(i.moqMilli).toBeGreaterThan(0);
  }
  // Panel ve hırdavatta birer alternatif tedarikçi var.
  const alternatives = new Set(items.filter((i) => !i.isPreferred).map((i) => spec.get(nameOf.get(i.materialId) ?? "")?.category));
  expect([...alternatives].sort()).toEqual(["hirdavat", "panel"]);
  // Teslim süresi, tercihli olduğu hiçbir malzemenin süresinden uzun değil.
  for (const s of rows) {
    for (const i of items.filter((x) => x.supplierId === s.id && x.isPreferred)) expect(s.leadTimeDays).toBeLessThanOrEqual(spec.get(nameOf.get(i.materialId) ?? "")?.leadTimeDays ?? 0);
  }
});

test("onay eşikleri settings'te; her sipariş durumundan en az bir tane; Yönetim onayı bekleyen 250.000 TL üstü", async () => {
  expect(await approvalThresholds(db)).toEqual(DEFAULT_THRESHOLDS);
  const orders = await listPurchaseOrders(db, { now: SNAPSHOT_NOW });
  expect(orders.length).toBeLessThanOrEqual(10);
  for (const status of ["draft", "pending_approval", "sent", "partial", "received", "cancelled"]) {
    expect(orders.filter((o) => o.status === status).length, status).toBeGreaterThanOrEqual(1);
  }
  const people = new Map((await db.select().from(users)).map((u) => [u.id, u.name]));
  const board = orders.filter((o) => o.status === "pending_approval" && o.requiredTier === 2);
  expect(board).toHaveLength(1);
  expect(board[0]?.netKurus).toBeGreaterThan(DEFAULT_THRESHOLDS.boardKurus);
  expect(board[0]?.managerApprovedBy).not.toBeNull();
  expect(board[0]?.boardApprovedBy).toBeNull();
  const manager = orders.filter((o) => o.status === "pending_approval" && o.requiredTier === 1);
  expect(manager).toHaveLength(1);
  expect(manager[0]?.managerApprovedBy).toBeNull();
  expect(people.get(manager[0]?.createdById ?? "")).toBe("Kerem Uysal");
  expect(manager[0]?.netKurus).toBeGreaterThan(DEFAULT_THRESHOLDS.managerKurus);
  expect(manager[0]?.netKurus).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.boardKurus);
});

test("arkalık için açık satın alma siparişi yok", async () => {
  const [arkalik] = (await db.select().from(materials)).filter((m) => m.name === ARKALIK);
  const open = await db.select({ status: purchaseOrders.status }).from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId)).where(eq(purchaseOrderLines.materialId, arkalik?.id ?? ""));
  expect(open.filter((r) => OPEN.includes(r.status))).toEqual([]);
});

test("bütün satın alma zamanları mesai içinde ve şimdiden önce; mal kabul hareketleri seedSales'ten sonra", async () => {
  // Belge olayları iş gününe düşer. Mal kabuller seedSales'in son hareketinden (cumartesi akşamı olabilir) hemen sonradır;
  // yüklemede hafta sonu değerleri son iş gününe çekilir (snapshotDates.test.ts satın alma tablolarını da gezer).
  const documents: [string, Date | null][] = [];
  const receiptsAt: [string, Date | null][] = [];
  for (const o of await db.select().from(purchaseOrders)) {
    documents.push([`${o.code} createdAt`, o.createdAt], [`${o.code} submittedAt`, o.submittedAt], [`${o.code} managerApprovedAt`, o.managerApprovedAt], [`${o.code} sentAt`, o.sentAt], [`${o.code} cancelledAt`, o.cancelledAt]);
    receiptsAt.push([`${o.code} receivedAt`, o.receivedAt]);
  }
  for (const s of await db.select().from(suppliers)) documents.push([`${s.code} createdAt`, s.createdAt]);
  for (const r of await db.select().from(goodsReceipts)) receiptsAt.push([`${r.code} createdAt`, r.createdAt]);
  for (const [label, at] of documents) {
    if (at === null) continue;
    expect(workHours(at), label).toBe(true);
    expect(at.getTime(), label).toBeLessThan(SNAPSHOT_NOW.getTime());
  }
  for (const [label, at] of receiptsAt) {
    if (at === null) continue;
    expect(istanbulHour(at), label).toBeGreaterThanOrEqual(8);
    expect(istanbulHour(at), label).toBeLessThan(18);
    expect(at.getTime(), label).toBeLessThan(SNAPSHOT_NOW.getTime());
  }
  const moves = await db.select().from(stockMovements);
  const receipts = moves.filter((m) => m.refType === "purchase_order" && m.type === "receipt");
  expect(receipts.length).toBeGreaterThan(0);
  const salesLast = Math.max(...moves.filter((m) => m.refType !== "purchase_order").map((m) => m.createdAt.getTime()));
  for (const m of receipts) {
    expect(m.createdAt.getTime()).toBeGreaterThan(salesLast);
    expect(istanbulHour(m.createdAt)).toBeLessThan(18);
  }
});
test("iki defter tutarlı", async () => {
  expect(await verifyLedger(db)).toEqual([]);
  expect(await verifyProductLedger(db)).toEqual([]);
});

const snapshot = committed as Snapshot;
const DAYS = [
  ["pazartesi", "2027-03-01"],
  ["salı", "2027-03-02"],
  ["çarşamba", "2027-03-03"],
  ["perşembe", "2027-03-04"],
  ["cuma", "2027-03-05"],
  ["cumartesi", "2027-03-06"],
  ["pazar", "2027-03-07"],
] as const;

describe.each(DAYS)("yüklenen anlık görüntü %s 10:00'da açılınca", (_label, date) => {
  const now = new Date(`${date}T10:00:00+03:00`);
  let loaded: Db;
  beforeAll(async () => {
    loaded = await createTestDb({ fresh: true });
    await loadSnapshot(loaded, snapshot, now);
  }, 120_000);

  test("arkalığın öneri grubu var ve tutarı 50.000–250.000 TL arasında (müdür onayı)", async () => {
    const group = (await purchaseSuggestions(loaded)).find((g) => g.lines.some((l) => l.name === ARKALIK));
    expect(group).toBeDefined();
    expect(group?.supplierId).not.toBeNull();
    expect(group?.netMinor).toBeGreaterThan(DEFAULT_THRESHOLDS.managerKurus);
    expect(group?.netMinor).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.boardKurus);
    expect(group?.requiredTier).toBe(1);
  });

  test("en az bir geciken satın alma siparişi var", async () => {
    const late = (await listPurchaseOrders(loaded, { now })).filter((o) => o.late);
    expect(late.length).toBeGreaterThanOrEqual(1);
  });
});

test("anlık görüntü 650 KB'ın altında", () => {
  expect(statSync("src/seed/snapshot.generated.json").size).toBeLessThan(650_000);
});
