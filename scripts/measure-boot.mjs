// Üretim derlemesinde soğuk açılış süresini ve indirilen dosya boyutunu ölçer.
// Kullanım: npm run build && npx next start -p 3201  (ayrı pencerede), sonra: node scripts/measure-boot.mjs
import { chromium } from "@playwright/test";

const URL = process.env.MEASURE_URL ?? "http://localhost:3201/giris";
const browser = await chromium.launch({ channel: "chrome", headless: true });

for (let run = 0; run < 3; run++) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let bytes = 0;
  const big = [];
  page.on("response", async (r) => {
    try {
      const size = (await r.body()).length;
      bytes += size;
      if (size > 300_000) big.push(`${r.url().split("/").pop().slice(0, 44)} ${(size / 1e6).toFixed(2)} MB`);
    } catch {
      // Gövdesi okunamayan yanıtlar (yönlendirme gibi) sayılmaz.
    }
  });
  const ready = () => page.getByRole("heading", { name: "Giriş yapın", level: 1 }).waitFor({ timeout: 60_000 });

  const t0 = Date.now();
  await page.goto(URL);
  await ready();
  const cold = Date.now() - t0;

  const t1 = Date.now();
  await page.reload();
  await ready();
  const warm = Date.now() - t1;

  console.log(`soğuk açılış: ${cold} ms, yenileme: ${warm} ms, indirilen: ${(bytes / 1e6).toFixed(1)} MB (iki yükleme toplamı)`);
  if (run === 0) console.log([...new Set(big)].join("\n"));
  await context.close();
}
await browser.close();
