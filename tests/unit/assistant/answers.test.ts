import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import type { Ctx } from "@/domain/context";
import { addLine, confirmOrder, createOrder } from "@/domain/sales/orders";
import { answerIntent, answerText, categoryReply, type CardData, type ChipData, type Part, type Reply, UNSURE_TEXT } from "@/assistant/answers";
import { visibleCategories } from "@/assistant/intents";
import { addBomLine, addCustomer, addMaterial, addProduct, addRouting, addStation, addSupplier, addUser, ctxFor } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

let db: Db;
let satis: Ctx;
let depo: Ctx;
let productId: string;

const day = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);
const card = (r: Reply): CardData => (r.parts.find((p): p is Extract<Part, { type: "card" }> => p.type === "card") as { card: CardData }).card;
const chips = (r: Reply): ChipData[] => (r.parts.find((p): p is Extract<Part, { type: "chips" }> => p.type === "chips") as { chips: ChipData[] }).chips;

beforeEach(async () => {
  db = await createTestDb();
  satis = ctxFor(db, await addUser(db, "satis", "uzman", { name: "Selin Aksoy" }));
  depo = ctxFor(db, await addUser(db, "depo", "operator", { name: "Burak Şen" }));
  productId = (await addProduct(db, { name: "Adım Ayakkabılık" })).id;
  await addRouting(db, { productId, seq: 1, stationId: (await addStation(db)).id, minutesPerUnit: 10 });
  const mat = await addMaterial(db, { unit: "plaka" });
  await addBomLine(db, { productId, materialId: mat.id, qtyMilli: 1000 });
});

async function order(name: string, due = "2026-12-15", confirm = false) {
  const customer = await addCustomer(db, { name });
  const o = await createOrder(satis, { customerId: customer.id, dueAt: day(due) });
  await addLine(satis, { orderId: o.id, productId, qtyMilli: 1000 });
  if (confirm) await confirmOrder(satis, o.id);
  return o;
}

test("geciken siparişler: kart, sayı, Aç bağlantısı, süzgeçli Hepsini gör ve Menü çipi", async () => {
  const late = await order("Geç Müşteri", "2026-12-15", true);
  await order("Taslak Müşteri");
  const later = { ...satis, now: day("2027-01-10") };
  const r = await answerIntent(later, "overdue_orders");
  const c = card(r);
  expect(c.title).toBe("Geciken siparişler");
  expect(c.count).toBe(1);
  expect(c.rows[0]).toMatchObject({ code: late.code, name: "Geç Müşteri", href: `/satis/siparisler?ac=${late.id}` });
  expect(c.rows[0]!.chip?.tone).toBe("danger");
  expect(c.more?.href).toBe("/satis/siparisler?geciken=1");
  expect(chips(r).at(-1)?.label).toBe("⌂ Menü");
});

test("boş sonuç dostça bir cümle verir, Hepsini gör bağlantısı vermez", async () => {
  const c = card(await answerIntent(satis, "overdue_orders"));
  expect(c.count).toBe(0);
  expect(c.rows).toHaveLength(0);
  expect(c.more).toBeUndefined();
  expect(c.empty).toContain("Geciken sipariş yok");
});

test("kartta en çok 5 satır; sayı toplamı gösterir", async () => {
  for (let i = 0; i < 7; i++) await order(`Müşteri ${i}`);
  const c = card(await answerIntent(satis, "draft_orders"));
  expect(c.count).toBe(7);
  expect(c.rows).toHaveLength(5);
  expect(c.more?.href).toBe("/satis/siparisler?durum=draft");
});

test("kritik stok: yalnızca sipariş noktasının altındakiler; önerilen devam çipleri", async () => {
  const low = await addMaterial(db, { code: "MLZ-9001", name: "Düşük Meşe", onHandMilli: 1000, reorderPointMilli: 5000 });
  await addMaterial(db, { code: "MLZ-9002", name: "Bol Ceviz", onHandMilli: 9000, reorderPointMilli: 1000 });
  const r = await answerIntent(satis, "critical");
  const c = card(r);
  expect(c.rows.map((x) => x.code)).toEqual(["MLZ-9001"]);
  expect(c.rows[0]!.href).toBe(`/stok/malzemeler?ac=${low.id}`);
  expect(c.more?.href).toBe("/stok/malzemeler?kritik=1");
  expect(chips(r).map((x) => x.label)).toEqual(expect.arrayContaining(["Satın alma önerileri", "Malzeme ara", "⌂ Menü"]));
});

test("boşluk doldurma: girdi sorulur, son kayıtlar çip olur; sonraki yazı boşluğu doldurur", async () => {
  const o = await order("Anadolu Mobilya");
  const ask = await answerIntent(satis, "order_lookup");
  expect(ask.slot).toBe("order_lookup");
  expect(ask.parts[0]).toEqual({ type: "text", text: "Sipariş kodu ya da müşteri adı yazın" });
  expect(chips(ask).map((x) => x.label)).toContain(o.code);

  const filled = await answerText(satis, "anadolu", "order_lookup");
  expect(card(filled).rows[0]).toMatchObject({ code: o.code, name: "Anadolu Mobilya" });
  expect(filled.slot).toBeNull();

  const none = await answerText(satis, "zzzz yok", "order_lookup");
  expect(card(none).count).toBe(0);
  expect(none.slot).toBe("order_lookup");
});

