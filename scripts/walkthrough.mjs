// Üretim derlemesinde baştan sona elle dolaşımın başsız tekrarı; konsol hatası olursa başarısız biter.
// Kullanım: npm run build && npx next start -p 3201  (ayrı pencerede), sonra: node scripts/walkthrough.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.WALK_URL ?? "http://localhost:3201";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext()).newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`konsol: ${m.text()} (${m.location().url})`);
});
page.on("pageerror", (e) => problems.push(`sayfa hatası: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400) problems.push(`yanıt ${r.status()}: ${r.url()}`);
});

const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
};
const demo = async (who) => {
  await page.getByRole("button", { name: "Demo hesabıyla giriş yap" }).click();
  await page.getByRole("dialog", { name: "Demo hesapları" }).getByRole("button", { name: new RegExp(who) }).click();
  await page.getByRole("button", { name: new RegExp(`Hesap menüsü.*${who}`) }).waitFor();
};
const signOut = async () => {
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış yap" }).click();
  await page.waitForURL(/\/giris/);
};
const nav = (label) => page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: label }).click();

await step("giriş ekranı", async () => {
  await page.goto(`${BASE}/giris`);
  await page.getByRole("heading", { name: "Giriş yapın", level: 1 }).waitFor({ timeout: 60_000 });
});
await step("depo uzmanı girer, ana panel", async () => {
  await demo("Onur Tekin");
  await page.getByRole("region", { name: "Kritik stok" }).waitFor();
});
await step("malzeme açılır, stok girişi yapılır", async () => {
  await nav("Malzemeler");
  await page.getByRole("row", { name: /MLZ-0001/ }).click();
  await page.getByRole("button", { name: "Stok girişi" }).click();
  const d = page.getByRole("dialog", { name: "Stok girişi" });
  await d.getByLabel("Miktar").fill("5");
  await d.getByLabel("Birim maliyet").fill("1.600,00");
  await d.getByRole("button", { name: "Girişi kaydet" }).click();
  await page.getByRole("status").filter({ hasText: "giriş kaydedildi" }).waitFor();
  await page.keyboard.press("Escape");
});
await step("sayım açılır ve satır girilir", async () => {
  await nav("Sayım");
  await page.getByRole("button", { name: "Yeni sayım" }).click();
  const d = page.getByRole("dialog", { name: "Yeni sayım" });
  await d.getByRole("checkbox").first().check();
  await d.getByRole("button", { name: "Sayımı aç" }).click();
  const fis = page.getByRole("dialog").filter({ hasText: "SYM-" });
  await fis.getByRole("textbox", { name: /^Sayılan/ }).first().fill("1");
  await fis.getByRole("textbox", { name: /^Sayılan/ }).first().press("Enter");
  await page.keyboard.press("Escape");
});
await step("komut paleti", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("hareket");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/stok\/hareketler/);
});
await step("bilgi işlem kullanıcı ekler", async () => {
  await signOut();
  await demo("Ece Korkmaz");
  await nav("Kullanıcılar");
  await page.getByRole("button", { name: "Yeni kullanıcı" }).click();
  const d = page.getByRole("dialog", { name: "Yeni kullanıcı" });
  await d.getByLabel("Ad soyad").fill("Dolaşım Deneme");
  await d.getByLabel("E-posta").fill("dolasim.deneme@baltacioglus.example");
  await d.getByLabel("Parola", { exact: true }).fill("Dolasim-2026");
  await d.getByRole("button", { name: "Kullanıcıyı ekle" }).click();
  await page.getByRole("status").filter({ hasText: "Dolaşım Deneme eklendi" }).waitFor();
});
await step("veri sıfırlanır", async () => {
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.getByRole("button", { name: "Veriyi sıfırla" }).click();
  await page.getByRole("dialog", { name: "Veri sıfırlansın mı?" }).getByRole("button", { name: "Veriyi sıfırla" }).click();
  await page.waitForURL(/\/giris/, { timeout: 60_000 });
  await page.getByRole("heading", { name: "Giriş yapın", level: 1 }).waitFor({ timeout: 60_000 });
});

await browser.close();
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("konsolda hata yok");
