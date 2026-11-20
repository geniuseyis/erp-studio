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

const panel = (page: Page) => page.getByRole("dialog", { name: "Asistan" });
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

test("hızlı yardımcı: anahtar yokken kritik stok, tohumdaki gerçek malzemeyle; Esc kapatır ve odağı balona verir", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const critical = await one<{ code: string; id: string }>(
    page,
    "select code, id from materials where active and on_hand_milli - reserved_milli < reorder_point_milli order by code limit 1",
  );
  await openPanel(page);
  await expect(page.getByTestId("assistant-mode")).toHaveText("Hızlı yardımcı · yapay zekâ kapalı");
  await ask(page, "kritik stok");
  const link = panel(page).getByRole("log").getByRole("link", { name: critical.code });
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
  const critical = await one<{ code: string; id: string }>(
    page,
    "select code, id from materials where active and on_hand_milli - reserved_milli < reorder_point_milli order by code limit 1",
  );
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
  const card = panel(page).getByRole("group", { name: "Onay kartı" });
  await expect(card).toContainText(draft.code);
  await expect(card.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await status()).toBe("draft");
  await card.getByRole("button", { name: "Vazgeç" }).click();
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

test("390 px: balon ve pencere ekrana sığar, sayfa yatay taşmaz", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bubble = page.getByRole("button", { name: "Asistanı aç" });
  await expect(bubble).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);

  await openPanel(page);
  await ask(page, "kritik stok");
  await expect(panel(page).getByRole("log").getByRole("link").first()).toBeVisible();
  const box = await panel(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const close = await page.getByRole("button", { name: "Asistanı kapat" }).last().boundingBox();
  expect(close!.x + close!.width).toBeLessThanOrEqual(390);
});
