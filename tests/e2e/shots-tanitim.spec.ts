// Tanıtım README'si için ekran görüntüleri; normal test çalıştırmasında atlanır.
// Kullanım: SHOTS_TANITIM=all (ya da virgülle ayrılmış adlar) npx playwright test tests/e2e/shots-tanitim.spec.ts  → docs/screens/tanitim/
import { type Page, test } from "@playwright/test";
import { approve, loginAs, openLogin, sql } from "./helpers";

const wanted = (process.env.SHOTS_TANITIM ?? "").split(",").filter(Boolean);
const OUT = "docs/screens/tanitim";
const SIZES = { masaustu: [1440, 900], tablet: [1024, 768], telefon: [390, 844] } as const;

type Shot = {
  name: string;
  user?: string; // verilmezse giriş yapılmaz (giriş ekranı)
  path: string;
  size?: keyof typeof SIZES;
  theme?: "light" | "dark";
  prepare?: (page: Page) => Promise<void>;
};

const panel = (page: Page) => page.getByRole("dialog", { name: "Atölye Asistanı" });
async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Asistanı aç" }).click();
  await panel(page).waitFor();
}
async function ask(page: Page, text: string) {
  await panel(page).getByLabel("Mesajınız").fill(text);
  await panel(page).getByRole("button", { name: "Gönder" }).click();
}
const firstRowOpen = async (page: Page) => {
  await page.getByRole("row").nth(1).click();
  await page.getByRole("dialog").waitFor();
};

