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
const CHECKED = { sayfa: "ürün sayfası okundu", özet: "arama özeti" };
const tl = (n) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const page = SEED_MATERIALS.filter((m) => m.source?.checked === "sayfa");
const snippet = SEED_MATERIALS.filter((m) => m.source?.checked === "özet");
const estimated = SEED_MATERIALS.filter((m) => !m.source);

const basis = (m) =>
  m.source
    ? `[${m.source.site}](${m.source.url}): ${m.source.note}${m.source.vat === "dahil" ? " → KDV'siz" : ""}`
    : `tahmin: ${m.estimate ?? "dayanak yazılmamış"}`;
const rows = SEED_MATERIALS.map(
  (m) =>
    `| ${m.name} | ${CATEGORY[m.category]} | ${tl(m.price)} TL / ${UNIT[m.unit]} | ${basis(m)} | ${
      m.source ? CHECKED[m.source.checked] : "tahmin"
    } |`,
);

const out = `# Örnek verinin kaynakları

Bu dosya \`node scripts/gen-data-sources.mjs\` ile \`src/seed/data/materials.ts\` içinden üretilir; elle düzenlemeyin.

## Özet

- Fiyat araması tarihi: **2026-11-16**. Yalnızca Türkiye'deki, Türkçe kaynaklar kullanıldı.
- ${SEED_MATERIALS.length} malzemeden **${page.length}** tanesinin fiyatı ürün ya da liste sayfası açılıp okunarak, **${
  snippet.length
}** tanesininki arama sonucu özetinden alındı; **${estimated.length}** tanesi tahmindir ve tahminin dayanağı tabloda yazılıdır.
- "Arama özeti" olan kaynakların çoğu Koçtaş, Cimri ve Hepsiburada'dır: bu siteler otomatik sayfa okumayı reddediyor (HTTP 403), bu yüzden fiyat ürün sayfasında doğrulanamadı.
- Kaynak bir aralık veriyorsa alt sınır alındı; liste fiyatı ile sepet indirimi ayrı gösteriliyorsa liste fiyatı alındı.
- İlanlar değişebilir; fiyatlar gerçek bir satın alma teklifi yerine geçmez. Arayüzde bütün fiyatlar "örnek veri" olarak etiketlenir.

## KDV

- **Katalogdaki birim fiyatlar KDV hariçtir.** Mobilya üreticisi satın aldığı malzemenin KDV'sini indirim konusu yapar, bu yüzden maliyet KDV'siz tutulur.
- Kaynakta KDV dahil görünen (ya da KDV yazmayan perakende) fiyatlar genel oran olan **%20**'ye göre 1,20'ye bölündü. Malzeme, parça ve aksesuar teslimleri genel orana tabidir.
- Bakanlık rayiçleri zaten KDV hariçtir: listenin kendi notu "Bu listelerde yer alan değerlere KDV dahil değildir."
- **Mobilya satışında KDV %10'dur.** Dayanak: KDV oranları kararına ekli (II) sayılı listenin 33. sırası (1994 sayılı Cumhurbaşkanı Kararı, 2 Ocak 2020; oran 7346 sayılı Kararla 10 Temmuz 2023'ten beri %10). Sıra 9401 (oturma mobilyaları, döşemeli olanlar dahil), 9403.10–9403.89 (ahşap, metal ve plastik mobilyalar) ve 9404.10, 9404.21, 9404.29 (şilte ve şilte mesnetleri) pozisyonlarını kapsar. Kaynak: [GİB, Güncel KDV oranları](https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fkdv-oranlari.pdf) (10/07/2023 itibarıyla güncel liste). 2024–2026 tarihli muhasebe kaynaklarında bu orana dair bir değişiklik geçmiyor.
- Mobilya parçaları ve aksesuarları (9401.90, 9403.90), montaj, nakliye ve tamir hizmetleri listede olmadığı için **%20**'dir.

## Ölçüler

Plaka ölçüleri (2100×2800 mm; 8, 18 ve 19 mm), kenar bandı kesitleri (22×0,4, 22×0,8, 22×2, 43×2 mm), menteşe açısı ve çanak çapı (110°, 35 mm) ile ray boyları (45 ve 50 cm) piyasada satılan standart ölçülerdir.

## Kişiler ve firmalar

Demo hesaplarındaki çalışan adları kurgusaldır. E-postalar \`@baltacioglus.example\` alanındadır; \`.example\` gerçek bir alan adı olarak tescil edilemez.

## Malzeme fiyatları

| Malzeme | Kategori | Birim fiyat (KDV hariç) | Dayanak | Doğrulama |
|---|---|---|---|---|
${rows.join("\n")}

## Bulunan ama kullanılmayan veriler

- 18 mm suntalam için kaynaklar geniş bir aralık veriyor: [Bauhaus](https://www.bauhaus.com.tr/suntalam-2100-2800-18mm-441-flora-1-plaka-588m2-61537949) 1.150 TL (Flora desen, 1 plaka), [Kaplan Orman](https://www.kaplanormanurunleri.com/) 2.300 TL (beyaz), [Haber Gazetesi](https://www.habergazetesi.com.tr/sunta-fiyatlari) 2.150–2.550 TL (çift yüz beyaz, Ocak 2026). Tarihli ve aralığın ortasında kaldığı için MDF Marketi'nin 1.750 TL'si kullanıldı.
- [Bauhaus](https://www.bauhaus.com.tr/mdflam-2100-2800-18-mm-parlak-beyaz-cy-61514960) parlak beyaz MDFlam için 1.590 TL gösteriyor, ancak sayfa "fiyat metrekare cinsinden hesaplanmaktadır" diyor ve fiyatın plaka mı metrekare mi olduğu anlaşılmıyor; kullanılmadı.
- Kereste için [Haber Gazetesi](https://www.habergazetesi.com.tr/kereste-fiyatlari) meşeye 17.000–20.000 TL/m³ veriyor; Bakanlık rayici (19.200 TL/m³) bu aralığın içinde kaldığı için resmî kaynak tercih edildi.
- Bakanlık rayiçleri aylık güncelleniyor; katalogdaki rakamlar 1 Ocak 2026 listesindendir. Ekim–Kasım 2026 listelerinin PDF'ine ulaşılamadı.
`;

writeFileSync("docs/DATA_SOURCES.md", out);
console.log(
  `DATA_SOURCES.md: ${SEED_MATERIALS.length} kalem; ${page.length} sayfa, ${snippet.length} özet, ${estimated.length} tahmin`,
);
