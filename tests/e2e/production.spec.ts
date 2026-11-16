import { expect, type Locator, type Page, test } from "@playwright/test";
import { addWorkdays } from "../../src/domain/production/calendar";
import { loginAs, signOut, sql } from "./helpers";

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
/** İstanbul gününün başlangıcı → "YYYY-AA-GG". */
const dayInput = (d: Date) => new Date(d.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
const trDay = (d: Date) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Istanbul" }).format(d);

async function navTo(page: Page, label: string, heading = label): Promise<void> {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
}

/** İş emirleri ekranında koda göre arar ve çekmeceyi açar. */
async function openWorkOrder(page: Page, code: string): Promise<Locator> {
  await navTo(page, "İş emirleri");
  const rows = page.getByRole("table", { name: "İş emirleri" }).locator("tbody tr");
  await page.getByRole("searchbox", { name: "İş emri ara" }).fill(code);
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(code);
  await rows.first().click();
  const drawer = page.getByRole("dialog", { name: code });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Açık çekmeceyi kapatıp çıkar: çekmece açıkken sayfanın geri kalanı (hesap menüsü dahil) erişilebilirlik ağacından gizlidir. */
async function leave(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signOut(page);
}

const one = async <T>(page: Page, query: string): Promise<T> => {
  const [row] = await sql<T>(page, query);
  if (!row) throw new Error(`satır yok: ${query}`);
  return row;
};

test("ürün çekmecesinde reçete ve rota görünür; ahşap üründe cila satırı var", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  await navTo(page, "Ürünler");
  const wood = await one<{ code: string; name: string; model_key: string; bom: number; steps: number; width: number }>(
    page,
    `select p.code, p.name, p.model_key, p.width_mm as width,
            (select count(*)::int from bom_lines b where b.product_id = p.id) as bom,
            (select count(*)::int from routings r where r.product_id = p.id) as steps
       from products p where p.finish = 'ahsap' order by p.code limit 1`,
  );
  const white = await one<{ code: string; name: string }>(page, `select code, name from products where finish = 'beyaz' and model_key = '${wood.model_key}'`);

  const rows = page.getByRole("table", { name: "Ürünler" }).locator("tbody tr");
  await page.getByRole("searchbox", { name: "Ürün ara" }).fill(wood.code);
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(wood.code);
  await expect(rows.first()).toContainText("Ahşap");
  await rows.first().click();

  let drawer = page.getByRole("dialog", { name: wood.name });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(wood.code);
  await expect(drawer).toContainText(`KDV %`);
  await expect(drawer).toContainText(`${wood.width.toLocaleString("tr-TR")} ×`);
  const bom = drawer.getByRole("table", { name: "Reçete" });
  await expect(bom.locator("tbody tr")).toHaveCount(wood.bom);
  await expect(bom).toContainText("Vernik");
  const route = drawer.getByRole("list", { name: "Rota" });
  await expect(route.getByRole("listitem")).toHaveCount(wood.steps);
  await expect(route).toContainText("Boya ve cila");
  await expect(route).toContainText("dk/adet");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // Beyaz kardeşinde cila adımı ve vernik yok.
  // Ahşap ve beyaz aynı adı taşır; önceki aramanın satırı kalmış olmasın diye kodu bekle.
  await page.getByRole("searchbox", { name: "Ürün ara" }).fill(white.code);
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(white.code);
  await rows.first().click();
  drawer = page.getByRole("dialog", { name: white.name });
  await expect(drawer).toContainText(white.code);
  await expect(drawer.getByRole("list", { name: "Rota" })).toBeVisible();
  await expect(drawer.getByRole("list", { name: "Rota" })).not.toContainText("Boya ve cila");
  await expect(drawer.getByRole("table", { name: "Reçete" })).not.toContainText("Vernik");
});

test("planlama uzmanı iş emrini planlar; adımlara günler yazılır", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const wo = await one<{ id: string; code: string; steps: number }>(
    page,
    `select w.id, w.code, (select count(*)::int from work_order_steps s where s.work_order_id = w.id) as steps
       from work_orders w where w.status = 'planned' order by w.code limit 1`,
  );
  const drawer = await openWorkOrder(page, wo.code);

  const start = addWorkdays(new Date(), 1);
  const input = drawer.getByLabel("Başlangıç günü");
  await expect(input).toHaveValue(dayInput(start));
  await drawer.getByRole("button", { name: "Planla" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${wo.code} planlandı` })).toBeVisible();

  const expected = Array.from({ length: wo.steps }, (_, i) => addWorkdays(start, i).getTime());
  await expect
    .poll(async () =>
      (await sql<{ ms: number }>(page, `select extract(epoch from planned_day)::float8 * 1000 as ms from work_order_steps where work_order_id = '${wo.id}' order by seq`)).map(
        (r) => r.ms,
      ),
    )
    .toEqual(expected);
  const timeline = drawer.getByRole("list", { name: "Adımlar" });
  await expect(timeline.getByRole("listitem").first()).toContainText(trDay(start));
  await expect(timeline.getByRole("listitem").last()).toContainText(trDay(addWorkdays(start, wo.steps - 1)));
});

test("malzeme bekleyen iş emri: depo giriş yapar, planlama yeniden dener, durum değişir", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const wo = await one<{ id: string; code: string; line: string }>(
    page,
    `select id, code, sales_order_line_id as line from work_orders where status = 'planned' and not materials_reserved order by code limit 1`,
  );
  // İş emrinin eksik kalemleri ve eksik miktarları (birim adımına yukarı yuvarlanmış, bir birim payla).
  const short = await sql<{ code: string; units: number }>(
    page,
    `select m.code, (ceil((ceil(b.qty_milli::float8 * w.qty_milli * (1000 + b.scrap_permille) / 1000000) - (m.on_hand_milli - m.reserved_milli)) / 1000.0) + 1)::int as units
       from work_orders w
       join bom_lines b on b.product_id = w.product_id
       join materials m on m.id = b.material_id
      where w.id = '${wo.id}'
        and ceil(b.qty_milli::float8 * w.qty_milli * (1000 + b.scrap_permille) / 1000000) > m.on_hand_milli - m.reserved_milli
      order by m.code`,
  );
  expect(short.length).toBeGreaterThan(0);

  let drawer = await openWorkOrder(page, wo.code);
  await expect(drawer.getByText("Malzeme bekliyor").first()).toBeVisible();
  const missing = drawer.getByRole("region", { name: "Eksikler" });
  for (const s of short) await expect(missing).toContainText(s.code);
  // Malzeme gelmeden yeniden deneme eksikleri söyler, durumu değiştirmez.
  await drawer.getByRole("button", { name: "Malzemeyi yeniden dene" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "hâlâ eksik" })).toBeVisible();
  await leave(page);

  await loginAs(page, "Onur Tekin");
  await navTo(page, "Malzemeler");
  for (const s of short) {
    await page.getByRole("searchbox", { name: "Malzeme ara" }).fill(s.code);
    await page.getByRole("row", { name: new RegExp(s.code) }).click();
    const material = page.getByRole("dialog").filter({ hasText: s.code });
    await material.getByRole("button", { name: "Stok girişi" }).click();
    const dialog = page.getByRole("dialog", { name: "Stok girişi" });
    await dialog.getByLabel("Miktar").fill(String(s.units));
    await dialog.getByRole("button", { name: "Girişi kaydet" }).click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(material).toBeHidden();
  }
  await signOut(page);

  await loginAs(page, "Zeynep Arıkan");
  drawer = await openWorkOrder(page, wo.code);
  await expect(drawer.getByRole("region", { name: "Eksikler" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Malzemeyi yeniden dene" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${wo.code}: malzemeler ayrıldı` })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Malzemeyi yeniden dene" })).toHaveCount(0);
  await expect(drawer.getByText("Malzeme bekliyor")).toHaveCount(0);
  await expect(drawer.getByRole("table", { name: "Malzemeler" }).getByRole("columnheader", { name: "Ayrılan" })).toBeVisible();
  await expect.poll(async () => (await one<{ r: boolean }>(page, `select materials_reserved as r from work_orders where id = '${wo.id}'`)).r).toBe(true);
  if (wo.line) {
    await expect.poll(async () => (await one<{ s: string }>(page, `select status as s from sales_order_lines where id = '${wo.line}'`)).s).toBe("in_production");
  }
});

