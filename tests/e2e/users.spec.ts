import { expect, type Page, test } from "@playwright/test";
import { approve, confirmDialog, DEMO_PASSWORD, loginAs, openLogin, signOut, sql } from "./helpers";

const NEW_PASSWORD = "Atolye-2026";

async function openUsers(page: Page) {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Kullanıcılar" }).click();
  await expect(page.getByRole("heading", { name: "Kullanıcılar", level: 1 })).toBeVisible();
}

async function rowMenu(page: Page, name: string) {
  await page.getByRole("button", { name: `İşlemler: ${name}` }).click();
}

async function formLogin(page: Page, email: string, password: string) {
  await openLogin(page);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
}

test("bilgi işlem yeni kullanıcı ekler; yeni kullanıcı kendi parolasıyla girer", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await openUsers(page);
  await page.getByRole("button", { name: "Yeni kullanıcı" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni kullanıcı" });
  await dialog.getByLabel("Ad soyad").fill("Selin Ateş");
  await dialog.getByLabel("E-posta").fill("selin.ates@baltacioglus.example");
  await dialog.getByLabel("Parola", { exact: true }).fill(NEW_PASSWORD);
  await dialog.getByLabel("Departman").selectOption("satis");
  await dialog.getByLabel("Düzey").selectOption("uzman");
  await dialog.getByLabel("Unvan").fill("Satış Uzmanı");
  await dialog.getByRole("button", { name: "Kullanıcıyı ekle" }).click();
  await expect(confirmDialog(page)).toContainText("selin.ates@baltacioglus.example");
  await approve(page, "Kullanıcıyı ekle");
  await expect(page.getByRole("status").filter({ hasText: "Selin Ateş eklendi" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Selin Ateş/ })).toBeVisible();

  await signOut(page);
  await formLogin(page, "selin.ates@baltacioglus.example", NEW_PASSWORD);
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toContainText("Selin Ateş");
});

test("pasife alınan kullanıcı giremez", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await openUsers(page);
  await rowMenu(page, "Elif Karaca");
  await page.getByRole("menuitem", { name: "Pasife al" }).click();
  await page.getByRole("alertdialog", { name: "Elif Karaca pasife alınsın mı?" }).getByRole("button", { name: "Pasife al" }).click();
  await expect(page.getByRole("row", { name: /Elif Karaca/ })).toContainText("Pasif");

  await signOut(page);
  await formLogin(page, "elif.karaca@baltacioglus.example", DEMO_PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toHaveText("E-posta ya da parola hatalı.");
});

test("açık oturumu olan kullanıcı pasife alınınca bir sonraki sayfa geçişinde girişe düşer", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await sql(page, "update users set active = false where email = 'elif.karaca@baltacioglus.example'");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Malzemeler" }).click();
  await expect(page).toHaveURL(/\/giris/);
});

test("form doğrular: kısa parola alan hatası, kayıtlı e-posta uyarısı", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await openUsers(page);
  await page.getByRole("button", { name: "Yeni kullanıcı" }).click();
  const dialog = page.getByRole("dialog", { name: "Yeni kullanıcı" });
  await dialog.getByLabel("Ad soyad").fill("Deneme Kişi");
  await dialog.getByLabel("E-posta").fill("deneme@baltacioglus.example");
  await dialog.getByLabel("Parola", { exact: true }).fill("1234567");
  await dialog.getByRole("button", { name: "Kullanıcıyı ekle" }).click();
  await expect(dialog.getByText("Parola en az 8 karakter olmalı")).toBeVisible();

  await dialog.getByLabel("E-posta").fill("tolga.erden@baltacioglus.example");
  await dialog.getByLabel("Parola", { exact: true }).fill("12345678");
  await dialog.getByRole("button", { name: "Kullanıcıyı ekle" }).click();
  await approve(page, "Kullanıcıyı ekle");
  await expect(dialog.getByText("Bu e-posta zaten kayıtlı")).toBeVisible();
});

test("kendi satırında 'Pasife al' yok; başkasınınkinde var", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await openUsers(page);
  await rowMenu(page, "Ece Korkmaz");
  await expect(page.getByRole("menuitem", { name: "Düzenle" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Pasife al" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await rowMenu(page, "Tolga Erden");
  await expect(page.getByRole("menuitem", { name: "Pasife al" })).toBeVisible();
});

test("parola sıfırlanınca kullanıcı yeni parolayla girer", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await openUsers(page);
  await rowMenu(page, "Kerem Uysal");
  await page.getByRole("menuitem", { name: "Parolayı sıfırla" }).click();
  const dialog = page.getByRole("dialog", { name: "Kerem Uysal için yeni parola" });
  await dialog.getByLabel("Yeni parola").fill(NEW_PASSWORD);
  await dialog.getByRole("button", { name: "Parolayı sıfırla" }).click();
  await approve(page, "Parolayı sıfırla");
  await expect(page.getByRole("status").filter({ hasText: "Kerem Uysal parolası sıfırlandı" })).toBeVisible();

  await signOut(page);
  await formLogin(page, "kerem.uysal@baltacioglus.example", NEW_PASSWORD);
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toContainText("Kerem Uysal");
});
