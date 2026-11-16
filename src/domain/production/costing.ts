// Ürün maliyetinin işçilik kısmı. Örnek katalog (src/seed/data/products.ts) ve ürün ekranları aynı sabitleri kullanır;
// dayanağı docs/DATA_SOURCES.md.

/**
 * İşçilik dakikası, kuruş. 2026 brüt asgari ücret 33.030,00 TL; imalatta 5 puanlık SGK teşvikiyle işverene aylık
 * maliyet 39.223,13 TL. ÷ 225 saat ÷ 60 dk = 2,905 TL/dk.
 */
export const LABOR_KURUS_PER_MINUTE = 291;
/** Varsayım: atölye genel gideri işçilik kadar; dakika maliyeti işçiliğin iki katı. */
export const OVERHEAD_FACTOR = 2;

/** Rota dakikalarının işçilik ve genel gider maliyeti, kuruş (tam sayı). */
export function laborCostKurus(minutes: number): number {
  return minutes * LABOR_KURUS_PER_MINUTE * OVERHEAD_FACTOR;
}
