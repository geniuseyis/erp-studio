import { expect, type Page, test } from "@playwright/test";
import { istanbulDayStart } from "@/domain/production/calendar";
import { approve, loginAs, navTo, one, signOut, sql } from "./helpers";

const stat = (page: Page, label: string) =>
  page.locator("div.glass").filter({ has: page.getByText(label, { exact: true }) }).getByTestId("stat-value");
const table = (page: Page) => page.getByRole("table", { name: "İşlemler" });

test("silinen sipariş satırı İşlemler'de 'satır silindi' aramasıyla bulunur; kayda tıklayınca sipariş çekmecesi açılır", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const order = await one<{ id: string; code: string }>(
    page,
    `select o.id, o.code from sales_orders o where o.status = 'draft'
       and (select count(*) from sales_order_lines l where l.order_id = o.id) >= 2 order by o.code limit 1`,
  );
  const target = await one<{ code: string; name: string }>(
    page,
    `select p.code, p.name from sales_order_lines l join products p on p.id = l.product_id where l.order_id = '${order.id}' order by p.code limit 1`,
  );

  await page.goto(`/satis/siparisler?ac=${order.id}`);
  const drawer = page.getByRole("dialog", { name: order.code });
  await drawer.getByRole("button", { name: `Satırı sil: ${target.code}` }).click({ timeout: 45_000 });
  await approve(page, "Satırı sil");
  await expect(drawer.getByRole("button", { name: `Satırı sil: ${target.code}` })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await navTo(page, "İşlemler");
  await page.getByRole("searchbox", { name: "İşlem ara" }).fill("satır silindi");
  await expect(page).toHaveURL(/q=sat%C4%B1r/);
  const top = table(page).locator("tbody tr").first();
  await expect(top).toContainText(`${order.code}: satır silindi — ${target.code} ${target.name}`);
  await expect(top).toContainText("Satır silindi");
  await expect(top).toContainText("Elif Karaca");
  await expect(top.locator("time")).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);

  await top.getByRole("link", { name: new RegExp(order.code) }).click();
  await expect(page).toHaveURL(new RegExp(`/satis/siparisler\\?ac=${order.id}`));
  await expect(page.getByRole("dialog", { name: order.code })).toBeVisible();
});

test("depo kullanıcısı da İşlemler'i görür; sayılar veritabanından; departman, kişi ve tarih süzgeçleri adreste kalır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await navTo(page, "İşlemler");

  const rows = table(page).locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  const dayStart = istanbulDayStart(new Date());
  const weekAgo = new Date(dayStart.getTime() - 6 * 86_400_000);
  const count = async (since: Date) =>
    (await one<{ n: number }>(page, `select count(*)::int as n from audit_log where entity <> 'user' and created_at >= '${since.toISOString()}'`)).n;
  await expect(stat(page, "Bugün")).toHaveText(String(await count(dayStart)));
  await expect(stat(page, "Son 7 gün")).toHaveText(String(await count(weekAgo)));

  // Depo kullanıcısı satış ekranlarını görür: sipariş kayıtları bağlantıdır.
  await page.getByRole("button", { name: "Sipariş", exact: true }).click();
  await expect(page).toHaveURL(/tur=sales_order/);
  await expect(rows.first().getByRole("link", { name: /SIP-/ })).toBeVisible();
  await page.getByRole("button", { name: "Tümü", exact: true }).click();

  await page.getByLabel("Departman").selectOption("satis");
  await expect(page).toHaveURL(/departman=satis/);
  await expect(rows.first()).toContainText("Satış");
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(shown, 15); i += 1) await expect(rows.nth(i)).toContainText("Satış");
  const satis = await one<{ n: number }>(
    page,
    "select count(*)::int as n from audit_log a join users u on u.id = a.user_id where u.department_code = 'satis' and a.entity <> 'user'",
  );
  expect(shown).toBe(Math.min(satis.n, 500));

  await page.getByLabel("Departman").selectOption("");
  await page.getByRole("button", { name: /Kişi: Tümü/ }).click();
  const picker = page.getByRole("dialog", { name: "Kişi seç" });
  await picker.getByRole("searchbox", { name: "Kişi ara" }).fill("zeynep");
  await picker.getByRole("radio", { name: /Zeynep Arıkan/ }).check();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/kisi=/);
  await expect(page.getByRole("button", { name: /Kişi: Zeynep Arıkan/ })).toBeVisible();
  await expect(rows.first()).toContainText("Zeynep Arıkan");
  const zeynep = await sql<{ n: number }>(
    page,
    "select count(*)::int as n from audit_log a join users u on u.id = a.user_id where u.name = 'Zeynep Arıkan' and a.entity <> 'user'",
  );
  await expect(rows).toHaveCount(Math.min(zeynep[0]?.n ?? 0, 500));

  await page.getByLabel("Başlangıç").fill("2099-01-01");
  await expect(page).toHaveURL(/bas=2099-01-01/);
  await expect(page.getByText("Bu süzgeçlerle eşleşen işlem yok")).toBeVisible();
  await page.getByRole("button", { name: "Süzgeçleri temizle" }).first().click();
  await expect(page).not.toHaveURL(/kisi=|bas=/);
  await expect(rows.first()).toBeVisible();
});

test("kullanıcı kayıtları yalnızca Kullanıcılar modülünü görenlere gösterilir: BT görür, atölye görmez", async ({ page }) => {
  const kindChip = page.getByRole("group", { name: "Kayıt türü" }).getByRole("button", { name: "Kullanıcı", exact: true });
  const rows = table(page).locator("tbody tr");

  // Demo verisinde kullanıcı kaydı yoktur: BT hesabıyla bir tane yazılır (sonra aynı tarayıcıdan atölye hesabıyla bakılır).
  await loginAs(page, "Deniz Aydemir");
  await sql(
    page,
    `insert into audit_log (user_id, entity, entity_id, action, summary)
       select u.id, 'user', u.id::text, 'deactivate', u.name || ' pasife alındı' from users u where u.name = 'Deniz Aydemir'`,
  );
  await navTo(page, "İşlemler");
  await expect(kindChip).toBeVisible({ timeout: 45_000 });
  await kindChip.click();
  await expect(page).toHaveURL(/tur=user/);
  await expect(rows.first()).toContainText("Deniz Aydemir pasife alındı");
  await signOut(page);

  await loginAs(page, "Cem Doğru");
  await navTo(page, "İşlemler");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  await expect(kindChip).toHaveCount(0);
  await expect(table(page).getByText("pasife alındı")).toHaveCount(0);
  await page.goto("/islemler?tur=user");
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
  await expect(table(page).getByText("pasife alındı")).toHaveCount(0);
  await expect(table(page).getByText("Kullanıcı", { exact: true })).toHaveCount(0);
});

test("Ctrl+K paletinde İşlemler sayfası var", async ({ page }) => {
  await loginAs(page, "Cem Doğru");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Ara ve git" })).toBeVisible();
  await page.keyboard.type("işlem");
  await expect(page.getByRole("option", { name: /İşlemler/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/islemler/);
  await expect(page.getByRole("heading", { name: "İşlemler", level: 1 })).toBeVisible();
});

test("telefonda İşlemler ekranı yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Elif Karaca");
  await page.goto("/islemler");
  await expect(page.getByRole("heading", { name: "İşlemler", level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(table(page).locator("tbody tr").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: /Kişi: Tümü/ }).click();
  await expect(page.getByRole("dialog", { name: "Kişi seç" })).toBeVisible();
  const after = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(after).toBeLessThanOrEqual(0);
});
