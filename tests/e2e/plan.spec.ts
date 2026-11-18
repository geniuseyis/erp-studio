import { expect, type Locator, type Page, test } from "@playwright/test";
import { approve, confirmDialog, loginAs, one, settledHeight, sql } from "./helpers";

// Gün hesapları uygulamanın takvim kodundan bağımsız: İstanbul UTC+3 sabit, gün = o günün başladığı an.
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) => new Date(Math.floor((d.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
function mondayOf(d: Date): Date {
  const start = dayStart(d);
  const weekday = new Date(start.getTime() + OFFSET_MS).getUTCDay();
  return plusDays(start, -((weekday + 6) % 7));
}
/** "2026-11-23": adresteki hafta ve hücre anahtarı biçimi. */
const dayKey = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
/** "23.11" */
const dm = (d: Date) => {
  const w = new Date(d.getTime() + OFFSET_MS);
  return `${String(w.getUTCDate()).padStart(2, "0")}.${String(w.getUTCMonth() + 1).padStart(2, "0")}`;
};
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const WEEKDAYS = ["pazar", "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi"];
/** "23 Kasım pazartesi": klavye duyurusundaki gün. */
const longDay = (d: Date) => {
  const w = new Date(d.getTime() + OFFSET_MS);
  return `${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]} ${WEEKDAYS[w.getUTCDay()]}`;
};
const tr = (n: number) => n.toLocaleString("tr-TR");

type Step = { seq: number; minutes: number; station: string; stationCode: string; capacity: number };
type Order = { id: string; code: string; steps: Step[] };

/** Gelecek haftanın pazartesisi: bütün günleri geleceğe düşer, test hangi gün koşarsa koşsun. */
const nextWeek = () => plusDays(mondayOf(new Date()), 7);

/**
 * Başlamamış, beş adımlı (beyaz ürün: Kesim, Kenar, CNC, Montaj, Paketleme) planlı bir iş emri seçer ve adımlarını
 * gelecek haftanın pazartesi–cuma günlerine sırayla dizer. Satır başına bir adım: rota sırası günlerle aynıdır.
 */
async function prepareOrder(page: Page, week: Date): Promise<Order> {
  const wo = await one<{ id: string; code: string }>(
    page,
    `select w.id, w.code from work_orders w
      where w.status = 'planned'
        and not exists (select 1 from work_order_steps s where s.work_order_id = w.id and s.started_at is not null)
        and (select count(*) from work_order_steps s where s.work_order_id = w.id) = 5
      order by w.code limit 1`,
  );
  const steps = await sql<Step>(
    page,
    `select s.seq, s.minutes, st.name as station, st.code as "stationCode", st.daily_capacity_min as capacity
       from work_order_steps s join stations st on st.id = s.station_id
      where s.work_order_id = '${wo.id}' order by s.seq`,
  );
  for (const [i, s] of steps.entries()) {
    await sql(page, `update work_order_steps set planned_day = '${plusDays(week, i).toISOString()}' where work_order_id = '${wo.id}' and seq = ${s.seq}`);
  }
  return { ...wo, steps };
}

const plannedDay = async (page: Page, wo: Order, seq: number) =>
  new Date((await one<{ d: string }>(page, `select planned_day as d from work_order_steps where work_order_id = '${wo.id}' and seq = ${seq}`)).d);
const moves = async (page: Page, wo: Order) =>
  (await one<{ n: number }>(page, `select count(*)::int as n from audit_log where entity = 'work_order' and entity_id = '${wo.id}' and action = 'move_step'`)).n;

const card = (page: Page, wo: Order, seq: number) => page.locator(`[data-step-key="${wo.id}:${seq}"]`).first();
const cell = (page: Page, stationCode: string, day: Date) => page.locator(`[data-cell="${stationCode}:${dayKey(day)}"]`);
const announcer = (page: Page) => page.getByRole("status", { name: "Plan duyurusu" });

async function openWeek(page: Page, week: Date): Promise<void> {
  await page.goto(`/uretim/plan?hafta=${dayKey(week)}`);
  await expect(page.getByRole("heading", { name: "Haftalık plan", level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("table", { name: "Haftalık üretim planı" })).toBeVisible();
}

/** Fareyle sürükler: önce eşiği aşan küçük bir kıpırdama (tıklama sayılmasın), sonra hedef hücrenin ortasına adım adım. */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  if (!a) throw new Error("kart görünmüyor");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 14, a.y + a.height / 2, { steps: 4 });
  const b = await to.boundingBox();
  if (!b) throw new Error("hücre görünmüyor");
  const y = a.y + a.height / 2;
  await page.mouse.move(b.x + b.width / 2, y, { steps: 14 });
  await page.mouse.move(b.x + b.width / 2 + 3, y, { steps: 3 });
  await page.mouse.up();
}

test("planlama uzmanı kartı sürükleyip bırakır; onaydan sonra adımın günü değişir", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!; // salı; sonraki adım (CNC) çarşamba: aynı güne taşıma izinli
  await openWeek(page, week);

  const moving = card(page, wo, knr.seq);
  await expect(moving).toHaveAttribute("aria-roledescription", "taşınabilir kart");
  await expect(cell(page, knr.stationCode, plusDays(week, 1)).locator(`[data-step-key="${wo.id}:${knr.seq}"]`)).toBeVisible();
  await drag(page, moving, cell(page, knr.stationCode, plusDays(week, 2)));

  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${wo.code} ${knr.station} adımı ${dm(plusDays(week, 1))} → ${dm(plusDays(week, 2))} taşınsın mı?`);
  // Vazgeç odakta: Enter tek başına onaylamaz.
  await expect(dialog.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await approve(page, "Taşı");

  await expect.poll(async () => (await plannedDay(page, wo, knr.seq)).getTime()).toBe(plusDays(week, 2).getTime());
  expect(await moves(page, wo)).toBe(1);
  await expect(cell(page, knr.stationCode, plusDays(week, 2)).locator(`[data-step-key="${wo.id}:${knr.seq}"]`)).toBeVisible();
  await expect(cell(page, knr.stationCode, plusDays(week, 1)).locator(`[data-step-key="${wo.id}:${knr.seq}"]`)).toHaveCount(0);
});

test("klavyeyle Space, →, Enter taşır; Esc vazgeçer ve hiçbir şey yazmaz", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!;
  const mnt = wo.steps[3]!;
  await openWeek(page, week);

  // Esc: perşembedeki Montaj tutulur, cumaya kaydırılır, vazgeçilir. Pencere açılmaz, hiçbir şey yazılmaz, odak kartta kalır.
  const montaj = card(page, wo, mnt.seq);
  await montaj.focus();
  await page.keyboard.press("Space");
  await expect(announcer(page)).toContainText(`${wo.code} ${mnt.station}`);
  await expect(montaj).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(announcer(page)).toContainText(`${wo.code} ${mnt.station}, ${longDay(plusDays(week, 4))} üzerinde`);
  await page.keyboard.press("Escape");
  await expect(announcer(page)).toContainText("vazgeçildi");
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(montaj).toBeFocused();
  await expect(montaj).not.toHaveAttribute("aria-pressed", "true");
  expect((await plannedDay(page, wo, mnt.seq)).getTime()).toBe(plusDays(week, 3).getTime());
  expect(await moves(page, wo)).toBe(0);

  // Space, →, Enter: salıdaki Kenar bantlama çarşambaya.
  const kenar = card(page, wo, knr.seq);
  await kenar.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(announcer(page)).toContainText(`${wo.code} ${knr.station}, ${longDay(plusDays(week, 2))} üzerinde`);
  await page.keyboard.press("Enter");
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${wo.code} ${knr.station} adımı ${dm(plusDays(week, 1))} → ${dm(plusDays(week, 2))} taşınsın mı?`);
  // Enter tek başına onaylamaz: odak Vazgeç'te, Enter vazgeçer.
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(await moves(page, wo)).toBe(0);

  await kenar.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await approve(page, "Taşı");
  await expect.poll(async () => (await plannedDay(page, wo, knr.seq)).getTime()).toBe(plusDays(week, 2).getTime());
  expect(await moves(page, wo)).toBe(1);
  // Taşınan kart yeni hücresinde ve odakta.
  await expect(cell(page, knr.stationCode, plusDays(week, 2)).locator(`[data-step-key="${wo.id}:${knr.seq}"]`)).toBeFocused();
});

test("rotayı bozan bırakma toast verir, kart yerinde kalır", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!;
  const cnc = wo.steps[2]!; // çarşamba: Kenar bantlama perşembeye geçemez
  await openWeek(page, week);

  await drag(page, card(page, wo, knr.seq), cell(page, knr.stationCode, plusDays(week, 3)));
  await expect(page.getByRole("alert").filter({ hasText: `${cnc.station} adımı (${dm(plusDays(week, 2))}) bundan önce olamaz` })).toBeVisible();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(cell(page, knr.stationCode, plusDays(week, 1)).locator(`[data-step-key="${wo.id}:${knr.seq}"]`)).toBeVisible();
  expect((await plannedDay(page, wo, knr.seq)).getTime()).toBe(plusDays(week, 1).getTime());
  expect(await moves(page, wo)).toBe(0);
});

