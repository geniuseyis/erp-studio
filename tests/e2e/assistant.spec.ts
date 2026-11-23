import { expect, type Page, type Route, test } from "@playwright/test";
import { loginAs, one } from "./helpers";

// Gerçek Claude ucu hiçbir testte çağrılmaz: /api/asistan page.route ile taklit edilir.

type Msg = { role: string; content: string | { type: string; content?: string }[] };

const json = (route: Route, body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

/** Taklit uç: GET modu bildirir; POST'ta `answer` konuşmayı görüp cevabı üretir. */
async function mockAi(page: Page, answer: (messages: Msg[]) => unknown): Promise<{ calls: Msg[][] }> {
  const calls: Msg[][] = [];
  await page.route("**/api/asistan", async (route) => {
    if (route.request().method() === "GET") return json(route, { ai: true });
    const { messages } = route.request().postDataJSON() as { messages: Msg[] };
    calls.push(messages);
    return json(route, { mode: "ai", content: answer(messages), stopReason: "end_turn" });
  });
  return { calls };
}

const panel = (page: Page) => page.getByRole("dialog", { name: "Atölye Asistanı" });
const tiles = (page: Page) => panel(page).getByRole("group", { name: "Başlıklar" }).getByRole("button");
const tile = (page: Page, name: string) => panel(page).getByRole("group", { name: "Başlıklar" }).getByRole("button", { name, exact: true });
const chip = (page: Page, name: string) => panel(page).getByRole("group", { name: "Hızlı yanıtlar" }).getByRole("button", { name, exact: true });
const homeButton = (page: Page) => panel(page).getByRole("button", { name: "Ana menü", exact: true });
const card = (page: Page, name: string) => panel(page).getByRole("region", { name });
const CRITICAL_SQL = "select code, id, name from materials where active and on_hand_milli - reserved_milli < reorder_point_milli order by code limit 1";

async function openPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Asistanı aç" }).click();
  await expect(panel(page)).toBeVisible();
}
async function ask(page: Page, text: string): Promise<void> {
  await panel(page).getByLabel("Mesajınız").fill(text);
  await panel(page).getByRole("button", { name: "Gönder" }).click();
}
const lastToolResult = (messages: Msg[]): string => {
  const last = messages[messages.length - 1];
  const block = Array.isArray(last?.content) ? last.content[0] : undefined;
  return block?.content ?? "";
};
const isToolTurn = (messages: Msg[]) => Array.isArray(messages[messages.length - 1]?.content);

