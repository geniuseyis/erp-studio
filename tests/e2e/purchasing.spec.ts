import { expect, type Locator, type Page, test } from "@playwright/test";
import { formatMoney, formatQty, lineValueKurus, roundUpToStep, UNIT_STEP_MILLI, type Unit } from "../../src/domain/units";
import { approve, confirmDialog, leave, loginAs, navTo, sql } from "./helpers";

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
const MANAGER = "Ayla Güneş"; // Satın Alma müdürü: müdür kademesini onaylar
const BOARD = "Nermin Aksoy"; // Yönetim: iki kademeyi de onaylar

/**
 * Kritik, bekleyen iş emri ihtiyacı ve yoldaki siparişi olmayan bir malzeme için tercihli tedarikçi açar. Öneri miktarı
 * `kritik açık = sipariş noktası − kullanılabilir` değerinin birim adımına yukarı yuvarlanmışıdır; birim fiyat öyle seçilir ki
 * KDV hariç tutar hedefe (varsayılan 100.000 TL: müdür kademesi) yaklaşır. Beklenen değerler SQL'den türer, sabit değildir.
 */
/** Boşluğu hâlâ pozitif olan ilk kritik malzeme: bekleyen iş emri ihtiyacı olmayan, açık siparişle henüz karşılanmamış. */
async function criticalMaterial(page: Page) {
  const [m] = await sql<{ id: string; code: string; name: string; unit: Unit; gap: number }>(
    page,
    `select * from (
       select m.id, m.code, m.name, m.unit,
              (m.reorder_point_milli - (m.on_hand_milli - m.reserved_milli)
                - coalesce((select sum(l.qty_milli - l.received_milli) from purchase_order_lines l join purchase_orders o on o.id = l.order_id
                            where l.material_id = m.id and o.status in ('draft','pending_approval','sent','partial')), 0))::float8 as gap
         from materials m
        where m.active
          and (m.on_hand_milli - m.reserved_milli) < m.reorder_point_milli
          and not exists (select 1 from bom_lines b join work_orders w on w.product_id = b.product_id
                           where b.material_id = m.id and w.status = 'planned' and not w.materials_reserved)
     ) t where t.gap > 0 order by t.code limit 1`,
  );
  if (!m) throw new Error("kritik malzeme yok");
  return m;
}

