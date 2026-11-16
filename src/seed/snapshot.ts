// Örnek verinin anlık görüntüsü.
// seedBase ve seedSales gerçek servisleri çağırarak veriyi üretir (on binlerce sorgu); bu Node'da yaklaşık 25 saniye,
// tarayıcıda dakikalar sürer.
// Bu yüzden veri derleme sırasında bir kez üretilip JSON'a yazılır (npm run seed:snapshot) ve tarayıcıda
// tablo başına birkaç toplu INSERT ile yüklenir. Tarihler yükleme anına iş günü olarak kaydırılır; vitrin hiç eskimiş
// görünmez ve hiçbir kayıt hafta sonuna düşmez.
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import {
  auditLog,
  bomLines,
  customers,
  departments,
  materials,
  productMovements,
  products,
  routings,
  salesOrderLines,
  salesOrders,
  settings,
  stations,
  stockCountLines,
  stockCounts,
  stockMovements,
  users,
  workOrderSteps,
  workOrders,
} from "@/db/schema";
import { istanbulDayStart, isWorkday, prevWorkday, shiftWorkdays, workdaysBetween } from "@/domain/production/calendar";

/** Anlık görüntünün üretildiği "şimdi" (pazar). Yüklemede tarihler bu andan yükleme anına iş günü olarak kaydırılır (makeDateShift). */
export const SNAPSHOT_NOW = new Date("2026-11-15T09:00:00+03:00");

/** Yabancı anahtar sırasıyla: önce başvurulan tablolar. */
const TABLES: PgTable[] = [
  departments,
  users,
  materials,
  stockMovements,
  stockCounts,
  stockCountLines,
  stations,
  products,
  bomLines,
  routings,
  customers,
  salesOrders,
  salesOrderLines,
  workOrders,
  workOrderSteps,
  productMovements,
  auditLog,
  settings,
];
const CHUNK = 400;

/**
 * Sıkıştırılmış ama kayıpsız biçim (1 MB sınırı için): her tablo sütun adları ve değer dizileri olarak durur,
 * tarihler epoch milisaniyesidir, uuid değerleri `ids` listesine bir kez yazılır ve satırlarda sıra
 * numarasıyla geçer. `uuidColumns`: sayı değeri `ids` sıra numarası olan sütunlar (metin sütunlarında
 * uuid olmayan değerler metin olarak kalır).
 */
export type SnapshotTable = { columns: string[]; uuidColumns: string[]; rows: unknown[][] };
export type Snapshot = {
  /** ISO tarih: verinin üretildiği an. */
  takenAt: string;
  ids: string[];
  tables: Record<string, SnapshotTable>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** uuid sıra numarasına çevrilebilen sütun türleri (drizzle columnType). */
const INTERNABLE = new Set(["PgUUID", "PgText"]);

function dateColumns(table: PgTable): string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => column.dataType === "date")
    .map(([key]) => key);
}

/** Veritabanındaki bütün örnek veriyi sıkıştırılmış JSON'a çevirir. */
export async function exportSnapshot(db: Db, takenAt: Date): Promise<Snapshot> {
  const ids: string[] = [];
  const index = new Map<string, number>();
  const tables: Snapshot["tables"] = {};
  for (const table of TABLES) {
    const all = getTableColumns(table);
    const columns = Object.keys(all);
    const dates = new Set(dateColumns(table));
    // Yalnızca uuid ve düz metin sütunları sıkıştırılır; json/jsonb değerleri karışık türde olabilir, dokunulmaz.
    const internable = new Set(columns.filter((key) => INTERNABLE.has(all[key]?.columnType ?? "")));
    const uuidColumns = new Set<string>();
    const rows = ((await db.select().from(table)) as Record<string, unknown>[]).map((row) =>
      columns.map((key) => {
        const value = row[key];
        if (dates.has(key) && value instanceof Date) return value.getTime();
        if (internable.has(key) && typeof value === "string" && UUID.test(value)) {
          uuidColumns.add(key);
          let i = index.get(value);
          if (i === undefined) {
            i = ids.length;
            ids.push(value);
            index.set(value, i);
          }
          return i;
        }
        return value;
      }),
    );
    tables[getTableName(table)] = { columns, uuidColumns: columns.filter((c) => uuidColumns.has(c)), rows };
  }
  return { takenAt: takenAt.toISOString(), ids, tables };
}

