import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

// Başsız Chromium varsayılan olarak çubukları gizler; gerçekten çizilmeleri için bu bayrak kaldırılır.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("kenar geçişi dikey kaydırma çubuğunu gizlemez", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await loginAs(page, "Onur Tekin");
await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Malzemeler" }).click();
await expect(page.getByRole("heading", { name: "Malzemeler", level: 1 })).toBeVisible();
const table = page.getByRole("table", { name: "Malzemeler" });
await expect(table.locator("tbody tr").first()).toBeVisible();
const box = table.locator("xpath=..");
  await expect.poll(() => box.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(box).toHaveAttribute("data-fade-right", "");
  const rect = await box.boundingBox();
  if (!rect) throw new Error("kap bulunamadı");
  // Sağdaki 6 px'lik sütun: dikey çubuğun yeri.
  const clip = { x: Math.round(rect.x + rect.width) - 6, y: Math.round(rect.y), width: 6, height: Math.round(rect.height) };

  // Önce çubuk gizliyken, sonra görünürken aynı sütunun görüntüsü alınır; fark tutamaktır.
  const hidden = (await page.screenshot({ clip })).toString("base64");
  // Başsız Chromium üst öğe :hover/:focus-within değişince çubuğu yeniden çizmez; görünürlük anahtarı olan öznitelik elle konur.
  await box.evaluate((el) => el.setAttribute("data-scrolling", ""));
  await expect(box).toHaveAttribute("data-fade-right", "");
  let shown = hidden;
  await expect
    .poll(async () => {
      shown = (await page.screenshot({ clip })).toString("base64");
      return shown !== hidden;
    }, { message: "çubuk görününce sağ 6 px değişmeli (tutamak çizilmeli)" })
    .toBe(true);

  const differing = await page.evaluate(
    async ([a, b]) => {
      const read = async (data: string) => {
        const img = new Image();
        img.src = "data:image/png;base64," + data;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        ctx?.drawImage(img, 0, 0);
        return ctx?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
      };
      const [pa, pb] = await Promise.all([read(a ?? ""), read(b ?? "")]);
      let n = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs((pa[i] ?? 0) - (pb[i] ?? 0)) + Math.abs((pa[i + 1] ?? 0) - (pb[i + 1] ?? 0)) > 30) n++;
      }
      return n;
    },
    [shown, hidden],
  );
  expect(differing, "sağ 6 px'te tutamak çizilmeli").toBeGreaterThan(10);
});
