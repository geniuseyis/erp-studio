import { expect, test } from "@playwright/test";
import { loginAs, openLogin, sql } from "./helpers";

test("veritabanı tarayıcıda açılır, örnek veri yüklenir ve yenilemede kalır", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
  await page.goto("/");
  await expect(page).toHaveURL(/\/giris/, { timeout: 45_000 });
  await openLogin(page);
  expect(await sql(page, "select count(*)::int as n from users")).toEqual([{ n: 14 }]);
  expect((await sql<{ n: number }>(page, "select count(*)::int as n from materials"))[0]?.n).toBeGreaterThanOrEqual(36);

  await sql(page, "insert into meta (key, value) values ('isaret', '1')");
  await page.reload();
  await openLogin(page);
  expect(await sql(page, "select value from meta where key = 'isaret'")).toEqual([{ value: "1" }]);
  // Yenilemede örnek veri ikinci kez yüklenmez.
  expect(await sql(page, "select count(*)::int as n from users")).toEqual([{ n: 14 }]);
  expect(errors, "yakalanmamış hata olmamalı").toEqual([]);
});

test("iki sekme aynı veriyi görür ve bozmaz", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([openLogin(a), openLogin(b)]);
  expect(await sql(a, "select count(*)::int as n from users")).toEqual([{ n: 14 }]);
  expect(await sql(b, "select count(*)::int as n from users")).toEqual([{ n: 14 }]);

  await sql(a, "insert into meta (key, value) values ('sayac', '1')");
  await sql(b, "update meta set value = (value::int + 1)::text where key = 'sayac'");
  expect(await sql(a, "select value from meta where key = 'sayac'")).toEqual([{ value: "2" }]);
  await a.reload();
  await openLogin(a);
  expect(await sql(a, "select value from meta where key = 'sayac'")).toEqual([{ value: "2" }]);
});

test("depolama kapalıyken bellekte çalışır ve kullanıcı uyarılır", async ({ page }) => {
  await page.addInitScript(() => {
    // Tarayıcı dosya sistemi (OPFS) yokmuş gibi davran.
    Object.defineProperty(navigator, "storage", { value: undefined });
  });
  await openLogin(page);
  await expect(page.getByText("Veriler bu sekme kapanınca silinir")).toBeVisible();
  await loginAs(page, "Onur Tekin");
  await expect(page.getByText("Veriler bu sekme kapanınca silinir")).toBeVisible();
});

test("depolama Worker içinde reddedilirse açılış takılmaz, bellekte çalışır ve kullanıcı uyarılır", async ({ page, context }) => {
  // Chrome site verisi engellendiğinde OPFS'i Worker içinde SecurityError ile reddeder. Bunu her betiğin başına
  // eklenen küçük bir yamayla taklit et; yama yalnızca Worker kapsamında etkili olur.
  const patch = `;(function(){try{if(typeof WorkerGlobalScope!=="undefined"&&typeof StorageManager!=="undefined"){Object.defineProperty(StorageManager.prototype,"getDirectory",{configurable:true,value:function(){return Promise.reject(new DOMException("denied","SecurityError"))}})}}catch(e){}})();\n`;
  await context.route(/\.js(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: patch + (await response.text()) });
  });
  await openLogin(page);
  await expect(page.getByText("Veriler bu sekme kapanınca silinir")).toBeVisible();
});

test("bir sekmedeki stok girişi diğer sekmenin ekranında yenilemeden görünür", async ({ context }) => {
  const a = await context.newPage();
  await loginAs(a, "Onur Tekin");
  const b = await context.newPage();
  await b.goto("/stok/malzemeler");
  const rowB = b.getByRole("row", { name: /MLZ-0001/ });
  await expect(rowB).toBeVisible({ timeout: 45_000 });
  const before = (await rowB.textContent()) ?? "";

  await a.goto("/stok/malzemeler");
  await a.getByRole("row", { name: /MLZ-0001/ }).click();
  await a.getByRole("button", { name: "Stok girişi" }).click();
  const dialog = a.getByRole("dialog", { name: "Stok girişi" });
  await dialog.getByLabel("Miktar").fill("7");
  await dialog.getByLabel("Birim maliyet").fill("1.600,00");
  await dialog.getByRole("button", { name: "Girişi kaydet" }).click();
  await expect(a.getByRole("status").filter({ hasText: "7 plaka giriş kaydedildi" })).toBeVisible();

  // B sekmesi yeniden yüklenmeden güncel satırı göstermeli.
  await expect.poll(async () => (await rowB.textContent()) ?? "").not.toBe(before);
});
