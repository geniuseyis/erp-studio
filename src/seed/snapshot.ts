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
import { mulberry32 } from "./rng";

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

/** Yükleme sırası; testler aynı sırayla gezer. */
export const SNAPSHOT_TABLES: readonly PgTable[] = TABLES;

/**
 * Sıkıştırılmış biçim (dosya boyutu sınırı için): her tablo sütun adları ve değer dizileri olarak durur,
 * tarihler epoch milisaniyesidir. Kimlikler dosyada hiç yazılmaz: her farklı uuid ilk görüldüğü sırada bir sıra
 * numarası alır, yüklemede `deterministicUuid(n)` ile yeniden üretilir. `uuidColumns`: sayı değeri kimlik sıra
 * numarası olan sütunlar (metin sütunlarında uuid olmayan değerler metin olarak kalır). Yüklenen veri içerik olarak
 * aynıdır, yalnızca kimlik değerleri değişir; aynı kimlik her yerde aynı numarayla geçtiği için bağlar korunur.
 */
export type SnapshotTable = { columns: string[]; uuidColumns: string[]; rows: unknown[][] };
export type Snapshot = {
  /** ISO tarih: verinin üretildiği an. */
  takenAt: string;
  tables: Record<string, SnapshotTable>;
};

const hex8 = (rng: () => number) => Math.floor(rng() * 4294967296).toString(16).padStart(8, "0");

/**
 * Sıra numarasından her zaman aynı, geçerli bir v4 uuid üretir (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`).
 * Haneler `mulberry32(20261118 + n)` dizisinden gelir; ilk 20.000 numarada çakışmadığı testle doğrulanır.
 */
export function deterministicUuid(index: number): string {
  const rng = mulberry32(20261118 + index);
  const h = hex8(rng) + hex8(rng) + hex8(rng) + hex8(rng);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

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
            i = index.size;
            index.set(value, i);
          }
          return i;
        }
        return value;
      }),
    );
    tables[getTableName(table)] = { columns, uuidColumns: columns.filter((c) => uuidColumns.has(c)), rows };
  }
  return { takenAt: takenAt.toISOString(), tables };
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
function decodeRows(
  snapshot: Snapshot,
  table: PgTable,
  shift: (ms: number) => number,
  uuid: (index: number) => string,
): Record<string, unknown>[] {
  const data = snapshot.tables[getTableName(table)];
  if (!data) return [];
  const dates = new Set(dateColumns(table));
  const uuids = new Set(data.uuidColumns);
  return data.rows.map((values) => {
    const out: Record<string, unknown> = {};
    data.columns.forEach((key, i) => {
      const value = values[i];
      if (dates.has(key) && typeof value === "number") out[key] = new Date(shift(value));
      else if (uuids.has(key) && typeof value === "number") out[key] = uuid(value);
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
  // Aynı kimlik birçok satırda geçer; her numara bir kez üretilir.
  const ids: string[] = [];
  const uuid = (index: number) => (ids[index] ??= deterministicUuid(index));
  await db.transaction(async (tx) => {
    for (const table of TABLES) {
      const shifted = decodeRows(snapshot, table, shift, uuid);
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
