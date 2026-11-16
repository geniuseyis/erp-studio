// Örnek malzeme kataloğu. Ölçüler piyasa standartlarıdır. Fiyatlar 2026-11-16'da Türkiye'deki kaynaklardan
// toplandı ve KDV HARİÇ tutulur (üretici malzeme KDV'sini indirir). Ayrıntı: docs/DATA_SOURCES.md (bu dosyadan üretilir).

export type SeedCategory = "panel" | "masif" | "kenar_bandi" | "hirdavat" | "boya" | "kumas" | "ambalaj";
export type SeedUnit = "plaka" | "m2" | "m" | "m3" | "adet" | "L" | "kg";

export type SeedSource = {
  site: string;
  url: string;
  /** Kaynakta görünen ürün ve fiyat, kaynağın kendi yazımıyla. */
  note: string;
  /** "sayfa": ürün sayfası açılıp okundu. "özet": site otomatik erişimi engelliyor, fiyat arama sonucundan. */
  checked: "sayfa" | "özet";
  /** Kaynaktaki fiyatın KDV durumu. "dahil" olanlar 1,20'ye bölünerek KDV hariç fiyata çevrildi. */
  vat: "dahil" | "hariç";
};

export type SeedMaterial = {
  name: string;
  category: SeedCategory;
  unit: SeedUnit;
  /** Birim fiyat, TL, KDV hariç. */
  price: number;
  /** Açılış stoğu, birim cinsinden. */
  opening: number;
  /** Yeniden sipariş noktası, birim cinsinden. */
  reorder: number;
  leadTimeDays: number;
  /** true: örnek veride kritik seviyede bırakılır. */
  critical?: boolean;
  /** Fiyatın dayandığı kaynak. */
  source?: SeedSource;
  /** Kaynak yoksa tahminin neye dayandığı. */
  estimate?: string;
};

/** Genel KDV oranı (%20) dahil bir fiyatı KDV hariç fiyata çevirir, kuruşa yuvarlar. */
export const net = (gross: number) => Math.round((gross / 1.2) * 100) / 100;

const CSB_2026_01 = "https://webdosya.csb.gov.tr/v2/yfk/2026/01/1-BF-202619011535-20260119155143.pdf";
const csb = (note: string): SeedSource => ({
  site: "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı 2026 rayiçleri",
  url: CSB_2026_01,
  note,
  checked: "sayfa",
  vat: "hariç",
});
const MDFMARKETI = "http://www.mdfmarketi.com/en-ekonomik-mdf-urunleri-en-ucuz-mdf-marketinde/";
const EMEKOR = "https://www.emekormanurunleri.com/mdf";
const MARMARA = "https://www.marmarakoltuk.com/kumas/";

