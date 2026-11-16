import { expect, test } from "@playwright/test";
import { loginAs, pickDemo, signOut } from "./helpers";

test("Ctrl+K açar, Esc kapatır; 'sayım' yazıp Enter sayım ekranına götürür", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Ara ve git" });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await page.getByRole("button", { name: /^Ara/ }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.type("sayım");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stok\/sayim/);
  await expect(palette).toBeHidden();
});

test("malzeme adı yazıp Enter çekmeceyi o malzemeyle açar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Ceviz Masif");
  await expect(page.getByRole("option", { name: /Ceviz Masif/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stok\/malzemeler\?ac=/);
  await expect(page.getByRole("dialog").filter({ hasText: "Ceviz Masif" })).toBeVisible();
});

test("'Temayı değiştir' komutu temayı değiştirir", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("tema");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
});

test("palet arama kutusu odakta çerçeve çizmez, normal düğmeler klavye halkasını korur", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible").first();
  await expect(focused).toHaveCSS("outline-style", "solid");
});

test("kullanıcının göremediği sayfa palette yok", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("kullanıcı");
  await expect(page.getByRole("option", { name: "Kullanıcılar" })).toHaveCount(0);
});

test("sipariş kodu yazıp Enter sipariş çekmecesini açar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("SIP-");
  const first = page.getByRole("option", { name: /SIP-/ }).first();
  await expect(first).toBeVisible();
  const code = (await first.textContent())?.match(/SIP-\d{4}-\d{4}/)?.[0] ?? "";
  expect(code).not.toBe("");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/satis\/siparisler\?ac=/);
  await expect(page.getByRole("dialog").filter({ hasText: code })).toBeVisible();
});

test("'Yeni sipariş' komutu yalnızca satışta var ve sipariş penceresini açar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("yeni sip");
  await expect(page.getByRole("option", { name: "Yeni sipariş" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await signOut(page);
  await pickDemo(page, "Elif Karaca");
  await expect(page.getByRole("button", { name: /Hesap menüsü.*Elif Karaca/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("yeni sip");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/satis\/siparisler\?yeni=1/);
  await expect(page.getByRole("dialog", { name: "Yeni sipariş" })).toBeVisible();
});
