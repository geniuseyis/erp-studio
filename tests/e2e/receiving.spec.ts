import { expect, type Page, test } from "@playwright/test";
import { approve, confirmDialog, insertSupplier, loginAs, navTo, nextPoCode, one, sql } from "./helpers";

const DEPO = "Onur Tekin"; // depo uzmanı: inventory:execute
const SALES = "Elif Karaca"; // yalnızca görüntüler

type Receivable = { id: string; code: string; lineA: string; lineB: string; matA: string; matB: string };

/**
 * Gönderilmiş, iki kalemli bir sipariş yazar (10 ve 6 birim; tedarikçi ve fiyat bu testin kendisidir). Malzemeler adım 1
 * olan birimlerdendir ki "4" gibi tam sayılar geçerli olsun. Beklenen değerler SQL'den okunur.
 */
async function sentOrder(page: Page): Promise<Receivable> {
  const mats = await sql<{ id: string; code: string }>(page, `select id, code from materials where active and unit in ('adet','plaka') order by code limit 2`);
  const [a, b] = mats;
  if (!a || !b) throw new Error("iki malzeme yok");
  const sup = await insertSupplier(page, () => "Mal Kabul Deneme", 3);
  const code = await nextPoCode(page);
  const po = await one<{ id: string }>(
    page,
    `insert into purchase_orders (code, supplier_id, status, required_tier, created_by, submitted_at, sent_at, expected_at)
     values ('${code}', '${sup.id}', 'sent', 0, (select id from users where name = 'Kerem Uysal'), now(), now(), now() + interval '3 days') returning id`,
  );
  const lineA = await one<{ id: string }>(page, `insert into purchase_order_lines (order_id, material_id, qty_milli, unit_price_minor) values ('${po.id}', '${a.id}', 10000, 5000) returning id`);
  const lineB = await one<{ id: string }>(page, `insert into purchase_order_lines (order_id, material_id, qty_milli, unit_price_minor) values ('${po.id}', '${b.id}', 6000, 7000) returning id`);
  return { id: po.id, code, lineA: lineA.id, lineB: lineB.id, matA: a.code, matB: b.code };
}

async function openReceipt(page: Page, o: Receivable) {
  await navTo(page, "Mal kabul", "Mal kabul");
  await page.getByRole("table", { name: "Mal kabule açık siparişler" }).getByRole("row", { name: new RegExp(o.code) }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(o.code) });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("depo uzmanı kısmi mal kabul yapar; sipariş Kısmi teslim, kalan güncellenir, stok hareketi SAS kodlu", async ({ page }) => {
  await loginAs(page, DEPO);
  const o = await sentOrder(page);
  const before = await one<{ on_hand: number }>(page, `select on_hand_milli::float8 as on_hand from materials where code = '${o.matA}'`);
  const drawer = await openReceipt(page, o);

  await drawer.getByLabel("İrsaliye no").fill("T-5001");
  await drawer.getByLabel(`${o.matA} miktarı`).fill("4");
  await drawer.getByLabel(`${o.matB} miktarı`).fill("0");
  await drawer.getByRole("button", { name: "Mal kabul et" }).click();

  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(/kısmi/i);
  await expect(dialog).toContainText(o.matA);
  await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await approve(page, "Mal kabul et");

  await expect(page.getByText(/MK-\d{4}-\d{4} kaydedildi/)).toBeVisible();
  await expect.poll(async () => (await one<{ status: string }>(page, `select status from purchase_orders where id = '${o.id}'`)).status).toBe("partial");
  const line = await one<{ received: number }>(page, `select received_milli::float8 as received from purchase_order_lines where id = '${o.lineA}'`);
  expect(line.received).toBe(4000);
  const move = await one<{ type: string; qty: number; ref: string }>(page, `select type, delta_on_hand_milli::float8 as qty, ref_id::text as ref from stock_movements where ref_id = '${o.id}'`);
  expect(move).toMatchObject({ type: "receipt", qty: 4000, ref: o.id });
  const after = await one<{ on_hand: number }>(page, `select on_hand_milli::float8 as on_hand from materials where code = '${o.matA}'`);
  expect(after.on_hand - before.on_hand).toBe(4000);

  // Kalan kalem sayısı listede güncellenir; son mal kabuller bölümünde MK kodu ve irsaliye görünür.
  const row = page.getByRole("table", { name: "Mal kabule açık siparişler" }).getByRole("row", { name: new RegExp(o.code) });
  await expect(row).toBeVisible();
  await expect(page.getByRole("table", { name: "Son mal kabuller" })).toContainText("T-5001");
});

test("kalandan fazla miktar alan hatası verir, onay penceresi açılmaz", async ({ page }) => {
  await loginAs(page, DEPO);
  const o = await sentOrder(page);
  const drawer = await openReceipt(page, o);
  await drawer.getByLabel("İrsaliye no").fill("T-5002");
  await drawer.getByLabel(`${o.matA} miktarı`).fill("11");
  await drawer.getByRole("button", { name: "Mal kabul et" }).click();
  await expect(drawer).toContainText(/kalan/i);
  await expect(confirmDialog(page)).toHaveCount(0);
  const n = await one<{ n: number }>(page, `select count(*)::int as n from goods_receipts where purchase_order_id = '${o.id}'`);
  expect(n.n).toBe(0);
});

test("aynı irsaliye ikinci kez: hata bildirimi, hiçbir şey yazılmaz", async ({ page }) => {
  await loginAs(page, DEPO);
  const o = await sentOrder(page);
  let drawer = await openReceipt(page, o);
  await drawer.getByLabel("İrsaliye no").fill("T-5003");
  await drawer.getByLabel(`${o.matA} miktarı`).fill("3");
  await drawer.getByLabel(`${o.matB} miktarı`).fill("0");
  await drawer.getByRole("button", { name: "Mal kabul et" }).click();
  await approve(page, "Mal kabul et");
  await expect(page.getByText(/MK-\d{4}-\d{4} kaydedildi/)).toBeVisible();

  drawer = await openReceipt(page, o);
  await drawer.getByLabel("İrsaliye no").fill("t-5003");
  await drawer.getByLabel(`${o.matA} miktarı`).fill("2");
  await drawer.getByLabel(`${o.matB} miktarı`).fill("0");
  await drawer.getByRole("button", { name: "Mal kabul et" }).click();
  await confirmDialog(page).getByRole("button", { name: "Mal kabul et", exact: true }).click();
  await expect(page.getByText(/Bu irsaliye zaten girildi/).first()).toBeVisible();
  const n = await one<{ n: number; received: number }>(
    page,
    `select (select count(*)::int from goods_receipts where purchase_order_id = '${o.id}') as n, (select received_milli::float8 from purchase_order_lines where id = '${o.lineA}') as received`,
  );
  expect(n).toEqual({ n: 1, received: 3000 });
});

test("satış uzmanı listeyi görür, 'Mal kabul et' düğmesi yok", async ({ page }) => {
  await loginAs(page, SALES);
  const o = await sentOrder(page);
  const drawer = await openReceipt(page, o);
  await expect(drawer).toContainText(o.matA);
  await expect(page.getByRole("button", { name: "Mal kabul et" })).toHaveCount(0);
  await expect(drawer.getByLabel("İrsaliye no")).toHaveCount(0);
  await expect(drawer).toContainText("Mal kabul etmek için depo yetkisi gerekir");
});

test("390 px'te sayfa yatay taşmaz", async ({ page }) => {
  await loginAs(page, DEPO);
  await sentOrder(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/depo/mal-kabul");
  await expect(page.getByRole("table", { name: "Mal kabule açık siparişler" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