test("atölye ekranında Başla sonra Bitti; kart sonraki istasyona geçer", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loginAs(page, "Cem Doğru");
  // Önceki adımları bitmiş, bu istasyonda bekleyen ve ardından bir adımı daha olan iş emri.
  const pick = await one<{ id: string; code: string; seq: number; station: string; next: string }>(
    page,
    `select w.id, w.code, s.seq, st.name as station,
            (select st2.name from work_order_steps n join stations st2 on st2.id = n.station_id
              where n.work_order_id = w.id and n.seq > s.seq order by n.seq limit 1) as next
       from work_orders w
       join work_order_steps s on s.work_order_id = w.id
       join stations st on st.id = s.station_id
      where w.status = 'in_progress' and s.started_at is null
        and not exists (select 1 from work_order_steps p where p.work_order_id = w.id and p.seq < s.seq and p.finished_at is null)
        and exists (select 1 from work_order_steps n where n.work_order_id = w.id and n.seq > s.seq)
      order by w.code limit 1`,
  );

  await navTo(page, "Atölye");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  const stations = page.getByRole("group", { name: "İstasyon" });
  await expect(stations.getByRole("button")).toHaveCount(6);
  // Tablette istasyon çipleri de en az 48 px.
  for (const chip of await stations.getByRole("button").all()) expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await stations.getByRole("button", { name: pick.station, exact: true }).click();
  await expect(stations.getByRole("button", { name: pick.station, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/istasyon=/);

  const card = page.getByRole("article", { name: pick.code });
  await expect(card).toBeVisible();
  const start = card.getByRole("button", { name: "Başla" });
  expect((await start.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await start.click();
  const finish = card.getByRole("button", { name: "Bitti" });
  await expect(finish).toBeVisible();
  await expect(card).toContainText("Çalışıyor");
  expect((await finish.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await finish.click();
  await expect(card).toBeHidden();
  await expect
    .poll(async () => (await one<{ by: string }>(page, `select u.name as by from work_order_steps s join users u on u.id = s.finished_by where s.work_order_id = '${pick.id}' and s.seq = ${pick.seq}`)).by)
    .toBe("Cem Doğru");

  await stations.getByRole("button", { name: pick.next, exact: true }).click();
  await expect(page.getByRole("article", { name: pick.code }).getByRole("button", { name: "Başla" })).toBeVisible();

  // Son seçim hatırlanır: adressiz açılışta aynı istasyon seçili gelir.
  await page.goto("/atolye");
  await expect(page.getByRole("heading", { name: "Atölye", level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("group", { name: "İstasyon" }).getByRole("button", { name: pick.next, exact: true })).toHaveAttribute("aria-pressed", "true");
  // Adresteki istasyon kayıtlı seçimden önce gelir.
  await page.goto("/atolye?istasyon=KSM");
  await expect(page.getByRole("group", { name: "İstasyon" }).getByRole("button", { name: "Kesim", exact: true })).toHaveAttribute("aria-pressed", "true", {
    timeout: 45_000,
  });
});

test("satış hesabında Başla ve Planla görünmez", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "İş emirleri" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Ürünler" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Atölye" })).toHaveCount(0);

  // Sipariş çekmecesindeki iş emri bağlantısı iş emri çekmecesini açar.
  const order = await one<{ id: string; code: string; wo: string; wo_id: string }>(
    page,
    `select o.id, o.code, w.code as wo, w.id as wo_id from sales_orders o
       join sales_order_lines l on l.order_id = o.id
       join work_orders w on w.sales_order_line_id = l.id
      where w.status = 'planned' order by w.code limit 1`,
  );
  await navTo(page, "Siparişler");
  await page.getByRole("searchbox", { name: "Sipariş ara" }).fill(order.code);
  const rows = page.getByRole("table", { name: "Siparişler" }).locator("tbody tr");
  await expect.poll(() => rows.count()).toBe(1);
  await expect(rows.first()).toContainText(order.code);
  await rows.first().click();
  await page.getByRole("dialog", { name: order.code }).getByRole("link", { name: `İş emri ${order.wo}` }).click();
  await expect(page).toHaveURL(/\/uretim\/is-emirleri\?ac=/);
  const drawer = page.getByRole("dialog", { name: order.wo });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("list", { name: "Adımlar" })).toBeVisible();
  for (const name of ["Planla", "Malzemeyi yeniden dene", "Sıradaki adımı başlat", "Adımı bitir"]) {
    await expect(drawer.getByRole("button", { name })).toHaveCount(0);
  }
  await expect(drawer.getByLabel("Başlangıç günü")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Atölye ekranı adresle açılırsa kuyruk görünür, düğmeler görünmez.
  const running = await one<{ code: string }>(
    page,
    `select st.code from work_order_steps s join stations st on st.id = s.station_id join work_orders w on w.id = s.work_order_id
      where w.status = 'in_progress' and s.started_at is not null and s.finished_at is null order by st.seq limit 1`,
  );
  await page.goto(`/atolye?istasyon=${running.code}`);
  await expect(page.getByRole("heading", { name: "Atölye", level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Başla" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bitti" })).toHaveCount(0);
});

test("telefonda ürün ve iş emri ekranları yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Nermin Aksoy");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const drawerOverflow = (drawer: Locator) =>
    drawer.evaluate((el) => {
      const body = el.querySelector("div.overflow-y-auto");
      return body ? body.scrollWidth - body.clientWidth : 0;
    });

  for (const [path, heading, code] of [
    ["/uretim/urunler", "Ürünler", /URN-/],
    ["/uretim/is-emirleri", "İş emirleri", /IE-/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 45_000 });
    const rows = page.getByRole("table", { name: heading }).locator("tbody tr");
    await expect(rows.first()).toContainText(code);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await rows.first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    expect(await drawerOverflow(drawer)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
  }

  await page.goto("/atolye");
  await expect(page.getByRole("heading", { name: "Atölye", level: 1 })).toBeVisible({ timeout: 45_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);
});
