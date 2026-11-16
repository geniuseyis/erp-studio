# Proje durumu

Son güncelleme: 2026-11-16 (Plan 1 tamamlandı)

## Yapılanlar (Plan 1: temel)

- Proje iskeleti: Next.js 16, React 19, TypeScript strict, Tailwind 4, Vitest, Playwright.
- Tarayıcıda PostgreSQL (aşağıda), Drizzle şeması, tek göç, sürüm değişince yeniden kurulum.
- İş kuralları (`src/domain`): birimler ve para, yetki matrisi, parola özeti (PBKDF2), giriş, kullanıcılar, stok defteri (giriş, çıkış, ayırma, tüketim, sayım farkı), malzeme kartları, sayım fişleri, denetim kaydı.
- Örnek veri: 7 departman, 14 kurgusal çalışan, 42 malzeme, son 30 günün mesai içi hareketleri, yarım kalmış bir sayım fişi.
- Tasarım sistemi "Sıcak atölye": ceviz başlık bandı ve üstüne binen kartlar, açık ve koyu tema, cetvel göstergesi, kategori numuneleri, yaylı animasyonlar (Motion), "hareketi azalt" desteği. İki tur kullanıcı geri bildirimiyle yeniden çizildi (ekranlar: `docs/screens/plan-2`).
- Ekranlar: açılış, giriş (demo hesapları ayrı pencerede), ana panel, malzemeler ve ayrıntı çekmecesi, stok hareketleri, sayım ve fiş ayrıntısı, kullanıcı yönetimi, ayarlar (veriyi sıfırla), Ctrl+K komut paleti.

## Testler

| Tür | Sayı | Not |
|---|---|---|
| Birim (Vitest) | 212 | Gerçek PGlite veritabanıyla; dosya başına paylaşılan veritabanı |
| Tarayıcı (Playwright) | 51 (+2 elle çalıştırılan: ekran görüntüsü, ölçüm) | Başsız Chrome, "hareketi azalt" açık |
| Üretim dolaşımı | `scripts/walkthrough.mjs` | Giriş, stok girişi, sayım, palet, kullanıcı ekleme, sıfırlama; konsol hatası yok |

## Tarayıcıda PostgreSQL

- **Motor:** PGlite (PostgreSQL WASM) bir Web Worker içinde (`PGliteWorker`); Drizzle bu bağlantıyla çalışır.
- **Depolama:** `memfs2opfs://erp-studio`. Veri tarayıcının sayfaya özel dosya sisteminde (OPFS) durur; değişiklikler bellekte izlenir ve her sorgudan sonra yalnızca değişen kısım diske yazılır.
- **Çok sekme:** PGlite sekmelerden birini lider seçer, diğerleri sorgularını ona yollar. Kurulum ve örnek veri yüklemesi Web Locks ile tek sekmede çalışır. Bir sekmedeki değişiklik `BroadcastChannel` ile diğer sekmelerin sorgularını yeniler.
- **Depolama kapalıysa** (OPFS yok, ya da site verisi engellendiği için Worker içinde reddediliyor): veritabanı bellekte açılır (`persistent: false`) ve ekranda kalıcı bir uyarı durur. Worker reddi açıkça bildirir; sessizce takılırsa 60 sn sonra bellekte devam edilir.
- **Sıfırlama ve sürüm değişimi:** `public` şeması silinip yeniden kurulur.
- **Örnek veri:** derleme sırasında üretilen anlık görüntüden (`src/seed/snapshot.generated.json`, ~210 KB) tablo başına toplu INSERT ile yüklenir; tarihler yükleme anına kaydırılır. Anlık görüntü `npm run seed:snapshot` ile yenilenir; güncel olup olmadığını bir birim testi denetler.

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
| Soğuk açılış (giriş ekranı görünene kadar) | 2,5–5,1 sn (sınır 8 sn; 2026-11-16) |
| Yenilemede açılış | 1,4–2,5 sn |
| İndirilen PostgreSQL dosyaları | `pglite.wasm` 9,1 MB + `pglite.data` 6,2 MB (sıkıştırılmamış) |

## Bilinen sınırlar

- Ölçümler yerel sunucuda ve yalnızca Chrome'da yapıldı. Yayında dosyalar sıkıştırılmış gelir ve önbellekte kalır, ama ilk ziyarette yaklaşık 15 MB'lık indirme bağlantı hızına göre süre ekler. Yayın sonrası gerçek ağda yeniden ölçülmeli.
- **Firefox ve Safari'de denenmedi.** `memfs2opfs` bir Worker içinde OPFS eşzamanlı dosya erişimi ister; bu tarayıcılarda çalışmazsa uygulama bellekte açılır ve uyarı gösterir.
- Her tam sayfa yenilemesinde veritabanı yeniden başlatılır (1,4–2,5 sn açılış ekranı). Uygulama içi gezinme sayfayı yenilemez.
- Malzeme fiyatlarının çoğu tahmindir: 42 kalemden 9'u bir ilana dayanır. Ayrıntı: `docs/DATA_SOURCES.md`.
- Örnek verinin tarihleri tam gün kaydırılır; hafta içi ve hafta sonu düzeni korunmaz.
- Kaydedilmiş veritabanı bozulursa kendiliğinden onarım yolu yok; Ayarlar → Veriyi sıfırla ya da site verisini silmek gerekir.
- "Parolamı unuttum" yok: parolayı bilgi işlem ya da yönetim sıfırlar (vitrinde e-posta gönderilmez).

## Sıradaki

Ayrıntılı yol haritası: [ROADMAP.md](ROADMAP.md). Sırada GitHub'a ilk yayın, ardından Plan 2 (satış ve üretim), Plan 3 (satın alma), Plan 4 (raporlar ve 12 aylık veri), Plan 5 (asistan ve yayın).
