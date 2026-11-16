// Örnek verinin anlık görüntüsü.
// seedBase gerçek servisleri çağırarak veriyi üretir (binlerce sorgu); bu Node'da 3 saniye, tarayıcıda dakikalar sürer.
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

export type Snapshot = {
  /** ISO tarih: verinin üretildiği an. */
  takenAt: string;
  tables: Record<string, Record<string, unknown>[]>;
};

function dateColumns(table: PgTable): string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => column.dataType === "date")
    .map(([key]) => key);
}

/** Veritabanındaki bütün örnek veriyi düz JSON'a çevirir. */
export async function exportSnapshot(db: Db, takenAt: Date): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const table of TABLES) {
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    const dates = dateColumns(table);
    tables[getTableName(table)] = rows.map((row) => {
      const out = { ...row };
      for (const key of dates) if (out[key] instanceof Date) out[key] = (out[key] as Date).toISOString();
      return out;
    });
  }
  return { takenAt: takenAt.toISOString(), tables };
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
      const rows = snapshot.tables[getTableName(table)] ?? [];
      const dates = dateColumns(table);
      const shifted = rows.map((row) => {
        const out = { ...row };
        for (const key of dates) if (typeof out[key] === "string") out[key] = new Date(new Date(out[key] as string).getTime() + shift);
        return out;
      });
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