test("hızlı mod: anahtar yokken kritik stok, tohumdaki gerçek malzemeyle; Esc kapatır ve odağı balona verir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const critical = await one<{ code: string; id: string }>(page, CRITICAL_SQL);
  await openPanel(page);
  await expect(page.getByTestId("assistant-mode")).toHaveText("Hızlı mod");
  await ask(page, "kritik stok");
  const link = panel(page).getByRole("log").getByRole("link", { name: `${critical.code} kaydını aç` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", `/stok/malzemeler?ac=${critical.id}`);

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Asistanı aç" })).toBeFocused();
});

test("yapay zekâ modu (taklit): okuma aracı tarayıcıda çalışır, cevap kayda bağlantı verir", async ({ page }) => {
  const { calls } = await mockAi(page, (messages) => {
    if (!isToolTurn(messages)) return [{ type: "tool_use", id: "tu_1", name: "malzeme_stok", input: { sadece_kritik: true } }];
    const result = JSON.parse(lastToolResult(messages)) as { kayitlar: { kod: string; href: string }[] };
    const first = result.kayitlar[0]!;
    return [{ type: "text", text: `En acil: [${first.kod}](${first.href})` }];
  });
  await loginAs(page, "Elif Karaca");
  const critical = await one<{ code: string; id: string }>(page, CRITICAL_SQL);
  await openPanel(page);
  await expect(page.getByTestId("assistant-mode")).toHaveText("Claude");
  await ask(page, "hangi malzeme kritik?");
  const link = panel(page).getByRole("log").getByRole("link", { name: critical.code });
  await expect(link).toHaveAttribute("href", `/stok/malzemeler?ac=${critical.id}`);
  expect(calls).toHaveLength(2);
});

test("yapay zekâ modu (taklit): işlem aracı onay kartı gösterir; Vazgeç hiçbir şey değiştirmez, Onayla siparişi onaylar", async ({ page }) => {
  let draft = { id: "", code: "" };
  await mockAi(page, (messages) =>
    isToolTurn(messages)
      ? [{ type: "text", text: `Sonuç: ${lastToolResult(messages)}` }]
      : [{ type: "tool_use", id: "tu_a", name: "onayla_siparis", input: { siparis_kodu: draft.code } }],
  );
  await loginAs(page, "Elif Karaca");
  draft = await one<{ id: string; code: string }>(
    page,
    `select o.id, o.code from sales_orders o where o.status = 'draft'
       and exists (select 1 from sales_order_lines l where l.order_id = o.id) order by o.code limit 1`,
  );
  const status = async () => (await one<{ status: string }>(page, `select status from sales_orders where id = '${draft.id}'`)).status;
  await openPanel(page);

  // Vazgeç: kart çıkar, odak Vazgeç'te, sipariş taslak kalır.
  await ask(page, `${draft.code} siparişini onayla`);
  const confirm = panel(page).getByRole("group", { name: "Onay kartı" });
  await expect(confirm).toContainText(draft.code);
  await expect(confirm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await status()).toBe("draft");
  await confirm.getByRole("button", { name: "Vazgeç" }).click();
  await expect(panel(page).getByText("Hiçbir şey değişmedi").first()).toBeVisible();
  await expect.poll(status).toBe("draft");

  // Onayla: sipariş taslaktan çıkar, cevap işlemin sonucunu taşır.
  await ask(page, `${draft.code} siparişini şimdi onayla`);
  const second = panel(page).getByRole("group", { name: "Onay kartı" }).last();
  await expect(second.getByRole("button", { name: "Onayla" })).toBeVisible();
  expect(await status()).toBe("draft");
  await second.getByRole("button", { name: "Onayla" }).click();
  await expect.poll(status).not.toBe("draft");
  await expect(panel(page).getByText("Sipariş onaylandı").first()).toBeVisible();
});

test("açılışta ana menü: 6 kutucuk görünür ve ilki odak alır; Satış alt menüsü yazma seçeneğini gösterir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openPanel(page);
  await expect(tiles(page)).toHaveCount(6);
  await expect(panel(page).getByText("Merhaba Elif")).toBeVisible();
  await expect(tiles(page).first()).toBeFocused();
  await tile(page, "Satış").click();
  await expect(chip(page, "Geciken siparişler")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Yeni sipariş aç" })).toHaveAttribute("href", "/satis/siparisler?yeni=1");
});

test("rol süzgeci: yazma yetkisi olmayan kişi 'Yeni sipariş aç' görmez; 'Kullanıcı nasıl eklenir?' yalnızca yönetime çıkar", async ({ page }) => {
  await loginAs(page, "Cem Doğru");
  await openPanel(page);
  await tile(page, "Satış").click();
  await expect(chip(page, "Geciken siparişler")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Yeni sipariş aç" })).toHaveCount(0);
  await homeButton(page).click();
  await tile(page, "Nasıl yapılır").click();
  await expect(chip(page, "Sipariş nasıl açılır?")).toBeVisible();
  await expect(chip(page, "Kullanıcı nasıl eklenir?")).toHaveCount(0);
});

test("kutucuk, çip, kart: Stok → Kritik stok kartı; Aç bağlantısı kaydın çekmecesini açar", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const critical = await one<{ code: string; id: string }>(page, CRITICAL_SQL);
  await openPanel(page);
  await tile(page, "Stok").click();
  await chip(page, "Kritik stok").click();
  const kritik = card(page, "Kritik stok");
  await expect(kritik).toBeVisible();
  const open = kritik.getByRole("link", { name: `${critical.code} kaydını aç` });
  await expect(open).toHaveAttribute("href", `/stok/malzemeler?ac=${critical.id}`);
  await expect(kritik.getByRole("link", { name: /Hepsini gör/ })).toHaveAttribute("href", "/stok/malzemeler?kritik=1");
  await expect(chip(page, "Satın alma önerileri")).toBeVisible();
  await expect(chip(page, "Malzeme ara")).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(new RegExp(`ac=${critical.id}`));
  await expect(page.locator("[data-drawer-title]")).toBeVisible();
});

test("her cevaptan sonra Ana menü: başlıktaki düğme ve ⌂ Menü çipi menüyü geri getirir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openPanel(page);
  await tile(page, "Stok").click();
  await chip(page, "Kritik stok").click();
  await expect(card(page, "Kritik stok")).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);

  await homeButton(page).click();
  await expect(tiles(page)).toHaveCount(6);
  await expect(tiles(page).first()).toBeFocused();

  // Yazıyla sorulan cevaptan sonra da menü çipi var.
  await ask(page, "geciken siparişler");
  await expect(card(page, "Geciken siparişler")).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Ana menüye dön" }).click();
  await expect(tiles(page)).toHaveCount(6);
});

test("yazım hatası ve eş anlamlı: 'krtik stok' ve 'ne bitti' cevaplanır", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const critical = await one<{ code: string }>(page, CRITICAL_SQL);
  await openPanel(page);
  await ask(page, "krtik stok");
  await expect(card(page, "Kritik stok")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: `${critical.code} kaydını aç` })).toBeVisible();
  await ask(page, "ne bitti");
  await expect(card(page, "Kritik stok")).toHaveCount(2);
  await expect(panel(page).getByText("anlayamadım")).toHaveCount(0);
});

