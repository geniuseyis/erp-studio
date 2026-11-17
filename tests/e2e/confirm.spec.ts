import { expect, type Page, test } from "@playwright/test";
import { orderTotals } from "../../src/domain/sales/money";
import { formatMoney, formatQty } from "../../src/domain/units";
import { approve, confirmDialog, loginAs, navTo, one, signOut, sql } from "./helpers";

// Her işlem türünden bir temsilci: Vazgeç hiçbir şey yazmaz, Enter tek başına onaylamaz, onay yazar.

const n = async (page: Page, query: string) => (await one<{ n: number }>(page, query)).n;

/** Onay penceresi açıldı, odak Vazgeç'te; Enter vazgeçer. */
async function enterCancels(page: Page): Promise<void> {
  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

test("satır sil: metin ürünü ve yeni tutarı söyler; Vazgeç, Esc ve Enter silmez; onay siler", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await navTo(page, "Siparişler");
  // Birden çok satırlı bir taslak: silinecek satır ve kalan tutar ekrandaki veriden hesaplanır.
  const order = await one<{ id: string; code: string }>(
    page,
    `select o.id, o.code from sales_orders o where o.status = 'draft'
       and (select count(*) from sales_order_lines l where l.order_id = o.id) >= 2 order by o.code limit 1`,
  );
  const lines = await sql<{ id: string; code: string; name: string; qty: number; price: number; discount: number; vat: number }>(
    page,
    `select l.id, p.code, p.name, l.qty_milli::int as qty, l.unit_price_kurus::float8 as price, l.discount_permille::int as discount, l.vat_rate::int as vat
       from sales_order_lines l join products p on p.id = l.product_id where l.order_id = '${order.id}' order by p.code`,
  );
  const target = lines[0];
  if (!target) throw new Error("satır yok");
  const totals = (rows: typeof lines) =>
    orderTotals(rows.map((l) => ({ qtyMilli: l.qty, unitPriceKurus: l.price, discountPermille: l.discount, vatRate: l.vat, status: "draft" }))).totalKurus;
  const lineCount = () => n(page, `select count(*)::int as n from sales_order_lines where order_id = '${order.id}'`);

  await page.goto(`/satis/siparisler?ac=${order.id}`);
  const drawer = page.getByRole("dialog", { name: order.code });
  const remove = drawer.getByRole("button", { name: `Satırı sil: ${target.code}` });
  await expect(remove).toBeVisible({ timeout: 45_000 });

  await remove.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(
    `${target.code} ${target.name} × ${target.qty / 1000} satırı silinecek. Sipariş tutarı ${formatMoney(totals(lines))} → ${formatMoney(totals(lines.slice(1)))} olacak.`,
  );
  // Ekran okuyucu başlıktan sonra sonucu okur: gövde pencerenin açıklamasıdır.
  await expect(dialog).toHaveAccessibleDescription(/satırı silinecek. Sipariş tutarı/);
  await enterCancels(page);
  // Odak açan düğmeye döner.
  await expect(remove).toBeFocused();
  expect(await lineCount()).toBe(lines.length);

  // Klavyeyle: Enter sil düğmesinde pencereyi açar ama aynı tuş basışı onu kapatmaz ya da onaylamaz.
  await remove.focus();
  await page.keyboard.press("Enter");
  await enterCancels(page);
  expect(await lineCount()).toBe(lines.length);

  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await remove.click();
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await lineCount()).toBe(lines.length);

  await remove.click();
  await approve(page, "Satırı sil");
  await expect.poll(lineCount).toBe(lines.length - 1);
  await expect(remove).toHaveCount(0);
});