test("çalışan kart sürüklenemez", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const ksm = wo.steps[0]!;
  await sql(page, `update work_orders set status = 'in_progress', started_at = now() where id = '${wo.id}'`);
  await sql(page, `update work_order_steps set started_at = now() where work_order_id = '${wo.id}' and seq = ${ksm.seq}`);
  await openWeek(page, week);

  const running = card(page, wo, ksm.seq);
  await expect(running).toContainText("çalışıyor");
  await expect(running).not.toHaveAttribute("aria-roledescription", "taşınabilir kart");
  await drag(page, running, cell(page, ksm.stationCode, plusDays(week, 1)));
  await expect(confirmDialog(page)).toHaveCount(0);
  // Aynı iş emrinin başlamamış adımı taşınabilir kalır.
  await expect(card(page, wo, wo.steps[1]!.seq)).toHaveAttribute("aria-roledescription", "taşınabilir kart");
  // Klavyeyle de tutulmaz: Space taşınamayan kartta düğme gibi iş emrini açar.
  await running.focus();
  await page.keyboard.press("Space");
  await expect(page).toHaveURL(new RegExp(`/uretim/is-emirleri\\?ac=${wo.id}`));
  await expect(page.getByRole("dialog", { name: wo.code })).toBeVisible();
  await expect(confirmDialog(page)).toHaveCount(0);
  expect((await plannedDay(page, wo, ksm.seq)).getTime()).toBe(week.getTime());
  expect(await moves(page, wo)).toBe(0);
});

