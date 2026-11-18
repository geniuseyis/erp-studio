import { expect, type Page, test } from "@playwright/test";
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

test("yan menüde klavyeyle gezerken odaklı bağlantı kenar geçişinin altında kalmaz", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loginAs(page, "Nermin Aksoy");
  const nav = page.getByRole("navigation", { name: "Ana menü" }).locator("visible=true").first();
  const links = nav.getByRole("link");
  const count = await links.count();
  await links.first().focus();
  let checked = 0;
  for (let i = 1; i < count; i++) {
    await page.keyboard.press("Tab");
    const r = await nav.evaluate((el) => {
      const a = document.activeElement as HTMLElement;
      if (!el.contains(a)) return null;
      const n = el.getBoundingClientRect();
      const b = a.getBoundingClientRect();
      return { top: b.top - n.top, bottom: n.bottom - b.bottom, fadeTop: el.hasAttribute("data-fade-top"), fadeBottom: el.hasAttribute("data-fade-bottom") };
    });
    if (!r) break;
    if (r.fadeTop) expect(r.top, `Tab ${i} üst`).toBeGreaterThanOrEqual(24);
    if (r.fadeBottom) expect(r.bottom, `Tab ${i} alt`).toBeGreaterThanOrEqual(24);
    if (r.fadeTop && r.fadeBottom) checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test.describe("kaydırma çubuğu", () => {
  async function openMaterialsTable(page: Page) {
    await loginAs(page, "Onur Tekin");
    await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Malzemeler" }).click();
    await expect(page.getByRole("heading", { name: "Malzemeler", level: 1 })).toBeVisible();
    const table = page.getByRole("table", { name: "Malzemeler" });
    await expect(table.locator("tbody tr").first()).toBeVisible();
    return table.locator("xpath=..");
  }

  test("tablo kabında ve sayfada kaydırınca data-scrolling eklenir, sonra kalkar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const box = await openMaterialsTable(page);

    // Tablo kabı: dikey kaydırma.
    await expect.poll(() => box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await box.evaluate((el) => el.scrollBy(0, 120));
    await expect(box).toHaveAttribute("data-scrolling", "");
    await expect(box).not.toHaveAttribute("data-scrolling", "", { timeout: 5_000 });

    // Sayfa: belge kaydırması (hedef document) html öğesine işlenir.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.id = "kaydirma-bosluk";
      spacer.style.height = "4000px";
      document.body.append(spacer);
      window.scrollTo(0, 200);
    });
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-scrolling", "");
    await expect(html).not.toHaveAttribute("data-scrolling", "", { timeout: 5_000 });
    await page.evaluate(() => document.getElementById("kaydirma-bosluk")?.remove());
  });

  test("dar pencerede tablo kabında kenar geçişleri kaydırma konumunu izler", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    const box = await openMaterialsTable(page);
    await expect.poll(() => box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(box).toHaveAttribute("data-fade-right", "");
    await expect(box).not.toHaveAttribute("data-fade-left", "");

    await box.evaluate((el) => el.scrollTo(el.scrollWidth, 0));
    await expect(box).toHaveAttribute("data-fade-left", "");
    await expect(box).not.toHaveAttribute("data-fade-right", "");
  });

  test("Tab ile gelen hücre kabın kenarından en az 24 px içeride kalır", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    const box = await openMaterialsTable(page);
    await expect.poll(() => box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await box.evaluate((el) => getComputedStyle(el).scrollPaddingInlineEnd)).toBe("24px");

    // Satır tek odak noktasıdır; görünümün dışında kalan ama içeriğin sonuna 24 px'ten uzak bir hücreye
    // düğme konup Tab ile ona gelinir (içeriğin en ucundaki hücre zaten kenara yaslanmak zorundadır).
    const row = page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr").first();
    const placed = await row.evaluate((tr) => {
      const scroller = tr.parentElement?.parentElement?.parentElement as HTMLElement;
      const cells = Array.from(tr.children) as HTMLElement[];
      const cell = cells.find((c) => c.offsetLeft > scroller.clientWidth + 40 && c.offsetLeft + c.offsetWidth + 48 < scroller.scrollWidth);
      if (!cell) return false;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sonOdak = "";
      button.textContent = "x";
      cell.append(button);
      return true;
    });
    expect(placed).toBe(true);
    await row.focus();
    await box.evaluate((el) => el.scrollTo(0, 0));
    await page.keyboard.press("Tab");
    const target = row.locator("[data-son-odak]");
    await expect(target).toBeFocused();
    await expect
      .poll(async () => {
        const [c, t] = await Promise.all([box.boundingBox(), target.boundingBox()]);
        if (!c || !t) return Number.NaN;
        return Math.round(c.x + c.width - (t.x + t.width));
      })
      .toBeGreaterThanOrEqual(23);
  });

  test("tutamak renkleri her iki temada tanımlıdır ve kaydırma alanlarına küresel kural uygulanır", async ({ page }) => {
    const read = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return [s.getPropertyValue("--scroll-thumb").trim(), s.getPropertyValue("--scroll-thumb-hover").trim()];
      });
    const [light] = await read();
    expect(light).not.toBe("");
    await page.getByRole("button", { name: "Koyu temaya geç" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(async () => (await read())[0]).not.toBe(light);
    // Ceviz zeminde bal tonu.
    const honey = await page.evaluate(() => {
      const el = document.createElement("div");
      el.className = "walnut";
      document.body.append(el);
      const value = getComputedStyle(el).getPropertyValue("--scroll-thumb").trim();
      el.remove();
      return value;
    });
    expect(honey.toLowerCase()).toMatch(/e2a54c|226 165 76/);
    // Sayfa kaydırması tarayıcının varsayılan çubuğunu göstermez: kural bütün öğelere (html dahil) uygulanır.
    const rule = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((r) => /^\*?::-webkit-scrollbar-thumb\s*\{/.test(r.cssText));
        } catch {
          return false;
        }
      }),
    );
    expect(rule).toBe(true);
  });
});