test("sevk: Vazgeç sevk etmez; onaya çift tıklamak tek sevk yazar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const order = await one<{ id: string; code: string }>(page, "select id, code from sales_orders where status = 'ready' order by code limit 1");
  const status = async () => (await one<{ s: string }>(page, `select status as s from sales_orders where id = '${order.id}'`)).s;
  const ships = () => n(page, `select count(*)::int as n from audit_log where entity_id = '${order.id}' and action = 'ship'`);
  await page.goto(`/satis/siparisler?ac=${order.id}`);
  const drawer = page.getByRole("dialog", { name: order.code });
  const ship = drawer.getByRole("button", { name: "Sevk et" });
  await expect(ship).toBeVisible({ timeout: 45_000 });

  await ship.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${order.code} sevk edilecek; mamul stoktan düşer. Geri alınamaz.`);
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await status()).toBe("ready");

  await ship.click();
  await enterCancels(page);
  expect(await status()).toBe("ready");

  await ship.click();
  await dialog.getByRole("button", { name: "Sevk et" }).dblclick();
  await expect(dialog).toBeHidden();
  await expect.poll(status).toBe("shipped");
  expect(await ships()).toBe(1);
});

test("atölye Başla: büyük düğmeli onay iş emrini, istasyonu ve adımı yazar; Vazgeç başlatmaz", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loginAs(page, "Cem Doğru");
  const pick = await one<{ id: string; code: string; seq: number; total: number; station: string; name: string }>(
    page,
    `select w.id, w.code, s.seq, (select count(*)::int from work_order_steps a where a.work_order_id = w.id) as total, st.code as station, st.name
       from work_orders w
       join work_order_steps s on s.work_order_id = w.id
       join stations st on st.id = s.station_id
      where w.status = 'in_progress' and s.started_at is null
        and not exists (select 1 from work_order_steps p where p.work_order_id = w.id and p.seq < s.seq and p.finished_at is null)
      order by w.code limit 1`,
  );
  const started = async () =>
    (await one<{ v: boolean }>(page, `select started_at is not null as v from work_order_steps where work_order_id = '${pick.id}' and seq = ${pick.seq}`)).v;
  await page.goto(`/atolye?istasyon=${pick.station}`);
  const card = page.getByRole("article", { name: pick.code });
  const start = card.getByRole("button", { name: "Başla" });
  await expect(start).toBeVisible({ timeout: 45_000 });

  await start.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${pick.code} · ${pick.name} adımı başlatılacak (adım ${pick.seq}/${pick.total}).`);
  for (const name of ["Vazgeç", "Başlat"]) {
    expect((await dialog.getByRole("button", { name, exact: true }).boundingBox())?.height ?? 0, name).toBeGreaterThanOrEqual(48);
  }
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await started()).toBe(false);

  await start.click();
  await enterCancels(page);
  expect(await started()).toBe(false);

  await start.click();
  await approve(page, "Başlat");
  await expect(card.getByRole("button", { name: "Bitti" })).toBeVisible();
  expect(await started()).toBe(true);
});

