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

// Verilirse sayfa yüklendikten sonra etkileşimli bir durum hazırlanır (basit yol, SHOTS_CLICK ve SHOTS_BUTTON'ın yetmediği durumlar):
//   plan-tasima    haftalık planda ilk taşınabilir kart klavyeyle bir güne kaydırılır, taşıma onay penceresi açık kalır
//   termin-onerisi ilk taslak siparişin çekmecesi açılır, Termin önerisi bölümü görünür
//   ozet-gizli     liste ekranlarında özet bandı daraltılır
const scenario = process.env.SHOTS_SCENARIO;

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
        if (scenario === "plan-tasima") {
          // Rota sırası ve geçmiş günler bazı taşımaları reddeder (pencere yerine toast); pencere açılana kadar kartlar sırayla denenir.
          const cards = page.locator("[aria-roledescription='taşınabilir kart']");
          await cards.first().waitFor({ timeout: 30_000 });
          const dialog = page.getByRole("alertdialog");
          const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
          for (let i = 0, n = await cards.count(); i < n; i++) {
            // Geçmiş günün kartı taşınamaz (reddedilir, ekranda boşuna toast kalır): bugün ve sonrası denenir.
            const day = await cards.nth(i).evaluate((el) => el.closest("[data-cell]")?.getAttribute("data-cell")?.split(":")[1] ?? "");
            if (day < today) continue;
            await cards.nth(i).focus();
            await page.keyboard.press("Space");
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("Enter");
            if (await dialog.waitFor({ timeout: 1500 }).then(() => true, () => false)) break;
            await page.keyboard.press("Escape");
          }
          await dialog.waitFor({ timeout: 1000 });
        }
        if (scenario === "termin-onerisi") {
          // Termini bugün olan yeni bir taslağa üretim gerektiren bir ürün eklenir: öneri termini erken bulur ve uygulama düğmesi çıkar.
          const confirmAndWait = async () => {
            const dialog = page.getByRole("alertdialog");
            await dialog.getByRole("button").last().click();
            await dialog.waitFor({ state: "hidden", timeout: 30_000 });
          };
          await page.getByRole("button", { name: "Yeni sipariş" }).click();
          const form = page.getByRole("dialog", { name: "Yeni sipariş" });
          await form.getByRole("radio").first().check();
          await form.getByLabel("Termin").fill(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
          await form.getByRole("button", { name: "Taslağı aç" }).click();
          await confirmAndWait();
          const drawer = page.getByRole("dialog").filter({ hasText: /SIP-/ });
          await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill("URN-0021");
          await drawer.getByRole("radio").first().check();
          await drawer.getByLabel("Adet", { exact: true }).fill("2");
          await drawer.getByRole("button", { name: "Satırı ekle" }).click();
          await confirmAndWait();
          const suggestion = drawer.getByRole("region", { name: "Termin önerisi" });
          await suggestion.waitFor({ timeout: 30_000 });
          await suggestion.scrollIntoViewIfNeeded();
        }
        if (scenario === "ozet-gizli") {
          await page.getByRole("button", { name: "Özeti gizle" }).click();
          await page.getByRole("button", { name: "Özeti göster" }).waitFor();
        }
        // Bildirimler görüntüyü örtmesin: kendiliğinden kapanana kadar beklenir.
        await page.waitForTimeout(scenario === "termin-onerisi" ? 7000 : 400);
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
