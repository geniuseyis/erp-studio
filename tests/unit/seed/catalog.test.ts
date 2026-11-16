import { describe, expect, test } from "vitest";
import { SEED_MATERIALS } from "@/seed/data/materials";
import {
  type CatalogEntry,
  type PanelSummary,
  type SeedBomLine,
  LABOR_KURUS_PER_MINUTE,
  SEED_PRODUCTS,
  STATIONS,
  deriveBom,
  deriveRouting,
  priceKurus,
  productName,
  unitCostKurus,
  vatRateFor,
} from "@/seed/data/products";

const byName = (bom: SeedBomLine[]) =>
  Object.fromEntries(bom.map((l) => [l.material, { qtyMilli: l.qtyMilli, scrapPermille: l.scrapPermille }])) as Record<
    string,
    { qtyMilli: number; scrapPermille: number } | undefined
  >;

const p = (t: number, a: number, b: number, slot: string, role: string): PanelSummary => ({ t, a, b, slot, role });

/** İki kapaklı, tek raflı, bazalı beyaz dolap. */
const twoDoor: CatalogEntry = {
  modelKey: "deneme-dolap",
  name: "Deneme Dolap",
  category: "Gardırop",
  collection: "Yatak Odası",
  finish: "beyaz",
  dims: { width: 1000, depth: 600, height: 2100 },
  panels: [
    p(18, 2000, 600, "body", "side"),
    p(18, 2000, 600, "body", "side"),
    p(18, 964, 600, "body", "top"),
    p(18, 964, 600, "body", "bottom"),
    p(6, 2000, 964, "interior", "back"),
    p(19, 2000, 497, "door", "door"),
    p(19, 2000, 497, "door", "door"),
    p(18, 960, 560, "interior", "shelf"),
  ],
  doors: [{ height: 2000 }, { height: 2000 }],
  drawers: [],
  flaps: 0,
  barHandles: 2,
  rodLengthMm: 960,
  hasPlinth: true,
};
const twoDoorWood: CatalogEntry = { ...twoDoor, finish: "ahsap" };