async function setupSupplier(page: Page, opts: { targetNetKurus?: number } = {}): Promise<Fixture> {
  const m = await criticalMaterial(page);  const qtyMilli = roundUpToStep(m.gap, m.unit);
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
  const [order] = await sql<{ code: string; status: string; lines: number; net: number; creator: string }>(
    page,
    `select o.code, o.status, count(l.id)::int as lines, sum(round(l.qty_milli * l.unit_price_minor / 1000.0))::float8 as net, u.name as creator
       from purchase_orders o join purchase_order_lines l on l.order_id = o.id join users u on u.id = o.created_by
      where o.id = '${id}' group by o.code, o.status, u.name`,
  );
  expect(order).toMatchObject({ status: "draft", lines: 1, net: f.netKurus, creator: BUYER });
  expect(order?.code).toMatch(/^SAS-\d{4}-\d{4}$/);
  await expect(page.getByRole("status").filter({ hasText: `${order?.code} taslağı açıldı` })).toBeVisible();
  await expect(page.getByRole("dialog", { name: order?.code })).toBeVisible();
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

test("Ctrl+K'da tedarikçi kodu tedarikçi çekmecesini açar; adıyla da bulunur", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const f = await setupSupplier(page);
  // Kayıtlar palet açılınca okunur; kurulum sonrası paleti açmak yeterli.
  await page.keyboard.press("Control+k");
  await page.keyboard.type(f.code);
  const option = page.getByRole("option", { name: new RegExp(f.name) });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/satin-alma/tedarikciler\\?ac=${f.supplierId}`));
  await expect(page.getByRole("dialog", { name: f.name })).toBeVisible();
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

// ---- Satın alma siparişleri (Görev 8) ----

type OrderStatus = "draft" | "pending_approval" | "sent" | "partial" | "cancelled";
type Seeded = { id: string; code: string };

/**
 * Kurulan tedarikçiye tek kalemli sipariş yazar (kalem miktarı ve fiyatı fixture'dan). Kod, İstanbul yılına göre sıradaki
 * SAS kodudur. `sent` siparişte beklenen gün üç gün sonradır (gecikmez).
 */
async function insertOrder(page: Page, f: Fixture, o: { status: OrderStatus; tier: 0 | 1 | 2; creator?: string; managerApproved?: string }): Promise<Seeded> {
  const [c] = await sql<{ code: string }>(
    page,
    `select 'SAS-' || t.y || '-' || lpad((coalesce(max(substring(p.code from 10)::int), 0) + 1)::text, 4, '0') as code
       from (select to_char(now() at time zone 'Europe/Istanbul', 'YYYY') as y) t
       left join purchase_orders p on p.code like 'SAS-' || t.y || '-%' group by t.y`,
  );
  const code = c?.code ?? "";
  const sent = o.status === "sent" || o.status === "partial";
  const submitted = o.status !== "draft";
  const manager = o.managerApproved ? `(select id from users where name = '${o.managerApproved}')` : "null";
  const cancelled = o.status === "cancelled";
  const [po] = await sql<{ id: string }>(
    page,
    `insert into purchase_orders (code, supplier_id, status, required_tier, created_by, submitted_at, sent_at, expected_at, manager_approved_by, manager_approved_at, cancelled_at, cancel_reason)
     values ('${code}', '${f.supplierId}', '${o.status}', ${o.tier}, (select id from users where name = '${o.creator ?? BUYER}'),
             ${submitted ? "now()" : "null"}, ${sent ? "now()" : "null"}, ${sent ? "now() + interval '3 days'" : "null"},
             ${manager}, ${o.managerApproved ? "now()" : "null"}, ${cancelled ? "now()" : "null"}, ${cancelled ? "'deneme'" : "''"}) returning id`,
  );
  const id = po?.id ?? "";
  await sql(page, `insert into purchase_order_lines (order_id, material_id, qty_milli, unit_price_minor) values ('${id}', '${f.material.id}', ${f.qtyMilli}, ${f.priceKurus})`);
  return { id, code };
}

const poTable = (page: Page): Locator => page.getByRole("table", { name: "Satın alma siparişleri" });
const poRows = (page: Page): Locator => poTable(page).locator("tbody tr");

/** Sipariş listesini açar, kodu satırdan seçip çekmeceyi döner. */
async function openPo(page: Page, code: string): Promise<Locator> {
  await navTo(page, "Satın alma siparişleri");
  await poRows(page).filter({ hasText: code }).click();
  const drawer = page.getByRole("dialog", { name: code });
  await expect(drawer).toBeVisible();
  return drawer;
}

const statusOf = async (page: Page, id: string) =>
  (await sql<{ s: string; t: number }>(page, `select status as s, required_tier as t from purchase_orders where id = '${id}'`))[0];

test("uzman taslağı 'Onaya gönder'ir; kendi siparişinde 'Onayla' yok, onay notu var", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "draft", tier: 0 });
  const drawer = await openPo(page, po.code);

  await expect(drawer).toContainText("Bu sipariş Müdür onayı ister");
  await expect(drawer.getByRole("button", { name: "Gönder", exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(confirmDialog(page)).toContainText(`${po.code}: ${formatMoney(f.netKurus)} KDV hariç 50.000 TL eşiğini aşıyor; Satın Alma müdürünün onayına gider.`);
  await expect(confirmDialog(page).getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await approve(page, "Onaya gönder");

  await expect.poll(() => statusOf(page, po.id)).toEqual({ s: "pending_approval", t: 1 });
  await expect(drawer.getByText("Onay bekleniyor: Satın Alma müdürü")).toBeVisible();
  await expect(drawer.getByText("Kendi siparişinizi onaylayamazsınız")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Onayla" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Onaya gönder" })).toHaveCount(0);
  await expect(drawer.getByRole("region", { name: "Geçmiş" })).toContainText(`${po.code} onaya gönderildi`);
});

test("müdür 'Onay bekliyor' süzgecinde siparişi açar, onaylar; durum Gönderildi, beklenen teslim yazılı", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "pending_approval", tier: 1 });
  await leave(page);
  await loginAs(page, MANAGER);

  await navTo(page, "Satın alma siparişleri");
  await page.getByRole("button", { name: "Onay bekliyor", exact: true }).click();
  await expect(page).toHaveURL(/durum=pending_approval/);
  const pendingCount = async () => (await sql<{ n: number }>(page, "select count(*)::int as n from purchase_orders where status = 'pending_approval'"))[0]?.n;
  await expect.poll(async () => (await poRows(page).count()) === (await pendingCount())).toBe(true);
  await expect(poRows(page).filter({ hasText: po.code })).toContainText("Müdür onayı bekliyor");
  await poRows(page).filter({ hasText: po.code }).click();
  const drawer = page.getByRole("dialog", { name: po.code });
  await expect(drawer).toContainText("Bu kademeyi siz onaylayabilirsiniz");

  await drawer.getByRole("button", { name: "Onayla", exact: true }).click();
  const text = confirmDialog(page);
  await expect(text).toContainText(`${po.code}: Müdür onayı gerekiyor; ${formatMoney(f.netKurus)} KDV hariç, müdür kademesi onaylanacak.`);
  await expect(text).toContainText(/Onaylanınca tedarikçiye gönderilir, beklenen teslim \d{2}\.\d{2}\.\d{4}\./);
  await approve(page, "Onayla");

  await expect.poll(() => statusOf(page, po.id)).toEqual({ s: "sent", t: 1 });
  const [row] = await sql<{ d: string; approver: string }>(
    page,
    `select to_char(o.expected_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY') as d, u.name as approver
       from purchase_orders o join users u on u.id = o.manager_approved_by where o.id = '${po.id}'`,
  );
  expect(row?.approver).toBe(MANAGER);
  await expect(drawer.getByRole("list", { name: "Onay zinciri" })).toContainText(`Onayladı: ${MANAGER}`);
  await expect(drawer.getByText("Beklenen teslim").locator("xpath=following-sibling::dd[1]")).toContainText(row?.d ?? "");
  await expect(drawer.getByRole("button", { name: "Onayla", exact: true })).toHaveCount(0);
});

test("iki kademe: müdür onaylar, Yönetim bekler ve müdür bir daha onaylayamaz; Yönetim onaylayınca gönderilir", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page, { targetNetKurus: 30_000_000 });
  const po = await insertOrder(page, f, { status: "pending_approval", tier: 2 });
  await leave(page);
  await loginAs(page, MANAGER);

  let drawer = await openPo(page, po.code);
  await expect(drawer).toContainText("Bu sipariş Müdür + Yönetim onayı ister");
  await drawer.getByRole("button", { name: "Onayla", exact: true }).click();
  await expect(confirmDialog(page)).toContainText("Sipariş ardından Yönetim onayı bekler");
  await approve(page, "Onayla");
  await expect.poll(() => statusOf(page, po.id)).toEqual({ s: "pending_approval", t: 2 });
  await expect(drawer.getByText("Onay bekleniyor: Yönetim")).toBeVisible();
  await expect(drawer.getByText("Bu kademe Yönetim onayı ister")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Onayla", exact: true })).toHaveCount(0);
  await leave(page);

  await loginAs(page, BOARD);
  drawer = await openPo(page, po.code);
  await expect(drawer.getByRole("list", { name: "Onay zinciri" })).toContainText(`Onayladı: ${MANAGER}`);
  await drawer.getByRole("button", { name: "Onayla", exact: true }).click();
  await approve(page, "Onayla");
  await expect.poll(() => statusOf(page, po.id)).toEqual({ s: "sent", t: 2 });
  await expect(drawer.getByRole("list", { name: "Onay zinciri" })).toContainText(`Onayladı: ${BOARD}`);
});

test("satış uzmanı siparişi okur: onay, iptal ve gönder düğmeleri yok, nedeni yazılı", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "pending_approval", tier: 1 });
  await leave(page);
  await loginAs(page, "Elif Karaca");

  const drawer = await openPo(page, po.code);
  await expect(drawer.getByText("Bu kademe Satın Alma müdürü onayı ister")).toBeVisible();
  for (const name of ["Onayla", "Onaya gönder", "Gönder", "İptal et"]) {
    await expect(drawer.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(drawer.getByRole("button", { name: /^Kalemi (düzenle|sil)/ })).toHaveCount(0);
});

test("taslakta kalem miktarı değişir; onay penceresi eski → yeni miktarı ve yeni toplamı yazar", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "draft", tier: 0 });
  const drawer = await openPo(page, po.code);

  const nextQty = f.qtyMilli + UNIT_STEP_MILLI[f.material.unit];
  const nextNet = lineValueKurus(nextQty, f.priceKurus);
  await drawer.getByRole("button", { name: `Kalemi düzenle: ${f.material.code}` }).click();
  const form = drawer.getByRole("form", { name: `Kalemi düzenle: ${f.material.code}` });
  // Değişiklik yokken kaydet kapalı.
  await expect(form.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  await form.getByLabel("Miktar", { exact: true }).fill(String(nextQty / 1000).replace(".", ","));
  await form.getByRole("button", { name: "Kaydet" }).click();
  const text = confirmDialog(page);
  await expect(text).toContainText(`Miktar: ${formatQty(f.qtyMilli, f.material.unit)} → ${formatQty(nextQty, f.material.unit)}`);
  await expect(text).toContainText(`Sipariş tutarı ${formatMoney(f.netKurus)} → ${formatMoney(nextNet)} olacak`);
  await approve(page, "Kalemi güncelle");

  await expect.poll(async () => (await sql<{ q: number }>(page, `select qty_milli::float8 as q from purchase_order_lines where order_id = '${po.id}'`))[0]?.q).toBe(nextQty);
  await expect(drawer.getByRole("table", { name: "Tutar özeti" }).getByRole("row", { name: /KDV hariç/ })).toContainText(formatMoney(nextNet));
  await expect(drawer.getByRole("region", { name: "Geçmiş" })).toContainText(`${f.material.code} miktar`);
});

test("iptal gerekçesiz gönderilemez; iptal sonrası Geçmiş'te gerekçe", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "sent", tier: 0 });
  const drawer = await openPo(page, po.code);

  await drawer.getByRole("button", { name: "İptal et" }).click();
  const dialog = page.getByRole("dialog", { name: "Siparişi iptal et" });
  await expect(dialog).toContainText(`${po.code}, ${f.name}: 1 kalem, ${formatMoney(f.netKurus)} KDV hariç gönderildi sipariş iptal edilecek.`);
  await dialog.getByRole("button", { name: "Siparişi iptal et" }).click();
  await expect(dialog.getByText("Gerekçe girin")).toBeVisible();
  expect(await statusOf(page, po.id)).toEqual({ s: "sent", t: 0 });

  await dialog.getByLabel("Gerekçe").fill("Tedarikçi fiyatı değiştirdi");
  await dialog.getByRole("button", { name: "Siparişi iptal et" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => statusOf(page, po.id)).toEqual({ s: "cancelled", t: 0 });
  await expect(drawer.getByRole("region", { name: "İptal gerekçesi" })).toContainText("Tedarikçi fiyatı değiştirdi");
  await expect(drawer.getByRole("region", { name: "Geçmiş" })).toContainText(`${po.code} iptal edildi: Tedarikçi fiyatı değiştirdi`);
  await expect(drawer.getByRole("button", { name: "İptal et" })).toHaveCount(0);
});

test("durum süzgeci adreste kalır, yenilemede korunur", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  await insertOrder(page, f, { status: "draft", tier: 0 });
  const sent = await insertOrder(page, f, { status: "sent", tier: 0 });
  await navTo(page, "Satın alma siparişleri");

  const sentCount = async () => (await sql<{ n: number }>(page, "select count(*)::int as n from purchase_orders where status = 'sent'"))[0]?.n;
  await page.getByRole("button", { name: "Gönderildi", exact: true }).click();
  await expect(page).toHaveURL(/durum=sent/);
  await expect.poll(async () => (await poRows(page).count()) === (await sentCount())).toBe(true);
  await expect(poRows(page).filter({ hasText: sent.code })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/durum=sent/);
  await expect(page.getByRole("button", { name: "Gönderildi", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await poRows(page).count()) === (await sentCount())).toBe(true);
  await expect(poRows(page).filter({ hasText: sent.code })).toBeVisible();
  await expect(poRows(page).filter({ hasText: "Taslak" })).toHaveCount(0);
});

test("390 px'te sipariş listesi ve çekmecesi yatay taşmaz", async ({ page }) => {
  await loginAs(page, BUYER);
  const f = await setupSupplier(page);
  const po = await insertOrder(page, f, { status: "pending_approval", tier: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto("/satin-alma/siparisler");
  await expect(poRows(page).filter({ hasText: po.code })).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);

  await page.goto(`/satin-alma/siparisler?ac=${po.id}`);
  const drawer = page.getByRole("dialog", { name: po.code });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("list", { name: "Kalemler" })).toBeVisible();
  await expect.poll(overflow).toBeLessThanOrEqual(0);
  // Çekmecenin kendi içeriği de taşmaz.
  await expect.poll(() => drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("tedarikçisi tanımsız grup: taslak düğmesi yok, açıklama ve 'Tedarikçi tanımla' bağlantısı var", async ({ page }) => {
  await loginAs(page, BUYER);
  const m = await criticalMaterial(page);
  await sql(page, `delete from supplier_items where material_id = '${m.id}'`);
  await navTo(page, "Öneriler", "Satın alma önerileri");
  const card = group(page, "Tedarikçisi tanımsız");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Bu malzemeler için fiyat veren tedarikçi yok");
  await expect(card).toContainText(m.code);
  await expect(card.getByRole("button", { name: "Taslak oluştur" })).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Tedarikçi tanımla" })).toBeVisible();
});