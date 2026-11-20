import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { answerSimple, parseQuestion } from "@/assistant/simple";
import { addMaterial, addUser } from "../../helpers/fixtures";
import { createTestDb } from "../../helpers/testDb";

test.each([
  ["Kritik stok neler?", { kind: "critical" }],
  ["KRİTİK STOKTAKİ MALZEMELER", { kind: "critical" }],
  ["geciken siparişler", { kind: "overdue" }],
  ["Gecikmiş sipariş var mı", { kind: "overdue" }],
  ["bugünün iş emirleri", { kind: "today" }],
  ["BUGÜN hangi iş emirleri var?", { kind: "today" }],
  ["sip-2026-0031 durumu nedir", { kind: "code", code: "SIP-2026-0031" }],
  ["IE-2026-0007 ne durumda", { kind: "code", code: "IE-2026-0007" }],
  ["sas 2026 0004 nerede", { kind: "code", code: "SAS-2026-0004" }],
  ["MLZ-0012 stoğu", { kind: "code", code: "MLZ-0012" }],
  ["Meşe masif stoğu ne kadar", { kind: "material", term: "mese masif" }],
  ["menteşe stok durumu", { kind: "material", term: "mentese" }],
  ["Sipariş nasıl açılır?", { kind: "howto", topic: "siparis" }],
  ["iş emri nasıl planlanır", { kind: "howto", topic: "plan" }],
  ["Satın alma nasıl yapılır", { kind: "howto", topic: "satin-alma" }],
  ["MAL KABUL NASIL YAPILIR", { kind: "howto", topic: "mal-kabul" }],
  ["sayım nasıl yapılır", { kind: "howto", topic: "sayim" }],
  ["merhaba", { kind: "help" }],
] as const)("soru kalıbı: %s", (question, expected) => {
  expect(parseQuestion(question)).toEqual(expected);
});

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

test("kritik stok: yalnızca sipariş noktasının altındakiler, bağlantılı", async () => {
  const low = await addMaterial(db, { code: "MLZ-9001", name: "Düşük Meşe", onHandMilli: 1000, reorderPointMilli: 5000 });
  await addMaterial(db, { code: "MLZ-9002", name: "Bol Ceviz", onHandMilli: 9000, reorderPointMilli: 1000 });
  const answer = await answerSimple(db, "kritik stok", new Date());
  expect(answer).toContain("MLZ-9001");
  expect(answer).toContain(`/stok/malzemeler?ac=${low.id}`);
  expect(answer).not.toContain("MLZ-9002");
});

test("malzeme adıyla stok: Türkçe harf duyarsız", async () => {
  await addMaterial(db, { code: "MLZ-9003", name: "Menteşe 110°", onHandMilli: 4000 });
  const answer = await answerSimple(db, "MENTESE stoğu", new Date());
  expect(answer).toContain("MLZ-9003");
});

test("bilinmeyen kod: bulunamadı der; anlaşılmayan soru yapabildiklerini sayar", async () => {
  await addUser(db, "satis", "uzman");
  expect(await answerSimple(db, "SIP-2026-9999 durumu", new Date())).toContain("bulunamadı");
  const help = await answerSimple(db, "hava nasıl", new Date());
  expect(help).toContain("kritik stok");
  expect(help).toContain("geciken siparişler");
});

test("bugünün iş emirleri: planlı gün bugün olmayan çıkmaz", async () => {
  expect(await answerSimple(db, "bugünün iş emirleri", new Date())).toContain("yok");
});
