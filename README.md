# BALTACIOĞLU'S ERP Studio

Mobilya atölyesi için kurumsal kaynak planlama: siparişten sevke, stoktan satın almaya tek uygulama.

<p align="center"><img src="docs/screens/tanitim/02-ana-panel.png" width="100%" alt="Ana panel: stok değeri, kritik kalemler, açık sayımlar ve son stok hareketleri"></p>

Bir mobilya atölyesinin ERP'sini gösteren bir vitrin. Gerçek bir PostgreSQL veritabanı doğrudan tarayıcının içinde çalışır; veriler ziyaretçinin tarayıcısından hiç çıkmaz.

## Öne çıkanlar

- **Siparişten sevke:** satış, üretim, depo ve sevkiyat tek akışta; sipariş onayında stok ayrılır ya da iş emri açılır.
- **Haftalık üretim planı:** istasyon ve gün ızgarası, kapasite çubukları, sürükle-bırak ya da klavyeyle taşıma ve her taşımada onay.
- **Satın alma:** kritik stoktan tedarikçiye göre sipariş önerisi, tutara göre onay zinciri ve depoda irsaliyeli mal kabul.
- **Rehberli asistan:** başlık kutucukları, kart cevapları, yazım hatası toleransı; değişiklik yapmadan önce her zaman onay ister.
- **Ctrl+K paleti:** sayfaya git, kayıt ara, çekmecesini aç.
- **Açık ve koyu tema**, telefon ve tablet görünümü, klavyeyle tam kullanım.
- **Her değişikliğin kaydı:** kim, ne zaman, ne yaptı.

## Ekranlar

### Giriş

<p align="center"><img src="docs/screens/tanitim/01-giris.png" width="100%" alt="Giriş ekranı: e-posta ve parola alanları, demo hesabıyla giriş düğmesi"></p>

### Ana panel

<p align="center"><img src="docs/screens/tanitim/02-ana-panel.png" width="100%" alt="Ana panel: stok değeri, kritik kalemler, açık sayımlar ve son stok hareketleri"></p>

### Siparişler

<p align="center"><img src="docs/screens/tanitim/03-siparisler.png" width="100%" alt="Siparişler listesi: durum çipleri, geciken ve malzeme bekleyen süzgeçleri"></p>

### Sipariş çekmecesi

<p align="center"><img src="docs/screens/tanitim/04-siparis-cekmecesi.png" width="100%" alt="Sipariş çekmecesi: müşteri, termin, satırlar, KDV dahil ve hariç toplam ve geçmiş"></p>

### Müşteriler

<p align="center"><img src="docs/screens/tanitim/05-musteriler.png" width="100%" alt="Müşteriler listesi: müşteri türü, şehir, sipariş sayısı ve açık tutar"></p>

### Ürünler

<p align="center"><img src="docs/screens/tanitim/06-urunler.png" width="100%" alt="Ürün çekmecesi: fiyat, birim maliyet, brüt kâr ve malzeme reçetesi"></p>

### İş emirleri

<p align="center"><img src="docs/screens/tanitim/07-is-emirleri-liste.png" width="100%" alt="İş emirleri listesi: durum, istasyon, termin ve malzeme eksikleri"></p>

### İş emirleri kanbanı

<p align="center"><img src="docs/screens/tanitim/08-is-emirleri-kanban.png" width="100%" alt="İş emirleri kanbanı: Malzeme bekliyor, Planlanmadı ve istasyon sütunları"></p>

### Haftalık plan

<p align="center"><img src="docs/screens/tanitim/09-haftalik-plan.png" width="100%" alt="Haftalık plan: istasyon ve gün ızgarası, kapasite çubukları ve iş emri kartları"></p>

### Taşıma onayı

<p align="center"><img src="docs/screens/tanitim/10-tasima-onayi.png" width="100%" alt="Taşıma onayı: kartı başka güne taşırken kapasite aşımı uyarısı"></p>

### Termin önerisi

<p align="center"><img src="docs/screens/tanitim/11-termin-onerisi.png" width="100%" alt="Taslak siparişte istasyon kapasitesine göre önerilen termin ve Öneriyi uygula düğmesi"></p>

### Atölye (tablet)

