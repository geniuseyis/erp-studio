import { expect, test } from "@playwright/test";
import { approve, loginAs, one, settledHeight, sql } from "./helpers";

test("silinen sipariş satırının ürün kodu ve adı Geçmiş'te görünür", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Siparişler" }).click();
  await expect(page.getByRole("heading", { name: "Siparişler", level: 1 })).toBeVisible();

  const product = await one<{ code: string; name: string }>(page, "select code, name from products where active order by code limit 1");

  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni sipariş" });
  // Normal pencerede kapatma düğmesi küçük kalır (48 px yalnızca atölye onayında).
  expect(await settledHeight(dialog.getByRole("button", { name: "Kapat" }))).toBeLessThan(48);
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Taslağı aç" }).click();
  await approve(page, "Taslağı aç");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/ac=/);
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  const { code } = await one<{ code: string }>(page, `select code from sales_orders where id = '${id}'`);
  const drawer = page.getByRole("dialog", { name: code });

  const history = drawer.getByRole("region", { name: "Geçmiş" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await expect(history.getByRole("listitem").first()).toContainText("taslağı açıldı");
  await expect(history.getByRole("listitem").first()).toContainText("Elif Karaca");
  await expect(history.getByRole("listitem").first()).toContainText("Satış");

  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill(product.code);
  await drawer.getByRole("radio", { name: new RegExp(product.code) }).check();
  await drawer.getByLabel("Adet", { exact: true }).fill("2");
  await drawer.getByRole("button", { name: "Satırı ekle" }).click();
  await approve(page, "Satırı ekle");
  const lines = drawer.getByRole("list", { name: "Satırlar" });
  await expect(lines.getByRole("listitem").filter({ hasText: product.code })).toBeVisible();

  await drawer.getByRole("button", { name: `Satırı sil: ${product.code}` }).click();
  await approve(page, "Satırı sil");
  await expect(drawer.getByText("Henüz satır yok.")).toBeVisible();

  const newest = history.getByRole("listitem").first();
  await expect(newest).toContainText(`${code}: satır silindi — ${product.code} ${product.name} × 2`);
  await expect(newest.locator("time")).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  await expect(history.getByRole("listitem")).toHaveCount(3);
  const rows = await sql<{ n: number }>(page, `select count(*)::int as n from audit_log where entity_id = '${id}'`);
  expect(rows[0]?.n).toBe(3);
});

test("sipariş geçmişi bağlı iş emirlerinin kayıtlarını da gösterir; müşteri çekmecesinin geçmişi var", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const order = await one<{ id: string; code: string; wo: string }>(
    page,
    `select o.id, o.code, w.code as wo from sales_orders o
       join sales_order_lines l on l.order_id = o.id
       join work_orders w on w.sales_order_line_id = l.id
      where w.status = 'completed' order by o.code limit 1`,
  );
  await page.goto(`/satis/siparisler?ac=${order.id}`);
  const drawer = page.getByRole("dialog", { name: order.code });
  const history = drawer.getByRole("region", { name: "Geçmiş" });
  await expect(history.getByRole("listitem").filter({ hasText: `${order.wo} tamamlandı` })).toBeVisible({ timeout: 45_000 });
  await expect(history.getByRole("listitem").filter({ hasText: `${order.code} onaylandı` })).toBeVisible();

  const customer = await one<{ id: string; code: string; name: string }>(page, "select id, code, name from customers order by code limit 1");
  await page.goto(`/satis/musteriler?ac=${customer.id}`);
  const customerHistory = page.getByRole("dialog", { name: customer.name }).getByRole("region", { name: "Geçmiş" });
  await expect(customerHistory.getByRole("listitem").filter({ hasText: `${customer.code} ${customer.name} eklendi` })).toBeVisible({ timeout: 45_000 });
});