test("stok girişi: metin eldekinin öncesini ve sonrasını yazar; formda Enter iki kez basılsa da kaydetmez", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const m = await one<{ code: string; name: string; on_hand: number }>(page, "select code, name, on_hand_milli::float8 as on_hand from materials where code = 'MLZ-0001'");
  const movements = () => n(page, "select count(*)::int as n from stock_movements");
  const before = await movements();
  await navTo(page, "Malzemeler");
  await page.getByRole("row", { name: /MLZ-0001/ }).click();
  await page.getByRole("button", { name: "Stok girişi" }).click();
  const form = page.getByRole("dialog", { name: "Stok girişi" });
  await form.getByLabel("Miktar").fill("12,5");
  // Miktar kutusunda Enter formu gönderir, onay açılır; hemen ikinci Enter vazgeçer.
  await form.getByLabel("Miktar").press("Enter");
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${m.code} ${m.name}: eldeki ${formatQty(m.on_hand, "plaka")} → ${formatQty(m.on_hand + 12_500, "plaka")}`);
  await enterCancels(page);
  await expect(form).toBeVisible();
  expect(await movements()).toBe(before);

  await form.getByRole("button", { name: "Girişi kaydet" }).click();
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await movements()).toBe(before);

  await form.getByRole("button", { name: "Girişi kaydet" }).click();
  await approve(page, "Girişi kaydet");
  await expect(form).toBeHidden();
  await expect.poll(movements).toBe(before + 1);
});

test("kullanıcıyı pasife al: kırmızı onay; Vazgeç ve Enter değiştirmez, onay pasife alır", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await navTo(page, "Kullanıcılar");
  const active = async () => (await one<{ v: boolean }>(page, "select active as v from users where email = 'elif.karaca@baltacioglus.example'")).v;
  const open = async () => {
    await page.getByRole("button", { name: "İşlemler: Elif Karaca" }).click();
    await page.getByRole("menuitem", { name: "Pasife al" }).click();
  };

  await open();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText("Elif Karaca pasife alınacak");
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await active()).toBe(true);

  await open();
  await enterCancels(page);
  expect(await active()).toBe(true);

  await open();
  await approve(page, "Pasife al");
  await expect.poll(active).toBe(false);
  await expect(page.getByRole("row", { name: /Elif Karaca/ })).toContainText("Pasif");
});

test("müşteri düzenleme: değişiklik yoksa kaydet pasif; onay yalnızca değişen alanı listeler; Vazgeç yazmaz", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const c = await one<{ id: string; code: string; name: string; phone: string; city: string }>(page, "select id, code, name, phone, city from customers order by code limit 1");
  const phone = async () => (await one<{ p: string }>(page, `select phone as p from customers where id = '${c.id}'`)).p;
  const updates = () => n(page, `select count(*)::int as n from audit_log where entity_id = '${c.id}' and action = 'update'`);
  const before = await updates();
  await page.goto(`/satis/musteriler?ac=${c.id}`);
  const drawer = page.getByRole("dialog", { name: c.name });
  await drawer.getByRole("button", { name: "Düzenle" }).click({ timeout: 45_000 });
  const form = page.getByRole("dialog", { name: "Müşteriyi düzenle" });
  const save = form.getByRole("button", { name: "Değişiklikleri kaydet" });
  await expect(save).toBeDisabled();

  const next = "0216 555 99 88";
  await form.getByLabel("Telefon").fill(next);
  await expect(save).toBeEnabled();
  await save.click();
  const dialog = confirmDialog(page);
  const changes = dialog.getByRole("list", { name: "Değişiklikler" }).getByRole("listitem");
  await expect(changes).toHaveCount(1);
  await expect(changes.first()).toContainText(`Telefon: ${c.phone} → ${next}`);
  await expect(dialog).not.toContainText("Ad:");
  await expect(dialog).not.toContainText(c.city);

  await enterCancels(page);
  await save.click();
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  expect(await phone()).toBe(c.phone);
  expect(await updates()).toBe(before);

  // Eski değere dönülürse kaydet yeniden pasif olur.
  await form.getByLabel("Telefon").fill(c.phone);
  await expect(save).toBeDisabled();
  await form.getByLabel("Telefon").fill(next);
  await save.click();
  await approve(page, "Kaydet");
  await expect(form).toBeHidden();
  await expect.poll(phone).toBe(next);
  expect(await updates()).toBe(before + 1);
});

test("sayım: kayıtlı sayımın üzerine yazmak onay ister, Vazgeç eski değeri geri getirir; onay penceresinde Vazgeç sayımı onaylamaz", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await navTo(page, "Sayım");
  await page.getByRole("button", { name: "Yeni sayım" }).click();
  const create = page.getByRole("dialog", { name: "Yeni sayım" });
  const firstItem = create.getByRole("listitem").first();
  await create.getByRole("searchbox", { name: "Malzeme ara" }).fill("koli bandı");
  await expect(firstItem).toContainText("Koli Bandı");
  await firstItem.getByRole("checkbox").check();
  await create.getByRole("button", { name: "Sayımı aç" }).click();
  await approve(page, "Sayımı aç");
  await expect(page).toHaveURL(/fis=/);
  const countId = new URL(page.url()).searchParams.get("fis") ?? "";
  const counted = async () => (await one<{ n: number | null }>(page, `select counted_milli::float8 as n from stock_count_lines where count_id = '${countId}'`)).n;

  const detail = page.getByRole("dialog").filter({ hasText: "SYM-" });
  const input = detail.getByRole("textbox", { name: /^Sayılan/ });
  // İlk sayım hiçbir kaydı değiştirmez: onay sorulmaz.
  await input.fill("7");
  await input.press("Enter");
  await expect.poll(counted).toBe(7000);
  // Ekran kayıtlı sayımı gösterene dek bekle; ancak ondan sonraki giriş üzerine yazmadır.
  await expect(detail.getByText("1 / 1 kalem sayıldı")).toBeVisible();
  await expect(confirmDialog(page)).toHaveCount(0);

  // Üzerine yazma: Vazgeç yazmaz ve alana kayıtlı değer döner.
  await input.fill("8");
  await input.press("Enter");
  const dialog = confirmDialog(page);
  await expect(dialog.getByRole("list", { name: "Değişiklikler" })).toContainText("Sayılan: 7");
  await expect(dialog.getByRole("list", { name: "Değişiklikler" })).toContainText("→ 8");
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  await expect(input).toHaveValue("7");
  expect(await counted()).toBe(7000);

  await input.fill("8");
  await input.press("Enter");
  await approve(page, "Değiştir");
  await expect.poll(counted).toBe(8000);
  await expect(input).toHaveValue("8");
  // Üzerine yazma Geçmiş'e düşer: eski ve yeni değer birlikte.
  await expect(detail.getByRole("list", { name: "Geçmiş" })).toContainText("sayılan 7");
  await expect(detail.getByRole("list", { name: "Geçmiş" })).toContainText("→ 8");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signOut(page);

  // Müdür onay penceresinde vazgeçerse fark yazılmaz, fiş açık kalır.
  await loginAs(page, "Sevgi Polat");
  const adjustments = () => n(page, `select count(*)::int as n from stock_movements where type = 'count_adjust' and ref_id = '${countId}'`);
  const status = async () => (await one<{ s: string }>(page, `select status as s from stock_counts where id = '${countId}'`)).s;
  await page.goto(`/stok/sayim?fis=${countId}`);
  const review = page.getByRole("dialog").filter({ hasText: "SYM-" });
  await review.getByRole("button", { name: "Onayla" }).click({ timeout: 45_000 });
  await expect(confirmDialog(page)).toContainText("satırdaki fark stok hareketi olarak yazılacak");
  await confirmDialog(page).getByRole("button", { name: "Vazgeç" }).click();
  await expect(confirmDialog(page)).toBeHidden();
  expect(await adjustments()).toBe(0);
  expect(await status()).toBe("open");
  await review.getByRole("button", { name: "Onayla" }).click();
  await enterCancels(page);
  expect(await adjustments()).toBe(0);
  expect(await status()).toBe("open");
});

test("veriyi sıfırla: Vazgeç ve Enter hiçbir şey silmez, oturum açık kalır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await sql(page, "insert into meta (key, value) values ('onay-isaret', '1')");
  const users = await n(page, "select count(*)::int as n from users");
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  const reset = page.getByRole("button", { name: "Veriyi sıfırla" });

  await reset.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText("bütün değişiklikler silinecek");
  await dialog.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dialog).toBeHidden();
  await reset.click();
  await enterCancels(page);

  await expect(page).not.toHaveURL(/\/giris/);
  expect(await sql(page, "select value from meta where key = 'onay-isaret'")).toEqual([{ value: "1" }]);
  expect(await n(page, "select count(*)::int as n from users")).toBe(users);
});

test("onay açıkken sayfa değişirse pencere kapanır, hiçbir şey yazılmaz; sonraki onay yeniden açılır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const order = await one<{ id: string; code: string }>(page, "select id, code from sales_orders where status = 'ready' order by code limit 1");
  const status = async () => (await one<{ s: string }>(page, `select status as s from sales_orders where id = '${order.id}'`)).s;
  const open = async () => {
    await navTo(page, "Siparişler");
    await page.getByRole("searchbox", { name: "Sipariş ara" }).fill(order.code);
    const rows = page.getByRole("table", { name: "Siparişler" }).locator("tbody tr");
    await expect.poll(() => rows.count()).toBe(1);
    await rows.first().click();
    const drawer = page.getByRole("dialog", { name: order.code });
    await drawer.getByRole("button", { name: "Sevk et" }).click();
    await expect(confirmDialog(page)).toBeVisible();
  };

  await open();
  // Uygulama içi geri: çekmece ve onun onay penceresi kaldırılır; bekleyen onay vazgeçilmiş sayılır.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Siparişler", level: 1 })).toHaveCount(0);
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await status()).toBe("ready");

  await open();
  await enterCancels(page);
  expect(await status()).toBe("ready");
});