describe("reçete kuralları", () => {
  test("iki kapaklı beyaz dolabın plaka miktarları", () => {
    const bom = byName(deriveBom(twoDoor));
    // 2 × 2,0 × 0,497 = 1,988 m² ÷ 5,88 = 0,3381 plaka → 340 milli
    expect(bom["MDF Lam 18 mm Parlak Beyaz 2100×2800"]).toEqual({ qtyMilli: 340, scrapPermille: 150 });
    // gövde: 2 × 1,2 + 2 × 0,5784 + raf 0,5376 = 4,0944 m² ÷ 5,88 = 0,6963 → 700
    expect(bom["Suntalam 18 mm Beyaz 2100×2800"]).toEqual({ qtyMilli: 700, scrapPermille: 150 });
    // arkalık 2,0 × 0,964 = 1,928 m² ÷ 5,88 = 0,3279 → 330
    expect(bom["MDF Lam 8 mm Beyaz Arkalık 2100×2800"]).toEqual({ qtyMilli: 330, scrapPermille: 150 });
    expect(bom["Frenli Menteşe 110° Düz, 35 mm Çanak"]!.qtyMilli).toBe(8_000); // 2 kapak × 4 (yükseklik 2000)
    expect(bom["Ayarlı Plastik Baza Ayağı 10 cm"]!.qtyMilli).toBe(4_000);
    expect(bom["Poliüretan Vernik, Mat"]).toBeUndefined(); // beyazda cila yok
  });

  test("beyazda kenar bandı: ön yüz ve raf çevresi ABS, gövde ön kenarı PVC", () => {
    const bom = byName(deriveBom(twoDoor));
    // kapaklar 2 × 2 × (2,0 + 0,497) = 9,988 m; raf 2 × (0,96 + 0,56) = 3,04 m → 13,028 m
    expect(bom["ABS Kenar Bandı 22×0,8 mm Beyaz"]).toEqual({ qtyMilli: 13_030, scrapPermille: 100 });
    // yanlar 2 × 2,0 + üst ve alt 2 × 0,964 = 5,928 m
    expect(bom["PVC Kenar Bandı 22×0,4 mm Beyaz"]).toEqual({ qtyMilli: 5_930, scrapPermille: 100 });
  });

  test("beyaz dolabın hırdavat, tutkal ve ambalaj satırları", () => {
    const bom = byName(deriveBom(twoDoor));
    expect(bom["Çubuk Kulp 192 mm Mat Siyah"]).toEqual({ qtyMilli: 2_000, scrapPermille: 0 });
    expect(bom["Gardırop Askı Borusu Oval 3 m"]).toEqual({ qtyMilli: 320, scrapPermille: 0 }); // 960 ÷ 3000 = 0,32
    // gövde paneli: 2 yan, üst, alt ve raf = 5 → 20'şer adet
    expect(bom["Minifiks Bağlantı Seti 15 mm"]).toEqual({ qtyMilli: 20_000, scrapPermille: 50 });
    expect(bom["Ahşap Kavela 8×35 mm"]).toEqual({ qtyMilli: 20_000, scrapPermille: 50 });
    // (8 × 4 + 0 × 12 + 2 × 2 + 20) ÷ 1000 = 0,056 kutu
    expect(bom["Sunta Vidası 4×40 mm (1000'lik Kutu)"]!.qtyMilli).toBe(60);
    expect(bom["PVA Ahşap Tutkalı D3"]!.qtyMilli).toBe(160); // 8 panel × 0,02 kg
    // S = 2 × (1,0 × 0,6 + 1,0 × 2,1 + 0,6 × 2,1) = 7,92 m²
    expect(bom["Oluklu Mukavva Levha 50×70 cm"]!.qtyMilli).toBe(23_000); // ceil(7,92 ÷ 0,35) = 23
    expect(bom["Karton Köşe Koruyucu 1 m"]!.qtyMilli).toBe(8_000);
    expect(bom["Balonlu Naylon 100 cm × 100 m"]!.qtyMilli).toBe(80); // 0,0792
    expect(bom["Koli Bandı 45 mm × 100 m"]!.qtyMilli).toBe(200);
    expect(bom["Palet Streç Film 50 cm 17 Mikron 300 m"]!.qtyMilli).toBe(20);
    expect(bom["Teleskopik Frenli Ray 45 cm (Takım)"]).toBeUndefined();
  });

  test("ahşap kaplamada ön yüz meşe kaplamalı, cila var", () => {
    const bom = byName(deriveBom(twoDoorWood));
    expect(bom["Meşe Kaplamalı MDF 19 mm 2100×2800"]).toEqual({ qtyMilli: 340, scrapPermille: 150 });
    expect(bom["Suntalam 18 mm Ceviz Desen 2100×2800"]).toEqual({ qtyMilli: 700, scrapPermille: 150 });
    expect(bom["MDF Lam 18 mm Parlak Beyaz 2100×2800"]).toBeUndefined();
    expect(bom["Suntalam 18 mm Beyaz 2100×2800"]).toBeUndefined();
    // ön yüz bandı ve gövde bandı aynı malzemeye düşer, toplanır: 13,028 + 5,928 = 18,956 m
    expect(bom["ABS Kenar Bandı 22×2 mm Meşe"]).toEqual({ qtyMilli: 18_960, scrapPermille: 100 });
    // 1,988 m² × 0,24 = 0,47712 L; sertleştirici yarısı; tiner 0,3 katı
    expect(bom["Poliüretan Vernik, Mat"]).toEqual({ qtyMilli: 480, scrapPermille: 100 });
    expect(bom["Poliüretan Sertleştirici"]).toEqual({ qtyMilli: 240, scrapPermille: 100 });
    expect(bom["Selülozik Tiner"]).toEqual({ qtyMilli: 150, scrapPermille: 100 });
  });

  test("ayaklar hacimle masif kerestedir: ahşapta meşe, beyazda kayın", () => {
    const legs: CatalogEntry = { ...twoDoor, panels: [p(42, 120, 42, "leg", "plinth")], doors: [], barHandles: 0, hasPlinth: false };
    // 4 ayak yerine tek ayak: 0,042 × 0,12 × 0,042 = 0,00021168 m³ → 10 milli (en az 10)
    expect(byName(deriveBom(legs))["Kayın Masif 50 mm, Fırınlanmış"]).toEqual({ qtyMilli: 10, scrapPermille: 300 });
    expect(byName(deriveBom({ ...legs, finish: "ahsap" }))["Meşe Masif 40 mm, Fırınlanmış"]).toEqual({ qtyMilli: 10, scrapPermille: 300 });
    expect(byName(deriveBom(legs))["Ayarlı Plastik Baza Ayağı 10 cm"]).toBeUndefined();
  });

  test("ayna ve cam parçalar reçeteye girmez", () => {
    const mirror: CatalogEntry = { ...twoDoor, panels: [p(6, 1000, 800, "mirror", "door"), p(6, 900, 500, "glass", "shelf")] };
    const bom = byName(deriveBom(mirror));
    expect(bom["MDF Lam 8 mm Beyaz Arkalık 2100×2800"]).toBeUndefined();
    expect(bom["PVA Ahşap Tutkalı D3"]).toBeUndefined();
  });

  test("yükseklik 900 ve 901 mm kapakta menteşe 2 ve 3", () => {
    const hinges = (height: number) =>
      byName(deriveBom({ ...twoDoor, doors: [{ height }] }))["Frenli Menteşe 110° Düz, 35 mm Çanak"]!.qtyMilli;
    expect(hinges(900)).toBe(2_000);
    expect(hinges(901)).toBe(3_000);
    expect(hinges(1600)).toBe(3_000);
    expect(hinges(1601)).toBe(4_000);
  });

  test("çekmece derinliği 479 → 45 cm ray, 480 → 50 cm ray", () => {
    const rails = (depth: number) => byName(deriveBom({ ...twoDoor, drawers: [{ depth }] }));
    expect(rails(479)["Teleskopik Frenli Ray 45 cm (Takım)"]).toEqual({ qtyMilli: 1_000, scrapPermille: 0 });
    expect(rails(479)["Teleskopik Frenli Ray 50 cm (Takım)"]).toBeUndefined();
    expect(rails(480)["Teleskopik Frenli Ray 50 cm (Takım)"]).toEqual({ qtyMilli: 1_000, scrapPermille: 0 });
    expect(rails(480)["Teleskopik Frenli Ray 45 cm (Takım)"]).toBeUndefined();
  });

  test("bütün miktarlar 10 millinin katı ve sıfırdan büyük", () => {
    for (const line of [...deriveBom(twoDoor), ...deriveBom(twoDoorWood)]) {
      expect(line.qtyMilli % 10).toBe(0);
      expect(line.qtyMilli).toBeGreaterThan(0);
    }
  });
});

