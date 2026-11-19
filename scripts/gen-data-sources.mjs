// docs/DATA_SOURCES.md dosyasını src/seed/data/materials.ts ve products.ts'ten üretir: node scripts/gen-data-sources.mjs
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { SEED_CUSTOMERS } from "../src/seed/data/customers.ts";
import { SEED_MATERIALS } from "../src/seed/data/materials.ts";

// src içindeki modüller uzantısız içe aktarır (./materials) ve JSON'u özniteliksiz yükler; Node ikisini de
// kendiliğinden çözmez. Bu kanca yalnızca bu betik için .ts uzantısını ekler ve JSON'u JSON olarak yükletir.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".json")) return { ...nextResolve(specifier, context), importAttributes: { type: "json" } };
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { SEED_SUPPLIERS } = await import("../src/seed/data/suppliers.ts");
const { LABOR_KURUS_PER_MINUTE, SEED_PRODUCTS, STATIONS, unitCostKurus } = await import("../src/seed/data/products.ts");

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

const FINISH = { beyaz: "Beyaz", ahsap: "Ahşap" };
const kurus = (n) => `${tl(n / 100)} TL`;
const productRows = SEED_PRODUCTS.map(
  (p) =>
    `| ${p.code} | ${p.name} | ${FINISH[p.finish]} | ${kurus(unitCostKurus(p.bom, p.routing))} | ${kurus(p.priceKurus)} | %${p.vatRate} |`,
);
const stationList = STATIONS.map((s) => `${s.name} (${s.dailyCapacityMin} dk/gün)`).join(", ");
const vat20 = [...new Set(SEED_PRODUCTS.filter((p) => p.vatRate === 20).map((p) => `"${p.category}"`))].join(", ");
const vat10Count = new Set(SEED_PRODUCTS.filter((p) => p.vatRate === 10).map((p) => p.category)).size;

