import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/bilesenler");
  await expect(page.getByRole("heading", { name: "Bileşenler", level: 1 })).toBeVisible();
});

test("klavyeyle gezinince her etkileşimli öğede görünür odak halkası var", async ({ page }) => {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, outline: s.outlineStyle !== "none" && s.outlineWidth !== "0px", shadow: s.boxShadow !== "none" };
    });
    expect(ring, `Tab ${i + 1}`).not.toBeNull();
    expect(ring?.outline || ring?.shadow, `Tab ${i + 1}: ${ring?.tag}`).toBe(true);
  }
});

test("pencere odağı içeride tutar, Esc kapatır, odak tetikleyiciye döner", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Pencereyi aç" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Stok girişi" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("çekmece sağdan açılır ve Esc ile kapanır", async ({ page }) => {
  await page.getByRole("button", { name: "Çekmeceyi aç" }).click();
  const drawer = page.getByRole("dialog", { name: "MDF Lam 18 mm" });
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  // Masaüstünde panel sağ kenardan 8 px içeride yüzer; sağa yaslı olmalı.
  const gap = width - Math.round((box?.x ?? 0) + (box?.width ?? 0));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(12);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("tema düğmesi koyu temaya geçirir ve yenilemede kalır", async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  const light = await bg();
  await page.getByRole("button", { name: "Koyu temaya geç" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bg()).not.toBe(light);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Açık temaya geç" })).toBeVisible();
});

test("tablo başlığına tıklayınca artan, yine tıklayınca azalan sıralar", async ({ page }) => {
  const table = page.getByRole("table", { name: "Örnek malzemeler" });
  const quantities = async () =>
    (await table.locator("tbody tr td:nth-child(3)").allTextContents()).map((t) => Number(t.replace(/\./g, "").replace(",", ".").split(" ")[0]));
  const header = table.getByRole("button", { name: "Eldeki" });
  await header.click();
  const asc = await quantities();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await expect(table.locator("th", { hasText: "Eldeki" })).toHaveAttribute("aria-sort", "ascending");
  await header.click();
  const desc = await quantities();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
});

test("satır seçince toplu işlem çubuğu çıkar; sütun gizlenebilir", async ({ page }) => {
  const table = page.getByRole("table", { name: "Örnek malzemeler" });
  await table.getByRole("checkbox", { name: /seç: MLZ-0001/ }).check();
  await expect(page.getByText("1 satır seçildi")).toBeVisible();
  await page.getByRole("button", { name: "Sütunlar" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Raf" }).click();
  await page.keyboard.press("Escape");
  await expect(table.getByRole("columnheader", { name: "Raf" })).toHaveCount(0);
});

test("bildirim görünür ve ekran okuyucuya duyurulur", async ({ page }) => {
  await page.getByRole("button", { name: "Başarı bildirimi" }).click();
  const toast = page.getByRole("status").filter({ hasText: "120 adet giriş kaydedildi" });
  await expect(toast).toBeVisible();
});

test("telefonda sayfa yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("yan menü taşınca kenar geçişleri kaydırma konumunu izler", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loginAs(page, "Nermin Aksoy");
  const nav = page.getByRole("navigation", { name: "Ana menü" }).locator("visible=true").first();
  await expect(nav).toHaveAttribute("data-fade-bottom", "");
  await expect(nav).not.toHaveAttribute("data-fade-top", "");

  await nav.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(nav).toHaveAttribute("data-fade-top", "");
  await expect(nav).not.toHaveAttribute("data-fade-bottom", "");

  await page.setViewportSize({ width: 1280, height: 1400 });
  await expect(nav).not.toHaveAttribute("data-fade-top", "");
  await expect(nav).not.toHaveAttribute("data-fade-bottom", "");
});