export const SEED_MATERIALS: SeedMaterial[] = [
  // Panel (plaka fiyatı, 2100×2800 mm)
  {
    name: "MDF Lam 18 mm Parlak Beyaz 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(3000),
    opening: 180,
    reorder: 60,
    leadTimeDays: 5,
    source: {
      site: "Özsoy Orman",
      url: "https://ozsoyorman.com/urun/mdf-lam-nedir/",
      note: "MDF Lam 210×280×18 mm, 1 adet: 3.000,00 TL, fiyata KDV dahil",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "MDF Lam 18 mm Antrasit 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(3200),
    opening: 90,
    reorder: 30,
    leadTimeDays: 5,
    source: {
      site: "Emek Orman Ürünleri",
      url: EMEKOR,
      note: "18 mm MDFLAM referans fiyatı 3.200–4.870 TL (KDV dahil, 12 Ekim 2026); renkli plaka için alt sınır alındı",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Suntalam 18 mm Beyaz 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(1750),
    opening: 220,
    reorder: 80,
    leadTimeDays: 5,
    source: {
      site: "MDF Marketi",
      url: MDFMARKETI,
      note: "18 mm Suntalam 210×280 çift taraf beyaz: 1.750 TL (liste tarihi 12/10/2026; KDV yazmıyor, dahil kabul edildi)",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Suntalam 18 mm Ceviz Desen 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(2350),
    opening: 120,
    reorder: 40,
    leadTimeDays: 5,
    source: {
      site: "Haber Gazetesi",
      url: "https://www.habergazetesi.com.tr/sunta-fiyatlari",
      note: "210×280 cm 18 mm renkli/desenli suntalam: 2.350–2.800 TL (Ocak 2026 ortalaması); alt sınır alındı",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "MDF Lam 8 mm Beyaz Arkalık 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(1850),
    opening: 140,
    reorder: 50,
    leadTimeDays: 5,
    critical: true,
    source: {
      site: "MDF Marketi",
      url: MDFMARKETI,
      note: "8 mm MDF LAM 210×280: 1.850 TL (liste tarihi 12/10/2026; KDV yazmıyor, dahil kabul edildi)",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Ham MDF 18 mm 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(2700),
    opening: 60,
    reorder: 25,
    leadTimeDays: 5,
    source: {
      site: "Emek Orman Ürünleri",
      url: EMEKOR,
      note: "Ham MDF 18 mm 210×280 cm: 2.700 TL (KDV dahil referans fiyat, 12 Ekim 2026)",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Meşe Kaplamalı MDF 19 mm 2100×2800",
    category: "panel",
    unit: "plaka",
    price: net(4870),
    opening: 45,
    reorder: 20,
    leadTimeDays: 10,
    estimate: "İlan bulunamadı. Doğal kaplama melamin kaplamadan pahalıdır; Emek Orman'ın 18 mm MDFLAM aralığının üst sınırı (4.870 TL, KDV dahil) alındı.",
  },

  // Masif (m³ fiyatı)
  {
    name: "Meşe Masif 40 mm, Fırınlanmış",
    category: "masif",
    unit: "m3",
    price: 19200,
    opening: 6.5,
    reorder: 3,
    leadTimeDays: 14,
    critical: true,
    source: csb("10.130.4507 Meşe kerestesi: 19.200,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim)"),
  },
  {
    name: "Ceviz Masif 40 mm, Fırınlanmış",
    category: "masif",
    unit: "m3",
    price: 21600,
    opening: 3.2,
    reorder: 1.5,
    leadTimeDays: 21,
    source: csb("10.130.4508 Ceviz kerestesi: 21.600,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim)"),
  },
  {
    name: "Kayın Masif 50 mm, Fırınlanmış",
    category: "masif",
    unit: "m3",
    price: 12000,
    opening: 5,
    reorder: 2,
    leadTimeDays: 14,
    source: csb("10.130.4509 Kayın kerestesi: 12.000,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim)"),
  },
  {
    name: "Isıl İşlemli Dişbudak 25 mm",
    category: "masif",
    unit: "m3",
    price: 24000,
    opening: 2,
    reorder: 0.8,
    leadTimeDays: 21,
    estimate: "Rayiç listesinde dişbudak yok. Isıl işlem maliyet ekler; meşe rayicinin (19.200 TL/m³) %25 fazlası alındı.",
  },
  {
    name: "Çam Masif 50 mm, Fırın Kurusu",
    category: "masif",
    unit: "m3",
    price: 10200,
    opening: 4,
    reorder: 1.5,
    leadTimeDays: 10,
    source: csb("10.130.4501 Çam kerestesi (I. sınıf): 10.200,00 TL/m³ (1 Ocak 2026 rayici, KDV hariç, işbaşında teslim)"),
  },

  // Kenar bandı (metre fiyatı)
  {
    name: "PVC Kenar Bandı 22×0,4 mm Beyaz",
    category: "kenar_bandi",
    unit: "m",
    price: net(3.39),
    opening: 4000,
    reorder: 1500,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/kenar-bandi-pvc-tutkalsiz-22mm040mm-100mt-mat-akcaagac/p/5000678440",
      note: "PVC kenar bandı 22×0,4 mm 100 m rulo: 339–349 TL; alt sınır alındı",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "ABS Kenar Bandı 22×0,8 mm Beyaz",
    category: "kenar_bandi",
    unit: "m",
    price: 6.3,
    opening: 3000,
    reorder: 1200,
    leadTimeDays: 7,
    critical: true,
    estimate: "Türkiye'de ABS 22×0,8 ilanı bulunamadı. 22×2 mm PVC bandın KDV hariç metre fiyatının (15,75 TL) kalınlık oranıyla yaklaşık %40'ı alındı.",
  },
  {
    name: "ABS Kenar Bandı 22×2 mm Antrasit",
    category: "kenar_bandi",
    unit: "m",
    price: 18.9,
    opening: 1500,
    reorder: 600,
    leadTimeDays: 7,
    estimate: "Türkiye'de ABS 22×2 ilanı bulunamadı. ABS, PVC'den pahalıdır; pvckenarbantlari.com'daki 22×2 mm PVC aralığının (15,75–18,90 TL/m + KDV) üst sınırı alındı.",
  },
  {
    name: "ABS Kenar Bandı 22×2 mm Meşe",
    category: "kenar_bandi",
    unit: "m",
    price: 18.9,
    opening: 1200,
    reorder: 500,
    leadTimeDays: 7,
    estimate: "Antrasit ABS 22×2 ile aynı dayanak: 22×2 mm PVC aralığının üst sınırı (18,90 TL/m + KDV).",
  },
  {
    name: "ABS Kenar Bandı 43×2 mm Ceviz",
    category: "kenar_bandi",
    unit: "m",
    price: 37.8,
    opening: 600,
    reorder: 250,
    leadTimeDays: 10,
    estimate: "Genişlik iki katı olduğundan 22×2 mm ABS tahmininin (18,90 TL/m) iki katı alındı.",
  },

  // Hırdavat (adet fiyatı)
  {
    name: "Frenli Menteşe 110° Düz, 35 mm Çanak",
    category: "hirdavat",
    unit: "adet",
    price: net(51.39),
    opening: 2400,
    reorder: 1000,
    leadTimeDays: 21,
    critical: true,
    source: {
      site: "idefix",
      url: "https://www.idefix.com/std-norm-pistonlu-frenli-duz-mentese-100-lu-paket-p-27356674",
      note: "Std Norm pistonlu frenli düz menteşe, 110°, 35 mm tas, 100'lü paket: 5.138,99 TL (sepette 4.882,04 TL); liste fiyatı alındı",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Frenli Menteşe 110° Yarım Deve",
    category: "hirdavat",
    unit: "adet",
    price: 44.96,
    opening: 900,
    reorder: 400,
    leadTimeDays: 21,
    estimate: "Aynı serinin düz menteşesinin KDV hariç fiyatına (42,83 TL) %5 eklendi; yarım deve gövde biraz daha pahalıdır.",
  },
  {
    name: "Teleskopik Frenli Ray 45 cm (Takım)",
    category: "hirdavat",
    unit: "adet",
    price: net(471.14),
    opening: 320,
    reorder: 120,
    leadTimeDays: 21,
    estimate: "Frenli 45 cm ilanı bulunamadı. Aynı markanın frenli 50 cm takımı (523,49 TL, KDV dahil) boy oranıyla (45/50) küçültüldü.",
  },
  {
    name: "Teleskopik Frenli Ray 50 cm (Takım)",
    category: "hirdavat",
    unit: "adet",
    price: net(523.49),
    opening: 260,
    reorder: 100,
    leadTimeDays: 21,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/samet-galvan-teleskopik-frenli-cekmece-rayi-46x500/p/5000737629",
      note: "Samet Galvan teleskopik frenli çekmece rayı 46×500: 523,49 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Minifiks Bağlantı Seti 15 mm",
    category: "hirdavat",
    unit: "adet",
    price: net(14.9),
    opening: 12000,
    reorder: 5000,
    leadTimeDays: 10,
    source: {
      site: "Cimri (Hepsiburada ilanı)",
      url: "https://www.cimri.com/minifix",
      note: "Hafele Minifix Seti 15/18 mm, 10 adet: 149 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Ahşap Kavela 8×35 mm",
    category: "hirdavat",
    unit: "adet",
    price: net(2),
    opening: 30000,
    reorder: 10000,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/ptx-ahsap-kavela-pimi-50-parca/p/2000024664",
      note: "Ptx ahşap kavela pimi, 50 parça: 99,99 TL (perakende paket; toptan alımda daha ucuzdur)",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Çubuk Kulp 192 mm Mat Siyah",
    category: "hirdavat",
    unit: "adet",
    price: net(122.9),
    opening: 700,
    reorder: 300,
    leadTimeDays: 14,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/hafele-hind-kulp-mat-siyah-192-mm/p/1000331131",
      note: "Hafele Hind kulp mat siyah 192 mm: 122,90 TL (indirimli 92,99 TL); liste fiyatı alındı",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Gardırop Askı Borusu Oval 3 m",
    category: "hirdavat",
    unit: "adet",
    price: net(799.8),
    opening: 120,
    reorder: 50,
    leadTimeDays: 10,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/oval-aski-borusu-krom-150-cm-kbo150/p/1000579705",
      note: "Oval askı borusu krom 150 cm: 399,90 TL; 3 m için iki katı alındı",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Ayarlı Plastik Baza Ayağı 10 cm",
    category: "hirdavat",
    unit: "adet",
    price: net(62.5),
    opening: 3200,
    reorder: 1200,
    leadTimeDays: 10,
    source: {
      site: "Cimri (Hepsiburada ilanı)",
      url: "https://www.cimri.com/plastik-dolap-ayagi",
      note: "Feyza Yapı 10 cm plastik ayak, 4'lü paket: yaklaşık 250 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Sunta Vidası 4×40 mm (1000'lik Kutu)",
    category: "hirdavat",
    unit: "adet",
    price: net(962.34),
    opening: 60,
    reorder: 25,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/sunta-vidasi-4x40-500-adet/p/5001229245",
      note: "Sunta vidası 4×40, 500 adet: 481,17 TL; 1000'lik kutu için iki katı alındı",
      checked: "özet",
      vat: "dahil",
    },
  },

  // Boya ve kimyasal
  {
    name: "Poliüretan Vernik, Mat",
    category: "boya",
    unit: "L",
    price: net(1400),
    opening: 180,
    reorder: 70,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/demarin-demacoat-923-poliuretan-vernik/p/5003388542",
      note: "Demarin Demacoat 923 poliüretan vernik 1 L: 1.400 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Poliüretan Sertleştirici",
    category: "boya",
    unit: "L",
    price: net(1120),
    opening: 90,
    reorder: 35,
    leadTimeDays: 7,
    estimate: "Hacmi belli bir ilan bulunamadı. Aynı sistemin vernik fiyatının (1.400 TL/L, KDV dahil) %80'i alındı.",
  },
  {
    name: "Yağ Bazlı Ahşap Cilası, Doğal",
    category: "boya",
    unit: "L",
    price: net(1106.53),
    opening: 60,
    reorder: 25,
    leadTimeDays: 10,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/polisan-wood-wood-teak-yagi/p/1000106398",
      note: "Polisan Wood Teak yağı, renksiz, 0,75 L: 829,90 TL; litreye çevrildi",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Selülozik Tiner",
    category: "boya",
    unit: "L",
    price: net(178.97),
    opening: 240,
    reorder: 100,
    leadTimeDays: 5,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/pamukkale-manas-selulozik-tiner-10-lt/p/5002074837",
      note: "Pamukkale Manas selülozik tiner 10 L: 1.789,70 TL; litreye çevrildi",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Akrilik Lake Boya, Beyaz",
    category: "boya",
    unit: "kg",
    price: net(570.86),
    opening: 110,
    reorder: 45,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/rich-multi-surface-1750-gr-2102-antik-beyaz/p/1000477706",
      note: "Rich Multi Surface antik beyaz 1.750 g: 999 TL; kilograma çevrildi",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "PVA Ahşap Tutkalı D3",
    category: "boya",
    unit: "kg",
    price: net(323.71),
    opening: 150,
    reorder: 60,
    leadTimeDays: 5,
    source: {
      site: "idefix",
      url: "https://www.idefix.com/shumanss-d3-masif-ahsap-tutkali-25kgkova-p-5475610",
      note: "Shumanss D3 masif ahşap tutkalı 25 kg kova: 8.092,66 TL (sepette 6.878,76 TL); yüksek fiyat alındı, kilograma çevrildi",
      checked: "sayfa",
      vat: "dahil",
    },
  },

  // Kumaş (metre fiyatı)
  {
    name: "Keten Döşemelik Kumaş, Ekru, 140 cm En",
    category: "kumas",
    unit: "m",
    price: net(340),
    opening: 260,
    reorder: 100,
    leadTimeDays: 12,
    critical: true,
    source: {
      site: "Marmara Koltuk",
      url: MARMARA,
      note: "Keten döşemelik kumaş, metre: 340 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Kadife Döşemelik Kumaş, Antrasit",
    category: "kumas",
    unit: "m",
    price: net(550),
    opening: 180,
    reorder: 70,
    leadTimeDays: 12,
    source: {
      site: "Marmara Koltuk",
      url: MARMARA,
      note: "Velvet kadife döşemelik kumaş, metre: 550 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Bukle Döşemelik Kumaş, Krem",
    category: "kumas",
    unit: "m",
    price: net(687.5),
    opening: 120,
    reorder: 50,
    leadTimeDays: 14,
    estimate: "Satış birimi belli bir bukle ilanı bulunamadı. Bukle kadifeden pahalıdır; velvet kadife metre fiyatının (550 TL) %25 fazlası alındı.",
  },
  {
    name: "Elyaf Vatka 200 gr/m²",
    category: "kumas",
    unit: "m",
    price: net(465.33),
    opening: 400,
    reorder: 150,
    leadTimeDays: 7,
    source: {
      site: "n11",
      url: "https://www.n11.com/arama?m=Erpol",
      note: "Erpol vatka elyaf 150 g, 210 cm en, 1 metre: 349 TL; 200 g için ağırlık oranıyla artırıldı",
      checked: "özet",
      vat: "dahil",
    },
  },

  // Ambalaj (adet fiyatı)
  {
    name: "Palet Streç Film 50 cm 17 Mikron 300 m",
    category: "ambalaj",
    unit: "adet",
    price: net(500),
    opening: 90,
    reorder: 36,
    leadTimeDays: 4,
    source: {
      site: "Hepsiburada",
      url: "https://www.hepsiburada.com/ekol-ambalaj-strec-filmler-xc-60001207-b20978",
      note: "Ekol Ambalaj palet streç film 50 cm 17 mikron 2 kg: yaklaşık 500 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Oluklu Mukavva Levha 50×70 cm",
    category: "ambalaj",
    unit: "adet",
    price: net(39.88),
    opening: 1800,
    reorder: 700,
    leadTimeDays: 4,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/kutu-ve-ambalaj-malzemeleri/koli/c/107014001",
      note: "50×70 cm oluklu mukavva, 10 adet: 398,80 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Karton Köşe Koruyucu 1 m",
    category: "ambalaj",
    unit: "adet",
    price: net(15.5),
    opening: 2500,
    reorder: 900,
    leadTimeDays: 4,
    source: {
      site: "n11",
      url: "https://www.n11.com/urun/100adet-1metre-karton-kosebent-kose-koruyucu-palet-kartonu-12287740",
      note: "1 metre karton köşebent, 100 adet: 1.549,90 TL",
      checked: "özet",
      vat: "dahil",
    },
  },
  {
    name: "Balonlu Naylon 100 cm × 100 m",
    category: "ambalaj",
    unit: "adet",
    price: net(2507.43),
    opening: 40,
    reorder: 16,
    leadTimeDays: 4,
    source: {
      site: "Akakçe",
      url: "https://www.akakce.com/ambalaj-naylonu,33.html",
      note: "Balonlu naylon rulo 100 cm × 100 m (40 g/m²): en ucuz 2.507,43 TL",
      checked: "sayfa",
      vat: "dahil",
    },
  },
  {
    name: "Koli Bandı 45 mm × 100 m",
    category: "ambalaj",
    unit: "adet",
    price: net(48.72),
    opening: 300,
    reorder: 120,
    leadTimeDays: 4,
    source: {
      site: "idefix",
      url: "https://www.idefix.com/stella-hotmelt-koli-banti-45-x-100-72-adet-p-17024786",
      note: "Stella hotmelt koli bandı 45×100, 72 adet: 3.508,00 TL (sepette 3.122,12 TL); yüksek fiyat alındı, adede çevrildi",
      checked: "sayfa",
      vat: "dahil",
    },
  },
];
