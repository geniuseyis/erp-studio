// Görsel kontrol için ekran görüntüsü alır; normal test çalıştırmasında atlanır.
// Kullanım: SHOTS=bilesenler,giris npx playwright test tests/e2e/shots.spec.ts  → .shots/
import { test } from "@playwright/test";

// Yollar baştaki "/" olmadan verilir (Git Bash "/x" değerini Windows yoluna çevirir): SHOTS=bilesenler,stok/malzemeler
const paths = (process.env.SHOTS ?? "")
  .split(",")
  .filter(Boolean)
  .map((p) => `/${p.replace(/^\//, "")}`);
const demoUser = process.env.SHOTS_USER;
// Verilirse yükleme sonrası adı bu ifadeyle eşleşen satıra tıklanır (çekmeceyi görüntülemek için): SHOTS_CLICK=MLZ-0018
const clickRow = process.env.SHOTS_CLICK;
// Verilirse yükleme sonrası bu adlı düğmeye basılır (pencereyi görüntülemek için): SHOTS_BUTTON="Demo hesabıyla giriş yap"
const clickButton = process.env.SHOTS_BUTTON;

// Temalar ve boyutlar daraltılabilir: SHOTS_THEMES=light, SHOTS_SIZES=masaustu,tablet (tablet 1024x768).
const SIZES = { masaustu: [1440, 900], tablet: [1024, 768], telefon: [390, 844] } as const;
type SizeName = keyof typeof SIZES;
const themes = (process.env.SHOTS_THEMES ?? "light,dark").split(",").filter(Boolean) as ("light" | "dark")[];
const sizes = (process.env.SHOTS_SIZES ?? "masaustu,telefon").split(",").filter((n): n is SizeName => n in SIZES);
// Verilirse dosya adı (uzantısız) ve klasör bu olur; tek tema ve tek boyutla kullanılır. Sayfa altı (-alt) görüntüsü alınmaz: SHOTS_NAME=01-siparisler SHOTS_DIR=docs/screens/asama-2
const outName = process.env.SHOTS_NAME;
const outDir = process.env.SHOTS_DIR ?? ".shots";

test.skip(paths.length === 0, "SHOTS tanımlı değil");

for (const path of paths) {
  for (const theme of themes) {
    for (const name of sizes) {
      const [width, height] = SIZES[name];
      test(`${path} ${theme} ${name}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.addInitScript((t) => localStorage.setItem("erp.theme", t), theme);
        if (demoUser) {
          await page.goto("/giris");
          await page.getByRole("button", { name: "Demo hesabıyla giriş yap" }).click({ timeout: 45_000 });
          await page.getByRole("dialog", { name: "Demo hesapları" }).getByRole("button", { name: new RegExp(demoUser) }).click();
          await page.waitForURL((u) => !u.pathname.startsWith("/giris"));
        }
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        // Açılış ekranı kapanana (veritabanı hazır olana) kadar bekle.
        await page.getByText("Veritabanı başlatılıyor").waitFor({ state: "hidden", timeout: 45_000 });
        if (clickRow) {
          await page.getByRole("row", { name: new RegExp(clickRow) }).first().click();
          await page.getByRole("dialog").waitFor();
        }
        if (clickButton) {
          await page.getByRole("button", { name: clickButton, exact: true }).click();
          await page.getByRole("dialog").waitFor();
        }
        await page.waitForTimeout(400);
        const file = outName ? `${outDir}/${outName}.png` : `${outDir}/${path.replace(/[/?=&]/g, "_")}${clickRow ? "-cekmece" : ""}${clickButton ? "-pencere" : ""}-${theme}-${name}.png`;
        await page.screenshot({ path: file, fullPage: true });
        // Uygulama kabuğunda sayfa kendi içinde kayar; alt kısım ayrıca çekilir.
        const scrolled = await page.evaluate(() => {
          const main = document.querySelector("main.overflow-auto");
          if (!main || main.scrollHeight <= main.clientHeight + 4) return false;
          main.scrollTop = main.scrollHeight;
          return true;
        });
        if (scrolled && !clickRow && !outName) {
          await page.waitForTimeout(300);
          await page.screenshot({ path: file.replace(/.png$/, "-alt.png") });
        }
      });
    }
  }
}
