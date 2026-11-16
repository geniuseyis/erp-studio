// Tarayıcıdaki veritabanının sorgu sürelerini ölçer; normal test çalıştırmasında atlanır. Kullanım: PERF=1 npx playwright test tests/e2e/perf.spec.ts
import { test } from "@playwright/test";
import { openLogin } from "./helpers";

test.skip(!process.env.PERF, "PERF tanımlı değil");

test("sorgu süreleri", async ({ page }) => {
  const errors: string[] = [];
  const t0 = Date.now();
  page.on("pageerror", (e) => errors.push(e.name + ": " + e.message));
  page.on("console", (m) => { if (m.text().startsWith("WORKER")) console.log("+" + (Date.now() - t0) + "ms " + m.text().slice(0, 2500)); });
  await openLogin(page);
  console.log("açılış (giriş ekranı görünene kadar): " + (Date.now() - t0) + " ms");
  const result = await page.evaluate(async () => {
    const erp = (window as unknown as { __erp: { query(q: string): Promise<unknown[]> } }).__erp;
    const time = async (label: string, n: number, q: string) => {
      const t = performance.now();
      for (let i = 0; i < n; i++) await erp.query(q);
      return label + ": " + ((performance.now() - t) / n).toFixed(1) + " ms/sorgu";
    };
    return [
      await time("select 1", 20, "select 1"),
      await time("malzeme listesi", 10, "select * from materials order by code"),
      await time("hareket listesi (200)", 10, "select * from stock_movements order by created_at desc limit 200"),
      await time("yazma (update)", 20, "update meta set value = value where key = 'schema_version'"),
    ];
  });
  console.log(result.join("\n"));
  console.log("yakalanmamış hatalar: " + (errors.length ? errors.join("; ") : "yok"));
});