describe("rota kuralları", () => {
  test("rota: beyazda Boya ve cila yok, sıra KSM→KNR→CNC→MNT→PKT", () => {
    // P = 8, E = 18,956 m, H = 8, F = 2
    expect(deriveRouting(twoDoor)).toEqual([
      { station: "KSM", minutesPerUnit: 16 },
      { station: "KNR", minutesPerUnit: 16 },
      { station: "CNC", minutesPerUnit: 28 },
      { station: "MNT", minutesPerUnit: 34 },
      { station: "PKT", minutesPerUnit: 13 },
    ]);
  });

  test("rota: ahşapta montajdan sonra boya ve cila", () => {
    const steps = deriveRouting(twoDoorWood);
    expect(steps.map((s) => s.station)).toEqual(["KSM", "KNR", "CNC", "MNT", "BYA", "PKT"]);
    expect(steps.find((s) => s.station === "BYA")!.minutesPerUnit).toBe(34); // 12 × 1,988 + 10 = 33,86
  });

  test("istasyonlar kod, ad, sıra ve günlük kapasiteyle tanımlı", () => {
    expect(STATIONS.map((s) => [s.code, s.name, s.seq, s.dailyCapacityMin])).toEqual([
      ["KSM", "Kesim", 1, 960],
      ["KNR", "Kenar bantlama", 2, 480],
      ["CNC", "Delik ve CNC", 3, 480],
      ["MNT", "Montaj", 4, 960],
      ["BYA", "Boya ve cila", 5, 480],
      ["PKT", "Paketleme", 6, 480],
    ]);
  });
});

describe("maliyet, fiyat ve KDV", () => {
  test("işçilik dakikası 291 kuruş; maliyet malzeme (fire dahil) + iki kat işçilik", () => {
    expect(LABOR_KURUS_PER_MINUTE).toBe(291);
    // 4 × 52,08 TL = 208,32 TL; 10 dk × 2,91 TL × 2 = 58,20 TL
    expect(unitCostKurus([{ material: "Ayarlı Plastik Baza Ayağı 10 cm", qtyMilli: 4_000, scrapPermille: 0 }], [{ station: "KSM", minutesPerUnit: 10 }])).toBe(
      26_652,
    );
    // fire: 1 plaka × 2.500 TL × 1,15 = 2.875 TL
    expect(unitCostKurus([{ material: "MDF Lam 18 mm Parlak Beyaz 2100×2800", qtyMilli: 1_000, scrapPermille: 150 }], [])).toBe(287_500);
  });

  test("fiyat 50 TL'ye yukarı yuvarlanır ve maliyetin 1,8 katından az değildir", () => {
    expect(priceKurus(100_000)).toBe(180_000);
    expect(priceKurus(100_001)).toBe(185_000);
    const cost = unitCostKurus(deriveBom(twoDoor), deriveRouting(twoDoor));
    const price = priceKurus(cost);
    expect(price % 5_000).toBe(0);
    expect(price).toBeGreaterThanOrEqual(cost * 1.8);
    expect(price - cost * 1.8).toBeLessThan(5_000);
  });

  test.each(["Dekoratif duvar paneli", "LED ayna", "Havluluk"])("%s KDV %%20", (category) => {
    expect(vatRateFor(category)).toBe(20);
  });

  test("gardırop KDV %10", () => {
    expect(vatRateFor("Gardırop")).toBe(10);
  });
});

