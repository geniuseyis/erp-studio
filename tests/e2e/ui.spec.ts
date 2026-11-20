import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAs, navTo, settledHeight } from "./helpers";

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
  const width = page.viewportSize()?.width ?? 0;
  // Masaüstünde panel sağ kenardan 8 px içeride yüzer; sağa yaslı olmalı. Kayarak girdiği için yerine oturması beklenir.
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      const gap = width - Math.round((box?.x ?? 0) + (box?.width ?? 0));
      return gap >= 0 && gap <= 12;
    })
    .toBe(true);
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

    // Satır animasyonları genişliği oynatabilir: uca her denemede yeniden kaydırılır.
    await expect
      .poll(async () => {
        await box.evaluate((el) => el.scrollTo(el.scrollWidth, 0));
        return box.evaluate((el) => [el.hasAttribute("data-fade-left"), el.hasAttribute("data-fade-right")]);
      })
      .toEqual([true, false]);
  });

  test("Tab ile gelen hücre kabın kenarından en az 24 px içeride kalır", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    const box = await openMaterialsTable(page);
    await expect.poll(() => box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await box.evaluate((el) => getComputedStyle(el).scrollPaddingInlineEnd)).toBe("24px");

    // Satır tek odak noktasıdır; görünümün dışında kalan ama içeriğin sonuna 24 px'ten uzak bir hücreye
    // düğme konup Tab ile ona gelinir (içeriğin en ucundaki hücre zaten kenara yaslanmak zorundadır).
    const row = page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr").first();
    const target = row.locator("[data-son-odak]");
    // Düğmeyi koyma, odaklama ve Tab tek adımdır ve baştan tekrarlanabilir: yük altında tablo yeniden çizilirse
    // (düğme silinir) ya da yerleşim henüz oturmamışsa kaydırma sıfırlanıp adım yeniden denenir.
    await expect(async () => {
      await row.evaluate((tr) => {
        tr.querySelectorAll("[data-son-odak]").forEach((b) => b.remove());
        const scroller = tr.parentElement?.parentElement?.parentElement as HTMLElement;
        const cells = Array.from(tr.children) as HTMLElement[];
        const cell = cells.find((c) => c.offsetLeft > scroller.clientWidth + 40 && c.offsetLeft + c.offsetWidth + 48 < scroller.scrollWidth);
        if (!cell) throw new Error("uygun hücre yok");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.sonOdak = "";
        button.textContent = "x";
        cell.append(button);
        scroller.style.scrollBehavior = "auto"; // yumuşak kaydırma ölçümü geciktirmesin
        scroller.scrollLeft = 0;
        (tr as HTMLElement).focus();
      });
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // Odak geldikten sonra tarayıcının kaydırması oturana dek ölçüm yoklanır.
    await expect
      .poll(async () => {
        const [c, t] = await Promise.all([box.boundingBox(), target.boundingBox()]);
        if (!c || !t) return Number.NaN;
        return Math.round(c.x + c.width - (t.x + t.width));
      })
      .toBeGreaterThanOrEqual(23);
  });

  test("tutamak renkleri her iki temada tanımlıdır ve ceviz zeminde bal tonudur", async ({ page }) => {
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
  });
  test("varsayılan çubuk hiçbir kaydırma alanında kalmaz: çubuk 6 px ve özel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    const box = await openMaterialsTable(page);
    const width = (loc: Locator) => loc.evaluate((el) => getComputedStyle(el, "::-webkit-scrollbar").width);

    expect(await width(page.locator("main"))).toBe("6px");
    expect(await width(page.locator("html"))).toBe("6px");
    expect(await width(box)).toBe("6px");

    await page.getByRole("table", { name: "Malzemeler" }).locator("tbody tr").first().click();
    const drawer = page.getByRole("dialog").filter({ hasText: "MLZ-0001" });
    await expect(drawer).toBeVisible();
    const body = drawer.locator("div.overflow-y-auto");
    expect(await width(body)).toBe("6px");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Ara ve git" });
    await expect(palette).toBeVisible();
    expect(await width(palette.locator("[cmdk-list]"))).toBe("6px");
  });
});

