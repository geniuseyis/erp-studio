import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  auditLog,
  customers,
  materials,
  productMovements,
  products,
  salesOrderLines,
  salesOrders,
  stockCounts,
  stockMovements,
  users,
  workOrders,
  workOrderSteps,
} from "@/db/schema";
import { isWorkday, prevWorkday, workdaysBetween } from "@/domain/production/calendar";
import { deterministicUuid, loadSnapshot, type Snapshot } from "@/seed/snapshot";
import committed from "@/seed/snapshot.generated.json";
import { createTestDb } from "../../helpers/testDb";

const snapshot = committed as Snapshot;
const takenAt = new Date(snapshot.takenAt);

/** Tarih sütunu olan bütün tablolar. */
const TABLES: PgTable[] = [
  users,
  materials,
  stockMovements,
  stockCounts,
  products,
  customers,
  salesOrders,
  salesOrderLines,
  workOrders,
  workOrderSteps,
  productMovements,
  auditLog,
];
/** Planlanan gün ve termin gelecekte olabilir; geri kalan her şey yükleme anında geçmiştir. */
const MAY_BE_FUTURE = new Set(["dueAt", "plannedDay", "plannedStart"]);

const dateColumns = (table: PgTable) =>
  Object.entries(getTableColumns(table))
    .filter(([, c]) => c.dataType === "date")
    .map(([key]) => key);

const istanbul = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 16);

/** Anlık görüntüdeki ham değer (epoch ms), satır kimliğine göre. */
function rawDates(tableName: string, column: string): Map<string, number> {
  const data = snapshot.tables[tableName];
  if (!data) throw new Error(`tablo yok: ${tableName}`);
  const id = data.columns.indexOf("id");
  const col = data.columns.indexOf(column);
  const out = new Map<string, number>();
  for (const row of data.rows) {
    const value = row[col];
    if (typeof value === "number") out.set(deterministicUuid(row[id] as number), value);
  }
  return out;
}

describe.each([
  ["çarşamba", new Date("2027-03-03T10:00:00+03:00")],
  ["cumartesi", new Date("2027-03-06T10:00:00+03:00")],
])("anlık görüntü %s 10:00'da yüklenince", (_label, now) => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb({ fresh: true });
    await loadSnapshot(db, snapshot, now);
  }, 120_000);

  test("hiçbir tarih hafta sonuna düşmez; termin ve plan dışında hiçbiri gelecekte değildir", async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const table of TABLES) {
      const columns = dateColumns(table);
      const rows = (await db.select().from(table)) as Record<string, unknown>[];
      for (const row of rows) {
        for (const key of columns) {
          const value = row[key];
          if (!(value instanceof Date)) continue;
          checked += 1;
          if (!isWorkday(value)) problems.push(`${getTableName(table)}.${key} hafta sonu: ${istanbul(value)}`);
          if (!MAY_BE_FUTURE.has(key) && value.getTime() > now.getTime()) problems.push(`${getTableName(table)}.${key} gelecekte: ${istanbul(value)}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(7_000);
  });

  test("en yeni kayıt bir önceki iş gününde; saatler mesai içinde kalır", async () => {
    const movements = await db.select().from(stockMovements);
    const newest = new Date(Math.max(...movements.map((m) => m.createdAt.getTime())));
    expect(istanbul(newest).slice(0, 10)).toBe(istanbul(prevWorkday(now)).slice(0, 10));
    for (const m of movements) {
      const hour = (m.createdAt.getUTCHours() + 3) % 24;
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(18);
    }
  });

  test("iş günü aralıkları korunur: plan günleri ve terminler aynı iş günü uzaklığında kalır", async () => {
    const from = prevWorkday(takenAt);
    const to = prevWorkday(now);
    const plan = rawDates("work_order_steps", "plannedDay");
    for (const s of await db.select().from(workOrderSteps)) {
      const original = plan.get(s.id);
      if (original === undefined || !s.plannedDay) continue;
      expect(workdaysBetween(to, s.plannedDay), s.id).toBe(workdaysBetween(from, new Date(original)));
    }
    const due = rawDates("sales_orders", "dueAt");
    for (const o of await db.select().from(salesOrders)) {
      const original = due.get(o.id);
      if (original === undefined || !o.dueAt) continue;
      expect(workdaysBetween(to, o.dueAt), o.code).toBe(workdaysBetween(from, new Date(original)));
      // Termin gün başlangıcı olarak kalır.
      expect(istanbul(o.dueAt).slice(11)).toBe("00:00");
    }
  });

  test("anlık görüntüde gelecekte olan plan günleri yüklemede de bugün ya da sonrasıdır", async () => {
    const plan = rawDates("work_order_steps", "plannedDay");
    const futureIds = [...plan].filter(([, ms]) => ms > takenAt.getTime()).map(([id]) => id);
    expect(futureIds.length).toBeGreaterThan(0);
    const todayStart = new Date(Math.floor((now.getTime() + 3 * 3_600_000) / 86_400_000) * 86_400_000 - 3 * 3_600_000);
    for (const s of await db.select().from(workOrderSteps)) {
      if (futureIds.includes(s.id)) expect(s.plannedDay?.getTime(), s.id).toBeGreaterThanOrEqual(todayStart.getTime());
    }
  });
});
