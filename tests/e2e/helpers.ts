import { expect, type Locator, type Page } from "@playwright/test";

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

/** Ana menüden bir sayfaya gider ve başlığını bekler. */
export async function navTo(page: Page, label: string, heading = label): Promise<void> {
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
}

/** Açık çekmeceyi kapatıp çıkar: çekmece açıkken sayfanın geri kalanı (hesap menüsü dahil) erişilebilirlik ağacından gizlidir. */
export async function leave(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await signOut(page);
}

/** Açık onay penceresi. Değişiklik yapan her işlem önce bunu açar (role=alertdialog). */
export function confirmDialog(page: Page): Locator {
  return page.getByRole("alertdialog");
}

/** Onay penceresinde onay düğmesine basar ve pencerenin kapanmasını bekler. */
export async function approve(page: Page, label: string | RegExp): Promise<void> {
  const dialog = confirmDialog(page);
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
}

/**
 * Öğenin ekrandaki yüksekliği, giriş animasyonları bittikten sonra. Pencere `pop-in` ile %97 ölçekten başlar; animasyon
 * henüz ilk karesini çizmemişken (yavaş makinede, azaltılmış harekette bile) ölçülen kutu 48 px yerine 46,56 px çıkar.
 * Öğenin ve atalarının sonlu animasyonları beklenir; sonsuz döngüler (dönen işaret, iskelet) beklenmez.
 */
export async function settledHeight(locator: Locator): Promise<number> {
  await locator.evaluate(async (el) => {
    const running: Promise<unknown>[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      for (const a of node.getAnimations()) if (a.effect?.getComputedTiming().endTime !== Infinity) running.push(a.finished.catch(() => undefined));
    }
    await Promise.all(running);
  });
  return (await locator.boundingBox())?.height ?? 0;
}

/** Tek satır dönmesi beklenen sorgu; satır yoksa test anlaşılır bir hatayla düşer. */
export async function one<T>(page: Page, query: string): Promise<T> {
  const [row] = await sql<T>(page, query);
  if (!row) throw new Error(`satır yok: ${query}`);
  return row;
}