const out = `# Örnek verinin kaynakları

Bu dosya \`node scripts/gen-data-sources.mjs\` ile \`src/seed/data/materials.ts\` ve \`src/seed/data/products.ts\` içinden üretilir; elle düzenlemeyin.

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

Müşteriler (\`src/seed/data/customers.ts\`, ${SEED_CUSTOMERS.length} kayıt) kurgusaldır: bireysel müşteri adları sık görülen ad ve soyadların rastgele birleşimidir; kurumsal adlar ("… Mimarlık", "… Otelcilik", "… Ofis Mobilyaları") gerçek bir firmaya benzemesin diye sıradan olmayan birleşimlerden seçildi. İl ve ilçe çiftleri gerçektir. Telefonlar \`0 5xx 000 00 NN\` biçimindedir; ortadaki "000 00" bir abone numarasına denk gelmez. Vade bireyselde 0, kurumsalda 30, 45 ya da 60 gündür.

Tedarikçiler (\`src/seed/data/suppliers.ts\`, ${SEED_SUPPLIERS.length} kayıt) kurgusaldır: ad ("Sapanca Yonga Levha" gibi il ya da ilçe ve iş kolu birleşimleri) ve irtibat kişileri gerçek bir firmaya ya da kişiye karşılık gelmesin diye sıradan olmayan birleşimlerden seçildi; il ve ilçeler gerçektir. Telefonlar \`0 2xx 000 00 NN\` biçimindedir. Fiyatlar aşağıdaki malzeme tablosundaki kaynaklı KDV hariç fiyattır: kategorinin tercihli tedarikçisi o fiyatı aynen verir, panel ve hırdavatın alternatif tedarikçileri %6–7 daha pahalıdır. Teslim süresi tedarikçinin tercihli olduğu malzemelerin en kısa süresidir; en az sipariş miktarı birime göre (plaka 10, kenar bandı 500 m, menteşe gibi hırdavat 200 adet, boya 20 L) seçilmiştir.

## Malzeme fiyatları

| Malzeme | Kategori | Birim fiyat (KDV hariç) | Dayanak | Doğrulama |
|---|---|---|---|---|
${rows.join("\n")}

## Ürünler

- Katalog, mobilya sitesinin ürün kitabındaki ${SEED_PRODUCTS.length / 2} modeldir. Her model beyaz ve ahşap kaplamayla iki ayrı ürün olur (${SEED_PRODUCTS.length} ürün). Parça ölçüleri sitenin kendi model üreticilerinden \`npm run catalog:export\` ile \`src/seed/data/catalog.generated.json\` dosyasına aktarılır; reçete, rota, maliyet ve fiyat \`src/seed/data/products.ts\` içindeki kurallarla bu ölçülerden türetilir.
- **İşçilik dakikası 2,91 TL.** 2026 brüt asgari ücreti 33.030,00 TL'dir; imalat sektöründe 5 puanlık SGK işveren teşvikiyle işverene aylık maliyeti 39.223,13 TL'dir. Ayda 225 çalışma saatiyle 39.223,13 ÷ 225 ÷ 60 = 2,905 TL/dk; katalogda ${tl(LABOR_KURUS_PER_MINUTE / 100)} TL/dk kullanılır. Kaynaklar: [PwC, 2026 asgari ücret ve işveren maliyeti](https://www.pwc.com.tr/tr/medya/kose-yazilari/celal-ozcan/2026-yili-asgari-ucreti-ve-sektorlere-gore-isveren-maliyeti.html), [Alo Maliye, 2026 asgari ücreti](https://www.alomaliye.com/2025/12/23/2026-yili-asgari-ucreti-2026-yili-asgari-ucret-bilgilendirme/).
- **Maliyet** = Σ malzeme birim fiyatı (yukarıdaki tablo, KDV hariç) × miktar × (1 + fire) + rota dakikası × 2,91 TL × 2.
- **Varsayım, genel gider:** rota dakikası işçiliğin iki katıyla maliyetlenir; ikinci kat atölye genel gideridir (enerji, makine amortismanı, kira). Oran bir kaynağa dayanmaz.
- **Varsayım, satış fiyatı:** KDV hariç satış fiyatı maliyetin 1,8 katıdır ve 50 TL'ye yukarı yuvarlanır. Oran bir kaynağa dayanmaz.
- **Varsayım, KDV sınıflandırması:** ${vat20} 9403 ve 9401 pozisyonlarındaki mobilyalardan sayılmadı, genel oran olan **%20** uygulanır; diğer ${vat10Count} kategori mobilyadır ve **%10**'dur (yukarıdaki KDV bölümü). Sınıflandırma bir gümrük müşavirine doğrulatılmadı.
- **Hazır alınan parçalar reçeteye girmez:** ayna camı, LED aydınlatma, cam parçalar, metal ayak ve çerçeveler (kızak ve dikme ayaklar) ve beyaz havluluğun çelik boru gövdesi dışarıdan hazır alınır; katalogda fiyatları olmadığı için maliyete katılmadı. Bu yüzden LED aynanın ve beyaz havluluğun fiyatı yalnızca atölyede işlenen parçaları ve ambalajı yansıtır; beyaz havluluğun rotasında yalnızca paketleme vardır. Kuvars tezgâh reçetede ön yüz levhası olarak hesaplanır.
- **Reçete:** plaka miktarı panel alanının 5,88 m²'lik (2100×2800 mm) plakaya bölümüdür; ayaklar hacimle masif keresteden düşülür. Fire oranları levhada %15, masifte %30, kenar bandı ve cilada %10, minifiks ve kavelada %5'tir. Bütün miktarlar 0,01 birime yukarı yuvarlanır.
- **Rota istasyonları:** ${stationList}. Dakikalar panel sayısı, kenar bandı metresi, menteşe ve ray sayısı, cephe sayısı ve ahşapta cilalı alandan hesaplanır. Kapasiteler varsayımdır.

| Kod | Ürün | Kaplama | Birim maliyet (KDV hariç) | Satış fiyatı (KDV hariç) | KDV |
|---|---|---|---|---|---|
${productRows.join("\n")}

## Bulunan ama kullanılmayan veriler

- 18 mm suntalam için kaynaklar geniş bir aralık veriyor: [Bauhaus](https://www.bauhaus.com.tr/suntalam-2100-2800-18mm-441-flora-1-plaka-588m2-61537949) 1.150 TL (Flora desen, 1 plaka), [Kaplan Orman](https://www.kaplanormanurunleri.com/) 2.300 TL (beyaz), [Haber Gazetesi](https://www.habergazetesi.com.tr/sunta-fiyatlari) 2.150–2.550 TL (çift yüz beyaz, Ocak 2026). Tarihli ve aralığın ortasında kaldığı için MDF Marketi'nin 1.750 TL'si kullanıldı.
- [Bauhaus](https://www.bauhaus.com.tr/mdflam-2100-2800-18-mm-parlak-beyaz-cy-61514960) parlak beyaz MDFlam için 1.590 TL gösteriyor, ancak sayfa "fiyat metrekare cinsinden hesaplanmaktadır" diyor ve fiyatın plaka mı metrekare mi olduğu anlaşılmıyor; kullanılmadı.
- Kereste için [Haber Gazetesi](https://www.habergazetesi.com.tr/kereste-fiyatlari) meşeye 17.000–20.000 TL/m³ veriyor; Bakanlık rayici (19.200 TL/m³) bu aralığın içinde kaldığı için resmî kaynak tercih edildi.
- Bakanlık rayiçleri aylık güncelleniyor; katalogdaki rakamlar 1 Ocak 2026 listesindendir. Ekim–Kasım 2026 listelerinin PDF'ine ulaşılamadı.
`;

writeFileSync("docs/DATA_SOURCES.md", out);
console.log(
  `DATA_SOURCES.md: ${SEED_MATERIALS.length} kalem; ${page.length} sayfa, ${snippet.length} özet, ${estimated.length} tahmin; ${SEED_PRODUCTS.length} ürün`,
);
