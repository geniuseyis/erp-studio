import { expect, type Locator, type Page, test } from "@playwright/test";
import { formatMoney, lineValueKurus, roundUpToStep, type Unit } from "../../src/domain/units";
import { approve, confirmDialog, loginAs, navTo, sql } from "./helpers";

type Fixture = {
  supplierId: string;
  code: string;
  name: string;
  material: { id: string; code: string; name: string; unit: Unit };
  qtyMilli: number;
  priceKurus: number;
  netKurus: number;
};

const BUYER = "Kerem Uysal"; // Satın Alma uzmanı: taslak açar, onaylayamaz

/**
 * Kritik, bekleyen iş emri ihtiyacı ve yoldaki siparişi olmayan bir malzeme için tercihli tedarikçi açar. Öneri miktarı
 * `kritik açık = sipariş noktası − kullanılabilir` değerinin birim adımına yukarı yuvarlanmışıdır; birim fiyat öyle seçilir ki
 * KDV hariç tutar hedefe (varsayılan 100.000 TL: müdür kademesi) yaklaşır. Beklenen değerler SQL'den türer, sabit değildir.
 */
async function setupSupplier(page: Page, opts: { targetNetKurus?: number } = {}): Promise<Fixture> {
  const [m] = await sql<{ id: string; code: string; name: string; unit: Unit; gap: number }>(
    page,
    `select m.id, m.code, m.name, m.unit,
            (m.reorder_point_milli - (m.on_hand_milli - m.reserved_milli)
              - coalesce((select sum(l.qty_milli - l.received_milli) from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                          where l.material_id = m.id and o.status in ('draft','pending_approval','sent','partial')), 0))::float8 as gap
       from materials m
      where m.active
        and (m.on_hand_milli - m.reserved_milli) < m.reorder_point_milli
        and not exists (select 1 from bom_lines b join work_orders w on w.product_id = b.product_id
                         where b.material_id = m.id and w.status = 'planned' and not w.materials_reserved)
      order by m.code limit 1`,
  );
  if (!m || m.gap <= 0) throw new Error("kritik malzeme yok");
  const qtyMilli = roundUpToStep(m.gap, m.unit);
  const priceKurus = Math.max(1, Math.round(((opts.targetNetKurus ?? 10_000_000) * 1000) / qtyMilli));
  const [next] = await sql<{ n: number }>(page, "select coalesce(max(substring(code from 5)::int), 0) + 1 as n from suppliers");
  const code = `TED-${String(next?.n ?? 1).padStart(4, "0")}`;
  const name = `Deneme Tedarik ${code}`;
  await sql(page, `update supplier_items set is_preferred = false where material_id = '${m.id}'`);
  const [s] = await sql<{ id: string }>(
    page,
    `insert into suppliers (code, name, city, phone, lead_time_days, payment_term_days) values ('${code}', '${name}', 'Bursa', '0224 555 01 01', 5, 30) returning id`,
  );
  const supplierId = s?.id ?? "";
  await sql(
    page,
    `insert into supplier_items (supplier_id, material_id, unit_price_minor, moq_milli, is_preferred) values ('${supplierId}', '${m.id}', ${priceKurus}, 0, true)`,
  );
  return { supplierId, code, name, material: m, qtyMilli, priceKurus, netKurus: lineValueKurus(qtyMilli, priceKurus) };
}

const group = (page: Page, name: string): Locator => page.getByRole("region", { name });

