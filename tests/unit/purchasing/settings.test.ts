import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { approvalThresholds, DEFAULT_THRESHOLDS, SETTING_KEYS } from "@/domain/settings";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

test("approvalThresholds: anahtar yokken { managerKurus: 5_000_000, boardKurus: 25_000_000 }", async () => {
  expect(DEFAULT_THRESHOLDS).toEqual({ managerKurus: 5_000_000, boardKurus: 25_000_000 });
  expect(await approvalThresholds(db)).toEqual({ managerKurus: 5_000_000, boardKurus: 25_000_000 });
});

test("approvalThresholds: settings'e yazılan değerleri okur; sayı olmayan değerde varsayılana döner", async () => {
  await db.insert(settings).values([
    { key: SETTING_KEYS.approvalManagerKurus, value: 1_000_000 },
    { key: SETTING_KEYS.approvalBoardKurus, value: 9_000_000 },
  ]);
  expect(await approvalThresholds(db)).toEqual({ managerKurus: 1_000_000, boardKurus: 9_000_000 });

  await db.update(settings).set({ value: "çok" });
  expect(await approvalThresholds(db)).toEqual(DEFAULT_THRESHOLDS);

  // yalnızca biri bozuksa o varsayılana döner, diğeri korunur
  await db.update(settings).set({ value: 2_000_000 }).where(eq(settings.key, SETTING_KEYS.approvalManagerKurus));
  expect(await approvalThresholds(db)).toEqual({ managerKurus: 2_000_000, boardKurus: DEFAULT_THRESHOLDS.boardKurus });
});

test("approvalThresholds: Yönetim eşiği müdür eşiğinin altına inemez; kademeler ters dönmez", async () => {
  // yalnızca müdür eşiği yükseltildi, Yönetim eşiği yok: varsayılan 25M, müdür 30M → Yönetim eşiği 30M'ye çekilir
  await db.insert(settings).values({ key: SETTING_KEYS.approvalManagerKurus, value: 30_000_000 });
  expect(await approvalThresholds(db)).toEqual({ managerKurus: 30_000_000, boardKurus: 30_000_000 });

  // açıkça yazılmış ters değerler de düzeltilir
  await db.insert(settings).values({ key: SETTING_KEYS.approvalBoardKurus, value: 8_000_000 });
  expect(await approvalThresholds(db)).toEqual({ managerKurus: 30_000_000, boardKurus: 30_000_000 });
});
