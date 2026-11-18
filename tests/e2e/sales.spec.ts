import { expect, type Locator, type Page, test } from "@playwright/test";
import { orderTotals } from "../../src/domain/sales/money";
import { formatMoney } from "../../src/domain/units";
import { approve, confirmDialog, loginAs, sql } from "./helpers";

const QTY_ERROR = "Adet 1 ile 9999 arasında tam sayı olmalı";
const SHORT_MATERIAL = "MDF Lam 8 mm Beyaz Arkalık";

type ProductPick = { id: string; code: string; price: number };

async function openOrders(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Siparişler" }).click();
  await expect(page.getByRole("heading", { name: "Siparişler", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Siparişler" }).locator("tbody tr").first()).toContainText(/SIP-/);
}

async function openCustomers(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Müşteriler" }).click();
  await expect(page.getByRole("heading", { name: "Müşteriler", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Müşteriler" }).locator("tbody tr").first()).toContainText(/MUS-/);
}

/** Durum çipiyle süzer, liste oturunca ilk siparişin çekmecesini açar. */
async function openFirstWithStatus(page: Page, status: string): Promise<Locator> {
  await page.getByRole("button", { name: status, exact: true }).click();
  const rows = page.getByRole("table", { name: "Siparişler" }).locator("tbody tr");
  await expect
    .poll(async () => {
      const texts = await rows.allTextContents();
      return texts.length > 0 && texts.every((t) => t.includes(status));
    })
    .toBe(true);
  const code = (await rows.first().textContent())?.match(/SIP-\d{4}-\d{4}/)?.[0] ?? "";
  await rows.first().click();
  const drawer = page.getByRole("dialog", { name: code });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Yeni taslak açar ve çekmeceyi döner. */
async function newDraft(page: Page, customerQuery?: string): Promise<{ drawer: Locator; id: string; code: string }> {
  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni sipariş" });
  if (customerQuery) await dialog.getByRole("searchbox", { name: "Müşteri ara" }).fill(customerQuery);
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Taslağı aç" }).click();
  await approve(page, "Taslağı aç");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/ac=/);
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  const [row] = await sql<{ code: string }>(page, `select code from sales_orders where id = '${id}'`);
  const code = row?.code ?? "";
  const drawer = page.getByRole("dialog", { name: code });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Taslak").first()).toBeVisible();
  return { drawer, id, code };
}

/** Satırı forma yazar ve ekler; `confirm` false ise (geçersiz giriş) onay penceresi açılmaz. */
async function addLine(drawer: Locator, code: string, qty: string, discount = "", confirm = true): Promise<void> {
  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill(code);
  await drawer.getByRole("radio", { name: new RegExp(code) }).check();
  await drawer.getByLabel("Adet", { exact: true }).fill(qty);
  await drawer.getByLabel("İskonto", { exact: true }).fill(discount);
  await drawer.getByRole("button", { name: "Satırı ekle" }).click();
  if (confirm) await approve(drawer.page(), /^Satırı (ekle|güncelle)$/);
}

async function product(page: Page, where: string): Promise<ProductPick> {
  const [p] = await sql<ProductPick>(page, `select id, code, price_kurus::float8 as price from products where active and ${where} order by code limit 1`);
  if (!p) throw new Error(`ürün yok: ${where}`);
  return p;
}

const count = async (page: Page, query: string) => (await sql<{ n: number }>(page, query))[0]?.n ?? Number.NaN;

test("satış uzmanı sipariş açar, iki satır ekler, toplam KDV ayrı görünür", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  const furniture = await product(page, "vat_rate = 10");
  const general = await product(page, "vat_rate = 20");

  const { drawer, id } = await newDraft(page);
  // Seçili ürün aramayla listeden gizlense de görünür kalır.
  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill(furniture.code);
  await drawer.getByRole("radio", { name: new RegExp(furniture.code) }).check();
  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill("zzzyok");
  await expect(drawer.getByRole("radio")).toHaveCount(0);
  await expect(drawer.getByText(`Seçili: ${furniture.code}`)).toBeVisible();

  await addLine(drawer, furniture.code, "2", "10");
  await expect(drawer.getByRole("list", { name: "Satırlar" }).getByRole("listitem").filter({ hasText: furniture.code })).toBeVisible();
  await addLine(drawer, general.code, "1");
  await expect(drawer.getByRole("list", { name: "Satırlar" }).getByRole("listitem").filter({ hasText: general.code })).toBeVisible();
  expect(await count(page, `select count(*)::int as n from sales_order_lines where order_id = '${id}'`)).toBe(2);

  const totals = orderTotals([
    { qtyMilli: 2000, unitPriceKurus: furniture.price, discountPermille: 100, vatRate: 10, status: "draft" },
    { qtyMilli: 1000, unitPriceKurus: general.price, discountPermille: 0, vatRate: 20, status: "draft" },
  ]);
  const summary = drawer.getByRole("table", { name: "Tutar özeti" });
  await expect(summary.getByRole("row", { name: /KDV hariç/ })).toContainText(formatMoney(totals.netKurus));
  await expect(summary.getByRole("row", { name: /KDV %10/ })).toContainText(formatMoney(totals.vatByRate["10"] ?? 0));
  await expect(summary.getByRole("row", { name: /KDV %20/ })).toContainText(formatMoney(totals.vatByRate["20"] ?? 0));
  await expect(summary.getByRole("row", { name: /İskonto/ })).toContainText(formatMoney(totals.discountKurus));
  await expect(summary.getByRole("row", { name: /KDV dahil/ })).toContainText(formatMoney(totals.totalKurus));

  // Satır silinince toplam yeniden hesaplanır ve %20 satırı kaybolur.
  await drawer.getByRole("button", { name: `Satırı sil: ${general.code}` }).click();
  await approve(page, "Satırı sil");
  await expect(summary.getByRole("row", { name: /KDV %20/ })).toHaveCount(0);
  expect(await count(page, `select count(*)::int as n from sales_order_lines where order_id = '${id}'`)).toBe(1);
});

test("aynı ürün iskontosuz yeniden eklenince adet artar, iskonto korunur", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  const p = await product(page, "true");
  const { drawer, id } = await newDraft(page);
  const line = () => sql<{ qty: number; discount: number }>(page, `select qty_milli as qty, discount_permille as discount from sales_order_lines where order_id = '${id}'`);

  await addLine(drawer, p.code, "2", "10");
  await expect(page.getByRole("status").filter({ hasText: `${p.code} eklendi` })).toBeVisible();
  await expect.poll(line).toEqual([{ qty: 2000, discount: 100 }]);

  await addLine(drawer, p.code, "1");
  await expect.poll(line).toEqual([{ qty: 3000, discount: 100 }]);
  await expect(page.getByRole("status").filter({ hasText: `${p.code} adet artırıldı` })).toBeVisible();
});

for (const bad of ["1,5", "0", "abc", "10000"]) {
  test(`adet ${bad} alan hatası verir`, async ({ page }) => {
    await loginAs(page, "Elif Karaca");
    await openOrders(page);
    const drawer = await openFirstWithStatus(page, "Taslak");
    const id = new URL(page.url()).searchParams.get("ac") ?? "";
    const before = await count(page, `select coalesce(sum(qty_milli), 0)::int as n from sales_order_lines where order_id = '${id}'`);
    const p = await product(page, "true");
    await addLine(drawer, p.code, bad, "", false);
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(drawer.getByText(QTY_ERROR)).toBeVisible();
    await expect(drawer.getByLabel("Adet", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(await count(page, `select coalesce(sum(qty_milli), 0)::int as n from sales_order_lines where order_id = '${id}'`)).toBe(before);
  });
}

test("onay çift tıklamada tek iş emri açar", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  const p = await product(page, "on_hand_milli - reserved_milli = 0");
  const { drawer, id } = await newDraft(page);
  await addLine(drawer, p.code, "1");
  await expect(drawer.getByRole("list", { name: "Satırlar" }).getByRole("listitem").filter({ hasText: p.code })).toBeVisible();

  const before = await count(page, "select count(*)::int as n from work_orders");
  // Onay penceresinde onaya çift tıklamak da tek iş emri açar.
  await drawer.getByRole("button", { name: "Onayla" }).click();
  await confirmDialog(page).getByRole("button", { name: "Onayla" }).dblclick();
  await expect(confirmDialog(page)).toBeHidden();
  await expect(drawer.getByRole("button", { name: "Onayla" })).toHaveCount(0);
  await expect.poll(() => count(page, `select count(*)::int as n from sales_orders where id = '${id}' and status <> 'draft'`)).toBe(1);
  expect(await count(page, "select count(*)::int as n from work_orders")).toBe(before + 1);
  await expect(page.getByRole("alert").filter({ hasText: /zaten onaylanmış/ })).toHaveCount(0);
  // Satırın iş emri çekmecede bağlantı olarak görünür.
  await expect(drawer.getByRole("link", { name: /IE-/ }).first()).toHaveAttribute("href", /\/uretim\/is-emirleri\?ac=/);
});

test("malzeme eksikse onay sonrası eksik listesi görünür", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  const [pick] = await sql<{ code: string; qty: number }>(
    page,
    `select p.code,
            ((p.on_hand_milli - p.reserved_milli) / 1000
              + ceil((m.on_hand_milli - m.reserved_milli + 1000)::float8 / (b.qty_milli * (1000 + b.scrap_permille) / 1000.0)) + 1)::int as qty
       from products p
       join bom_lines b on b.product_id = p.id
       join materials m on m.id = b.material_id
      where p.active and m.name like '${SHORT_MATERIAL}%'
      order by p.code limit 1`,
  );
  if (!pick) throw new Error("arkalık kullanan ürün yok");
  expect(pick.qty).toBeLessThanOrEqual(9999);

  const { drawer } = await newDraft(page);
  await addLine(drawer, pick.code, String(pick.qty));
  await expect(drawer.getByRole("list", { name: "Satırlar" }).getByRole("listitem").filter({ hasText: pick.code })).toBeVisible();
  await drawer.getByRole("button", { name: "Onayla" }).click();
  await approve(page, "Onayla");

  const warning = drawer.getByRole("alert").filter({ hasText: "Malzeme eksik" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(SHORT_MATERIAL);
  await expect(warning).toContainText(/gerekli, .* var/);
  await expect(warning).toContainText("plaka");
  await expect(drawer.getByText("Malzeme bekliyor").first()).toBeVisible();
  // Veri yenilendikten sonra da kalır.
  await page.waitForTimeout(500);
  await expect(warning).toBeVisible();
});

test("depo hesabında Onayla görünmez; satış hesabında Sevk et görünmez", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  let drawer = await openFirstWithStatus(page, "Hazır");
  await expect(drawer.getByText("Hazır").first()).toBeVisible();
  for (const name of ["Sevk et", "İptal et"]) await expect(drawer.getByRole("button", { name })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Satış uzmanı yalnızca taslağı iptal edebilir.
  drawer = await openFirstWithStatus(page, "Taslak");
  await expect(drawer.getByRole("button", { name: "Onayla" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "İptal et" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış yap" }).click();
  await loginAs(page, "Onur Tekin");
  await openOrders(page);
  drawer = await openFirstWithStatus(page, "Taslak");
  for (const name of ["Onayla", "İptal et", "Satırı ekle"]) await expect(drawer.getByRole("button", { name })).toHaveCount(0);
  await page.keyboard.press("Escape");

  drawer = await openFirstWithStatus(page, "Hazır");
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  await drawer.getByRole("button", { name: "Sevk et" }).click();
  await approve(page, "Sevk et");
  await expect(page.getByRole("status").filter({ hasText: "sevk edildi" })).toBeVisible();
  await expect.poll(() => count(page, `select count(*)::int as n from sales_orders where id = '${id}' and status = 'shipped'`)).toBe(1);
  await expect(drawer.getByRole("button", { name: "Sevk et" })).toHaveCount(0);
});

test("satış müdürü onaylı siparişi gerekçeyle iptal eder", async ({ page }) => {
  await loginAs(page, "Tolga Erden");
  await openOrders(page);
  const drawer = await openFirstWithStatus(page, "Üretimde");
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  await drawer.getByRole("button", { name: "İptal et" }).click();
  const dialog = page.getByRole("dialog", { name: "Siparişi iptal et" });
  await dialog.getByRole("button", { name: "Siparişi iptal et" }).click();
  await expect(dialog.getByText("Gerekçe girin")).toBeVisible();
  await dialog.getByLabel("Gerekçe").fill("Müşteri vazgeçti");
  await dialog.getByRole("button", { name: "Siparişi iptal et" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "iptal edildi" })).toBeVisible();
  await expect.poll(() => count(page, `select count(*)::int as n from sales_orders where id = '${id}' and status = 'cancelled'`)).toBe(1);
  await expect(drawer.getByText("İptal").first()).toBeVisible();
});

test("müşteri ekle, aramada bul, siparişlerini gör", async ({ page }) => {
  const name = "Kestane Köşesi Deneme Evi";
  await loginAs(page, "Elif Karaca");
  await openCustomers(page);
  await page.getByRole("button", { name: "Yeni müşteri" }).click();
  const form = page.getByRole("dialog", { name: "Yeni müşteri" });
  await form.getByRole("button", { name: "Müşteriyi ekle" }).click();
  await expect(form.getByText("Ad girin")).toBeVisible();
  await form.getByLabel("Ad", { exact: true }).fill(name);
  await form.getByLabel("Tür").selectOption("kurumsal");
  await form.getByLabel("İl", { exact: true }).fill("Bursa");
  await form.getByLabel("İlçe").fill("Nilüfer");
  await form.getByLabel("Telefon").fill("0224 555 01 23");
  await form.getByLabel("Ödeme vadesi").fill("30");
  await form.getByRole("button", { name: "Müşteriyi ekle" }).click();
  await expect(confirmDialog(page)).toContainText("Bursa");
  await approve(page, "Müşteriyi ekle");
  await expect(page.getByRole("status").filter({ hasText: /MUS-\d{4} eklendi/ })).toBeVisible();
  await expect(form).toBeHidden();

  const rows = page.getByRole("table", { name: "Müşteriler" }).locator("tbody tr");
  await page.getByRole("searchbox", { name: "Müşteri ara" }).fill("kestane kosesi");
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(name);
  await expect(rows.first()).toContainText("Nilüfer");

  // Bu müşteriye bir sipariş aç, sonra müşteri çekmecesinden ona git.
  await openOrders(page);
  const { code } = await newDraft(page, "kestane");
  await page.keyboard.press("Escape");

  await openCustomers(page);
  await page.getByRole("searchbox", { name: "Müşteri ara" }).fill("kestane");
  await expect.poll(() => rows.count()).toBe(1);
  await rows.first().click();
  const drawer = page.getByRole("dialog", { name });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Kurumsal");
  await expect(drawer).toContainText("30 gün");
  await drawer.getByRole("link", { name: new RegExp(code) }).click();
  await expect(page).toHaveURL(/\/satis\/siparisler\?ac=/);
  await expect(page.getByRole("dialog", { name: code })).toBeVisible();
});

test("telefonda sipariş ve müşteri ekranları ve çekmeceleri yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Elif Karaca");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const [path, heading, rowText, drawerText] of [
    ["/satis/siparisler?durum=draft", "Siparişler", "Taslak", /SIP-/],
    ["/satis/musteriler", "Müşteriler", /MUS-/, /MUS-/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 45_000 });
    const rows = page.getByRole("table", { name: heading }).locator("tbody tr");
    await expect(rows.first()).toContainText(rowText);
    expect(await overflow(), path).toBeLessThanOrEqual(0);
    await rows.first().click();
    const drawer = page.getByRole("dialog").filter({ hasText: drawerText });
    await expect(drawer).toBeVisible();
    const inner = await drawer.evaluate((el) => {
      const body = el.querySelector("div.overflow-y-auto");
      return body ? body.scrollWidth - body.clientWidth : 0;
    });
    expect(inner, path).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("taslağa satır eklenince önerilen termin görünür; uygula → onay → termin değişir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openOrders(page);
  const p = await product(page, "on_hand_milli - reserved_milli = 0 and exists (select 1 from routings r where r.product_id = products.id)");

  // Termin bugün: üretim gereken ürün için öneriden erkendir.
  const istanbulToday = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayText = istanbulToday.split("-").reverse().join(".");
  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni sipariş" });
  await expect(dialog.getByText("Varsayılan: 14 gün sonra")).toBeVisible();
  await dialog.getByRole("radio").first().check();
  await dialog.getByLabel("Termin").fill(istanbulToday);
  await dialog.getByRole("button", { name: "Taslağı aç" }).click();
  await approve(page, "Taslağı aç");
  await expect(page).toHaveURL(/ac=/);
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  const [row] = await sql<{ code: string }>(page, `select code from sales_orders where id = '${id}'`);
  const code = row?.code ?? "";
  const drawer = page.getByRole("dialog", { name: code });
  const box = drawer.getByRole("region", { name: "Termin önerisi" });
  await expect(drawer.getByText("Henüz satır yok")).toBeVisible();
  await expect(box).toHaveCount(0);

  await addLine(drawer, p.code, "1");
  await expect(box).toContainText(/Önerilen termin: \d{2}\.\d{2}\.\d{4} · /);
  await expect(box).toContainText("Termin önerilenden önce");
  const suggested = /Önerilen termin: (\d{2}\.\d{2}\.\d{4})/.exec((await box.textContent()) ?? "")?.[1] ?? "";

  const due = async () => {
    const [r] = await sql<{ ms: number }>(page, `select (extract(epoch from due_at) * 1000)::float8 as ms from sales_orders where id = '${id}'`);
    return new Date((r?.ms ?? 0) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).split("-").reverse().join(".");
  };
  const logs = () => count(page, `select count(*)::int as n from audit_log where entity_id = '${id}' and action = 'update_due'`);

  // Vazgeç hiçbir şey değiştirmez.
  await box.getByRole("button", { name: "Öneriyi uygula" }).click();
  await expect(confirmDialog(page)).toContainText(`${code} termini ${todayText} → ${suggested} olacak.`);
  await confirmDialog(page).getByRole("button", { name: "Vazgeç" }).click();
  await expect(confirmDialog(page)).toBeHidden();
  expect(await due()).toBe(todayText);
  expect(await logs()).toBe(0);

  await box.getByRole("button", { name: "Öneriyi uygula" }).click();
  await approve(page, "Termini değiştir");
  await expect.poll(due).toBe(suggested);
  expect(await logs()).toBe(1);
  await expect(box).not.toContainText("Termin önerilenden önce");
  await expect(box.getByRole("button", { name: "Öneriyi uygula" })).toHaveCount(0);
  await expect(drawer.getByText(suggested).first()).toBeVisible();
});
