// PostgreSQL'i (PGlite) arayüzü kilitlemesin diye ayrı bir iş parçacığında çalıştırır.
// Birden çok sekme açıksa PGlite bir sekmeyi lider seçer; diğerleri sorgularını ona yollar.
import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";

/** Ana sayfaya giden "depolama açılamadı" iletisi; client.ts bunu görünce bellekteki veritabanına geçer. */
export const STORAGE_FAILED = "erp:storage-failed";

void worker({
  async init(options) {
    try {
      // Site verisi engelliyse tarayıcı OPFS'i burada reddeder. PGlite bu hatayı ana sayfaya iletmediği için
      // açıkça haber verilir; yoksa sorgular sonsuza dek bağlantı bekler.
      await navigator.storage.getDirectory();
      const db = new PGlite({ dataDir: options.dataDir });
      await db.waitReady;
      return db;
    } catch (error) {
      self.postMessage({ type: STORAGE_FAILED, message: String(error) });
      throw error;
    }
  },
});
