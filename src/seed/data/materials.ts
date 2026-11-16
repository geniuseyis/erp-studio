// Örnek malzeme kataloğu. Ölçüler piyasa standartlarıdır. Fiyatlar 2026-11-15'te yapılan aramalardan gelir;
// kaynağı olmayan kalemler benzer kalemden tahmindir. Ayrıntı: docs/DATA_SOURCES.md (bu dosyadan üretilir).

export type SeedCategory = "panel" | "masif" | "kenar_bandi" | "hirdavat" | "boya" | "kumas" | "ambalaj";
export type SeedUnit = "plaka" | "m2" | "m" | "m3" | "adet" | "L" | "kg";

export type SeedMaterial = {
  name: string;
  category: SeedCategory;
  unit: SeedUnit;
  /** Birim fiyat, TL. */
  price: number;
  /** Açılış stoğu, birim cinsinden. */
  opening: number;
  /** Yeniden sipariş noktası, birim cinsinden. */
  reorder: number;
  leadTimeDays: number;
  /** true: örnek veride kritik seviyede bırakılır. */
  critical?: boolean;
  /** Fiyatın dayandığı ilan. Yoksa fiyat tahmindir. */
  source?: { site: string; url: string; note: string };
};

const BAUHAUS_MDF = {
  site: "Bauhaus",
  url: "https://www.bauhaus.com.tr/mdflam-2100-2800-18-mm-parlak-beyaz-cy-61514960",
  note: "MdfLam 2100×2800×18 mm Parlak Beyaz: 1.590,00 TL",
};
const BAUHAUS_SUNTA = {
  site: "Bauhaus",
  url: "https://www.bauhaus.com.tr/suntalam-2100-2800-18mm-441-flora-1-plaka-588m2-61537949",
  note: "Suntalam 2100×2800×18 mm (441 Flora 1): 1.150,00 TL; aynı fiyat diğer desenlere uygulandı",
};

