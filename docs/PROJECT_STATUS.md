# Proje durumu

Son güncelleme: 2026-11-18 (Plan 2A: satış ve üretim tamamlandı ve `main`'e birleştirildi)

## Yapılanlar (Plan 1: temel)

- Proje iskeleti: Next.js 16, React 19, TypeScript strict, Tailwind 4, Vitest, Playwright.
- Tarayıcıda PostgreSQL (aşağıda), Drizzle şeması, tek göç, sürüm değişince yeniden kurulum.
- İş kuralları (`src/domain`): birimler ve para, yetki matrisi, parola özeti (PBKDF2), giriş, kullanıcılar, stok defteri (giriş, çıkış, ayırma, tüketim, sayım farkı), malzeme kartları, sayım fişleri, denetim kaydı.
- Örnek veri: 7 departman, 14 kurgusal çalışan, 42 malzeme, son 30 günün mesai içi hareketleri, yarım kalmış bir sayım fişi.
- Tasarım sistemi "Sıcak atölye": ceviz başlık bandı ve üstüne binen kartlar, açık ve koyu tema, cetvel göstergesi, kategori numuneleri, yaylı animasyonlar (Motion), "hareketi azalt" desteği. İki tur kullanıcı geri bildirimiyle yeniden çizildi (ekranlar: `docs/screens/plan-2`).
- Ekranlar: açılış, giriş (demo hesapları ayrı pencerede), ana panel, malzemeler ve ayrıntı çekmecesi, stok hareketleri, sayım ve fiş ayrıntısı, kullanıcı yönetimi, ayarlar (veriyi sıfırla), Ctrl+K komut paleti.

## Yapılanlar (Plan 2A: satış ve üretim)

- **Veri modeli:** ürünler ve reçeteler, istasyonlar ve rotalar, müşteriler, siparişler ve satırları, iş emirleri ve adımları, mamul stok defteri (`product_movements`). Şema sürümü değiştiği için vitrin veritabanları kendiliğinden yeniden kurulur.
- **Örnek veri:** mobilya sitesinin kataloğundan ürünler, reçeteleri ve rotaları; kurgusal müşteriler; son 30 günün sipariş ve iş emri geçmişi. Fiyatlar ve KDV oranları `docs/DATA_SOURCES.md` içinde.
- **İş kuralları (`src/domain/sales`, `src/domain/production`):** sipariş açma, satır ekleme, onay (mamul stoğu yeterse ayırır, değilse iş emri açıp reçete malzemelerini ayırır, malzeme yoksa "Malzeme bekliyor"), iptal, sevk; iş emrini planlama, malzemeyi yeniden deneme, istasyon adımını başlatma ve bitirme (sıra atlanamaz), bitince mamulün stoğa girmesi ve siparişin Hazır olması. Mamul stoğu yalnızca `postProductMovement` ile değişir; iki defter (malzeme ve mamul) tutarlılık testiyle denetlenir.
- **Ekranlar:** Siparişler (çekmecede satır ekleme, onay, sevk, iptal), Müşteriler, Ürünler (reçete ve rota), İş emirleri (adım çizelgesi, malzeme durumu, planlama), Atölye (istasyon kuyruğu, büyük Başla ve Bitti düğmeleri; tablette en az 48 px). Atölye yalnızca işlem yetkisi olanlara menüde görünür.
- **Ctrl+K:** sipariş, iş emri, müşteri ve ürün kodu ya da adıyla arama (yazınca, her grupta en çok 5; görme yetkisi olmayan ekranın kaydı çıkmaz), seçilince çekmece açılır. Satışta "Yeni sipariş" komutu. Kayıt listeleri palet açılınca bir kez okunur, tuş vuruşunda veritabanına gidilmez.
- **Yetki:** Satış sipariş açar ve onaylar, Planlama iş emrini planlar, Atölye adımları ilerletir, Depo sevk eder; hem düğme gizlenir hem servis `FORBIDDEN` döner.
- **İşlem geçmişi:** her işlem neyin değiştiğini açıkça yazar (silinen satırın ürünü, adedi ve tutarı; düzenlenen alanların eski → yeni değeri; iptal gerekçesi). Kayıt çekmecelerinin altında "Geçmiş" bölümü; sol menüde **İşlemler** ekranı (bütün kayıtlar, tür, departman, kişi, tarih ve metinle süzme, CSV). Kullanıcı yönetimi kayıtlarını yalnızca Yönetim ve Bilgi İşlem görür.
- **İşlem öncesi onay:** veri değiştiren her düğme önce neyin olacağını söyleyen bir pencere açar ("satır silinecek, tutar ₺X → ₺Y olacak"); düzenleme formları yalnızca değişen alanları eski → yeni gösterir. Pencere açılınca "Vazgeç" seçilidir, Enter tek başına onaylamaz; silen işlemler kırmızı düğmelidir. Sayımda yalnızca kayıtlı bir sayımın üzerine yazmak onay ister.
- Yan menüde tasarıma uygun ince kaydırma çubuğu ve kenar geçişleri.
- Ekran görüntüleri: `docs/screens/asama-2`.

## Testler

| Tür | Sayı | Not |
|---|---|---|
| Birim (Vitest) | 513 | Gerçek PGlite veritabanıyla; dosya başına paylaşılan veritabanı |
| Tarayıcı (Playwright) | 95 (+1 elle çalıştırılan: ekran görüntüsü) | Başsız Chrome, "hareketi azalt" açık |
| Üretim dolaşımı | `scripts/walkthrough.mjs` | Giriş, stok girişi, sayım, palet, siparişten sevke (satış, planlama, atölye, depo), kullanıcı ekleme, sıfırlama; konsol hatası ve 4xx yok |

## Tarayıcıda PostgreSQL

- **Motor:** PGlite (PostgreSQL WASM) bir Web Worker içinde (`PGliteWorker`); Drizzle bu bağlantıyla çalışır.
- **Depolama:** `memfs2opfs://erp-studio`. Veri tarayıcının sayfaya özel dosya sisteminde (OPFS) durur; değişiklikler bellekte izlenir ve her sorgudan sonra yalnızca değişen kısım diske yazılır.
- **Çok sekme:** PGlite sekmelerden birini lider seçer, diğerleri sorgularını ona yollar. Kurulum ve örnek veri yüklemesi Web Locks ile tek sekmede çalışır. Bir sekmedeki değişiklik `BroadcastChannel` ile diğer sekmelerin sorgularını yeniler.
- **Depolama kapalıysa** (OPFS yok, ya da site verisi engellendiği için Worker içinde reddediliyor): veritabanı bellekte açılır (`persistent: false`) ve ekranda kalıcı bir uyarı durur. Worker reddi açıkça bildirir; sessizce takılırsa 60 sn sonra bellekte devam edilir.
- **Sıfırlama ve sürüm değişimi:** `public` şeması silinip yeniden kurulur.
- **Örnek veri:** derleme sırasında üretilen anlık görüntüden (`src/seed/snapshot.generated.json`, ~960 KB; 1 MB sınırına yakın, Plan 2B'nin başında küçültülecek) tablo başına toplu INSERT ile yüklenir; tarihler yükleme anına iş günü olarak kaydırılır, hiçbir kayıt hafta sonuna düşmez. Anlık görüntü `npm run seed:snapshot` ile yenilenir; güncel olup olmadığını bir birim testi denetler.

### Neden bu depolama (2026-11-15 ölçümleri, başsız Chrome, RTX 4070 makine)

| Seçenek | Sorgu başına süre | Sonuç |
|---|---|---|
| `idb://` (IndexedDB), yazımı bekleyerek | ~173 ms (`select 1` dahil) | Kullanılamaz: tek bir stok işlemi saniyeler sürer |
| `idb://`, `relaxedDurability` (yazım arka planda) | ~4 ms | Reddedildi: açılışta yakalanmamış ENOENT hatası; yazılan veri hemen yenilemede kayboluyor |
| **`memfs2opfs://`, yazımı bekleyerek** | **2–5 ms** | **Seçildi:** hızlı, hata yok, yenilemede veri kalıyor |

Ayrıca örnek veriyi tarayıcıda servislerle üretmek (2.000'den fazla sorgu) IndexedDB'de dakikalar, arka plan yazımıyla 17 saniye sürüyordu; anlık görüntüden yüklemek açılışı 2–5 saniyeye indirdi.

### Açılış süresi (üretim derlemesi, yerel sunucu)

| Ölçüm | Değer |
|---|---|
| Soğuk açılış (giriş ekranı görünene kadar) | 3,0–5,1 sn (sınır 8 sn; 2026-11-16, Plan 2A sonrası 9 ölçüm) |
| Yenilemede açılış | 1,4–3,4 sn (dokuz ölçümün sekizinde 1,4–1,5 sn) |
| İndirilen PostgreSQL dosyaları | `pglite.wasm` 9,1 MB + `pglite.data` 6,2 MB (sıkıştırılmamış) |

## Bilinen sınırlar

**Plan 2B'ye kalanlar** (`/uretim/plan` menüde henüz yok):

- Haftalık plan ızgarası (istasyon × gün), sürükle-bırak ve klavyeyle taşıma, kapasite çubuğu.
- Termin önerisi (istasyon kapasitesine göre en erken teslim tarihi).
- İş emirleri için kanban görünümü (istasyona göre sütunlar).

**Bilinçle ertelenenler (2A):**

- Satın alınan parçalar (ayna, LED, metal ayak) reçetelerde ve maliyette yok; ürünün malzeme maliyeti yalnızca levha, bant, menteşe gibi stoktaki malzemeleri sayar. Birim maliyet buna rota dakikası × 2,91 TL × 2 (işçilik ve genel gider) ekler; katalog fiyatı da bu maliyetten çıkar.
- Hata yönlendirmesi ileti metnini okuyor (hata kodu yerine metne bakan yerler var); metin değişirse yönlendirme bozulur.
- Eşzamanlılık: eksik malzeme okumalarında `FOR UPDATE` yok. Tarayıcıda tek bağlantı olduğu için sorun çıkmaz; ikinci aşamada sunucu PostgreSQL'e geçerken kilitleme eklenmeli.
- Örnek verinin anlık görüntüsünün güncel olup olmadığını denetleyen birim testi zaman damgalarını karşılaştırmıyor.

- Ölçümler yerel sunucuda ve yalnızca Chrome'da yapıldı. Yayında dosyalar sıkıştırılmış gelir ve önbellekte kalır, ama ilk ziyarette yaklaşık 15 MB'lık indirme bağlantı hızına göre süre ekler. Yayın sonrası gerçek ağda yeniden ölçülmeli.
- **Firefox ve Safari'de denenmedi.** `memfs2opfs` bir Worker içinde OPFS eşzamanlı dosya erişimi ister; bu tarayıcılarda çalışmazsa uygulama bellekte açılır ve uyarı gösterir.
- Her tam sayfa yenilemesinde veritabanı yeniden başlatılır (1,4–3,4 sn açılış ekranı; dokuz ölçümün sekizinde 1,4–1,5 sn). Uygulama içi gezinme sayfayı yenilemez.
- Malzeme fiyatları 2026-11-16'da Türkiye'deki kaynaklardan toplandı ve KDV hariç tutulur: 42 kalemin 14'ü sayfadan okundu, 18'i arama özetinden (Koçtaş, Cimri ve Hepsiburada otomatik okumayı engelliyor), 10'u dayanağı yazılı tahmin. Kereste fiyatları Bakanlığın Ocak 2026 rayicinden. Ayrıntı: `docs/DATA_SOURCES.md`.
- Örnek verinin tarihleri iş günü olarak kaydırılır. Plan 1 stok verisindeki hafta sonu kayıtları sonraki iş gününe, anlık görüntünün son hafta sonundakiler (cumartesi sayımı dahil) son iş gününe taşınır; o günlerde saat sırası hareket sırasıyla birebir örtüşmeyebilir.
- Kaydedilmiş veritabanı bozulursa kendiliğinden onarım yolu yok; Ayarlar → Veriyi sıfırla ya da site verisini silmek gerekir.
- "Parolamı unuttum" yok: parolayı bilgi işlem ya da yönetim sıfırlar (vitrinde e-posta gönderilmez).

## Sıradaki

Sırada Plan 2B (haftalık plan, termin önerisi, kanban), ardından Plan 3 (satın alma), Plan 4 (raporlar ve 12 aylık veri), Plan 5 (asistan ve yayın).