test("anlamsız yazı: kesin sözcük istenmez, 'Bunu mu demek istediniz?' ve öneri çipleri gelir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openPanel(page);
  await ask(page, "qwzx plk");
  await expect(panel(page).getByText("Bunu mu demek istediniz?")).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Hızlı yanıtlar" }).getByRole("button")).toHaveCount(4);
  await expect(chip(page, "Günün özeti")).toBeVisible();
  await chip(page, "Günün özeti").click();
  await expect(card(page, "Günün özeti")).toBeVisible();
});

test("boşluk doldurma: Sipariş sorgula girdi ister, son siparişleri çip yapar, sonraki yazı boşluğu doldurur", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const latest = await one<{ id: string; code: string; name: string }>(
    page,
    "select o.id, o.code, c.name from sales_orders o join customers c on c.id = o.customer_id order by o.created_at desc, o.code desc limit 1",
  );
  await openPanel(page);
  await tile(page, "Satış").click();
  await chip(page, "Sipariş sorgula").click();
  await expect(panel(page).getByText("Sipariş kodu ya da müşteri adı yazın")).toBeVisible();
  await expect(chip(page, latest.code)).toBeVisible();

  await ask(page, latest.name);
  const rows = panel(page).getByRole("region", { name: /^Siparişler/ });
  await expect(rows.getByRole("link", { name: `${latest.code} kaydını aç` })).toHaveAttribute("href", `/satis/siparisler?ac=${latest.id}`);
  await expect(rows.getByRole("link", { name: /Hepsini gör/ })).toBeVisible();
});

test("yapay zekâ açıkken menü seçimleri API çağırmaz; yalnızca serbest yazı Claude'a gider", async ({ page }) => {
  const { calls } = await mockAi(page, () => [{ type: "text", text: "Merhaba, ben Claude." }]);
  await loginAs(page, "Elif Karaca");
  await openPanel(page);
  await expect(page.getByTestId("assistant-mode")).toHaveText("Claude");
  await tile(page, "Stok").click();
  await chip(page, "Kritik stok").click();
  await expect(card(page, "Kritik stok")).toBeVisible();
  expect(calls).toHaveLength(0);
  await ask(page, "bana bir hikaye anlat");
  await expect(panel(page).getByText("Merhaba, ben Claude.")).toBeVisible();
  expect(calls).toHaveLength(1);
  await expect(chip(page, "Ana menüye dön")).toBeVisible();
});

test("390 px: tam ekran sayfa, menü kutucukları ve cevap kartı, sayfa yatay taşmaz", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await openPanel(page);
  await expect(tiles(page)).toHaveCount(6);
  await expect.poll(async () => (await panel(page).boundingBox())?.width).toBe(390);
  const box = (await panel(page).boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.height).toBe(844);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await tile(page, "Stok").click();
  await chip(page, "Kritik stok").click();
  await expect(card(page, "Kritik stok")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const close = await panel(page).getByRole("button", { name: "Asistanı kapat" }).boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(390);
});

test("Ana menü onay kartı beklerken de çalışır: kart Vazgeç sayılır, sipariş değişmez", async ({ page }) => {
  let draft = { id: "", code: "" };
  await mockAi(page, (messages) =>
    isToolTurn(messages)
      ? [{ type: "text", text: "Tamam." }]
      : [{ type: "tool_use", id: "tu_h", name: "onayla_siparis", input: { siparis_kodu: draft.code } }],
  );
  await loginAs(page, "Elif Karaca");
  draft = await one<{ id: string; code: string }>(
    page,
    `select o.id, o.code from sales_orders o where o.status = 'draft'
       and exists (select 1 from sales_order_lines l where l.order_id = o.id) order by o.code limit 1`,
  );
  await openPanel(page);
  await ask(page, `${draft.code} siparişini onayla`);
  await expect(panel(page).getByRole("group", { name: "Onay kartı" }).getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await expect(homeButton(page)).toBeEnabled();
  await homeButton(page).click();
  await expect(panel(page).getByText("Hiçbir şey değişmedi").first()).toBeVisible();
  await expect.poll(async () => (await one<{ status: string }>(page, `select status from sales_orders where id = '${draft.id}'`)).status).toBe("draft");
});

test("telefonda kapatınca odak balona döner ve pencere modaldır", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await page.setViewportSize({ width: 390, height: 844 });
  await openPanel(page);
  await expect(panel(page)).toHaveAttribute("aria-modal", "true");
  await panel(page).getByRole("button", { name: "Asistanı kapat" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Asistanı aç" })).toBeFocused();
});