test("satın alma uzmanı öneriden taslak açar: onay penceresi tutarı ve kademeyi söyler", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  await navTo(page, "Öneriler", "Satın alma önerileri");

  const card = group(page, f.name);
  await expect(card).toBeVisible();
  await expect(card).toContainText(formatMoney(f.netKurus));
  await expect(card).toContainText("Müdür onayı");
  await expect(card).toContainText(f.material.code);

  await card.getByRole("button", { name: "Taslak oluştur" }).click();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${f.code} için 1 kalem, ${formatMoney(f.netKurus)} KDV hariç taslak açılsın mı? Gönderimde Satın Alma müdürü onayı gerekecek.`);
  await approve(page, "Taslağı aç");

  await expect(page).toHaveURL(/\/satin-alma\/siparisler\?ac=/);
  const id = new URL(page.url()).searchParams.get("ac") ?? "";
  // Veritabanı sondası uygulama açılınca gelir; sipariş ekranından bağımsız olarak öneri sayfasına dönülüp okunur.
  await page.goto("/satin-alma/oneriler");
  await expect(page.getByRole("heading", { name: "Satın alma önerileri", level: 1 })).toBeVisible();
  const read = async () => {
    try {
      const [po] = await sql<{ status: string; lines: number; net: number; creator: string }>(
        page,
        `select o.status, count(l.id)::int as lines, sum(round(l.qty_milli * l.unit_price_minor / 1000.0))::float8 as net, u.name as creator
           from purchase_orders o join purchase_order_lines l on l.order_id = o.id join users u on u.id = o.created_by
          where o.id = '${id}' group by o.status, u.name`,
      );
      return po;
    } catch {
      return undefined;
    }
  };
  await expect.poll(read).toEqual({ status: "draft", lines: 1, net: f.netKurus, creator: BUYER });
  const [order] = await sql<{ code: string }>(page, `select code from purchase_orders where id = '${id}'`);
  expect(order?.code).toMatch(/^SAS-\d{4}-\d{4}$/);
});

test("satış uzmanı önerileri görür ama 'Taslak oluştur' düğmesi yok", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const f = await setupSupplier(page);
  await navTo(page, "Öneriler", "Satın alma önerileri");
  const card = group(page, f.name);
  await expect(card).toBeVisible();
  await expect(card).toContainText(formatMoney(f.netKurus));
  await expect(page.getByRole("button", { name: "Taslak oluştur" })).toHaveCount(0);
});

test("tedarikçiye fiyat eklenir; onay penceresi değeri yazar; çekmecedeki listede ve Geçmiş'te görünür", async ({ page }) => {
  await loginAs(page, BUYER);
  await navTo(page, "Tedarikçiler");

  // Yeni tedarikçi formdan eklenir; onay penceresi alanları yazar.
  const name = `Form Tedarik ${Date.now() % 100000}`;
  await page.getByRole("button", { name: "Yeni tedarikçi" }).click();
  const form = page.getByRole("dialog", { name: "Yeni tedarikçi" });
  await form.getByLabel("Ad", { exact: true }).fill(name);
  await form.getByLabel("İl", { exact: true }).fill("Kocaeli");
  await form.getByLabel("Yetkili", { exact: true }).fill("Selin Akın");
  await form.getByLabel("Telefon", { exact: true }).fill("0262 555 01 02");
  await form.getByLabel("Teslim süresi", { exact: true }).fill("6");
  await form.getByLabel("Ödeme vadesi", { exact: true }).fill("45");
  await form.getByRole("button", { name: "Tedarikçiyi ekle" }).click();
  await expect(confirmDialog(page)).toContainText(name);
  await approve(page, "Tedarikçiyi ekle");
  await expect(form).toBeHidden();

  const [row] = await sql<{ id: string; code: string; lead: number }>(page, `select id, code, lead_time_days as lead from suppliers where name = '${name}'`);
  expect(row?.lead).toBe(6);
  // Eklenen tedarikçinin çekmecesi kendiliğinden açılır.
  await expect(page).toHaveURL(new RegExp(`ac=${row?.id}`));
  const drawer = page.getByRole("dialog", { name });
  await expect(drawer).toBeVisible();

  const [mat] = await sql<{ id: string; code: string; name: string; unit: string }>(page, "select id, code, name, unit from materials where active order by code limit 1");
  await drawer.getByRole("button", { name: "Fiyat ekle" }).click();
  const priceForm = page.getByRole("dialog", { name: "Fiyat ekle" });
  await priceForm.getByRole("searchbox", { name: "Malzeme ara" }).fill(mat?.code ?? "");
  await priceForm.getByRole("radio", { name: new RegExp(mat?.code ?? "") }).check();
  await priceForm.getByLabel("Birim fiyat", { exact: true }).fill("1580,50");
  await priceForm.getByLabel("En az sipariş miktarı", { exact: true }).fill("10");
  await priceForm.getByRole("checkbox", { name: "Tercihli tedarikçi" }).check();
  await priceForm.getByRole("button", { name: "Fiyatı ekle" }).click();
  await expect(confirmDialog(page)).toContainText(`${mat?.code}`);
  await expect(confirmDialog(page)).toContainText(formatMoney(158050));
  await expect(confirmDialog(page)).toContainText("tercihli");
  await approve(page, "Fiyatı ekle");
  await expect(priceForm).toBeHidden();

  const prices = drawer.getByRole("list", { name: "Fiyat listesi" });
  await expect(prices.getByRole("listitem").filter({ hasText: mat?.code ?? "" })).toContainText(formatMoney(158050));
  await expect(prices.getByRole("listitem").filter({ hasText: mat?.code ?? "" })).toContainText("Tercihli");
  const [item] = await sql<{ price: number; moq: number; pref: boolean }>(
    page,
    `select unit_price_minor::float8 as price, moq_milli::float8 as moq, is_preferred as pref from supplier_items where supplier_id = '${row?.id}' and material_id = '${mat?.id}'`,
  );
  expect(item).toEqual({ price: 158050, moq: 10_000, pref: true });

  const history = drawer.getByRole("region", { name: "Geçmiş" });
  await expect(history).toContainText(`${mat?.code}`);
  await expect(history).toContainText("fiyatı ₺1.580,50");
});

test("390 px'te öneriler ve tedarikçiler sayfası yatay taşmaz", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto("/satin-alma/oneriler");
  await expect(group(page, f.name)).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);

  await page.goto("/satin-alma/tedarikciler");
  await expect(page.getByRole("table", { name: "Tedarikçiler" }).getByRole("row", { name: new RegExp(f.code) })).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);
});
