import { expect, test } from "@playwright/test";
import { approve, confirmDialog, leave, loginAs, navTo, one, sql } from "./helpers";

// Bitti tanımı (Plan 3A): kritik stok → öneri → taslak → müdür onayı → gönderim → depoda mal kabul → bekleyen iş emri hazır.
// Beklenen her değer SQL'den okunur; örnek veride hangi iş emirlerinin beklediği sabit varsayılmaz.
const ARKALIK = "MDF Lam 8 mm Beyaz Arkalık 2100×2800";
const BUYER = "Kerem Uysal";
const MANAGER = "Ayla Güneş";
const WAREHOUSE = "Onur Tekin";
const PLANNER = "Zeynep Arıkan";
const NOTE = "A-2026-118";

test("eksik malzemeden üretime: öneri → taslak → müdür onayı → gönderim → mal kabul → iş emri hazır", async ({ page }) => {
  test.setTimeout(180_000);

  await loginAs(page, BUYER);
  const mat = await one<{ id: string; code: string; supplier: string }>(
    page,
    `select m.id, m.code, s.name as supplier from materials m
       join supplier_items i on i.material_id = m.id and i.is_preferred
       join suppliers s on s.id = i.supplier_id where m.name = '${ARKALIK}'`,
  );
  const waiting = await sql<{ id: string; code: string; line: string | null }>(
    page,
    `select distinct w.id, w.code, w.sales_order_line_id as line from work_orders w
       join bom_lines b on b.product_id = w.product_id
      where b.material_id = '${mat.id}' and w.status = 'planned' and not w.materials_reserved order by w.code`,
  );
  expect(waiting.length).toBeGreaterThan(0);

  // 1. Öneriler: arkalık satırı "bekleyen iş emri" nedeniyle, iş emri kodlarıyla; taslak aç.
  await navTo(page, "Öneriler", "Satın alma önerileri");
  const card = page.getByRole("region", { name: mat.supplier });
  await expect(card).toBeVisible();
  await expect(card).toContainText(mat.code);
  await expect(card).toContainText("Bekleyen iş emri");
  await expect(card).toContainText(waiting[0]?.code ?? "");
  await card.getByRole("button", { name: "Taslak oluştur" }).click();
  await approve(page, "Taslağı aç");
  await expect(page).toHaveURL(/\/satin-alma\/siparisler\?ac=/);
  const poId = new URL(page.url()).searchParams.get("ac") ?? "";
  const po = await one<{ code: string }>(page, `select code from purchase_orders where id = '${poId}'`);
  const drawer = page.getByRole("dialog", { name: po.code });
  await expect(drawer).toBeVisible();

  // 2. Onaya gönder: eşik aşıldığı söylenir; sipariş onay bekler, oluşturan onaylayamaz.
  await drawer.getByRole("button", { name: "Onaya gönder" }).click();
  await expect(confirmDialog(page)).toContainText("50.000 TL eşiğini aşıyor");
  await approve(page, "Onaya gönder");
  await expect.poll(async () => (await one<{ s: string }>(page, `select status as s from purchase_orders where id = '${poId}'`)).s).toBe("pending_approval");
  await expect(drawer.getByText("Onay bekleniyor", { exact: false }).first()).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Onayla", exact: true })).toHaveCount(0);
  await leave(page);

  // 3. Satın Alma müdürü: "Onay bekliyor" süzgeci → sipariş → Onayla → Gönderildi.
  await loginAs(page, MANAGER);
  await navTo(page, "Satın alma siparişleri");
  await page.getByRole("button", { name: "Onay bekliyor", exact: true }).click();
  await expect(page).toHaveURL(/durum=pending_approval/);
  const row = page.getByRole("table", { name: "Satın alma siparişleri" }).getByRole("row", { name: new RegExp(po.code) });
  await expect(row).toBeVisible();
  await row.click();
  const managerDrawer = page.getByRole("dialog", { name: po.code });
  await managerDrawer.getByRole("button", { name: "Onayla", exact: true }).click();
  await approve(page, "Onayla");
  await expect.poll(async () => (await one<{ s: string }>(page, `select status as s from purchase_orders where id = '${poId}'`)).s).toBe("sent");
  await expect(managerDrawer).toContainText("Gönderildi");
  await leave(page);

  // 4. Depo: Mal kabul → sipariş → irsaliye → kalanların hepsi → onay → "üretime hazır".
  await loginAs(page, WAREHOUSE);
  await navTo(page, "Mal kabul", "Mal kabul");
  await page.getByRole("table", { name: "Mal kabule açık siparişler" }).getByRole("row", { name: new RegExp(po.code) }).click();
  const receipt = page.getByRole("dialog", { name: new RegExp(po.code) });
  await receipt.getByLabel("İrsaliye no").fill(NOTE);
  await receipt.getByRole("button", { name: "Kalanların hepsi" }).click();
  await receipt.getByRole("button", { name: "Mal kabul et" }).click();
  await expect(confirmDialog(page)).toContainText(waiting[0]?.code ?? "");
  await approve(page, "Mal kabul et");
  await expect(page.getByRole("status").filter({ hasText: /MK-\d{4}-\d{4} kaydedildi; .*üretime hazır/ })).toBeVisible();

  // 5. Veri: bekleyen iş emirlerinin malzemesi ayrıldı, bağlı satırlar üretimde, arkalık ayrılmış.
  const ids = waiting.map((w) => `'${w.id}'`).join(", ");
  await expect
    .poll(async () => (await one<{ n: number }>(page, `select count(*)::int as n from work_orders where id in (${ids}) and not materials_reserved`)).n)
    .toBe(0);
  const lines = waiting.flatMap((w) => (w.line ? [`'${w.line}'`] : []));
  if (lines.length > 0) {
    await expect
      .poll(async () => (await one<{ n: number }>(page, `select count(*)::int as n from sales_order_lines where id in (${lines.join(", ")}) and status <> 'in_production'`)).n)
      .toBe(0);
  }
  const reserved = await one<{ r: number }>(page, `select reserved_milli::float8 as r from materials where id = '${mat.id}'`);
  expect(reserved.r).toBeGreaterThan(0);
  await leave(page);

  // 6. Planlama: iş emri çekmecesinde "Malzeme bekliyor" yok; kanbanda "Malzeme bekliyor" sütununda bu iş emirleri yok.
  await loginAs(page, PLANNER);
  await page.goto("/uretim/is-emirleri?gorunum=kanban");
  const column = page.getByRole("region", { name: "Malzeme bekliyor", exact: true });
  await expect(column).toBeVisible({ timeout: 45_000 });
  // Yüklendi işareti: sütunun başlık sayısı, SQL'deki bekleyen iş emri sayısıyla eşleşir (olumsuz denetim boşuna geçmesin).
  const stillWaiting = await one<{ n: number }>(page, "select count(*)::int as n from work_orders where status = 'planned' and not materials_reserved");
  await expect(column.getByTestId("kanban-count")).toHaveText(String(stillWaiting.n));
  await expect(column.getByRole("listitem")).toHaveCount(stillWaiting.n);
  for (const w of waiting) await expect(column.getByText(w.code, { exact: true })).toHaveCount(0);
  await page.goto("/uretim/is-emirleri");
  await page.getByRole("searchbox", { name: "İş emri ara" }).fill(waiting[0]?.code ?? "");
  const rows = page.getByRole("table", { name: "İş emirleri" }).locator("tbody tr");
  await expect.poll(() => rows.count()).toBe(1);
  await rows.first().click();
  const wo = page.getByRole("dialog", { name: waiting[0]?.code ?? "" });
  await expect(wo).toBeVisible();
  // Yüklendi işareti: malzeme tablosunda "Ayrılan" sütunu var (ayrılmış iş emri); ancak ondan sonra chip yokluğu denetlenir.
  await expect(wo.getByRole("table", { name: "Malzemeler" }).getByRole("columnheader", { name: "Ayrılan" })).toBeVisible();
  await expect(wo.getByText("Malzeme bekliyor", { exact: true })).toHaveCount(0);
});