<p align="center"><img src="docs/screens/tanitim/12-atolye-tablet.png" width="100%" alt="Atölye ekranı tablette: istasyon kuyruğu ve büyük Bitti düğmeleri"></p>

### Malzemeler

<p align="center"><img src="docs/screens/tanitim/13-malzemeler.png" width="100%" alt="Malzemeler: eldeki ve kullanılabilir stok, sipariş noktasını gösteren cetvel"></p>

### Stok hareketleri

<p align="center"><img src="docs/screens/tanitim/14-stok-hareketleri.png" width="100%" alt="Stok hareketleri: giriş, çıkış ve sayım farkı kayıtları"></p>

### Sayım

<p align="center"><img src="docs/screens/tanitim/15-sayim.png" width="100%" alt="Sayım fişleri: açık fiş ve sayılan kalem ilerlemesi"></p>

### Satın alma önerileri

<p align="center"><img src="docs/screens/tanitim/16-satin-alma-onerileri.png" width="100%" alt="Satın alma önerileri: tedarikçiye göre gruplanmış sipariş önerileri ve Taslak oluştur düğmesi"></p>

### Satın alma siparişi ve onay zinciri

<p align="center"><img src="docs/screens/tanitim/17-satin-alma-siparisi.png" width="100%" alt="Onay bekleyen satın alma siparişi: onay zinciri, kalemler ve Onayla düğmesi"></p>

### Tedarikçiler

<p align="center"><img src="docs/screens/tanitim/18-tedarikciler.png" width="100%" alt="Tedarikçiler listesi: teslim süresi ve fiyat listeleri"></p>

### Mal kabul

<p align="center"><img src="docs/screens/tanitim/19-mal-kabul.png" width="100%" alt="Mal kabul: bekleyen siparişler, geciken teslimler ve son mal kabuller"></p>

### İşlemler

<p align="center"><img src="docs/screens/tanitim/20-islemler.png" width="100%" alt="İşlemler: tür, departman, kişi ve tarihe göre süzülebilen değişiklik kaydı"></p>

### Ctrl+K paleti

<p align="center"><img src="docs/screens/tanitim/21-komut-paleti.png" width="100%" alt="Ctrl+K paleti: sayfalar ve sipariş kayıtları arasında arama"></p>

## Asistan

### Ana menü

<p align="center"><img src="docs/screens/tanitim/22-asistan-menu.png" width="100%" alt="Asistan penceresi: Satış, Üretim, Stok, Satın alma, Özet ve Nasıl yapılır başlıklı altı kutucuk"></p>

### Kart cevabı

<p align="center"><img src="docs/screens/tanitim/23-asistan-kart.png" width="100%" alt="Asistan kritik stok kartı: kalemler, Aç bağlantıları ve devam çipleri"></p>

### Bunu mu demek istediniz?

<p align="center"><img src="docs/screens/tanitim/24-asistan-yazim-hatasi.png" width="100%" alt="Asistan anlaşılmayan yazıya Bunu mu demek istediniz diye öneri çipleri sunuyor"></p>

### Telefonda tam ekran

<p align="center"><img src="docs/screens/tanitim/25-asistan-telefon.png" width="100%" alt="Asistan telefonda tam ekran pencere olarak açılmış, altı kutucuklu ana menü"></p>

## Koyu tema ve telefon

### Koyu tema

<p align="center"><img src="docs/screens/tanitim/26-koyu-tema.png" width="100%" alt="Koyu temada ana panel"></p>

### Telefon

<p align="center"><img src="docs/screens/tanitim/27-telefon.png" width="100%" alt="Telefonda siparişler listesi"></p>

## Kullanılan teknolojiler

- **Next.js 16** ve **React 19**: uygulama iskeleti
- **TypeScript** ve **Tailwind CSS 4**: tür güvenliği ve tasarım sistemi
- **PGlite**: tarayıcının içinde çalışan PostgreSQL
- **Drizzle ORM**: şema ve sorgular
- **TanStack Query**: veri önbelleği
- **Radix UI**: erişilebilir bileşenler
- **cmdk**: Ctrl+K komut paleti
- **dnd-kit**: haftalık planda sürükle-bırak
- **Motion**: animasyonlar

Firma ve kişi adları kurgusaldır, fiyatlar herkese açık Türkçe kaynaklardan alınmıştır; ayrıntı için [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
