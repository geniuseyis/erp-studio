import { expect, type Page, test } from "@playwright/test";
import { approve, confirmDialog, loginAs, signOut, sql } from "./helpers";

const FIRST = "MLZ-0001";

async function onHand(page: Page, code = FIRST): Promise<number> {
  const rows = await sql<{ n: number }>(page, `select on_hand_milli::float8 as n from materials where code = '${code}'`);
  return rows[0]?.n ?? Number.NaN;
}
async function movementCount(page: Page): Promise<number> {
  return (await sql<{ n: number }>(page, "select count(*)::int as n from stock_movements"))[0]?.n ?? Number.NaN;
}
async function openMaterials(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Malzemeler" }).click();
  await expect(page.getByRole("heading", { name: "Malzemeler", level: 1 })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(FIRST) })).toBeVisible();
}
async function openDrawer(page: Page, code = FIRST) {
  await page.getByRole("row", { name: new RegExp(code) }).click();
  const drawer = page.getByRole("dialog").filter({ hasText: code });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("depo uzmanı stok girişi yapar; stok artar ve hareket yazılır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const before = await onHand(page);
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Stok girişi" }).click();

  const dialog = page.getByRole("dialog", { name: "Stok girişi" });
  await dialog.getByLabel("Miktar").fill("12,5");
  await dialog.getByLabel("Birim maliyet").fill("1.600,00");
  await dialog.getByLabel("Not").fill("İrsaliye 4471");
  await dialog.getByRole("button", { name: "Girişi kaydet" }).click();
  await expect(confirmDialog(page)).toContainText("Birim maliyet ₺1.600,00");
  await approve(page, "Girişi kaydet");

  await expect(page.getByRole("status").filter({ hasText: "12,5 plaka giriş kaydedildi" })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await onHand(page)).toBe(before + 12_500);
  await expect(drawer.getByRole("listitem").first()).toContainText("Giriş");
  await expect(drawer.getByRole("listitem").first()).toContainText("12,5 plaka");

  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Stok hareketleri" }).click();
  const first = page.getByRole("table", { name: "Stok hareketleri" }).locator("tbody tr").first();
  await expect(first).toContainText("Giriş");
  await expect(first).toContainText("Onur Tekin");
  await expect(first).toContainText("İrsaliye 4471");
  await expect(first).toContainText("₺1.600,00");
});

test("kaydet düğmesine çift tıklamak tek hareket yazar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const before = await movementCount(page);
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Stok girişi" }).click();
  const dialog = page.getByRole("dialog", { name: "Stok girişi" });
  await dialog.getByLabel("Miktar").fill("3");
  // Onay penceresinde onaya çift tıklamak da tek hareket yazar.
  await dialog.getByRole("button", { name: "Girişi kaydet" }).click();
  await confirmDialog(page).getByRole("button", { name: "Girişi kaydet" }).dblclick();
  await expect(confirmDialog(page)).toBeHidden();
  await expect(dialog).toBeHidden();
  expect(await movementCount(page)).toBe(before + 1);
});

test("kullanılabilirden fazla çıkış ve geçersiz miktar engellenir", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const before = await movementCount(page);
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Stok çıkışı" }).click();
  const dialog = page.getByRole("dialog", { name: "Stok çıkışı" });
  const save = dialog.getByRole("button", { name: "Çıkışı kaydet" });

  for (const bad of ["abc", "-3", "0", ""]) {
    await dialog.getByLabel("Miktar").fill(bad);
    await save.click();
    await expect(dialog.getByText("Geçerli bir miktar girin")).toBeVisible();
  }
  await dialog.getByLabel("Miktar").fill("999999");
  await save.click();
  await expect(dialog.getByText(/Kullanılabilir miktardan fazla/)).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(confirmDialog(page)).toHaveCount(0);
  expect(await movementCount(page)).toBe(before);

  await dialog.getByLabel("Miktar").fill("2");
  await save.click();
  await approve(page, "Çıkışı kaydet");
  await expect(page.getByRole("status").filter({ hasText: "2 plaka çıkış kaydedildi" })).toBeVisible();
  expect(await movementCount(page)).toBe(before + 1);
});

test("satış kullanıcısı stok ekranını görür ama işlem düğmelerini görmez", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await openMaterials(page);
  await expect(page.getByRole("button", { name: "Yeni malzeme" })).toHaveCount(0);
  const drawer = await openDrawer(page);
  await expect(drawer.getByText("Eldeki")).toBeVisible();
  for (const name of ["Stok girişi", "Stok çıkışı", "Düzenle"]) {
    await expect(drawer.getByRole("button", { name })).toHaveCount(0);
  }
});

