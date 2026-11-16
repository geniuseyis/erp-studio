// docs/DATA_SOURCES.md dosyasını src/seed/data/materials.ts içindeki katalogdan üretir: node scripts/gen-data-sources.mjs
import { writeFileSync } from "node:fs";
import { SEED_MATERIALS } from "../src/seed/data/materials.ts";

const CATEGORY = {
  panel: "Panel",
  masif: "Masif",
  kenar_bandi: "Kenar bandı",
  hirdavat: "Hırdavat",
  boya: "Boya ve kimyasal",
  kumas: "Kumaş",
  ambalaj: "Ambalaj",
};
const UNIT = { plaka: "plaka", m2: "m²", m: "m", m3: "m³", adet: "adet", L: "L", kg: "kg" };
const tl = (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sourced = SEED_MATERIALS.filter((m) => m.source);
const rows = SEED_MATERIALS.map(
  (m) =>
    `| ${m.name} | ${CATEGORY[m.category]} | ${tl(m.price)} TL / ${UNIT[m.unit]} | ${
      m.source ? `[${m.source.site}](${m.source.url}): ${m.source.note}` : "tahmin"
    } |`,
);

const out = `# Örnek verinin kaynakları

Bu dosya \`node scripts/gen-data-sources.mjs\` ile \`src/seed/data/materials.ts\` içinden üretilir; elle düzenlemeyin.

## Özet

- Fiyat araması tarihi: **2026-11-15**.
- ${SEED_MATERIALS.length} malzemeden **${sourced.length}** tanesinin fiyatı herkese açık bir ilana dayanır, **${
  SEED_MATERIALS.length - sourced.length
}** tanesi tahmindir.
- Kaynaklı fiyatlar web aramasının sonuç özetlerinden alındı; ürün sayfaları tek tek açılıp doğrulanmadı. İlanlar tarihsizdir ve değişmiş olabilir.
- Tahminler, aynı gruptaki kaynaklı kalemden ya da genel piyasa bilgisinden türetilmiştir ve gerçek fiyat teklifi yerine geçmez.
- Arayüzde bütün fiyatlar "örnek veri" olarak etiketlenir.

## Ölçüler

Plaka ölçüleri (2100×2800 mm; 8, 18 ve 19 mm), kenar bandı kesitleri (22×0,4, 22×0,8, 22×2, 43×2 mm), menteşe açısı ve çanak çapı (110°, 35 mm) ile ray boyları (45 ve 50 cm) piyasada satılan standart ölçülerdir.

## Kişiler ve firmalar

Demo hesaplarındaki çalışan adları kurgusaldır. E-postalar \`@baltacioglus.example\` alanındadır; \`.example\` gerçek bir alan adı olarak tescil edilemez.

## Malzeme fiyatları

| Malzeme | Kategori | Birim fiyat | Dayanak |
|---|---|---|---|
${rows.join("\n")}

## Bulunan ama kullanılmayan veriler

- Meşe kereste için [habergazetesi.com.tr](https://www.habergazetesi.com.tr/kereste-fiyatlari) sayfası 17.000–20.000 TL/m³ veriyor. Sayfanın güncelliği belirsiz ve rakam fırınlanmış birinci sınıf meşe için düşük göründüğünden kullanılmadı; meşe ve ceviz fiyatları tahmindir.
- Frenli menteşe için Koçtaş ilanlarında ([Samet Master](https://www.koctas.com.tr/samet-master-frenli-duz-mentese-havsali/p/5000737665)) 193,43 TL ve 791,44 TL görünüyor, ancak paket adedi arama özetinden anlaşılamadı; menteşe adet fiyatı tahmindir.
`;

writeFileSync("docs/DATA_SOURCES.md", out);
console.log(`DATA_SOURCES.md: ${SEED_MATERIALS.length} kalem, ${sourced.length} kaynaklı`);
