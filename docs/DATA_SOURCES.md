# Örnek verinin kaynakları

Bu dosya `node scripts/gen-data-sources.mjs` ile `src/seed/data/materials.ts` ve `src/seed/data/products.ts` içinden üretilir; elle düzenlemeyin.

## Özet

- Fiyat araması tarihi: **2026-11-16**. Yalnızca Türkiye'deki, Türkçe kaynaklar kullanıldı.
- 42 malzemeden **14** tanesinin fiyatı ürün ya da liste sayfası açılıp okunarak, **18** tanesininki arama sonucu özetinden alındı; **10** tanesi tahmindir ve tahminin dayanağı tabloda yazılıdır.
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

Demo hesaplarındaki çalışan adları kurgusaldır. E-postalar `@baltacioglus.example` alanındadır; `.example` gerçek bir alan adı olarak tescil edilemez.

## Malzeme fiyatları

| Malzeme | Kategori | Birim fiyat (KDV hariç) | Dayanak | Doğrulama |
|---|---|---|---|---|
| MDF Lam 18 mm Parlak Beyaz 2100×2800 | Panel | 2.500,00 TL / plaka | [Özsoy Orman](https://ozsoyorman.com/urun/mdf-lam-nedir/): MDF Lam 210×280×18 mm, 1 adet: 3.000,00 TL, fiyata KDV dahil → KDV'siz | ürün sayfası okundu |
| MDF Lam 18 mm Antrasit 2100×2800 | Panel | 2.666,67 TL / plaka | [Emek Orman Ürünleri](https://www.emekormanurunleri.com/mdf): 18 mm MDFLAM referans fiyatı 3.200–4.870 TL (KDV dahil, 12 Ekim 2026); renkli plaka için alt sınır alındı → KDV'siz | ürün sayfası okundu |
| Suntalam 18 mm Beyaz 2100×2800 | Panel | 1.458,33 TL / plaka | [MDF Marketi](http://www.mdfmarketi.com/en-ekonomik-mdf-urunleri-en-ucuz-mdf-marketinde/): 18 mm Suntalam 210×280 çift taraf beyaz: 1.750 TL (liste tarihi 12/10/2026; KDV yazmıyor, dahil kabul edildi) → KDV'siz | ürün sayfası okundu |
| Suntalam 18 mm Ceviz Desen 2100×2800 | Panel | 1.958,33 TL / plaka | [Haber Gazetesi](https://www.habergazetesi.com.tr/sunta-fiyatlari): 210×280 cm 18 mm renkli/desenli suntalam: 2.350–2.800 TL (Ocak 2026 ortalaması); alt sınır alındı → KDV'siz | ürün sayfası okundu |
| MDF Lam 8 mm Beyaz Arkalık 2100×2800 | Panel | 1.541,67 TL / plaka | [MDF Marketi](http://www.mdfmarketi.com/en-ekonomik-mdf-urunleri-en-ucuz-mdf-marketinde/): 8 mm MDF LAM 210×280: 1.850 TL (liste tarihi 12/10/2026; KDV yazmıyor, dahil kabul edildi) → KDV'siz | ürün sayfası okundu |
| Ham MDF 18 mm 2100×2800 | Panel | 2.250,00 TL / plaka | [Emek Orman Ürünleri](https://www.emekormanurunleri.com/mdf): Ham MDF 18 mm 210×280 cm: 2.700 TL (KDV dahil referans fiyat, 12 Ekim 2026) → KDV'siz | ürün sayfası okundu |
| Meşe Kaplamalı MDF 19 mm 2100×2800 | Panel | 4.058,33 TL / plaka | tahmin: İlan bulunamadı. Doğal kaplama melamin kaplamadan pahalıdır; Emek Orman'ın 18 mm MDFLAM aralığının üst sınırı (4.870 TL, KDV dahil) alındı. | tahmin |
| Meşe Masif 40 mm, Fırınlanmış | Masif | 19.200,00 TL / m³ | [Çevre, Şehircilik ve İklim Değişikliği Bakanlığı 2026 rayiçleri](https://webdosya.csb.gov.tr/v2/yfk/2026/01/1-BF-202619011535-20260119155143.pdf): 10.130.4507 Meşe kerestesi: 19.200,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim) | ürün sayfası okundu |
| Ceviz Masif 40 mm, Fırınlanmış | Masif | 21.600,00 TL / m³ | [Çevre, Şehircilik ve İklim Değişikliği Bakanlığı 2026 rayiçleri](https://webdosya.csb.gov.tr/v2/yfk/2026/01/1-BF-202619011535-20260119155143.pdf): 10.130.4508 Ceviz kerestesi: 21.600,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim) | ürün sayfası okundu |
| Kayın Masif 50 mm, Fırınlanmış | Masif | 12.000,00 TL / m³ | [Çevre, Şehircilik ve İklim Değişikliği Bakanlığı 2026 rayiçleri](https://webdosya.csb.gov.tr/v2/yfk/2026/01/1-BF-202619011535-20260119155143.pdf): 10.130.4509 Kayın kerestesi: 12.000,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim) | ürün sayfası okundu |
| Isıl İşlemli Dişbudak 25 mm | Masif | 24.000,00 TL / m³ | tahmin: Rayiç listesinde dişbudak yok. Isıl işlem maliyet ekler; meşe rayicinin (19.200 TL/m³) %25 fazlası alındı. | tahmin |
| Çam Masif 50 mm, Fırın Kurusu | Masif | 10.200,00 TL / m³ | [Çevre, Şehircilik ve İklim Değişikliği Bakanlığı 2026 rayiçleri](https://webdosya.csb.gov.tr/v2/yfk/2026/01/1-BF-202619011535-20260119155143.pdf): 10.130.4501 Çam kerestesi (I. sınıf): 10.200,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim) | ürün sayfası okundu |
| PVC Kenar Bandı 22×0,4 mm Beyaz | Kenar bandı | 2,83 TL / m | [Koçtaş](https://www.koctas.com.tr/kenar-bandi-pvc-tutkalsiz-22mm040mm-100mt-mat-akcaagac/p/5000678440): PVC kenar bandı 22×0,4 mm 100 m rulo: 339–349 TL; alt sınır alındı → KDV'siz | arama özeti |
| ABS Kenar Bandı 22×0,8 mm Beyaz | Kenar bandı | 6,30 TL / m | tahmin: Türkiye'de ABS 22×0,8 ilanı bulunamadı. 22×2 mm PVC bandın KDV hariç metre fiyatının (15,75 TL) kalınlık oranıyla yaklaşık %40'ı alındı. | tahmin |
| ABS Kenar Bandı 22×2 mm Antrasit | Kenar bandı | 18,90 TL / m | tahmin: Türkiye'de ABS 22×2 ilanı bulunamadı. ABS, PVC'den pahalıdır; pvckenarbantlari.com'daki 22×2 mm PVC aralığının (15,75–18,90 TL/m + KDV) üst sınırı alındı. | tahmin |
| ABS Kenar Bandı 22×2 mm Meşe | Kenar bandı | 18,90 TL / m | tahmin: Antrasit ABS 22×2 ile aynı dayanak: 22×2 mm PVC aralığının üst sınırı (18,90 TL/m + KDV). | tahmin |
| ABS Kenar Bandı 43×2 mm Ceviz | Kenar bandı | 37,80 TL / m | tahmin: Genişlik iki katı olduğundan 22×2 mm ABS tahmininin (18,90 TL/m) iki katı alındı. | tahmin |
| Frenli Menteşe 110° Düz, 35 mm Çanak | Hırdavat | 42,83 TL / adet | [idefix](https://www.idefix.com/std-norm-pistonlu-frenli-duz-mentese-100-lu-paket-p-27356674): Std Norm pistonlu frenli düz menteşe, 110°, 35 mm tas, 100'lü paket: 5.138,99 TL (sepette 4.882,04 TL); liste fiyatı alındı → KDV'siz | ürün sayfası okundu |
| Frenli Menteşe 110° Yarım Deve | Hırdavat | 44,96 TL / adet | tahmin: Aynı serinin düz menteşesinin KDV hariç fiyatına (42,83 TL) %5 eklendi; yarım deve gövde biraz daha pahalıdır. | tahmin |
| Teleskopik Frenli Ray 45 cm (Takım) | Hırdavat | 392,62 TL / adet | tahmin: Frenli 45 cm ilanı bulunamadı. Aynı markanın frenli 50 cm takımı (523,49 TL, KDV dahil) boy oranıyla (45/50) küçültüldü. | tahmin |
| Teleskopik Frenli Ray 50 cm (Takım) | Hırdavat | 436,24 TL / adet | [Koçtaş](https://www.koctas.com.tr/samet-galvan-teleskopik-frenli-cekmece-rayi-46x500/p/5000737629): Samet Galvan teleskopik frenli çekmece rayı 46×500: 523,49 TL → KDV'siz | arama özeti |
| Minifiks Bağlantı Seti 15 mm | Hırdavat | 12,42 TL / adet | [Cimri (Hepsiburada ilanı)](https://www.cimri.com/minifix): Hafele Minifix Seti 15/18 mm, 10 adet: 149 TL → KDV'siz | arama özeti |
| Ahşap Kavela 8×35 mm | Hırdavat | 1,67 TL / adet | [Koçtaş](https://www.koctas.com.tr/ptx-ahsap-kavela-pimi-50-parca/p/2000024664): Ptx ahşap kavela pimi, 50 parça: 99,99 TL (perakende paket; toptan alımda daha ucuzdur) → KDV'siz | arama özeti |
| Çubuk Kulp 192 mm Mat Siyah | Hırdavat | 102,42 TL / adet | [Koçtaş](https://www.koctas.com.tr/hafele-hind-kulp-mat-siyah-192-mm/p/1000331131): Hafele Hind kulp mat siyah 192 mm: 122,90 TL (indirimli 92,99 TL); liste fiyatı alındı → KDV'siz | arama özeti |
| Gardırop Askı Borusu Oval 3 m | Hırdavat | 666,50 TL / adet | [Koçtaş](https://www.koctas.com.tr/oval-aski-borusu-krom-150-cm-kbo150/p/1000579705): Oval askı borusu krom 150 cm: 399,90 TL; 3 m için iki katı alındı → KDV'siz | arama özeti |
| Ayarlı Plastik Baza Ayağı 10 cm | Hırdavat | 52,08 TL / adet | [Cimri (Hepsiburada ilanı)](https://www.cimri.com/plastik-dolap-ayagi): Feyza Yapı 10 cm plastik ayak, 4'lü paket: yaklaşık 250 TL → KDV'siz | arama özeti |
| Sunta Vidası 4×40 mm (1000'lik Kutu) | Hırdavat | 801,95 TL / adet | [Koçtaş](https://www.koctas.com.tr/sunta-vidasi-4x40-500-adet/p/5001229245): Sunta vidası 4×40, 500 adet: 481,17 TL; 1000'lik kutu için iki katı alındı → KDV'siz | arama özeti |
| Poliüretan Vernik, Mat | Boya ve kimyasal | 1.166,67 TL / L | [Koçtaş](https://www.koctas.com.tr/demarin-demacoat-923-poliuretan-vernik/p/5003388542): Demarin Demacoat 923 poliüretan vernik 1 L: 1.400 TL → KDV'siz | arama özeti |
| Poliüretan Sertleştirici | Boya ve kimyasal | 933,33 TL / L | tahmin: Hacmi belli bir ilan bulunamadı. Aynı sistemin vernik fiyatının (1.400 TL/L, KDV dahil) %80'i alındı. | tahmin |
| Yağ Bazlı Ahşap Cilası, Doğal | Boya ve kimyasal | 922,11 TL / L | [Koçtaş](https://www.koctas.com.tr/polisan-wood-wood-teak-yagi/p/1000106398): Polisan Wood Teak yağı, renksiz, 0,75 L: 829,90 TL; litreye çevrildi → KDV'siz | arama özeti |
| Selülozik Tiner | Boya ve kimyasal | 149,14 TL / L | [Koçtaş](https://www.koctas.com.tr/pamukkale-manas-selulozik-tiner-10-lt/p/5002074837): Pamukkale Manas selülozik tiner 10 L: 1.789,70 TL; litreye çevrildi → KDV'siz | arama özeti |
| Akrilik Lake Boya, Beyaz | Boya ve kimyasal | 475,72 TL / kg | [Koçtaş](https://www.koctas.com.tr/rich-multi-surface-1750-gr-2102-antik-beyaz/p/1000477706): Rich Multi Surface antik beyaz 1.750 g: 999 TL; kilograma çevrildi → KDV'siz | arama özeti |
| PVA Ahşap Tutkalı D3 | Boya ve kimyasal | 269,76 TL / kg | [idefix](https://www.idefix.com/shumanss-d3-masif-ahsap-tutkali-25kgkova-p-5475610): Shumanss D3 masif ahşap tutkalı 25 kg kova: 8.092,66 TL (sepette 6.878,76 TL); yüksek fiyat alındı, kilograma çevrildi → KDV'siz | ürün sayfası okundu |
| Keten Döşemelik Kumaş, Ekru, 140 cm En | Kumaş | 283,33 TL / m | [Marmara Koltuk](https://www.marmarakoltuk.com/kumas/): Keten döşemelik kumaş, metre: 340 TL → KDV'siz | arama özeti |
| Kadife Döşemelik Kumaş, Antrasit | Kumaş | 458,33 TL / m | [Marmara Koltuk](https://www.marmarakoltuk.com/kumas/): Velvet kadife döşemelik kumaş, metre: 550 TL → KDV'siz | arama özeti |
| Bukle Döşemelik Kumaş, Krem | Kumaş | 572,92 TL / m | tahmin: Satış birimi belli bir bukle ilanı bulunamadı. Bukle kadifeden pahalıdır; velvet kadife metre fiyatının (550 TL) %25 fazlası alındı. | tahmin |
| Elyaf Vatka 200 gr/m² | Kumaş | 387,78 TL / m | [n11](https://www.n11.com/arama?m=Erpol): Erpol vatka elyaf 150 g, 210 cm en, 1 metre: 349 TL; 200 g için ağırlık oranıyla artırıldı → KDV'siz | arama özeti |
| Palet Streç Film 50 cm 17 Mikron 300 m | Ambalaj | 416,67 TL / adet | [Hepsiburada](https://www.hepsiburada.com/ekol-ambalaj-strec-filmler-xc-60001207-b20978): Ekol Ambalaj palet streç film 50 cm 17 mikron 2 kg: yaklaşık 500 TL → KDV'siz | arama özeti |
| Oluklu Mukavva Levha 50×70 cm | Ambalaj | 33,23 TL / adet | [Koçtaş](https://www.koctas.com.tr/kutu-ve-ambalaj-malzemeleri/koli/c/107014001): 50×70 cm oluklu mukavva, 10 adet: 398,80 TL → KDV'siz | arama özeti |
| Karton Köşe Koruyucu 1 m | Ambalaj | 12,92 TL / adet | [n11](https://www.n11.com/urun/100adet-1metre-karton-kosebent-kose-koruyucu-palet-kartonu-12287740): 1 metre karton köşebent, 100 adet: 1.549,90 TL → KDV'siz | arama özeti |
| Balonlu Naylon 100 cm × 100 m | Ambalaj | 2.089,53 TL / adet | [Akakçe](https://www.akakce.com/ambalaj-naylonu,33.html): Balonlu naylon rulo 100 cm × 100 m (40 g/m²): en ucuz 2.507,43 TL → KDV'siz | ürün sayfası okundu |
| Koli Bandı 45 mm × 100 m | Ambalaj | 40,60 TL / adet | [idefix](https://www.idefix.com/stella-hotmelt-koli-banti-45-x-100-72-adet-p-17024786): Stella hotmelt koli bandı 45×100, 72 adet: 3.508,00 TL (sepette 3.122,12 TL); yüksek fiyat alındı, adede çevrildi → KDV'siz | ürün sayfası okundu |

## Ürünler

- Katalog, mobilya sitesinin ürün kitabındaki 20 modeldir. Her model beyaz ve ahşap kaplamayla iki ayrı ürün olur (40 ürün). Parça ölçüleri sitenin kendi model üreticilerinden `npm run catalog:export` ile `src/seed/data/catalog.generated.json` dosyasına aktarılır; reçete, rota, maliyet ve fiyat `src/seed/data/products.ts` içindeki kurallarla bu ölçülerden türetilir.
- **İşçilik dakikası 2,91 TL.** 2026 brüt asgari ücreti 33.030,00 TL'dir; imalat sektöründe 5 puanlık SGK işveren teşvikiyle işverene aylık maliyeti 39.223,13 TL'dir. Ayda 225 çalışma saatiyle 39.223,13 ÷ 225 ÷ 60 = 2,905 TL/dk; katalogda 2,91 TL/dk kullanılır. Kaynaklar: [PwC, 2026 asgari ücret ve işveren maliyeti](https://www.pwc.com.tr/tr/medya/kose-yazilari/celal-ozcan/2026-yili-asgari-ucreti-ve-sektorlere-gore-isveren-maliyeti.html), [Alo Maliye, 2026 asgari ücreti](https://www.alomaliye.com/2025/12/23/2026-yili-asgari-ucreti-2026-yili-asgari-ucret-bilgilendirme/).
- **Maliyet** = Σ malzeme birim fiyatı (yukarıdaki tablo, KDV hariç) × miktar × (1 + fire) + rota dakikası × 2,91 TL × 2.
- **Varsayım, genel gider:** rota dakikası işçiliğin iki katıyla maliyetlenir; ikinci kat atölye genel gideridir (enerji, makine amortismanı, kira). Oran bir kaynağa dayanmaz.
- **Varsayım, satış fiyatı:** KDV hariç satış fiyatı maliyetin 1,8 katıdır ve 50 TL'ye yukarı yuvarlanır. Oran bir kaynağa dayanmaz.
- **Varsayım, KDV sınıflandırması:** "Dekoratif duvar paneli", "LED ayna", "Havluluk" 9403 ve 9401 pozisyonlarındaki mobilyalardan sayılmadı, genel oran olan **%20** uygulanır; diğer 17 kategori mobilyadır ve **%10**'dur (yukarıdaki KDV bölümü). Sınıflandırma bir gümrük müşavirine doğrulatılmadı.
- **Hazır alınan parçalar reçeteye girmez:** ayna camı, LED aydınlatma, cam parçalar, metal ayak ve çerçeveler (kızak ve dikme ayaklar) ve beyaz havluluğun çelik boru gövdesi dışarıdan hazır alınır; katalogda fiyatları olmadığı için maliyete katılmadı. Bu yüzden LED aynanın ve beyaz havluluğun fiyatı yalnızca atölyede işlenen parçaları ve ambalajı yansıtır; beyaz havluluğun rotasında yalnızca paketleme vardır. Kuvars tezgâh reçetede ön yüz levhası olarak hesaplanır.
- **Reçete:** plaka miktarı panel alanının 5,88 m²'lik (2100×2800 mm) plakaya bölümüdür; ayaklar hacimle masif keresteden düşülür. Fire oranları levhada %15, masifte %30, kenar bandı ve cilada %10, minifiks ve kavelada %5'tir. Bütün miktarlar 0,01 birime yukarı yuvarlanır.
- **Rota istasyonları:** Kesim (960 dk/gün), Kenar bantlama (480 dk/gün), Delik ve CNC (480 dk/gün), Montaj (960 dk/gün), Boya ve cila (480 dk/gün), Paketleme (480 dk/gün). Dakikalar panel sayısı, kenar bandı metresi, menteşe ve ray sayısı, cephe sayısı ve ahşapta cilalı alandan hesaplanır. Kapasiteler varsayımdır.

| Kod | Ürün | Kaplama | Birim maliyet (KDV hariç) | Satış fiyatı (KDV hariç) | KDV |
|---|---|---|---|---|---|
| URN-0001 | Eksen Gardırop | Beyaz | 23.457,07 TL | 42.250,00 TL | %10 |
| URN-0002 | Eksen Gardırop | Ahşap | 30.786,28 TL | 55.450,00 TL | %10 |
| URN-0003 | Sükût Komodin | Beyaz | 3.593,33 TL | 6.500,00 TL | %10 |
| URN-0004 | Sükût Komodin | Ahşap | 4.078,71 TL | 7.350,00 TL | %10 |
| URN-0005 | Ritim Şifonyer | Beyaz | 9.934,38 TL | 17.900,00 TL | %10 |
| URN-0006 | Ritim Şifonyer | Ahşap | 11.603,03 TL | 20.900,00 TL | %10 |
| URN-0007 | Tezgâh Mutfak dolabı | Beyaz | 18.772,11 TL | 33.800,00 TL | %10 |
| URN-0008 | Tezgâh Mutfak dolabı | Ahşap | 26.328,60 TL | 47.400,00 TL | %10 |
| URN-0009 | Kiler Erzak dolabı | Beyaz | 11.815,90 TL | 21.300,00 TL | %10 |
| URN-0010 | Kiler Erzak dolabı | Ahşap | 15.487,83 TL | 27.900,00 TL | %10 |
| URN-0011 | Telve Kahve köşesi | Beyaz | 11.210,28 TL | 20.200,00 TL | %10 |
| URN-0012 | Telve Kahve köşesi | Ahşap | 14.337,15 TL | 25.850,00 TL | %10 |
| URN-0013 | Kâtip Kitaplıklı bilgisayar masası | Beyaz | 6.629,70 TL | 11.950,00 TL | %10 |
| URN-0014 | Kâtip Kitaplıklı bilgisayar masası | Ahşap | 8.625,91 TL | 15.550,00 TL | %10 |
| URN-0015 | Atölye Çalışma masası | Beyaz | 3.264,45 TL | 5.900,00 TL | %10 |
| URN-0016 | Atölye Çalışma masası | Ahşap | 4.429,33 TL | 8.000,00 TL | %10 |
| URN-0017 | Sayfa Kitaplık | Beyaz | 9.268,97 TL | 16.700,00 TL | %10 |
| URN-0018 | Sayfa Kitaplık | Ahşap | 11.310,37 TL | 20.400,00 TL | %10 |
| URN-0019 | Perde TV ünitesi | Beyaz | 4.827,16 TL | 8.700,00 TL | %10 |
| URN-0020 | Perde TV ünitesi | Ahşap | 5.845,77 TL | 10.550,00 TL | %10 |
| URN-0021 | Ada Orta sehpa | Beyaz | 1.732,83 TL | 3.150,00 TL | %10 |
| URN-0022 | Ada Orta sehpa | Ahşap | 3.136,70 TL | 5.650,00 TL | %10 |
| URN-0023 | Köşe Köşe sehpası | Beyaz | 703,58 TL | 1.300,00 TL | %10 |
| URN-0024 | Köşe Köşe sehpası | Ahşap | 1.135,76 TL | 2.050,00 TL | %10 |
| URN-0025 | Sofra Yemek masası | Beyaz | 3.075,76 TL | 5.550,00 TL | %10 |
| URN-0026 | Sofra Yemek masası | Ahşap | 5.071,22 TL | 9.150,00 TL | %10 |
| URN-0027 | Çıta Dekoratif duvar paneli | Beyaz | 4.812,31 TL | 8.700,00 TL | %20 |
| URN-0028 | Çıta Dekoratif duvar paneli | Ahşap | 6.211,48 TL | 11.200,00 TL | %20 |
| URN-0029 | Eşik Portmanto | Beyaz | 6.206,23 TL | 11.200,00 TL | %10 |
| URN-0030 | Eşik Portmanto | Ahşap | 7.711,49 TL | 13.900,00 TL | %10 |
| URN-0031 | Adım Ayakkabılık | Beyaz | 4.000,71 TL | 7.250,00 TL | %10 |
| URN-0032 | Adım Ayakkabılık | Ahşap | 5.458,74 TL | 9.850,00 TL | %10 |
| URN-0033 | Karşılama Dresuar | Beyaz | 3.877,99 TL | 7.000,00 TL | %10 |
| URN-0034 | Karşılama Dresuar | Ahşap | 4.453,25 TL | 8.050,00 TL | %10 |
| URN-0035 | Vaha Banyo dolabı | Beyaz | 4.229,93 TL | 7.650,00 TL | %10 |
| URN-0036 | Vaha Banyo dolabı | Ahşap | 5.347,90 TL | 9.650,00 TL | %10 |
| URN-0037 | Hale LED ayna | Beyaz | 916,00 TL | 1.650,00 TL | %20 |
| URN-0038 | Hale LED ayna | Ahşap | 1.187,22 TL | 2.150,00 TL | %20 |
| URN-0039 | Merdiven Havluluk | Beyaz | 555,81 TL | 1.050,00 TL | %20 |
| URN-0040 | Merdiven Havluluk | Ahşap | 1.186,55 TL | 2.150,00 TL | %20 |

## Bulunan ama kullanılmayan veriler

- 18 mm suntalam için kaynaklar geniş bir aralık veriyor: [Bauhaus](https://www.bauhaus.com.tr/suntalam-2100-2800-18mm-441-flora-1-plaka-588m2-61537949) 1.150 TL (Flora desen, 1 plaka), [Kaplan Orman](https://www.kaplanormanurunleri.com/) 2.300 TL (beyaz), [Haber Gazetesi](https://www.habergazetesi.com.tr/sunta-fiyatlari) 2.150–2.550 TL (çift yüz beyaz, Ocak 2026). Tarihli ve aralığın ortasında kaldığı için MDF Marketi'nin 1.750 TL'si kullanıldı.
- [Bauhaus](https://www.bauhaus.com.tr/mdflam-2100-2800-18-mm-parlak-beyaz-cy-61514960) parlak beyaz MDFlam için 1.590 TL gösteriyor, ancak sayfa "fiyat metrekare cinsinden hesaplanmaktadır" diyor ve fiyatın plaka mı metrekare mi olduğu anlaşılmıyor; kullanılmadı.
- Kereste için [Haber Gazetesi](https://www.habergazetesi.com.tr/kereste-fiyatlari) meşeye 17.000–20.000 TL/m³ veriyor; Bakanlık rayici (19.200 TL/m³) bu aralığın içinde kaldığı için resmî kaynak tercih edildi.
- Bakanlık rayiçleri aylık güncelleniyor; katalogdaki rakamlar 1 Ocak 2026 listesindendir. Ekim–Kasım 2026 listelerinin PDF'ine ulaşılamadı.
