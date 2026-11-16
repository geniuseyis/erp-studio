import { PGlite } from "@electric-sql/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PgliteQueryResultHKT } from "drizzle-orm/pglite";
import { applyMigrations, SCHEMA_VERSION } from "./migrate";
import * as schema from "./schema";

/** Hem ana bağlantıyı hem de bir transaction içindeki bağlantıyı karşılar; servisler ikisiyle de çalışır. */
export type Db = PgDatabase<PgliteQueryResultHKT, typeof schema>;
export type BootStep = "engine" | "schema" | "seed" | "ready";

export type DbHandle = {
  db: Db;
  /** false: tarayıcı deposu kullanılamıyor, veritabanı bellekte ve sekme kapanınca silinir. */
  persistent: boolean;
  /** true: şema sürümü değiştiği için veritabanı bu açılışta örnek veriyle yeniden kuruldu. */
  rebuilt: boolean;
  /** Bütün veriyi siler; şemayı ve örnek veriyi yeniden kurar. */
  reset(): Promise<void>;
};

type OpenOptions = {
  onProgress?: (step: BootStep) => void;
  seed: (db: Db) => Promise<void>;
};

/**
 * Veri, tarayıcının sayfaya özel dosya sisteminde (OPFS) durur. `memfs2opfs` değişiklikleri bellekte izler ve
 * her sorgudan sonra yalnızca değişen kısmı diske yazar.
 * Ölçüm (2026-11-15, Chrome): sorgu başına 2–5 ms. Aynı veritabanı IndexedDB (`idb://`) üzerinde sorgu başına
 * ~173 ms sürüyordu; yazımı beklemeyen ayarla (relaxedDurability) hızlanıyor ama yenilemede son değişiklik kayboluyordu.
 */
const DATA_DIR = "memfs2opfs://erp-studio";
const BOOT_LOCK = "erp-studio-boot";
/** Worker bu sürede hazır olmazsa (depolama sessizce takıldı) bellekteki veritabanına geçilir. Yavaş bağlantıda
 * PostgreSQL dosyalarının (~15 MB) ilk indirmesi de bu süreye girer; bu yüzden cömert tutulur. Açıkça reddedilen
 * depolama ise Worker'ın iletisiyle hemen yakalanır. */
const WORKER_READY_MS = 60_000;
/** pglite.worker.ts ile aynı değer; Worker dosyasını ana pakete çekmemek için burada yinelenir. */
const STORAGE_FAILED = "erp:storage-failed";

/** Açık bir PGlite bağlantısını şemayı bilen Drizzle veritabanına sarar. */
export function makeDb(pg: PGlite): Db {
  return drizzle(pg, { schema });
}

/** İki sekme aynı anda açılırsa kurulum ve örnek veri yalnızca birinde çalışır; diğeri bekler. */
async function withBootLock<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(BOOT_LOCK, run);
  }
  return run();
}

async function readMeta(pg: PGlite, key: string): Promise<string | null> {
  const exists = await pg.query<{ t: string | null }>("select to_regclass('public.meta')::text as t");
  if (!exists.rows[0]?.t) return null;
  const r = await pg.query<{ value: string }>("select value from meta where key = $1", [key]);
  return r.rows[0]?.value ?? null;
}

async function wipe(pg: PGlite): Promise<void> {
  await pg.exec("drop schema public cascade; create schema public;");
}

/** Şemayı kurar, sürüm değiştiyse baştan kurar, örnek veri yoksa yükler. Yeniden kurulduysa true döner. */
export async function prepare(pg: PGlite, db: Db, opts: OpenOptions, forceWipe = false): Promise<boolean> {
  return withBootLock(async () => {
    opts.onProgress?.("schema");
    const current = await readMeta(pg, "schema_version");
    const stale = current !== null && current !== SCHEMA_VERSION;
    if (stale || forceWipe) await wipe(pg);
    await applyMigrations(pg);
    await db
      .insert(schema.meta)
      .values({ key: "schema_version", value: SCHEMA_VERSION })
      .onConflictDoUpdate({ target: schema.meta.key, set: { value: SCHEMA_VERSION } });

    const seeded = await db.select().from(schema.meta).where(eq(schema.meta.key, "seeded"));
    if (seeded.length === 0) {
      opts.onProgress?.("seed");
      // Örnek veri ve "yüklendi" işareti aynı transaction'da: açılış arada kesilirse ikisi de geri alınır.
      // Ayrı yazılsaydı bir sonraki açılış veriyi yeniden yüklemeye çalışır ve yinelenen anahtarla hep düşerdi.
      await db.transaction(async (tx) => {
        await opts.seed(tx);
        await tx.insert(schema.meta).values({ key: "seeded", value: new Date().toISOString() });
      });
    }
    return stale;
  });
}

function storageAvailable(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

async function connect(): Promise<{ pg: PGlite; persistent: boolean }> {
  if (storageAvailable()) {
    let w: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      w = new Worker(new URL("./pglite.worker.ts", import.meta.url), { type: "module" });
      const worker = w;
      // Worker depolamayı açamazsa haber verir; PGliteWorker.create bundan önce "hazır" diye döner.
      const failed = new Promise<never>((_, reject) => {
        worker.addEventListener("message", (e: MessageEvent<{ type?: string; message?: string }>) => {
          if (e.data?.type === STORAGE_FAILED) reject(new Error(e.data.message ?? "depolama açılamadı"));
        });
        timer = setTimeout(() => reject(new Error("veritabanı zamanında açılmadı")), WORKER_READY_MS);
      });
      const pg = await Promise.race([PGliteWorker.create(worker, { dataDir: DATA_DIR }), failed]);
      // Gerçek hazırlık: ilk sorgu ancak Worker veritabanını açınca yanıtlanır.
      await Promise.race([pg.query("select 1"), failed]);
      clearTimeout(timer);
      // PGliteWorker, Drizzle'ın kullandığı query ve transaction yöntemlerini PGlite ile aynı biçimde sunar.
      return { pg: pg as unknown as PGlite, persistent: true };
    } catch (e) {
      // Ör. gizli pencere ya da engellenmiş site verisi: depolama izni yok.
      clearTimeout(timer);
      w?.terminate();
      console.warn("Kalıcı veritabanı açılamadı, bellekte devam ediliyor.", e);
    }
  }
  return { pg: await PGlite.create(), persistent: false };
}

let opening: Promise<DbHandle> | null = null;

/** Tarayıcıdaki veritabanını açar. Aynı sayfada kaç kez çağrılırsa çağrılsın tek bağlantı kullanılır. */
export function openBrowserDb(opts: OpenOptions): Promise<DbHandle> {
  opening ??= (async () => {
    opts.onProgress?.("engine");
    const { pg, persistent } = await connect();
    const db = makeDb(pg);
    const rebuilt = await prepare(pg, db, opts);
    opts.onProgress?.("ready");
    return {
      db,
      persistent,
      rebuilt,
      // Sıfırlama açılış ekranını geri getirmez; ilerleme bildirilmez.
      reset: async () => {
        await prepare(pg, db, { seed: opts.seed }, true);
      },
    };
  })();
  opening.catch(() => {
    opening = null;
  });
  return opening;
}
