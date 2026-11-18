import { expect, type Page, test } from "@playwright/test";
import { loginAs, navTo, one, sql } from "./helpers";

const LIST = "/uretim/is-emirleri";
const KANBAN = `${LIST}?gorunum=kanban`;

async function openKanban(page: Page, url = KANBAN): Promise<void> {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "İş emirleri", level: 1 }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("region", { name: "Planlanmadı" })).toBeVisible();
}

const column = (page: Page, title: string) =>
  page.getByRole("region", { name: title, exact: true });
/** Başlıktaki sayı ile sütundaki kart sayısı aynı olmalı; ikisi de yerleşene kadar yoklanır. */
async function settledCount(page: Page, title: string): Promise<number> {
  const col = column(page, title);
  let last = -1;
  await expect
    .poll(async () => {
      const header = Number(
        (await col.getByTestId("kanban-count").textContent()) ?? "NaN",
      );
      const cards = await col.getByRole("listitem").count();
      last = cards;
      return header === cards;
    })
    .toBe(true);
  return last;
}

test("kanbana geçilir; sütunlar ve sayıları verideki durumla tutarlı", async ({
  page,
}) => {
  await loginAs(page, "Zeynep Arıkan");
  await page.goto(LIST);
  await expect(page.getByRole("table", { name: "İş emirleri" })).toBeVisible({
    timeout: 45_000,
  });

  const view = page.getByRole("group", { name: "Görünüm" });
  await expect(view.getByRole("button", { name: "Liste" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await view.getByRole("button", { name: "Kanban" }).click();
  await expect(page).toHaveURL(/gorunum=kanban/);
  await expect(page.getByRole("table", { name: "İş emirleri" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Kanban" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const stations = (
    await one<{ n: number }>(page, "select count(*)::int as n from stations")
  ).n;
  await expect(page.getByRole("region")).toHaveCount(stations + 3);

  // Planlanmadı: planın "Planlanmamış" sayısıyla aynı koşul.
  const unscheduled = (
    await one<{ n: number }>(
      page,
      `select count(*)::int as n from work_orders w where w.status in ('planned', 'in_progress')
         and exists (select 1 from work_order_steps s where s.work_order_id = w.id and s.planned_day is null)`,
    )
  ).n;
  await expect.poll(() => settledCount(page, "Planlanmadı")).toBe(unscheduled);

  // Tamamlandı: yalnızca son 7 gün; iptal hiçbir sütunda değil. Açık olanlar tam bir sütunda.
  const open = (
    await one<{ n: number }>(
      page,
      "select count(*)::int as n from work_orders where status in ('planned', 'in_progress')",
    )
  ).n;
  const titles = ["Malzeme bekliyor", "Planlanmadı"];
  for (const s of await sql<{ name: string }>(
    page,
    "select name from stations order by seq, code",
  ))
    titles.push(s.name);
  let placed = 0;
  for (const t of titles) placed += await settledCount(page, t);
  expect(placed).toBe(open);
  const recent = (
    await one<{ n: number }>(
      page,
      "select count(*)::int as n from work_orders where status = 'completed' and completed_at >= now() - interval '7 days'",
    )
  ).n;
  // Yedi İstanbul günü, 7×24 saatten biraz uzun olabilir: sütun en az bu kadar, en çok tüm tamamlananlar kadar.
  const done = await settledCount(page, "Tamamlandı");
  expect(done).toBeGreaterThanOrEqual(recent);
  expect(done).toBeLessThanOrEqual(
    (
      await one<{ n: number }>(
        page,
        "select count(*)::int as n from work_orders where status = 'completed'",
      )
    ).n,
  );
});

test("kart çekmeceyi açar, kapanınca odak karta döner", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  await openKanban(page);
  // Örnek veride hangi sütunun dolu olduğuna bağlı değil: tahtadaki ilk kart.
  const first = page.getByTestId("kanban-board").getByRole("listitem").first();
  const card = first.getByRole("button");
  await expect(card).toBeVisible();
  const name = (await card.getAttribute("aria-label")) ?? "";
  expect(name).toMatch(/^IE-[\d-]+,.+ adet, adım \d+\/\d+, /);
  await card.click();
  await expect(page).toHaveURL(/gorunum=kanban.*ac=|ac=.*gorunum=kanban/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? "",
      ),
    )
    .toBe(name);
  await expect(page).toHaveURL(/gorunum=kanban/);
});

test("adres yenilemede ve geri düğmesinde kanban kalır", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  await openKanban(page);
  await page.reload();
  await expect(page.getByRole("region", { name: "Planlanmadı" })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page).toHaveURL(/gorunum=kanban/);

  await navTo(page, "Haftalık plan", "Haftalık plan");
  await page.goBack();
  await expect(page).toHaveURL(/gorunum=kanban/);
  await expect(page.getByRole("region", { name: "Planlanmadı" })).toBeVisible();

  // Listeye dönmek parametreyi siler.
  await page
    .getByRole("group", { name: "Görünüm" })
    .getByRole("button", { name: "Liste" })
    .click();
  await expect(page).not.toHaveURL(/gorunum/);
  await expect(page.getByRole("table", { name: "İş emirleri" })).toBeVisible();
});

test("görünüm değişince öteki süzgeçler adreste kalır; kanban hangilerini uyguladığını söyler", async ({
  page,
}) => {
  await loginAs(page, "Zeynep Arıkan");
  await page.goto(`${LIST}?durum=planned&q=a`);
  await expect(page.getByRole("table", { name: "İş emirleri" })).toBeVisible({
    timeout: 45_000,
  });
  await page
    .getByRole("group", { name: "Görünüm" })
    .getByRole("button", { name: "Kanban" })
    .click();
  await expect(page).toHaveURL(/gorunum=kanban/);
  await expect(page).toHaveURL(/durum=planned/);
  await expect(page).toHaveURL(/q=a/);
  await expect(page.getByTestId("kanban-note")).toContainText(
    "yalnızca aramayı",
  );
  await expect(
    page.getByRole("searchbox", { name: "İş emri ara" }),
  ).toHaveValue("a");
  await page
    .getByRole("group", { name: "Görünüm" })
    .getByRole("button", { name: "Liste" })
    .click();
  await expect(page).toHaveURL(/durum=planned/);
  await expect(
    page.getByRole("button", { name: "Planlı", exact: false }).first(),
  ).toBeVisible();
});

test("termini geçmiş kart kırmızı ve metinle işaretlenir", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const wo = await one<{ code: string; order_id: string }>(
    page,
    `select w.code, o.id as order_id from work_orders w
       join sales_order_lines l on l.id = w.sales_order_line_id join sales_orders o on o.id = l.order_id
      where w.status in ('planned', 'in_progress') order by w.code limit 1`,
  );
  await sql(
    page,
    `update sales_orders set due_at = now() - interval '5 days' where id = '${wo.order_id}'`,
  );
  await openKanban(page);
  const card = page.getByRole("button", { name: new RegExp(`^${wo.code},`) });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("aria-label", /termin geçti/);
  const late = card.getByTestId("kanban-late");
  await expect(late).toContainText(/gün gecikti|geçti/);
  await expect
    .poll(() => late.evaluate((el) => getComputedStyle(el).color))
    .not.toBe(
      await card
        .getByTestId("kanban-code")
        .evaluate((el) => getComputedStyle(el).color),
    );
});

test("dar ekranda sütunlar kendi kabında yatay kayar, sayfa taşmaz", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await loginAs(page, "Zeynep Arıkan");
  await openKanban(page);
  const board = page.getByTestId("kanban-board");
  await expect(board).toHaveClass(/scroll-x/);
  await expect
    .poll(() => board.evaluate((el) => el.scrollWidth > el.clientWidth + 8))
    .toBe(true);
  await expect
    .poll(() => board.evaluate((el) => el.hasAttribute("data-fade-right")))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await board.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect
    .poll(() => board.evaluate((el) => el.hasAttribute("data-fade-left")))
    .toBe(true);
});
