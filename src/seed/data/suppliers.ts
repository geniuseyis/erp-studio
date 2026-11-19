// Örnek tedarikçiler. Hepsi kurgusaldır: ad, kişi ve telefon numaraları gerçek firmalarla ilgili değildir
// (telefonlar `0 2xx 000 00 NN` biçimindedir, bu numaralar kullanımda değildir). Fiyatlar malzemenin kaynaklı
// KDV hariç fiyatıdır (SEED_MATERIALS, docs/DATA_SOURCES.md); tercihli tedarikçi birebir o fiyatı verir, alternatif
// tedarikçi %4–8 pahalıdır. Kodlar sırayla TED-0001'den başlar.
import { SEED_MATERIALS, type SeedCategory, type SeedMaterial } from "./materials";

export type SeedSupplier = {
  name: string;
  city: string;
  contact: string;
  leadTimeDays: number;
  paymentTermDays: number;
  items: { material: string; priceFactor: number; moq: number; preferred: boolean }[];
};

/** En az sipariş miktarı (birim cinsinden): birimin ve kategorinin alışılmış parti büyüklüğü. */
function moqFor(m: SeedMaterial): number {
  if (m.unit === "plaka") return 10;
  if (m.unit === "m3") return 1;
  if (m.unit === "L") return 20;
  if (m.unit === "kg") return 25;
  if (m.unit === "m") return m.category === "kenar_bandi" ? 500 : 50;
  return m.category === "hirdavat" ? 200 : 20; // adet
}

const ofCategory = (category: SeedCategory, priceFactor: number, preferred: boolean): SeedSupplier["items"] =>
  SEED_MATERIALS.filter((m) => m.category === category).map((m) => ({ material: m.name, priceFactor, moq: moqFor(m), preferred }));

/** Tedarikçinin teslim süresi, tercihli olduğu malzemelerin en kısa süresidir (malzemeden uzun söz vermez). */
const leadOf = (items: SeedSupplier["items"]): number =>
  Math.min(...items.filter((i) => i.preferred).map((i) => SEED_MATERIALS.find((m) => m.name === i.material)?.leadTimeDays ?? 7));

function supplier(name: string, city: string, contact: string, paymentTermDays: number, items: SeedSupplier["items"]): SeedSupplier {
  return { name, city, contact, leadTimeDays: leadOf(items), paymentTermDays, items };
}

export const SEED_SUPPLIERS: SeedSupplier[] = [
  supplier("Sapanca Yonga Levha", "Sakarya", "Ramazan Kılıç", 45, ofCategory("panel", 1, true)),
  supplier("Karacabey Kereste ve Panel", "Bursa", "Hacer Tuncer", 30, [...ofCategory("masif", 1, true), ...ofCategory("panel", 1.06, false)]),
  supplier("Dilovası Kenar Bandı", "Kocaeli", "Selahattin Oral", 30, ofCategory("kenar_bandi", 1, true)),
  supplier("Gebze Bağlantı Elemanları", "Kocaeli", "Nurten Başaran", 60, ofCategory("hirdavat", 1, true)),
  supplier("Tuzla Vernik ve Tutkal", "İstanbul", "Cengiz Yazıcı", 30, ofCategory("boya", 1, true)),
  supplier("İnegöl Döşemelik", "Bursa", "Meryem Çetiner", 45, ofCategory("kumas", 1, true)),
  supplier("İkitelli Ambalaj", "İstanbul", "Orhan Dinç", 15, [...ofCategory("ambalaj", 1, true), ...ofCategory("hirdavat", 1.07, false)]),
];

/** Telefon: `0 <alan kodu> 000 00 NN` (NN tedarikçi sırası). */
const AREA: Record<string, string> = { Sakarya: "264", Bursa: "224", Kocaeli: "262", İstanbul: "212" };
export function supplierPhone(s: SeedSupplier, index: number): string {
  return `0 ${AREA[s.city] ?? "216"} 000 00 ${String(index + 1).padStart(2, "0")}`;
}