test("kapasiteyi aşan taşımada onay metni yükü yazar; hücre kırmızı", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!;
  const target = plusDays(week, 2);
  // Hedef hücre örnek veriden bağımsız boşaltılır (oradaki başka adımlar bir hafta ileri); adımın dakikası kapasiteyi
  // 60 dk aşar. Böylece beklenen yük sabittir: kapasite + 60.
  await sql(
    page,
    `update work_order_steps s set planned_day = s.planned_day + interval '7 days' from stations st
      where st.id = s.station_id and st.code = '${knr.stationCode}' and s.work_order_id <> '${wo.id}'
        and s.planned_day >= '${target.toISOString()}' and s.planned_day < '${plusDays(target, 1).toISOString()}'`,
  );
  const total = knr.capacity + 60;
  await sql(page, `update work_order_steps set minutes = ${total} where work_order_id = '${wo.id}' and seq = ${knr.seq}`);
  await openWeek(page, week);

  const targetCell = cell(page, knr.stationCode, target);
  await expect(targetCell).not.toHaveAttribute("data-over", "true");
  await drag(page, card(page, wo, knr.seq), targetCell);
  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${wo.code} ${knr.station} adımı ${dm(plusDays(week, 1))} → ${dm(target)} taşınsın mı?`);
  await expect(dialog).toContainText(`${knr.station} ${dm(target)}: ${tr(total)} / ${tr(knr.capacity)} dk (%${Math.round((total * 100) / knr.capacity)})`);
  await approve(page, "Taşı");

  await expect(targetCell).toHaveAttribute("data-over", "true");
  await expect(targetCell).toContainText(`${tr(total)} / ${tr(knr.capacity)} dk`);
  expect((await plannedDay(page, wo, knr.seq)).getTime()).toBe(target.getTime());
  const audit = await one<{ summary: string }>(page, `select summary from audit_log where entity_id = '${wo.id}' and action = 'move_step'`);
  expect(audit.summary).toContain(`yük ${tr(total)}/${tr(knr.capacity)} dk`);
});

test("cuma kartı klavyeyle sağa: sonraki haftanın pazartesisi, görünüm geçer", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const pkt = wo.steps[4]!; // cuma, son adım
  const friday = plusDays(week, 4);
  const monday = plusDays(week, 7);
  await openWeek(page, week);

  const packing = card(page, wo, pkt.seq);
  await packing.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(announcer(page)).toContainText(`${wo.code} ${pkt.station}, ${longDay(monday)} üzerinde`);
  await expect(page).toHaveURL(new RegExp(`hafta=${dayKey(monday)}`));
  await expect(cell(page, pkt.stationCode, monday)).toBeVisible();
  await expect(cell(page, pkt.stationCode, friday)).toHaveCount(0);
  await page.keyboard.press("Enter");

  const dialog = confirmDialog(page);
  await expect(dialog).toContainText(`${wo.code} ${pkt.station} adımı ${dm(friday)} → ${dm(monday)} taşınsın mı?`);
  await approve(page, "Taşı");
  await expect.poll(async () => (await plannedDay(page, wo, pkt.seq)).getTime()).toBe(monday.getTime());
  await expect(cell(page, pkt.stationCode, monday).locator(`[data-step-key="${wo.id}:${pkt.seq}"]`)).toBeVisible();
});

test("cuma kartı sağa alınıp Esc: görünüm kaynak haftaya döner, odak kartta, hiçbir şey yazılmaz", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const pkt = wo.steps[4]!;
  await openWeek(page, week);

  await card(page, wo, pkt.seq).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(new RegExp(`hafta=${dayKey(plusDays(week, 7))}`));
  // Hedef hücredeki gölge kart odakta: odak body'ye düşmez.
  await expect(page.locator("[data-ghost]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`hafta=${dayKey(week)}`));
  await expect(announcer(page)).toContainText("vazgeçildi");
  await expect(card(page, wo, pkt.seq)).toBeFocused();
  expect(await moves(page, wo)).toBe(0);
  expect((await plannedDay(page, wo, pkt.seq)).getTime()).toBe(plusDays(week, 4).getTime());
});

test("tutarken kaynak haftaya geri dönülünce odak kaynak kartta", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const pkt = wo.steps[4]!;
  await openWeek(page, week);

  await card(page, wo, pkt.seq).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-ghost]")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(new RegExp(`hafta=${dayKey(week)}`));
  await expect(card(page, wo, pkt.seq)).toBeFocused();
  await expect(card(page, wo, pkt.seq)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  expect(await moves(page, wo)).toBe(0);
});

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test("Tab ya da Ctrl+K tutmayı bırakır ama odağı karta geri çekmez", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!;
  await openWeek(page, week);

  const kenar = card(page, wo, knr.seq);
  await kenar.focus();
  await page.keyboard.press("Space");
  await expect(kenar).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(announcer(page)).toContainText("vazgeçildi");
  await expect(kenar).not.toHaveAttribute("aria-pressed", "true");
  // Geri çekme olsaydı sonraki karelerde olurdu.
  await twoFrames(page);
  await expect(kenar).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);

  await kenar.focus();
  await page.keyboard.press("Space");
  await expect(kenar).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+k");
  const input = page.getByRole("dialog", { name: "Ara ve git" }).getByRole("combobox");
  await expect(input).toBeFocused();
  await twoFrames(page);
  await expect(input).toBeFocused();
  // Palette basılan oklar artık tutmaya gitmez.
  await page.keyboard.press("ArrowDown");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await moves(page, wo)).toBe(0);
});

test("planlanmamış sayısı iş emri listesinin planlanmamış süzgeciyle aynı", async ({ page }) => {
  await loginAs(page, "Zeynep Arıkan");
  // Örnek veriden bağımsız: iki açık iş emrinin birer adımının günü silinir (en az iki planlanmamış).
  await sql(
    page,
    `update work_order_steps set planned_day = null where id in (
       select id from (select distinct on (s.work_order_id) s.id from work_order_steps s join work_orders w on w.id = s.work_order_id
        where w.status in ('planned', 'in_progress') and s.started_at is null and s.planned_day is not null
        order by s.work_order_id, s.seq desc) x limit 2)`,
  );
  const expected = (
    await one<{ n: number }>(
      page,
      `select count(*)::int as n from work_orders w where w.status in ('planned', 'in_progress')
         and exists (select 1 from work_order_steps s where s.work_order_id = w.id and s.planned_day is null)`,
    )
  ).n;
  expect(expected).toBeGreaterThanOrEqual(2);
  await openWeek(page, nextWeek());

  const stat = page.getByRole("link", { name: /Planlanmamış/ });
  await expect(stat).toHaveAttribute("href", "/uretim/is-emirleri?planlanmamis=1");
  await expect(stat.getByTestId("stat-value")).toHaveText(String(expected));
  await stat.click();
  await expect(page).toHaveURL(/\/uretim\/is-emirleri\?planlanmamis=1/);
  const rows = page.getByRole("table", { name: "İş emirleri" }).locator("tbody tr");
  await expect.poll(() => rows.count()).toBe(expected);
  // Süzgeç görünür ve kaldırılabilir.
  const chip = page.getByRole("button", { name: /Planlanmamış/ });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(page).not.toHaveURL(/planlanmamis/);
  await expect(chip).toHaveCount(0);
  await expect.poll(() => rows.count()).toBeGreaterThan(expected);
});

test("satış kullanıcısı ızgarayı görür ama sürükleyemez", async ({ page }) => {
  await loginAs(page, "Elif Karaca");
  const week = nextWeek();
  const wo = await prepareOrder(page, week);
  const knr = wo.steps[1]!;

  // Menüde Üretim grubunda, İş emirleri'nden sonra.
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "Haftalık plan", exact: true })).toBeVisible();
  await openWeek(page, week);

  const readOnly = card(page, wo, knr.seq);
  await expect(readOnly).toBeVisible();
  await expect(readOnly).not.toHaveAttribute("aria-roledescription", "taşınabilir kart");
  await drag(page, readOnly, cell(page, knr.stationCode, plusDays(week, 2)));
  await expect(confirmDialog(page)).toHaveCount(0);
  expect((await plannedDay(page, wo, knr.seq)).getTime()).toBe(plusDays(week, 1).getTime());

  // Başlıktaki planlanmamış sayısı iş emirleri listesine götürür.
  const unscheduled = page.getByRole("link", { name: /Planlanmamış/ });
  await expect(unscheduled).toHaveAttribute("href", "/uretim/is-emirleri?planlanmamis=1");

  // Hafta seçimi: Sonraki ve Bu hafta adresi değiştirir.
  await page.getByRole("button", { name: "Sonraki hafta" }).click();
  await expect(page).toHaveURL(new RegExp(`hafta=${dayKey(plusDays(week, 7))}`));
  await page.getByRole("button", { name: "Bu hafta" }).click();
  await expect(page).not.toHaveURL(/hafta=/);
  const today = new Date();
  const weekday = new Date(today.getTime() + OFFSET_MS).getUTCDay();
  if (weekday >= 1 && weekday <= 5) await expect(page.locator(`[data-day="${dayKey(today)}"]`)).toHaveAttribute("aria-current", "date");

  // Kartı tıklamak iş emri çekmecesini açar.
  await openWeek(page, week);
  await card(page, wo, knr.seq).click();
  await expect(page).toHaveURL(new RegExp(`/uretim/is-emirleri\\?ac=${wo.id}`));
  await expect(page.getByRole("dialog", { name: wo.code })).toBeVisible();
});

test("özet bandı daraltılınca ızgara büyür; seçim yenilemede kalır", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "Zeynep Arıkan");
  await openWeek(page, nextWeek());
  const scroller = page.locator("[data-plan-scroll]");
  const before = await settledHeight(scroller);
  await page.getByRole("button", { name: "Özeti gizle" }).click();
  await expect(page.getByRole("button", { name: "Özeti göster" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => settledHeight(scroller)).toBeGreaterThan(before + 60);
  await page.reload();
  await expect(page.getByRole("button", { name: "Özeti göster" })).toBeVisible({ timeout: 45_000 });
});

test("390 px'te sayfa taşmaz, ızgara kendi içinde kayar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "Zeynep Arıkan");
  const week = nextWeek();
  await prepareOrder(page, week);
  await openWeek(page, week);

  const scroller = page.locator("[data-plan-scroll]");
  await expect(scroller).toHaveClass(/scroll-x/);
  await expect.poll(() => scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 100)).toBe(true);
  await expect(scroller).toHaveAttribute("data-fade-right", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const main = page.getByRole("main");
  expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
