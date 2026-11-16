import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Demo2026!";
const BOOT_TIMEOUT = 45_000;

/** Giriş ekranını açar ve örnek verinin yüklenmesini bekler. */
export async function openLogin(page: Page): Promise<void> {
  await page.goto("/giris");
  await expect(page.getByRole("heading", { name: "Giriş yapın", level: 1 })).toBeVisible({ timeout: BOOT_TIMEOUT });
}

/** Giriş ekranındayken demo hesapları penceresini açar ve verilen kişiyle girer. */
export async function pickDemo(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Demo hesabıyla giriş yap" }).click();
  await page.getByRole("dialog", { name: "Demo hesapları" }).getByRole("button", { name: new RegExp(name) }).click();
}

/** Demo hesaplarından biriyle giriş yapar. */
export async function loginAs(page: Page, name: string): Promise<void> {
  await openLogin(page);
  await pickDemo(page, name);
  await expect(page.getByRole("button", { name: new RegExp(`Hesap menüsü.*${name}`) })).toBeVisible();
}

/** Tarayıcıdaki veritabanında SQL çalıştırır (yalnızca E2E derlemesinde bulunan sonda). */
export async function sql<T = Record<string, unknown>>(page: Page, query: string): Promise<T[]> {
  return page.evaluate((q) => (window as unknown as { __erp: { query(q: string): Promise<unknown[]> } }).__erp.query(q), query) as Promise<T[]>;
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Hesap menüsü/ }).click();
  await page.getByRole("menuitem", { name: "Çıkış yap" }).click();
  await expect(page).toHaveURL(/\/giris/);
}
