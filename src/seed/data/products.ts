// Örnek mamul kataloğu. Ürünler mobilya sitesinin kitabındaki 20 modeldir; her biri beyaz ve ahşap kaplamayla.
// Parça özetleri catalog.generated.json'dan (npm run catalog:export) gelir; reçete, rota, maliyet ve fiyat
// buradaki kurallarla türetilir. Kuralların dayanağı ve varsayımlar: docs/DATA_SOURCES.md.
import catalog from "./catalog.generated.json";
import { SEED_MATERIALS } from "./materials";

/** Panel özeti, mm. t en ince kenar; a ≥ b. */
export type PanelSummary = { t: number; a: number; b: number; slot: string; role: string };

export type CatalogEntry = {
  modelKey: string;
  name: string;
  category: string;
  collection: string;
  finish: "beyaz" | "ahsap";
  dims: { width: number; depth: number; height: number };
  panels: PanelSummary[];
  doors: { height: number }[];
  drawers: { depth: number }[];
  flaps: number;
  /** handleStyle "bar" olan kapak, çekmece ve klape sayısı. */
  barHandles: number;
  /** Askı borularının toplam boyu. */
  rodLengthMm: number;
  hasPlinth: boolean;
};

/** material: SEED_MATERIALS adı. */
export type SeedBomLine = { material: string; qtyMilli: number; scrapPermille: number };
/** station: STATIONS kodu. */
export type SeedRoutingStep = { station: string; minutesPerUnit: number };

export const STATIONS: { code: string; name: string; seq: number; dailyCapacityMin: number }[] = [
  { code: "KSM", name: "Kesim", seq: 1, dailyCapacityMin: 960 },
  { code: "KNR", name: "Kenar bantlama", seq: 2, dailyCapacityMin: 480 },
  { code: "CNC", name: "Delik ve CNC", seq: 3, dailyCapacityMin: 480 },
  { code: "MNT", name: "Montaj", seq: 4, dailyCapacityMin: 960 },
  { code: "BYA", name: "Boya ve cila", seq: 5, dailyCapacityMin: 480 },
  { code: "PKT", name: "Paketleme", seq: 6, dailyCapacityMin: 480 },
];

/**
 * İşçilik dakikası, kuruş. 2026 brüt asgari ücret 33.030,00 TL; imalatta 5 puanlık SGK teşvikiyle işverene aylık
 * maliyet 39.223,13 TL. ÷ 225 saat ÷ 60 dk = 2,905 TL/dk.
 */
export const LABOR_KURUS_PER_MINUTE = 291;
/** Varsayım: atölye genel gideri işçilik kadar; dakika maliyeti işçiliğin iki katı. */
const OVERHEAD_FACTOR = 2;
/** Varsayım: satış fiyatı maliyetin 1,8 katı (oran 18/10 olarak tamsayıyla hesaplanır). */
const MARKUP_TENTHS = 18;
const PRICE_STEP_KURUS = 5_000;

/** 2100 × 2800 mm plaka. */
const SHEET_M2 = 5.88;
const FRONT_SLOTS = new Set(["door", "drawer", "top"]);
/** Hazır alınan parçalar: ayna camı ve cam. Reçeteye girmez. */
const BOUGHT_IN_SLOTS = new Set(["mirror", "glass"]);