/**
 * Anlık görüntü tarihini yükleme anına taşıyan işlev (epoch ms → epoch ms). `n`, anlık görüntünün son iş günü
 * (`prevWorkday(takenAt)`) ile yüklemenin son iş günü (`prevWorkday(now)`) arasındaki iş günü sayısıdır (geri
 * saatte negatif). Her değerin İstanbul günü n iş günü kaydırılır, günün saati korunur:
 * - Hafta sonu günü önce sonraki iş gününe geçer (Plan 1 stok verisinde hafta sonu hareketleri var).
 * - Anlık görüntü anında geçmiş olan bir değer, anlık görüntünün son iş gününü aşamaz; o günden sonraki hafta
 *   sonu (ör. cumartesi sayımı) o güne çekilir. Böylece geçmiş kayıtlar yüklemede dünden ileri düşmez.
 * Böylece hiçbir kayıt hafta sonuna düşmez, iş günü aralıkları (ardışık plan günleri, terminler) korunur, gelecekteki
 * plan ve termin günleri gelecekte kalır.
 */
export function makeDateShift(takenAt: Date, now: Date): (ms: number) => number {
  const anchor = prevWorkday(takenAt);
  const n = workdaysBetween(anchor, prevWorkday(now));
  const takenMs = takenAt.getTime();
  // Aynı gün binlerce kez geçer; gün başına bir kez hesaplanır.
  const pastDays = new Map<number, number>();
  const futureDays = new Map<number, number>();
  return (ms) => {
    const dayStart = istanbulDayStart(new Date(ms)).getTime();
    const past = ms <= takenMs;
    const days = past ? pastDays : futureDays;
    let target = days.get(dayStart);
    if (target === undefined) {
      let day = new Date(dayStart);
      if (!isWorkday(day)) day = shiftWorkdays(day, 0);
      if (past && day.getTime() > anchor.getTime()) day = anchor;
      target = shiftWorkdays(day, n).getTime();
      days.set(dayStart, target);
    }
    return target + (ms - dayStart);
  };
}

/** Bir tablonun satırlarını nesneye çevirir: uuid sıra numaraları çözülür, tarihler `shift` ile taşınır. */
function decodeRows(snapshot: Snapshot, table: PgTable, shift: (ms: number) => number): Record<string, unknown>[] {
  const data = snapshot.tables[getTableName(table)];
  if (!data) return [];
  const dates = new Set(dateColumns(table));
  const uuids = new Set(data.uuidColumns);
  return data.rows.map((values) => {
    const out: Record<string, unknown> = {};
    data.columns.forEach((key, i) => {
      const value = values[i];
      if (dates.has(key) && typeof value === "number") out[key] = new Date(shift(value));
      else if (uuids.has(key) && typeof value === "number") out[key] = snapshot.ids[value];
      else out[key] = value;
    });
    return out;
  });
}

/**
 * Anlık görüntüyü boş bir veritabanına yükler. Tarihler iş günü olarak kaydırılır (makeDateShift): saatler (mesai
 * içi) korunur, hiçbir kayıt hafta sonuna ve (plan ve termin günleri dışında) `now`'dan ileri düşmez.
 * Tek transaction içinde çalışır.
 */
export async function loadSnapshot(db: Db, snapshot: Snapshot, now: Date): Promise<void> {
  const shift = makeDateShift(new Date(snapshot.takenAt), now);
  await db.transaction(async (tx) => {
    for (const table of TABLES) {
      const shifted = decodeRows(snapshot, table, shift);
      for (let i = 0; i < shifted.length; i += CHUNK) {
        await tx.insert(table).values(shifted.slice(i, i + CHUNK) as never);
      }
    }
    // Sıra numaraları elle yazıldı; sayacı en büyük değerin üstüne al ki yeni hareketler çakışmasın.
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('stock_movements', 'seq'), greatest((select coalesce(max(seq), 0) from stock_movements), 1))`,
    );
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('product_movements', 'seq'), greatest((select coalesce(max(seq), 0) from product_movements), 1))`,
    );
  });
}
