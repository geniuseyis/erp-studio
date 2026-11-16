// Örnek verinin anlık görüntüsü.
// seedBase ve seedSales gerçek servisleri çağırarak veriyi üretir (on binlerce sorgu); bu Node'da yaklaşık 25 saniye,
// tarayıcıda dakikalar sürer.
// Bu yüzden veri derleme sırasında bir kez üretilip JSON'a yazılır (npm run seed:snapshot) ve tarayıcıda
// tablo başına birkaç toplu INSERT ile yüklenir. Tarihler yükleme anına kaydırılır; vitrin hiç eskimiş görünmez.
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

/** Anlık görüntünün üretildiği "şimdi". Yüklemede bütün tarihler (yükleme anı − bu an) kadar, tam gün olarak kaydırılır. */
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

/** Bir tablonun satırlarını nesneye çevirir: uuid sıra numaraları çözülür, tarihlere `shift` eklenir. */
function decodeRows(snapshot: Snapshot, table: PgTable, shift: number): Record<string, unknown>[] {
  const data = snapshot.tables[getTableName(table)];
  if (!data) return [];
  const dates = new Set(dateColumns(table));
  const uuids = new Set(data.uuidColumns);
  return data.rows.map((values) => {
    const out: Record<string, unknown> = {};
    data.columns.forEach((key, i) => {
      const value = values[i];
      if (dates.has(key) && typeof value === "number") out[key] = new Date(value + shift);
      else if (uuids.has(key) && typeof value === "number") out[key] = snapshot.ids[value];
      else out[key] = value;
    });
    return out;
  });
}

/**
 * Anlık görüntüyü boş bir veritabanına yükler. Tarihler tam gün olarak kaydırılır: saatler (mesai içi) korunur
 * ve hiçbir kayıt `now`'dan ileri düşmez. Tek transaction içinde çalışır.
 */
export async function loadSnapshot(db: Db, snapshot: Snapshot, now: Date): Promise<void> {
  const DAY = 86_400_000;
  const shift = Math.floor((now.getTime() - new Date(snapshot.takenAt).getTime()) / DAY) * DAY;
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