test("serbest yazı: yazım hatası, kod, ad parçası ve anlaşılmayan metin", async () => {
  await addMaterial(db, { code: "MLZ-9001", name: "Düşük Meşe", onHandMilli: 1000, reorderPointMilli: 5000 });
  const o = await order("Kuzey Ofis");
  expect(card(await answerText(satis, "krtik stok")).title).toBe("Kritik stok");
  expect(card(await answerText(satis, o.code.toLowerCase())).rows[0]!.code).toBe(o.code);
  expect(card(await answerText(satis, "SIP-2026-9999")).empty).toContain("bulunamadı");
  const byName = card(await answerText(satis, "kuzey"));
  expect(byName.rows[0]).toMatchObject({ name: "Kuzey Ofis" });
  const gib = await answerText(satis, "qwzx plk");
  expect(gib.parts[0]).toEqual({ type: "text", text: UNSURE_TEXT });
  expect(chips(gib).length).toBeGreaterThanOrEqual(4);
});

test("selam menüyü getirir; teşekkür kısa cevap verir", async () => {
  const hi = await answerText(satis, "merhaba");
  expect(hi.parts.some((p) => p.type === "menu")).toBe(true);
  expect(JSON.stringify(hi.parts[0])).toContain("Selin");
  const thanks = await answerText(satis, "teşekkürler");
  expect(JSON.stringify(thanks.parts[0])).toContain("Rica ederim");
});

test("rehber: adımlar ve ekrana bağlantı; günün özeti yetkiye göre satır verir", async () => {
  const g = card(await answerIntent(satis, "howto_order"));
  expect(g.steps?.length).toBeGreaterThan(2);
  expect(g.more?.href).toBe("/satis/siparisler");
  const s = card(await answerIntent(satis, "summary"));
  expect(s.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["Açık sipariş", "Kritik malzeme"]));
});

test("tedarikçi ve müşteri arama kartları", async () => {
  const t = await addSupplier(db, { name: "Marmara Kereste" });
  const c = card(await answerText(depo, "tedarikçi ara Marmara"));
  expect(c.rows[0]).toMatchObject({ code: t.code, href: `/satin-alma/tedarikciler?ac=${t.id}` });
});

test("menü yetkiye göre: kategori alt menüsünde yazma seçeneği operatöre çıkmaz", async () => {
  expect(visibleCategories(depo.user)).toHaveLength(6);
  const sales = chips(categoryReply(satis.user, "satis")).map((x) => x.label);
  expect(sales).toContain("Yeni sipariş aç");
  expect(chips(categoryReply(depo.user, "satis")).map((x) => x.label)).not.toContain("Yeni sipariş aç");
  expect(sales.at(-1)).toBe("⌂ Menü");
});

test("boşlukta bekleyen yazı niyete uyuyorsa boşluktan çıkar: Sipariş sorgula → kritik stok", async () => {
  await addMaterial(db, { code: "MLZ-9001", name: "Düşük Meşe", onHandMilli: 1000, reorderPointMilli: 5000 });
  const ask = await answerIntent(satis, "order_lookup");
  expect(ask.slot).toBe("order_lookup");
  const r = await answerText(satis, "kritik stok", ask.slot);
  expect(card(r).title).toBe("Kritik stok");
  expect(r.slot).toBeNull();
  // Uymayan yazı boşlukta kalır.
  const miss = await answerText(satis, "zzzz yok", "order_lookup");
  expect(miss.slot).toBe("order_lookup");
  expect(card(miss).emptyTone).toBe("none");
});

test("boşlukta teşekkür: kısa cevap verir ve boşluğu kapatır", async () => {
  const r = await answerText(satis, "teşekkürler", "order_lookup");
  expect(JSON.stringify(r.parts[0])).toContain("Rica ederim");
  expect(r.slot).toBeNull();
});

test("MUS- müşteri kodu kayıt kartı verir", async () => {
  const c = await addCustomer(db, { name: "Kod Müşteri" });
  const r = card(await answerText(satis, c.code.toLowerCase()));
  expect(r.rows[0]).toMatchObject({ code: c.code, name: "Kod Müşteri", href: `/satis/musteriler?ac=${c.id}` });
});

test("kritik stok satırı: kullanılabilir miktar çip, eldeki ve ayrılmış alt satır", async () => {
  await addMaterial(db, { code: "MLZ-9005", name: "Ayrılmış Meşe", unit: "plaka", onHandMilli: 25_000, reservedMilli: 25_000, reorderPointMilli: 5000 });
  const row = card(await answerIntent(satis, "critical")).rows[0]!;
  expect(row.chip?.label).toBe("Kullanılabilir 0 plaka");
  expect(row.sub).toBe("Eldeki 25 plaka · ayrılmış 25 plaka");
});

test("süzgeci olmayan listelerde bağlantı 'Listeyi aç' der", async () => {
  await order("Geç", "2026-12-15", true);
  const wo = card(await answerIntent({ ...satis, now: day("2027-01-10") }, "late_wo"));
  expect(wo.more === undefined || wo.more.label === "Listeyi aç →").toBe(true);
  expect(card(await answerIntent(satis, "po_late")).more?.label ?? "Listeyi aç →").toBe("Listeyi aç →");
});