export const SEED_MATERIALS: SeedMaterial[] = [
  // Panel
  { name: "MDF Lam 18 mm Parlak Beyaz 2100×2800", category: "panel", unit: "plaka", price: 1590, opening: 180, reorder: 60, leadTimeDays: 5, source: BAUHAUS_MDF },
  { name: "MDF Lam 18 mm Antrasit 2100×2800", category: "panel", unit: "plaka", price: 1650, opening: 90, reorder: 30, leadTimeDays: 5 },
  { name: "Suntalam 18 mm Beyaz 2100×2800", category: "panel", unit: "plaka", price: 1150, opening: 220, reorder: 80, leadTimeDays: 5, source: BAUHAUS_SUNTA },
  { name: "Suntalam 18 mm Ceviz Desen 2100×2800", category: "panel", unit: "plaka", price: 1150, opening: 120, reorder: 40, leadTimeDays: 5, source: BAUHAUS_SUNTA },
  { name: "MDF Lam 8 mm Beyaz Arkalık 2100×2800", category: "panel", unit: "plaka", price: 780, opening: 140, reorder: 50, leadTimeDays: 5, critical: true },
  { name: "Ham MDF 18 mm 2100×2800", category: "panel", unit: "plaka", price: 1050, opening: 60, reorder: 25, leadTimeDays: 5 },
  { name: "Meşe Kaplamalı MDF 19 mm 2100×2800", category: "panel", unit: "plaka", price: 3400, opening: 45, reorder: 20, leadTimeDays: 10 },

  // Masif
  { name: "Meşe Masif 40 mm, Fırınlanmış", category: "masif", unit: "m3", price: 65000, opening: 6.5, reorder: 3, leadTimeDays: 14, critical: true },
  { name: "Ceviz Masif 40 mm, Fırınlanmış", category: "masif", unit: "m3", price: 130000, opening: 3.2, reorder: 1.5, leadTimeDays: 21 },
  { name: "Kayın Masif 50 mm, Fırınlanmış", category: "masif", unit: "m3", price: 38000, opening: 5, reorder: 2, leadTimeDays: 14 },
  { name: "Isıl İşlemli Dişbudak 25 mm", category: "masif", unit: "m3", price: 72000, opening: 2, reorder: 0.8, leadTimeDays: 21 },
  {
    name: "Çam Masif 50 mm, Fırın Kurusu",
    category: "masif",
    unit: "m3",
    price: 11500,
    opening: 4,
    reorder: 1.5,
    leadTimeDays: 10,
    source: {
      site: "habergazetesi.com.tr",
      url: "https://www.habergazetesi.com.tr/kereste-fiyatlari",
      note: "Çam fırın kurusu 50×100 mm: 10.000–11.500 TL/m³; sayfanın güncelliği belirsiz",
    },
  },

  // Kenar bandı
  {
    name: "PVC Kenar Bandı 22×0,4 mm Beyaz",
    category: "kenar_bandi",
    unit: "m",
    price: 3.45,
    opening: 4000,
    reorder: 1500,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/kenar-bandi-pvc-tutkalsiz-22mm040mm-100mt-mat-akcaagac/p/5000678440",
      note: "PVC kenar bandı 22×0,4 mm 100 m rulo: 339–349 TL",
    },
  },
  { name: "ABS Kenar Bandı 22×0,8 mm Beyaz", category: "kenar_bandi", unit: "m", price: 6.5, opening: 3000, reorder: 1200, leadTimeDays: 7, critical: true },
  { name: "ABS Kenar Bandı 22×2 mm Antrasit", category: "kenar_bandi", unit: "m", price: 14, opening: 1500, reorder: 600, leadTimeDays: 7 },
  { name: "ABS Kenar Bandı 22×2 mm Meşe", category: "kenar_bandi", unit: "m", price: 15, opening: 1200, reorder: 500, leadTimeDays: 7 },
  { name: "ABS Kenar Bandı 43×2 mm Ceviz", category: "kenar_bandi", unit: "m", price: 29, opening: 600, reorder: 250, leadTimeDays: 10 },

  // Hırdavat
  { name: "Frenli Menteşe 110° Düz, 35 mm Çanak", category: "hirdavat", unit: "adet", price: 62, opening: 2400, reorder: 1000, leadTimeDays: 21, critical: true },
  { name: "Frenli Menteşe 110° Yarım Deve", category: "hirdavat", unit: "adet", price: 66, opening: 900, reorder: 400, leadTimeDays: 21 },
  { name: "Teleskopik Frenli Ray 45 cm (Takım)", category: "hirdavat", unit: "adet", price: 495, opening: 320, reorder: 120, leadTimeDays: 21 },
  {
    name: "Teleskopik Frenli Ray 50 cm (Takım)",
    category: "hirdavat",
    unit: "adet",
    price: 523.49,
    opening: 260,
    reorder: 100,
    leadTimeDays: 21,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/samet-galvan-teleskopik-frenli-cekmece-rayi-46x500/p/5000737629",
      note: "Samet Galvan teleskopik frenli çekmece rayı 46×500: 523,49 TL",
    },
  },
  { name: "Minifiks Bağlantı Seti 15 mm", category: "hirdavat", unit: "adet", price: 4.8, opening: 12000, reorder: 5000, leadTimeDays: 10 },
  { name: "Ahşap Kavela 8×35 mm", category: "hirdavat", unit: "adet", price: 0.45, opening: 30000, reorder: 10000, leadTimeDays: 7 },
  { name: "Çubuk Kulp 192 mm Mat Siyah", category: "hirdavat", unit: "adet", price: 85, opening: 700, reorder: 300, leadTimeDays: 14 },
  { name: "Gardırop Askı Borusu Oval 3 m", category: "hirdavat", unit: "adet", price: 210, opening: 120, reorder: 50, leadTimeDays: 10 },
  { name: "Ayarlı Plastik Baza Ayağı 10 cm", category: "hirdavat", unit: "adet", price: 9.5, opening: 3200, reorder: 1200, leadTimeDays: 10 },
  { name: "Sunta Vidası 4×40 mm (1000'lik Kutu)", category: "hirdavat", unit: "adet", price: 310, opening: 60, reorder: 25, leadTimeDays: 7 },

  // Boya ve kimyasal
  {
    name: "Poliüretan Vernik, Mat",
    category: "boya",
    unit: "L",
    price: 1400,
    opening: 180,
    reorder: 70,
    leadTimeDays: 7,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/demarin-demacoat-923-poliuretan-vernik/p/5003388542",
      note: "Demarin Demacoat 923 poliüretan vernik 1 L: 1.400 TL",
    },
  },
  { name: "Poliüretan Sertleştirici", category: "boya", unit: "L", price: 1150, opening: 90, reorder: 35, leadTimeDays: 7 },
  { name: "Yağ Bazlı Ahşap Cilası, Doğal", category: "boya", unit: "L", price: 950, opening: 60, reorder: 25, leadTimeDays: 10 },
  { name: "Selülozik Tiner", category: "boya", unit: "L", price: 180, opening: 240, reorder: 100, leadTimeDays: 5 },
  { name: "Akrilik Lake Boya, Beyaz", category: "boya", unit: "kg", price: 620, opening: 110, reorder: 45, leadTimeDays: 7 },
  { name: "PVA Ahşap Tutkalı D3", category: "boya", unit: "kg", price: 165, opening: 150, reorder: 60, leadTimeDays: 5 },

  // Kumaş
  { name: "Keten Döşemelik Kumaş, Ekru, 140 cm En", category: "kumas", unit: "m", price: 480, opening: 260, reorder: 100, leadTimeDays: 12, critical: true },
  { name: "Kadife Döşemelik Kumaş, Antrasit", category: "kumas", unit: "m", price: 560, opening: 180, reorder: 70, leadTimeDays: 12 },
  { name: "Bukle Döşemelik Kumaş, Krem", category: "kumas", unit: "m", price: 690, opening: 120, reorder: 50, leadTimeDays: 14 },
  { name: "Elyaf Vatka 200 gr/m²", category: "kumas", unit: "m", price: 75, opening: 400, reorder: 150, leadTimeDays: 7 },

  // Ambalaj
  {
    name: "Palet Streç Film 50 cm 17 Mikron 300 m",
    category: "ambalaj",
    unit: "adet",
    price: 500,
    opening: 90,
    reorder: 36,
    leadTimeDays: 4,
    source: {
      site: "Hepsiburada",
      url: "https://www.hepsiburada.com/ekol-ambalaj-strec-filmler-xc-60001207-b20978",
      note: "Ekol Ambalaj palet streç film 50 cm 17 mikron 2 kg: yaklaşık 500 TL",
    },
  },
  {
    name: "Oluklu Mukavva Levha 50×70 cm",
    category: "ambalaj",
    unit: "adet",
    price: 39.88,
    opening: 1800,
    reorder: 700,
    leadTimeDays: 4,
    source: {
      site: "Koçtaş",
      url: "https://www.koctas.com.tr/kutu-ve-ambalaj-malzemeleri/koli/c/107014001",
      note: "50×70 cm oluklu mukavva 10 adet: 398,80 TL",
    },
  },
  { name: "Karton Köşe Koruyucu 1 m", category: "ambalaj", unit: "adet", price: 14, opening: 2500, reorder: 900, leadTimeDays: 4 },
  { name: "Balonlu Naylon 100 cm × 100 m", category: "ambalaj", unit: "adet", price: 780, opening: 40, reorder: 16, leadTimeDays: 4 },
  { name: "Koli Bandı 45 mm × 100 m", category: "ambalaj", unit: "adet", price: 48, opening: 300, reorder: 120, leadTimeDays: 4 },
];