const M = {
  back: "MDF Lam 8 mm Beyaz Arkalık 2100×2800",
  front: { beyaz: "MDF Lam 18 mm Parlak Beyaz 2100×2800", ahsap: "Meşe Kaplamalı MDF 19 mm 2100×2800" },
  body: { beyaz: "Suntalam 18 mm Beyaz 2100×2800", ahsap: "Suntalam 18 mm Ceviz Desen 2100×2800" },
  leg: { beyaz: "Kayın Masif 50 mm, Fırınlanmış", ahsap: "Meşe Masif 40 mm, Fırınlanmış" },
  frontEdge: { beyaz: "ABS Kenar Bandı 22×0,8 mm Beyaz", ahsap: "ABS Kenar Bandı 22×2 mm Meşe" },
  bodyEdge: { beyaz: "PVC Kenar Bandı 22×0,4 mm Beyaz", ahsap: "ABS Kenar Bandı 22×2 mm Meşe" },
  hinge: "Frenli Menteşe 110° Düz, 35 mm Çanak",
  rail45: "Teleskopik Frenli Ray 45 cm (Takım)",
  rail50: "Teleskopik Frenli Ray 50 cm (Takım)",
  handle: "Çubuk Kulp 192 mm Mat Siyah",
  rod: "Gardırop Askı Borusu Oval 3 m",
  minifix: "Minifiks Bağlantı Seti 15 mm",
  dowel: "Ahşap Kavela 8×35 mm",
  screws: "Sunta Vidası 4×40 mm (1000'lik Kutu)",
  plinthFoot: "Ayarlı Plastik Baza Ayağı 10 cm",
  varnish: "Poliüretan Vernik, Mat",
  hardener: "Poliüretan Sertleştirici",
  thinner: "Selülozik Tiner",
  glue: "PVA Ahşap Tutkalı D3",
  board: "Oluklu Mukavva Levha 50×70 cm",
  corner: "Karton Köşe Koruyucu 1 m",
  bubble: "Balonlu Naylon 100 cm × 100 m",
  tape: "Koli Bandı 45 mm × 100 m",
  film: "Palet Streç Film 50 cm 17 Mikron 300 m",
} as const;

/** Kayan nokta artığını (0,30000000004 gibi) yukarı yuvarlamaya taşımamak için önce milyonda bire yuvarlanır. */
const clean = (n: number) => Math.round(n * 1e6) / 1e6;
const ceilClean = (n: number) => Math.ceil(clean(n));

/** Miktar milli'ye çevrilir, 10'un katına yukarı yuvarlanır; sıfırdan büyükse en az 10. */
const toMilli = (qty: number) => {
  const milli = clean(qty * 1000);
  return milli <= 0 ? 0 : Math.max(10, Math.ceil(milli / 10) * 10);
};

type Kind = "thin" | "leg" | "front" | "body";
const kindOf = (p: PanelSummary): Kind | null =>
  BOUGHT_IN_SLOTS.has(p.slot) ? null : p.t <= 10 ? "thin" : p.slot === "leg" ? "leg" : FRONT_SLOTS.has(p.slot) ? "front" : "body";

const hingesFor = (height: number) => (height <= 900 ? 2 : height <= 1600 ? 3 : 4);

/** Reçete ve rotanın ortak ölçüleri. Alan m², hacim m³, uzunluk m. */
function measure(e: CatalogEntry) {
  const m = { panels: 0, bodyPanels: 0, thinArea: 0, frontArea: 0, bodyArea: 0, legVolume: 0, frontEdge: 0, bodyEdge: 0 };
  for (const p of e.panels) {
    const kind = kindOf(p);
    if (!kind) continue;
    m.panels++;
    const area = (p.a * p.b) / 1e6;
    if (kind === "thin") m.thinArea += area;
    else if (kind === "leg") m.legVolume += (p.t * p.a * p.b) / 1e9;
    else {
      if (kind === "front") m.frontArea += area;
      else {
        m.bodyArea += area;
        m.bodyPanels++;
      }
      if (kind === "front" || p.role === "shelf") m.frontEdge += (2 * (p.a + p.b)) / 1000;
      else m.bodyEdge += p.a / 1000;
    }
  }
  const hinges = e.doors.reduce((sum, d) => sum + hingesFor(d.height), 0);
  const rails = e.drawers.length;
  return { ...m, hinges, rails, edge: m.frontEdge + m.bodyEdge };
}