test.describe("liste ekranlarında yerleşim ayarı", () => {
  async function openActivity(page: Page, reload = false) {
    if (reload) await page.reload();
    else {
      await loginAs(page, "Onur Tekin");
      await navTo(page, "İşlemler");
    }
    await expect(page.getByRole("heading", { name: "İşlemler", level: 1 })).toBeVisible({ timeout: 45_000 });
    const table = page.getByRole("table", { name: "İşlemler" });
    await expect(table.locator("tbody tr").first()).toBeVisible({ timeout: 45_000 });
    // Özet kutuları veri gelince belirir ve bandı uzatır (tablo kısalır); ölçmeden önce beklenir.
    await expect(page.getByTestId("stat-value").first()).toBeVisible({ timeout: 45_000 });
    const handle = page.getByRole("separator", { name: "Tablo yüksekliği" });
    return { handle, root: handle.locator("xpath=.."), hero: page.locator(".page-hero") };
  }

  test("özet bandı gizlenince bant küçülür, tablo kabı büyür; seçim yenilemede kalır", async ({ page }) => {
    const { root, hero } = await openActivity(page);
    const heroOpen = await settledHeight(hero);
    const rootOpen = await settledHeight(root);
    const toggle = page.getByRole("button", { name: "Özeti gizle" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await toggle.click();
    const show = page.getByRole("button", { name: "Özeti göster" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => settledHeight(hero)).toBeLessThan(heroOpen - 80);
    await expect.poll(() => settledHeight(root)).toBeGreaterThan(rootOpen + 80);

    const again = await openActivity(page, true);
    await expect(page.getByRole("button", { name: "Özeti göster" })).toBeVisible();
    await expect.poll(() => settledHeight(again.hero)).toBeLessThan(heroOpen - 80);

    await page.getByRole("button", { name: "Özeti göster" }).click();
    await expect(page.getByRole("button", { name: "Özeti gizle" })).toBeVisible();
    await expect.poll(() => settledHeight(again.hero)).toBeGreaterThan(heroOpen - 4);
  });

  test("tutamaç klavyeyle çalışır: ↓ × 3 = 120 px, yenilemede kalır, Home en küçük, çift tık otomatik", async ({ page }) => {
    const { handle, root } = await openActivity(page);
    await expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    await expect(handle).toHaveAttribute("tabindex", "0");
    const before = await settledHeight(root);
    const startNow = Number(await handle.getAttribute("aria-valuenow"));

    await handle.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await settledHeight(root)) - before).toBeGreaterThanOrEqual(118);
    expect((await settledHeight(root)) - before).toBeLessThanOrEqual(122);
    await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(startNow + 116);
    const stored = await settledHeight(root);

    const again = await openActivity(page, true);
    await expect.poll(async () => Math.abs((await settledHeight(again.root)) - stored)).toBeLessThanOrEqual(2);

    const min = Number(await again.handle.getAttribute("aria-valuemin"));
    await again.handle.focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => Math.abs((await settledHeight(again.root)) - min)).toBeLessThanOrEqual(2);
    await expect(again.handle).toHaveAttribute("aria-valuenow", String(min));

    await again.handle.dblclick();
    await expect.poll(async () => Math.abs((await settledHeight(again.root)) - before)).toBeLessThanOrEqual(2);
  });

  test("tutamaç fareyle 200 px sürüklenince kap uzar ve main kayar", async ({ page }) => {
    const { handle, root } = await openActivity(page);
    const before = await settledHeight(root);
    const box = await handle.boundingBox();
    if (!box) throw new Error("tutamaç yok");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + i * 20);
    await page.mouse.up();
    await expect.poll(async () => (await settledHeight(root)) - before).toBeGreaterThanOrEqual(194);
    expect((await settledHeight(root)) - before).toBeLessThanOrEqual(206);
    await expect.poll(() => page.locator("main").evaluate((el) => el.scrollHeight > el.clientHeight + 4)).toBe(true);
  });

  test("sürükleme metin seçmez; kıpırdamadan tıklamak ayarı sabitlemez, kap pencereyi doldurmaya devam eder", async ({ page }) => {
    const { handle, root } = await openActivity(page);
    const before = await settledHeight(root);
    const box = await handle.boundingBox();
    if (!box) throw new Error("tutamaç yok");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.click(x, y);
    await expect(handle).toBeFocused();
    expect(await page.evaluate(() => window.localStorage.getItem("erp:table-h:islemler"))).toBeNull();
    await page.setViewportSize({ width: 1440, height: 1200 });
    await expect.poll(() => settledHeight(root)).toBeGreaterThan(before + 150);

    // Sürükleme sırasında seçim oluşmaz.
    const moved = await handle.boundingBox();
    if (!moved) throw new Error("tutamaç yok");
    await page.mouse.move(moved.x + 20, moved.y + 3);
    await page.mouse.down();
    await page.mouse.move(moved.x + 20, moved.y - 60, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");
  });

  test("PageUp/PageDown 160 px, End pencereyi doldurur ve altta tam 20 px boşluk bırakır", async ({ page }) => {
    const { handle, root } = await openActivity(page);
    const auto = await settledHeight(root);
    await handle.focus();
    await page.keyboard.press("PageUp");
    await expect.poll(async () => auto - (await settledHeight(root))).toBeGreaterThanOrEqual(158);
    expect(auto - (await settledHeight(root))).toBeLessThanOrEqual(162);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await settledHeight(root)) - auto).toBeGreaterThanOrEqual(158);
    expect((await settledHeight(root)) - auto).toBeLessThanOrEqual(162);

    await page.keyboard.press("End");
    const gap = () =>
      page.evaluate(() => {
        const main = document.querySelector("main") as HTMLElement;
        const card = document.querySelector('[role="separator"]')?.parentElement as HTMLElement;
        return { gap: main.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom, spill: main.scrollHeight - main.clientHeight };
      });
    await expect.poll(async () => Math.abs((await gap()).gap - 20)).toBeLessThanOrEqual(1);
    expect((await gap()).spill).toBeLessThanOrEqual(1);

    // Alan aşılınca main kayar ve en altta da kabın altında tam 20 px boşluk kalır (padding değil, son öğe).
    for (let i = 0; i < 3; i++) await page.keyboard.press("PageDown");
    await expect.poll(async () => (await gap()).spill).toBeGreaterThan(400);
    await page.locator("main").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(async () => Math.abs((await gap()).gap - 20)).toBeLessThanOrEqual(1);
  });

  test("1280×720'de bant daraltılmış başlar; kayıtlı 'açık' seçim yenilemeden sonra kazanır", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openActivity(page);
    await expect(page.getByRole("button", { name: "Özeti göster" })).toBeVisible();
    await page.evaluate(() => window.localStorage.setItem("erp:hero:islemler", "0"));
    await openActivity(page, true);
    await expect(page.getByRole("button", { name: "Özeti gizle" })).toBeVisible();
  });

  test("1280×720'de varsayılan durumda tablo kabı en az 24rem", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const { root } = await openActivity(page);
    await expect.poll(() => settledHeight(root)).toBeGreaterThanOrEqual(384);
  });

  test("localStorage engelliyken ekran hatasız açılır", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException("engellendi", "SecurityError");
      };
      for (const m of ["getItem", "setItem", "removeItem"] as const) Storage.prototype[m] = blocked;
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const { handle, root } = await openActivity(page);
    await expect(handle).toBeVisible();
    await expect.poll(() => settledHeight(root)).toBeGreaterThanOrEqual(384);
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("heading", { name: "İşlemler", level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
