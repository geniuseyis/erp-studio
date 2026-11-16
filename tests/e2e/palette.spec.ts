import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

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

test("kullanıcının göremediği sayfa palette yok", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("kullanıcı");
  await expect(page.getByRole("option", { name: "Kullanıcılar" })).toHaveCount(0);
});