describe("ürün adı", () => {
  test("kategori model adıyla başlıyorsa ad tekrarlanmaz", () => {
    expect(productName("Köşe", "Köşe sehpası")).toBe("Köşe sehpası");
    expect(productName("KÖŞE", "köşe sehpası")).toBe("Köşe sehpası");
  });

  test("başka durumda model adı ve kategori", () => {
    expect(productName("Eksen", "Gardırop")).toBe("Eksen Gardırop");
    // yalnızca tam kelime: "Ada" + "Adalı masa" birleşir
    expect(productName("Ada", "Adalı masa")).toBe("Ada Adalı masa");
  });

  test("katalogda adı tekrarlanan ürün yok", () => {
    const kose = SEED_PRODUCTS.filter((x) => x.modelKey === "kose-sehpa").map((x) => x.name);
    expect(kose).toEqual(["Köşe sehpası", "Köşe sehpası"]);
  });
});

describe("katalog dosyası", () => {
  test("katalogda 20 model × 2 kaplama, kodlar URN-0001..URN-0040", () => {
    expect(SEED_PRODUCTS).toHaveLength(40);
    expect(SEED_PRODUCTS.map((x) => x.code)).toEqual(Array.from({ length: 40 }, (_, i) => `URN-${String(i + 1).padStart(4, "0")}`));
    expect(SEED_PRODUCTS.map((x) => x.finish)).toEqual(Array.from({ length: 40 }, (_, i) => (i % 2 ? "ahsap" : "beyaz")));
    expect(new Set(SEED_PRODUCTS.map((x) => x.modelKey)).size).toBe(20);
    expect(SEED_PRODUCTS[0]).toMatchObject({ modelKey: "eksen-gardirop", name: "Eksen Gardırop", collection: "Yatak Odası", category: "Gardırop" });
  });

  test("panel özetlerinde t en ince kenar, a ≥ b", () => {
    for (const product of SEED_PRODUCTS) {
      for (const panel of product.panels) {
        expect(panel.t).toBeLessThanOrEqual(panel.b);
        expect(panel.b).toBeLessThanOrEqual(panel.a);
      }
    }
  });

  test("her reçete satırının malzemesi SEED_MATERIALS'ta var", () => {
    const names = new Set(SEED_MATERIALS.map((m) => m.name));
    for (const product of SEED_PRODUCTS) for (const line of product.bom) expect(names).toContain(line.material);
  });

  test("her üründe en az bir reçete satırı ve en az iki rota adımı var", () => {
    for (const product of SEED_PRODUCTS) {
      expect(product.bom.length, product.code).toBeGreaterThan(0);
      if (product.panels.length > 0) expect(product.routing.length, product.code).toBeGreaterThanOrEqual(2);
      // Tek istisna beyaz havluluk: bütünü çelik borudur, hazır alınır; yalnızca paketlenir.
      else expect(product.routing.map((s) => s.station), product.code).toEqual(["PKT"]);
      expect(product.priceKurus % 5_000).toBe(0);
      expect(product.vatRate).toBe(vatRateFor(product.category));
    }
  });

  test("katalog dosyası deriveBom ile kararlı: aynı giriş aynı çıktı", () => {
    for (const product of SEED_PRODUCTS) {
      expect(deriveBom(product)).toEqual(product.bom);
      expect(deriveBom(product)).toEqual(deriveBom(structuredClone(product)));
      expect(deriveRouting(product)).toEqual(product.routing);
    }
  });

  test("panelsiz tek ürün beyaz havluluk", () => {
    expect(SEED_PRODUCTS.filter((x) => x.panels.length === 0).map((x) => `${x.modelKey}/${x.finish}`)).toEqual(["merdiven-havluluk/beyaz"]);
  });

  test("gardırop, köşe sehpasının beş katından pahalı", () => {
    const price = (key: string, finish: string) => SEED_PRODUCTS.find((x) => x.modelKey === key && x.finish === finish)!.priceKurus;
    expect(price("eksen-gardirop", "beyaz") / price("kose-sehpa", "beyaz")).toBeGreaterThan(5);
    expect(price("eksen-gardirop", "ahsap") / price("kose-sehpa", "ahsap")).toBeGreaterThan(5);
  });
});
