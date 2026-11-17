import { expect, type Page, test } from "@playwright/test";
import { leave, loginAs, navTo, one, signOut, sql } from "./helpers";

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Sipariş ekranında koda göre arar ve çekmeceyi açar. */
async function openOrder(page: Page, code: string) {
  await navTo(page, "Siparişler");
  await page.getByRole("searchbox", { name: "Sipariş ara" }).fill(code);
  const rows = page.getByRole("table", { name: "Siparişler" }).locator("tbody tr");
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(code);
  await rows.first().click();
  const drawer = page.getByRole("dialog", { name: code });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("beş departmanla siparişten sevke", async ({ page }) => {
  test.setTimeout(240_000);

  // ---- Satış: Elif Karaca siparişi açar ve onaylar ----------------------------------------------------
  await loginAs(page, "Elif Karaca");
  // Mamul stoğu olmayan, bir adet için bütün malzemeleri yeten beyaz ürün (adım ve fire payıyla).
  const product = await one<{ id: string; code: string }>(
    page,
    `select p.id, p.code from products p
      where p.active and p.finish = 'beyaz' and p.on_hand_milli = 0
        and exists (select 1 from routings r where r.product_id = p.id)
        and not exists (
          select 1 from bom_lines b join materials m on m.id = b.material_id
           where b.product_id = p.id
             and m.on_hand_milli - m.reserved_milli < ceil(b.qty_milli::float8 * (1000 + b.scrap_permille) / 1000) + 1000)
      order by p.code limit 1`,
  );

  await navTo(page, "Siparişler");
  await page.getByRole("button", { name: "Yeni sipariş" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni sipariş" });
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Taslağı aç" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/ac=/);
  const orderId = new URL(page.url()).searchParams.get("ac") ?? "";
  const { code: orderCode } = await one<{ code: string }>(page, `select code from sales_orders where id = '${orderId}'`);
  let drawer = page.getByRole("dialog", { name: orderCode });
  await drawer.getByRole("searchbox", { name: "Ürün ara" }).fill(product.code);
  await drawer.getByRole("radio", { name: new RegExp(product.code) }).check();
  await drawer.getByLabel("Adet", { exact: true }).fill("1");
  await drawer.getByRole("button", { name: "Satırı ekle" }).click();
  await expect(drawer.getByRole("list", { name: "Satırlar" }).getByRole("listitem").filter({ hasText: product.code })).toBeVisible();
  await drawer.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${orderCode} onaylandı` })).toBeVisible();
  await expect(drawer.getByText("Üretimde").first()).toBeVisible();

  const wo = await one<{ id: string; code: string; reserved: boolean }>(
    page,
    `select w.id, w.code, w.materials_reserved as reserved from work_orders w
       join sales_order_lines l on l.id = w.sales_order_line_id where l.order_id = '${orderId}'`,
  );
  expect(wo.reserved).toBe(true);
  await leave(page);

  // ---- Planlama: Zeynep Arıkan iş emrini bugüne planlar ----------------------------------------------
  await loginAs(page, "Zeynep Arıkan");
  await navTo(page, "İş emirleri");
  await page.getByRole("searchbox", { name: "İş emri ara" }).fill(wo.code);
  const rows = page.getByRole("table", { name: "İş emirleri" }).locator("tbody tr");
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(wo.code);
  await rows.first().click();
  const woDrawer = page.getByRole("dialog", { name: wo.code });
  const today = new Date(Date.now() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
  await woDrawer.getByLabel("Başlangıç günü").fill(today);
  await woDrawer.getByRole("button", { name: "Planla" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${wo.code} planlandı` })).toBeVisible();
  await expect
    .poll(async () => (await one<{ n: number }>(page, `select count(*)::int as n from work_order_steps where work_order_id = '${wo.id}' and planned_day is null`)).n)
    .toBe(0);
  await leave(page);

  // ---- Atölye: Cem Doğru rotadaki her istasyonda Başla → Bitti --------------------------------------
  await loginAs(page, "Cem Doğru");
  const route = await sql<{ name: string }>(
    page,
    `select st.name from work_order_steps s join stations st on st.id = s.station_id where s.work_order_id = '${wo.id}' order by s.seq`,
  );
  expect(route.length).toBeGreaterThan(0);
  await navTo(page, "Atölye");
  const stations = page.getByRole("group", { name: "İstasyon" });
  for (const { name } of route) {
    await stations.getByRole("button", { name, exact: true }).click();
    await expect(stations.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    const card = page.getByRole("article", { name: wo.code });
    await card.getByRole("button", { name: "Başla" }).click();
    await card.getByRole("button", { name: "Bitti" }).click();
    await expect(card).toBeHidden();
  }
  await expect.poll(async () => (await one<{ s: string }>(page, `select status as s from work_orders where id = '${wo.id}'`)).s).toBe("completed");
  await expect.poll(async () => (await one<{ s: string }>(page, `select status as s from sales_orders where id = '${orderId}'`)).s).toBe("ready");
  await signOut(page);

  // ---- Depo: Onur Tekin siparişi sevk eder -------------------------------------------------------------
  await loginAs(page, "Onur Tekin");
  drawer = await openOrder(page, orderCode);
  await drawer.getByRole("button", { name: "Sevk et" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${orderCode} sevk edildi` })).toBeVisible();
  await leave(page);

  // ---- Yönetim: Nermin Aksoy siparişi sevk edilmiş görür -----------------------------------------------
  await loginAs(page, "Nermin Aksoy");
  drawer = await openOrder(page, orderCode);
  await expect(drawer.getByText("Sevk edildi").first()).toBeVisible();

  // ---- İki defter tutarlı: hareket toplamları tablolardaki eldeki ve ayrılmış miktarlara eşit ----------
  const drift = async (table: "materials" | "products", ledger: "stock_movements" | "product_movements", key: "material_id" | "product_id") =>
    (
      await one<{ n: number }>(
        page,
        `select count(*)::int as n from ${table} t
          left join (select ${key} as id, sum(delta_on_hand_milli) as on_hand, sum(delta_reserved_milli) as reserved
                       from ${ledger} group by ${key}) l on l.id = t.id
         where t.on_hand_milli <> coalesce(l.on_hand, 0) or t.reserved_milli <> coalesce(l.reserved, 0)`,
      )
    ).n;
  expect(await drift("materials", "stock_movements", "material_id")).toBe(0);
  expect(await drift("products", "product_movements", "product_id")).toBe(0);

  // Ürün üretildi, ayrıldı ve sevk edildi: eldeki ve ayrılmış yine sıfır; iş emrinin malzemesi tüketildi.
  const p = await one<{ on_hand: number; reserved: number }>(page, `select on_hand_milli::float8 as on_hand, reserved_milli::float8 as reserved from products where id = '${product.id}'`);
  expect(p).toEqual({ on_hand: 0, reserved: 0 });
  const consumed = await one<{ n: number }>(page, `select count(*)::int as n from stock_movements where ref_type = 'work_order' and ref_id = '${wo.id}' and type = 'consume'`);
  expect(consumed.n).toBeGreaterThan(0);
});