export function deriveBom(e: CatalogEntry): SeedBomLine[] {
  const f = e.finish;
  const m = measure(e);
  const lines = new Map<string, { qty: number; scrap: number }>();
  const add = (material: string, qty: number, scrap: number) => {
    if (clean(qty) <= 0) return;
    const line = lines.get(material);
    if (!line) lines.set(material, { qty, scrap });
    else if (line.scrap !== scrap) throw new Error(`${material}: aynı malzemeye iki farklı fire oranı`);
    else line.qty += qty;
  };

  add(M.back, m.thinArea / SHEET_M2, 150);
  add(M.front[f], m.frontArea / SHEET_M2, 150);
  add(M.body[f], m.bodyArea / SHEET_M2, 150);
  add(M.leg[f], m.legVolume, 300);
  add(M.frontEdge[f], m.frontEdge, 100);
  add(M.bodyEdge[f], m.bodyEdge, 100);
  add(M.hinge, m.hinges, 0);
  for (const d of e.drawers) add(d.depth >= 480 ? M.rail50 : M.rail45, 1, 0);
  add(M.handle, e.barHandles, 0);
  add(M.rod, e.rodLengthMm / 3000, 0);
  add(M.minifix, m.bodyPanels * 4, 50);
  add(M.dowel, m.bodyPanels * 4, 50);
  add(M.screws, (m.hinges * 4 + m.rails * 12 + e.barHandles * 2 + 20) / 1000, 0);
  if (e.hasPlinth) add(M.plinthFoot, 4, 0);
  if (f === "ahsap") {
    const varnish = m.frontArea * 0.24;
    add(M.varnish, varnish, 100);
    add(M.hardener, varnish / 2, 100);
    add(M.thinner, varnish * 0.3, 100);
  }
  add(M.glue, m.panels * 0.02, 0);

  const { width, depth, height } = e.dims;
  const surface = (2 * (width * depth + width * height + depth * height)) / 1e6;
  add(M.board, ceilClean(surface / 0.35), 0);
  add(M.corner, 8, 0);
  add(M.bubble, surface / 100, 0);
  add(M.tape, 0.2, 0);
  add(M.film, 0.02, 0);

  return [...lines].map(([material, l]) => ({ material, qtyMilli: toMilli(l.qty), scrapPermille: l.scrap }));
}

export function deriveRouting(e: CatalogEntry): SeedRoutingStep[] {
  const m = measure(e);
  const P = m.panels;
  const F = e.doors.length + e.drawers.length + e.flaps;
  const minutes: Record<string, number> = {
    KSM: ceilClean(2 * P),
    KNR: ceilClean(0.8 * m.edge),
    CNC: ceilClean(1.5 * P + 2 * (m.hinges + m.rails)),
    MNT: ceilClean(3 * P + 5 * F),
    BYA: e.finish === "ahsap" ? ceilClean(12 * m.frontArea + 10) : 0,
    PKT: ceilClean(10 + P / 3),
  };
  return STATIONS.filter((s) => minutes[s.code]! > 0).map((s) => ({ station: s.code, minutesPerUnit: minutes[s.code]! }));
}

const PRICE_BY_NAME = new Map(SEED_MATERIALS.map((x) => [x.name, x.price]));

/** Malzeme (SEED_MATERIALS fiyatı, fire dahil) + dakika × işçilik × genel gider çarpanı. Kuruş. */
export function unitCostKurus(bom: SeedBomLine[], routing: SeedRoutingStep[]): number {
  let material = 0;
  for (const line of bom) {
    const price = PRICE_BY_NAME.get(line.material);
    if (price === undefined) throw new Error(`Malzeme katalogda yok: ${line.material}`);
    material += (price * 100 * line.qtyMilli * (1000 + line.scrapPermille)) / 1e6;
  }
  const minutes = routing.reduce((sum, s) => sum + s.minutesPerUnit, 0);
  return Math.round(material) + minutes * LABOR_KURUS_PER_MINUTE * OVERHEAD_FACTOR;
}

/** KDV hariç satış fiyatı: maliyet × 1,8, 50 TL'ye yukarı yuvarlanır. */
export function priceKurus(costKurus: number): number {
  return Math.ceil((costKurus * MARKUP_TENTHS) / (10 * PRICE_STEP_KURUS)) * PRICE_STEP_KURUS;
}

/** Mobilya olmayan katalog ürünleri (9403/9401 pozisyonunda değil): genel oran. */
const GENERAL_VAT_CATEGORIES = new Set(["Dekoratif duvar paneli", "LED ayna", "Havluluk"]);

export function vatRateFor(category: string): 10 | 20 {
  return GENERAL_VAT_CATEGORIES.has(category) ? 20 : 10;
}

export const SEED_PRODUCTS: (CatalogEntry & {
  code: string;
  bom: SeedBomLine[];
  routing: SeedRoutingStep[];
  priceKurus: number;
  vatRate: 10 | 20;
})[] = (catalog as CatalogEntry[]).map((entry, i) => {
  const bom = deriveBom(entry);
  const routing = deriveRouting(entry);
  return {
    ...entry,
    code: `URN-${String(i + 1).padStart(4, "0")}`,
    bom,
    routing,
    priceKurus: priceKurus(unitCostKurus(bom, routing)),
    vatRate: vatRateFor(entry.category),
  };
});