const shots: Shot[] = [
  { name: "01-giris", path: "/giris" },
  { name: "02-ana-panel", user: "Sevgi Polat", path: "/" },
  { name: "03-siparisler", user: "Elif Karaca", path: "/satis/siparisler" },
  { name: "04-siparis-cekmecesi", user: "Elif Karaca", path: "/satis/siparisler", prepare: firstRowOpen },
  { name: "05-musteriler", user: "Elif Karaca", path: "/satis/musteriler" },
  { name: "06-urunler", user: "Elif Karaca", path: "/uretim/urunler", prepare: firstRowOpen },
  { name: "07-is-emirleri-liste", user: "Elif Karaca", path: "/uretim/is-emirleri" },
  {
    name: "08-is-emirleri-kanban",
    user: "Elif Karaca",
    path: "/uretim/is-emirleri",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Kanban" }).click();
    },
  },
  { name: "09-haftalik-plan", user: "Elif Karaca", path: "/uretim/plan" },
  {
    name: "10-tasima-onayi",
    user: "Zeynep Arıkan",
    path: "/uretim/plan",
    prepare: async (page) => {
      // Rota sırası ve geçmiş günler bazı taşımaları reddeder; onay penceresi açılana kadar kartlar sırayla denenir.
      const cards = page.locator("[aria-roledescription='taşınabilir kart']");
      await cards.first().waitFor({ timeout: 30_000 });
      const dialog = page.getByRole("alertdialog");
      const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
      for (let i = 0, n = await cards.count(); i < n; i++) {
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
    },
  },
  {
    name: "11-termin-onerisi",
    user: "Elif Karaca",
    path: "/satis/siparisler",
    prepare: async (page) => {
      // Termini bugün olan yeni bir taslağa üretim gerektiren bir ürün eklenir; öneri termini erken bulur.
      await page.getByRole("button", { name: "Yeni sipariş" }).click();
      const form = page.getByRole("dialog", { name: "Yeni sipariş" });
      await form.getByRole("radio").first().check();
      await form.getByLabel("Termin").fill(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10));
      await form.getByRole("button", { name: "Taslağı aç" }).click();
      await approve(page, "Taslağı aç");
      await page.waitForFunction(() => location.search.includes("ac="));
      const id = new URL(page.url()).searchParams.get("ac") ?? "";
      const [row] = await sql<{ code: string }>(page, `select code from sales_orders where id = '${id}'`);
      const drawer = page.getByRole("dialog", { name: row?.code ?? "" });
      await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill("URN-0021");
      await drawer.getByRole("radio", { name: /URN-0021/ }).check();
      await drawer.getByLabel("Adet", { exact: true }).fill("2");
      await drawer.getByRole("button", { name: "Satırı ekle" }).click();
      await approve(page, /^Satırı (ekle|güncelle)$/);
      const suggestion = drawer.getByRole("region", { name: "Termin önerisi" });
      await suggestion.waitFor({ timeout: 30_000 });
      await suggestion.scrollIntoViewIfNeeded();
    },
  },
  { name: "12-atolye-tablet", user: "Cem Doğru", path: "/atolye", size: "tablet" },
  { name: "13-malzemeler", user: "Onur Tekin", path: "/stok/malzemeler" },
  { name: "14-stok-hareketleri", user: "Onur Tekin", path: "/stok/hareketler" },
  { name: "15-sayim", user: "Sevgi Polat", path: "/stok/sayim" },
  { name: "16-satin-alma-onerileri", user: "Kerem Uysal", path: "/satin-alma/oneriler" },
  {
    name: "17-satin-alma-siparisi",
    user: "Ayla Güneş",
    path: "/satin-alma/siparisler",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Onay bekliyor", exact: true }).click();
      await page.waitForTimeout(500);
      await page.getByRole("row").nth(1).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "18-tedarikciler", user: "Kerem Uysal", path: "/satin-alma/tedarikciler" },
  { name: "19-mal-kabul", user: "Onur Tekin", path: "/depo/mal-kabul" },
  { name: "20-islemler", user: "Sevgi Polat", path: "/islemler" },
  {
    name: "21-komut-paleti",
    user: "Elif Karaca",
    path: "/",
    prepare: async (page) => {
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Ara ve git" }).waitFor();
      await page.keyboard.type("sip");
      await page.waitForTimeout(500);
    },
  },
  {
    name: "22-asistan-menu",
    user: "Elif Karaca",
    path: "/stok/malzemeler",
    prepare: openAssistant,
  },
  {
    name: "23-asistan-kart",
    user: "Elif Karaca",
    path: "/stok/malzemeler",
    prepare: async (page) => {
      await openAssistant(page);
      await panel(page).getByRole("group", { name: "Başlıklar" }).getByRole("button", { name: "Stok", exact: true }).click();
      await panel(page).getByRole("group", { name: "Hızlı yanıtlar" }).getByRole("button", { name: "Kritik stok", exact: true }).click();
      await panel(page).getByRole("region", { name: "Kritik stok" }).waitFor();
    },
  },
  {
    name: "24-asistan-yazim-hatasi",
    user: "Elif Karaca",
    path: "/stok/malzemeler",
    prepare: async (page) => {
      await openAssistant(page);
      await ask(page, "qwzx plk");
      await panel(page).getByText("Bunu mu demek istediniz?").waitFor();
    },
  },
  { name: "25-asistan-telefon", user: "Elif Karaca", path: "/stok/malzemeler", size: "telefon", prepare: openAssistant },
  { name: "26-koyu-tema", user: "Sevgi Polat", path: "/", theme: "dark" },
  { name: "27-telefon", user: "Elif Karaca", path: "/satis/siparisler", size: "telefon" },
];

test.skip(wanted.length === 0, "SHOTS_TANITIM tanımlı değil");

for (const s of shots) {
  if (!wanted.includes("all") && !wanted.includes(s.name)) continue;
  test(s.name, async ({ page }) => {
    const [width, height] = SIZES[s.size ?? "masaustu"];
    await page.setViewportSize({ width, height });
    await page.addInitScript((t) => localStorage.setItem("erp.theme", t), s.theme ?? "light");
    if (s.user) await loginAs(page, s.user);
    else await openLogin(page);
    await page.goto(s.path);
    await page.getByText("Veritabanı başlatılıyor").waitFor({ state: "hidden", timeout: 45_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    if (s.prepare) await s.prepare(page);
    // Bildirimler görüntüyü örtmesin.
    await page.waitForTimeout(6500);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
  });
}