test("depo görevlisi giriş yapabilir ama malzeme ekleyemez ve düzenleyemez", async ({ page }) => {
  await loginAs(page, "Burak Şen");
  await openMaterials(page);
  await expect(page.getByRole("button", { name: "Yeni malzeme" })).toHaveCount(0);
  const drawer = await openDrawer(page);
  await expect(drawer.getByRole("button", { name: "Stok girişi" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Düzenle" })).toHaveCount(0);
});

test("arama Türkçe harfe duyarsızdır; süzgeçler adreste kalır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const rows = page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr");

  await page.getByRole("searchbox", { name: "Malzeme ara" }).fill("mese");
  await expect(rows.first()).toContainText("Meşe");
  for (const text of await rows.allTextContents()) expect(text).toContain("Meşe");
  await expect(page).toHaveURL(/q=mese/);

  await page.getByRole("searchbox", { name: "Malzeme ara" }).fill("");
  await page.getByRole("button", { name: "Kritik", exact: true }).click();
  await expect(page).toHaveURL(/kritik=1/);
  await expect.poll(() => rows.count()).toBeLessThan(10);
  const critical = await rows.count();
  expect(critical).toBeGreaterThanOrEqual(4);
  for (const text of await rows.allTextContents()) expect(text).toContain("Kritik");

  await page.reload();
  await expect(page.getByRole("button", { name: "Kritik", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 45_000 });
  await expect(rows).toHaveCount(critical);

  await page.getByRole("searchbox", { name: "Malzeme ara" }).fill("zzzyok");
  await expect(page.getByText("Aramanızla eşleşen malzeme yok")).toBeVisible();
});

test("uzman yeni malzeme ekler ve düzenler", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  await page.getByRole("button", { name: "Yeni malzeme" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni malzeme" });
  await dialog.getByRole("button", { name: "Malzemeyi ekle" }).click();
  await expect(dialog.getByText("Ad girin")).toBeVisible();

  await dialog.getByLabel("Ad", { exact: true }).fill("Tik Kaplamalı MDF 19 mm 2100×2800");
  await dialog.getByLabel("Kategori").selectOption("panel");
  await dialog.getByLabel("Birim").selectOption("plaka");
  await dialog.getByLabel("Yeniden sipariş noktası").fill("15");
  await dialog.getByLabel("Raf").fill("A-08");
  await dialog.getByRole("button", { name: "Malzemeyi ekle" }).click();
  await approve(page, "Malzemeyi ekle");
  await expect(page.getByRole("status").filter({ hasText: /MLZ-\d{4} eklendi/ })).toBeVisible();

  await page.getByRole("searchbox", { name: "Malzeme ara" }).fill("tik kapla");
  const row = page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr").first();
  await expect(row).toContainText("Tik Kaplamalı MDF 19 mm");
  await expect(row).toContainText("Kritik");

  await row.click();
  const drawer = page.getByRole("dialog").filter({ hasText: "Tik Kaplamalı" });
  await drawer.getByRole("button", { name: "Düzenle" }).click();
  const edit = page.getByRole("dialog", { name: "Malzemeyi düzenle" });
  await expect(edit.getByRole("button", { name: "Değişiklikleri kaydet" })).toBeDisabled();
  await edit.getByLabel("Raf").fill("A-09");
  await edit.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(confirmDialog(page).getByRole("listitem")).toHaveText(["Raf: A-08 → A-09"]);
  await approve(page, "Kaydet");
  await expect(drawer.getByText("A-09", { exact: true })).toBeVisible();
});

test("sayım: uzman açar ve sayar, müdür onaylar, fark harekete yazılır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Sayım" }).click();
  await expect(page.getByRole("heading", { name: "Sayım", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Yeni sayım" }).click();
  const create = page.getByRole("dialog", { name: "Yeni sayım" });
  await create.getByRole("button", { name: "Sayımı aç" }).click();
  await expect(create.getByText("En az bir malzeme seçin")).toBeVisible();
  // Liste aramaya göre yenilenene kadar bekle; yoksa önceki listenin ilk satırı işaretlenir.
  const firstItem = create.getByRole("listitem").first();
  await create.getByRole("searchbox", { name: "Malzeme ara" }).fill("koli bandı");
  await expect(firstItem).toContainText("Koli Bandı");
  await firstItem.getByRole("checkbox").check();
  await create.getByRole("searchbox", { name: "Malzeme ara" }).fill("balonlu");
  await expect(firstItem).toContainText("Balonlu Naylon");
  await firstItem.getByRole("checkbox").check();
  await expect(create.getByText("2 malzeme seçildi")).toBeVisible();
  await create.getByRole("button", { name: "Sayımı aç" }).click();
  await approve(page, "Sayımı aç");

  const detail = page.getByRole("dialog").filter({ hasText: "SYM-" });
  await expect(detail).toBeVisible();
  const code = (await detail.getByRole("heading").first().textContent()) ?? "";
  expect(code).toMatch(/^SYM-\d{4}-\d{4}$/);
  await expect(detail.getByRole("button", { name: "Onayla" })).toHaveCount(0);

  const inputs = detail.getByRole("textbox", { name: /^Sayılan/ });
  await expect(inputs).toHaveCount(2);
  const system = await sql<{ n: number }>(page, "select on_hand_milli::float8 as n from materials where name like 'Koli Bandı%'");
  await inputs.nth(0).fill("7");
  await inputs.nth(0).press("Enter");
  await inputs.nth(1).fill(String((system[0]?.n ?? 0) / 1000 - 5));
  await inputs.nth(1).press("Enter");
  await expect(detail.getByText("2 / 2 kalem sayıldı")).toBeVisible();
  await page.keyboard.press("Escape");
  await signOut(page);

  await loginAs(page, "Sevgi Polat");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Sayım" }).click();
  await page.getByRole("row", { name: new RegExp(code) }).click();
  const review = page.getByRole("dialog").filter({ hasText: code });
  await review.getByRole("button", { name: "Onayla" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Sayım onaylansın mı?" });
  await expect(confirm).toContainText("2 satırdaki fark stok hareketi olarak yazılacak");
  await confirm.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${code} onaylandı` })).toBeVisible();
  await expect(review.getByText("Onaylandı", { exact: true })).toBeVisible();

  const adjusted = await sql<{ n: number }>(
    page,
    "select m.delta_on_hand_milli::float8 as n from stock_movements m join materials t on t.id = m.material_id where m.type = 'count_adjust' and t.name like 'Koli Bandı%'",
  );
  expect(adjusted).toEqual([{ n: -5000 }]);
  expect(await sql(page, "select count(*)::int as n from stock_movements where type = 'count_adjust'")).toEqual([{ n: 2 }]);
});

test("malzeme listesi CSV olarak indirilir", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV indir" }).click()]);
  expect(download.suggestedFilename()).toBe("malzemeler.csv");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const lines = Buffer.concat(chunks).toString("utf8").split("\r\n");
  expect(lines[0]).toBe("﻿Kod;Ad;Kategori;Eldeki;Ayrılmış;Kullanılabilir;Yeniden sipariş noktası;Birim;Ortalama maliyet;Stok değeri;Raf");
  expect(lines[1]).toMatch(/^MLZ-0001;MDF Lam 18 mm Parlak Beyaz 2100×2800;Panel;\d+(,\d+)?;0;/);
  expect(lines.length).toBeGreaterThanOrEqual(43);
});

test("klavyeyle: Enter çekmeceyi açar, Esc kapatır, odak satıra döner", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await openMaterials(page);
  const row = page.getByRole("row", { name: new RegExp(FIRST) });
  await row.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog").filter({ hasText: FIRST });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/ac=/);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(row).toBeFocused();
  await expect(page).not.toHaveURL(/ac=/);
});

test("stok hareketleri türe göre süzülür", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Stok hareketleri" }).click();
  const rows = page.getByRole("table", { name: "Stok hareketleri" }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await page.getByLabel("Tür").selectOption("issue");
  await expect(page).toHaveURL(/tur=issue/);
  // Süzülmüş liste yerine oturana kadar bekle. Tek bir anlık okuma yavaş makinede (CI) yenilenme arasına
  // denk gelip eski listeyi görebiliyor; ilk satırın tesadüfen "Çıkış" olması da yenilendiğini kanıtlamaz.
  await expect
    .poll(async () => {
      const texts = (await rows.allTextContents()).slice(0, 30);
      return texts.length > 0 && texts.every((t) => t.includes("Çıkış"));
    })
    .toBe(true);
});

test("telefonda stok ekranları yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Onur Tekin");
  for (const path of ["/stok/malzemeler", "/stok/hareketler", "/stok/sayim"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("tbody tr").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
