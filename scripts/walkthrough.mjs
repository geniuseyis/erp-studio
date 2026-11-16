// Üretim derlemesinde baştan sona elle dolaşımın başsız tekrarı (stok, sayım, sipariş → üretim → sevk, kullanıcı, sıfırlama); konsol hatası olursa başarısız biter.
// Kullanım: npm run build && npx next start -p 3201  (ayrı pencerede), sonra: node scripts/walkthrough.mjs
// Sipariş akışı örnek verideki URN-0021 ile çalışır; başka bir ürün için WALK_PRODUCT=URN-0025 verilebilir.
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
// Sipariş akışında satılan ürün: koda göre aranır; örnek veride malzemesi yeten, mamul stoğu olmayan bir beyaz ürün (Ada Orta sehpa).
const PRODUCT = process.env.WALK_PRODUCT ?? "URN-0021";
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
// Sipariş akışı: satış açar ve onaylar, planlama planlar, atölye istasyonları geçer, depo sevk eder.
let orderCode = "";
let workOrderCode = "";
const closeDrawer = async () => {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
};
await step("satış uzmanı sipariş açar ve onaylar", async () => {
  await signOut();
  await demo("Elif Karaca");
  await nav("Siparişler");
  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni sipariş" });
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Taslağı aç" }).click();
  await dialog.waitFor({ state: "hidden" });
  const drawer = page.getByRole("dialog").filter({ hasText: /SIP-/ });
  await drawer.waitFor();
  orderCode = (await drawer.textContent())?.match(/SIP-\d{4}-\d{4}/)?.[0] ?? "";
  if (!orderCode) throw new Error("sipariş kodu okunamadı");
  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill(PRODUCT);
  await drawer.getByRole("radio").first().check();
  await drawer.getByLabel("Adet", { exact: true }).fill("1");
  await drawer.getByRole("button", { name: "Satırı ekle" }).click();
  await drawer.getByRole("button", { name: "Onayla" }).click();
  await page.getByRole("status").filter({ hasText: `${orderCode} onaylandı` }).waitFor();
  await drawer.getByText("Üretimde").first().waitFor();
  workOrderCode = (await drawer.getByRole("link", { name: /İş emri IE-/ }).textContent())?.match(/IE-\d{4}-\d{4}/)?.[0] ?? "";
  if (!workOrderCode) throw new Error("iş emri kodu okunamadı");
});
await step("planlama iş emrini bugüne planlar", async () => {
  await closeDrawer();
  await signOut();
  await demo("Zeynep Arıkan");
  await nav("İş emirleri");
  await page.getByRole("searchbox", { name: "İş emri ara" }).fill(workOrderCode);
  await page.getByRole("table", { name: "İş emirleri" }).locator("tbody tr").filter({ hasText: workOrderCode }).click();
  const drawer = page.getByRole("dialog", { name: workOrderCode });
  await drawer.getByLabel("Başlangıç günü").fill(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
  await drawer.getByRole("button", { name: "Planla" }).click();
  await page.getByRole("status").filter({ hasText: `${workOrderCode} planlandı` }).waitFor();
});
await step("depo hazır olmayan siparişi sevk edemez", async () => {
  await closeDrawer();
  await signOut();
  await demo("Onur Tekin");
  await nav("Siparişler");
  await page.getByRole("searchbox", { name: "Sipariş ara" }).fill(orderCode);
  await page.getByRole("table", { name: "Siparişler" }).locator("tbody tr").filter({ hasText: orderCode }).click();
  const drawer = page.getByRole("dialog", { name: orderCode });
  await drawer.getByText("Üretimde").first().waitFor();
  if ((await drawer.getByRole("button", { name: "Sevk et" }).count()) !== 0) throw new Error("hazır olmayan sipariş sevk edilebiliyor");
});
await step("atölye her istasyonda başlar ve bitirir", async () => {
  await closeDrawer();
  await signOut();
  await demo("Cem Doğru");
  await nav("Atölye");
  await page.getByRole("group", { name: "İstasyon" }).waitFor();
  const stations = page.getByRole("group", { name: "İstasyon" }).getByRole("button");
  await stations.first().waitFor();
  const total = await stations.count();
  let done = 0;
  for (let i = 0; i < total; i++) {
    await stations.nth(i).click();
    const card = page.getByRole("article", { name: workOrderCode });
    // Kuyruk istasyon değişince yeniden yüklenir; kısa süre beklenir, iş emri bu istasyonda yoksa geçilir.
    await card.waitFor({ timeout: done === 0 ? 10_000 : 3000 }).catch(() => {});
    if ((await card.count()) === 0) continue;
    await card.getByRole("button", { name: "Başla" }).click();
    await card.getByRole("button", { name: "Bitti" }).click();
    await card.waitFor({ state: "hidden" });
    done++;
  }
  if (done === 0) throw new Error(`iş emri hiçbir istasyonda görünmedi: ${workOrderCode}`);
});
await step("depo hazır siparişi sevk eder", async () => {
  await signOut();
  await demo("Onur Tekin");
  await nav("Siparişler");
  await page.getByRole("searchbox", { name: "Sipariş ara" }).fill(orderCode);
  await page.getByRole("table", { name: "Siparişler" }).locator("tbody tr").filter({ hasText: orderCode }).click();
  const drawer = page.getByRole("dialog", { name: orderCode });
  await drawer.getByRole("button", { name: "Sevk et" }).click();
  await page.getByRole("status").filter({ hasText: `${orderCode} sevk edildi` }).waitFor();
  await drawer.getByText("Sevk edildi").first().waitFor();
  await closeDrawer();
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
