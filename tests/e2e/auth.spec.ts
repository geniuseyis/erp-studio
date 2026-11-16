import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, loginAs, openLogin, pickDemo, signOut, sql } from "./helpers";

test("demo hesabıyla giriş ve çıkış", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/giris/, { timeout: 45_000 });
  await loginAs(page, "Onur Tekin");
  await expect(page).toHaveURL(/\/$/);
  const account = page.getByRole("button", { name: /Hesap menüsü/ });
  await expect(account).toContainText("Onur Tekin");
  await expect(account).toContainText("Depo Uzmanı");

  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "Malzemeler" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Kullanıcılar" })).toHaveCount(0);
  await expect(page.getByText("Örnek veri").first()).toBeVisible();

  await signOut(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/giris/);
});

test("form ile giriş: hatalı parolada tek ileti, doğru parolada ana sayfa", async ({ page }) => {
  await openLogin(page);
  await page.getByLabel("E-posta").fill("ayla.gunes@baltacioglus.example");
  await page.getByLabel("Parola", { exact: true }).fill("yanlis-parola");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("E-posta ya da parola hatalı.");
  await expect(page).toHaveURL(/\/giris/);

  await page.getByLabel("Parola", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toContainText("Ayla Güneş");
});

test("boş form gönderilince alanlar işaretlenir", async ({ page }) => {
  await openLogin(page);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.getByText("E-posta girin")).toBeVisible();
  await expect(page.getByText("Parola girin")).toBeVisible();
});

test("yenilemede oturum kalır; korumalı adres girişten sonra açılır", async ({ page }) => {
  await page.goto("/stok/malzemeler");
  await expect(page).toHaveURL(/\/giris\?sonra=%2Fstok%2Fmalzemeler/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Giriş yapın", level: 1 })).toBeVisible({ timeout: 45_000 });
  await pickDemo(page, "Onur Tekin");
  await expect(page).toHaveURL(/\/stok\/malzemeler/);
  await page.reload();
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toContainText("Onur Tekin", { timeout: 45_000 });
  await expect(page).toHaveURL(/\/stok\/malzemeler/);
});

test("girişten sonraki adres yalnızca uygulama içi olabilir", async ({ page }) => {
  await page.goto("/giris?sonra=https%3A%2F%2Fexample.com%2F");
  await expect(page.getByRole("heading", { name: "Giriş yapın", level: 1 })).toBeVisible({ timeout: 45_000 });
  await pickDemo(page, "Onur Tekin");
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toBeVisible();
  expect(new URL(page.url()).origin).toBe("http://localhost:3200");
  expect(new URL(page.url()).pathname).toBe("/");
});

test("yetkisi olmayan kullanıcı kullanıcı yönetimini açamaz", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await page.goto("/yonetim/kullanicilar");
  await expect(page.getByRole("heading", { name: "Bu sayfayı görme yetkiniz yok" })).toBeVisible({ timeout: 45_000 });
});

test("pasife alınan kullanıcının açık oturumu kapanır", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  await sql(page, "update users set active = false where email = 'elif.karaca@baltacioglus.example'");
  await page.reload();
  await expect(page).toHaveURL(/\/giris/, { timeout: 45_000 });
  await sql(page, "update users set active = true where email = 'elif.karaca@baltacioglus.example'");
});

test("hesap değiştir giriş ekranına götürür", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Hesap değiştir" }).click();
  await expect(page).toHaveURL(/\/giris/);
  await pickDemo(page, "Sevgi Polat");
  await expect(page.getByRole("button", { name: /Hesap menüsü/ })).toContainText("Sevgi Polat");
});

test("veriyi sıfırla örnek veriye döner ve oturumu kapatır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  await sql(page, "insert into meta (key, value) values ('isaret', '1')");
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Ayarlar" }).click();
  await page.getByRole("button", { name: "Veriyi sıfırla" }).click();
  const dialog = page.getByRole("dialog", { name: "Veri sıfırlansın mı?" });
  await dialog.getByRole("button", { name: "Veriyi sıfırla" }).click();
  await expect(page).toHaveURL(/\/giris/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Giriş yapın", level: 1 })).toBeVisible({ timeout: 45_000 });
  expect(await sql(page, "select value from meta where key = 'isaret'")).toEqual([]);
  expect(await sql(page, "select count(*)::int as n from users")).toEqual([{ n: 14 }]);
});

test("yan menü daraltılır ve tercih yenilemede kalır", async ({ page }) => {
  await loginAs(page, "Onur Tekin");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "Malzemeler" })).toContainText("Malzemeler");
  await page.getByRole("button", { name: "Menüyü daralt" }).click();
  await expect(nav.getByText("Malzemeler")).toBeHidden();
  await expect(nav.getByRole("link", { name: "Malzemeler" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Menüyü genişlet" })).toBeVisible({ timeout: 45_000 });
});

test("telefonda menü düğmeyle açılır ve sayfa yatay taşmaz", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Onur Tekin");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  const menu = page.getByRole("dialog", { name: "Menü" });
  await menu.getByRole("link", { name: "Malzemeler" }).click();
  await expect(page).toHaveURL(/\/stok\/malzemeler/);
  await expect(menu).toBeHidden();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("giriş sayfası yalnızca girişi gösterir; demo hesapları ayrı pencerede açılır", async ({ page }) => {
  await openLogin(page);
  await expect(page.getByRole("heading", { name: "Demo hesapları" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Onur Tekin/ })).toHaveCount(0);

  const password = page.getByLabel("Parola", { exact: true });
  await password.fill("gizli-parola");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Parolayı göster" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Parolayı gizle" }).click();
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Demo hesabıyla giriş yap" }).click();
  const dialog = page.getByRole("dialog", { name: "Demo hesapları" });
  await expect(dialog.getByRole("button")).not.toHaveCount(0);
  await expect(dialog).toContainText(DEMO_PASSWORD);
});

test("çıkış yapan kişinin sayfası sonraki kişiye kalmaz", async ({ page }) => {
  await loginAs(page, "Ece Korkmaz");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Kullanıcılar" }).click();
  await expect(page.getByRole("heading", { name: "Kullanıcılar", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Hesap değiştir" }).click();
  await expect(page).toHaveURL(/\/giris$/);
  await pickDemo(page, "Onur Tekin");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Onur");
  await expect(page).toHaveURL(/\/$/);
});
