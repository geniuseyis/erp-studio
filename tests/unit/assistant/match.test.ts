import { expect, test } from "vitest";
import { INTENTS, followUps, visibleCategories, visibleIntents } from "@/assistant/intents";
import { editDistance, matchText, routeText, tokenScore } from "@/assistant/match";

const all = INTENTS;
const idOf = (text: string) => {
  const m = matchText(text, all);
  return m.kind === "intent" ? m.id : m.kind;
};

test.each([
  ["geciken siparişler", "overdue_orders"],
  ["Gecikmiş siparişleri göster", "overdue_orders"],
  ["geç kalan siparişler hangileri", "overdue_orders"],
  ["teslim edilmeyen siparişler", "overdue_orders"],
  ["gecikn siparisler", "overdue_orders"],
  ["taslak siparişler", "draft_orders"],
  ["onay bekleyen siparişler", "draft_orders"],
  ["malzeme bekleyen siparişler", "waiting_orders"],
  ["kritik stok", "critical"],
  ["krtik stok", "critical"],
  ["KRİTİK STOKTAKİ MALZEMELER", "critical"],
  ["ne bitti", "critical"],
  ["azalan malzemeler", "critical"],
  ["eksik malzeme var mı", "critical"],
  ["bugünün iş emirleri", "today_wo"],
  ["bugunku is emri", "today_wo"],
  ["planlanmamış iş emirleri", "unscheduled_wo"],
  ["plansız iş emirleri", "unscheduled_wo"],
  ["termine yetişmeyenler", "late_wo"],
  ["son stok hareketleri", "recent_movements"],
  ["satın alma önerileri", "po_suggestions"],
  ["ne satın almalıyız", "po_suggestions"],
  ["geciken teslimler", "po_late"],
  ["mal kabul bekleyenler", "receivable"],
  ["günün özeti", "summary"],
  ["genel durum", "summary"],
  ["sipariş nasıl açılır?", "howto_order"],
  ["mal kabul nasıl yapılır", "howto_receiving"],
  ["sayım nasıl yapılır", "howto_count"],
  ["yeni sipariş aç", "new_order"],
  ["haftalık plan", "plan_link"],
])("serbest yazı: %s → %s", (text, id) => {
  expect(idOf(text)).toBe(id);
});

test("selam, teşekkür ve menü istekleri", () => {
  expect(matchText("Merhaba", all).kind).toBe("greeting");
  expect(matchText("selam", all).kind).toBe("greeting");
  expect(matchText("teşekkürler", all).kind).toBe("thanks");
  expect(matchText("sağ ol", all).kind).toBe("thanks");
  expect(matchText("menü", all).kind).toBe("menu");
  expect(matchText("neler yapabilirsin", all).kind).toBe("menu");
});

test("kayıt kodları", () => {
  expect(matchText("sip-2026-0031 durumu nedir", all)).toEqual({ kind: "code", code: "SIP-2026-0031", entity: "order" });
  expect(matchText("IE 2026 0007", all)).toEqual({ kind: "code", code: "IE-2026-0007", entity: "workorder" });
  expect(matchText("sas-2026-0004 nerede", all)).toEqual({ kind: "code", code: "SAS-2026-0004", entity: "po" });
  expect(matchText("MLZ-0012 stoğu", all)).toEqual({ kind: "code", code: "MLZ-0012", entity: "material" });
  expect(matchText("ted 3", all)).toEqual({ kind: "code", code: "TED-0003", entity: "supplier" });
  expect(matchText("urn-0031", all)).toEqual({ kind: "code", code: "URN-0031", entity: "product" });
});

test("malzeme adıyla sorulunca boşluk satır içinde dolar", () => {
  expect(matchText("Meşe masif stoğu ne kadar", all)).toEqual({ kind: "intent", id: "material_search", term: "mese masif" });
});

test("emin olunamayınca en olası 3 seçenek önerilir; kesin sözcük istenmez", () => {
  const gib = matchText("asdkjh qwe", all);
  expect(gib.kind).toBe("unsure");
  if (gib.kind === "unsure") expect(gib.suggestions).toHaveLength(3);
  const vague = matchText("geciken", all);
  expect(vague.kind).toBe("unsure");
  if (vague.kind === "unsure") expect(vague.suggestions).toEqual(expect.arrayContaining(["overdue_orders"]));
  const name = matchText("Anadolu mobilya", all);
  expect(name).toMatchObject({ kind: "unsure", term: "anadolu mobilya" });
});

test("yazım hatası payı: 4-7 harfte 1, daha uzunda 2", () => {
  expect(tokenScore("krtik", "kritik")).toBe(0.8);
  expect(tokenScore("kritk", "kritik")).toBe(0.8);
  expect(tokenScore("kxxtik", "kritik")).toBe(0);
  expect(tokenScore("siparisleri", "siparis")).toBe(0.95);
  expect(tokenScore("sipraisler", "siparis")).toBe(0.8);
  expect(tokenScore("abc", "abd")).toBe(0);
  expect(editDistance("emri", "emir")).toBe(1);
});

test("yetki: işlem yetkisi olmayan kişi yazma seçeneklerini görmez", () => {
  const depo = { departmentCode: "depo", level: "operator" } as const;
  const satis = { departmentCode: "satis", level: "uzman" } as const;
  const bt = { departmentCode: "bt", level: "mudur" } as const;
  expect(visibleIntents(depo).some((i) => i.id === "new_order")).toBe(false);
  expect(visibleIntents(satis).some((i) => i.id === "new_order")).toBe(true);
  expect(visibleIntents(satis).some((i) => i.id === "howto_user")).toBe(false);
  expect(visibleIntents(bt).some((i) => i.id === "howto_user")).toBe(true);
  expect(visibleCategories(depo)).toHaveLength(6);
  expect(followUps(depo, "howto_order").map((i) => i.id)).not.toContain("new_order");
  // Görünmeyen seçenek serbest yazıda da eşleşmez.
  expect(idOf("yeni sipariş aç")).toBe("new_order");
  expect(matchText("yeni sipariş aç", visibleIntents(depo))).not.toMatchObject({ id: "new_order" });
});

test("katalog en az 25 seçenek içerir", () => {
  expect(INTENTS.length).toBeGreaterThanOrEqual(25);
});

test("boşluk doldurma: bekleyen boşluk varken serbest yazı boşluğu doldurur", () => {
  expect(routeText("Anadolu", all, "order_lookup")).toEqual({ kind: "slot_fill", id: "order_lookup", term: "Anadolu" });
  expect(routeText("kritik stok", all, "order_lookup")).toEqual({ kind: "slot_fill", id: "order_lookup", term: "kritik stok" });
  expect(routeText("SIP-2026-0003", all, "customer_search").kind).toBe("code");
  expect(routeText("menü", all, "order_lookup").kind).toBe("menu");
  expect(routeText("kritik stok", all, null)).toMatchObject({ kind: "intent", id: "critical" });
});
