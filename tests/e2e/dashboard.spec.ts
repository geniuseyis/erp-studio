import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const summary = (page: import("@playwright/test").Page, label: string) => page.getByRole("link", { name: new RegExp(`^${label}`) });

test("ana panel kişiyi selamlar; kritik kalem sayısı süzülmüş listenin satır sayısına eşit", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Onur");
  await expect(page.getByText("Depo Uzmanı, Depo ve Sevkiyat")).toBeVisible();

  const critical = summary(page, "Kritik kalem");
  await expect(critical).toBeVisible();
  const shown = Number((await critical.getByTestId("stat-value").textContent())?.trim());
  expect(shown).toBeGreaterThan(0);

  const list = page.getByRole("region", { name: "Kritik stok" }).getByRole("listitem");
  await expect(list).toHaveCount(Math.min(shown, 6));
  await expect(page.getByRole("region", { name: "Son hareketler" }).getByRole("listitem")).toHaveCount(10);

  await critical.click();
  await expect(page).toHaveURL(/kritik=1/);
  await expect(page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr")).toHaveCount(shown);
});

test("stok girişi yapınca ana paneldeki stok değeri yenilemeden artar", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const value = summary(page, "Stok değeri").getByTestId("stat-value");
  await expect(value).toHaveText(/₺/);
  const parse = (t: string | null) => Number((t ?? "").replace(/[^\d]/g, ""));
  const before = parse(await value.textContent());

  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Malzemeler" }).click();
  await page.getByRole("row", { name: /MLZ-0001/ }).click();
  await page.getByRole("button", { name: "Stok girişi" }).click();
  const dialog = page.getByRole("dialog", { name: "Stok girişi" });
  await dialog.getByLabel("Miktar").fill("10");
  await dialog.getByLabel("Birim maliyet").fill("1.600,00");
  await dialog.getByRole("button", { name: "Girişi kaydet" }).click();
  await expect(page.getByRole("status").filter({ hasText: "10 plaka giriş kaydedildi" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Ana panel" }).click();
  await expect.poll(async () => parse(await value.textContent())).toBeGreaterThan(before);
});

test("kategori dağılımı bütün kategorileri gösterir ve listeye bağlanır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const chart = page.getByRole("region", { name: "Kategoriye göre stok değeri" });
  await expect(chart.getByRole("link")).toHaveCount(7);
  await chart.getByRole("link", { name: /Hırdavat/ }).click();
  await expect(page).toHaveURL(/kategori=hirdavat/);
});
