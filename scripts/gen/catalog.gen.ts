// Mobilya sitesinin ürün kitabından parça özetlerini çıkarır: npm run catalog:export (yalnızca yerelde).
// Site yalnızca okunur. Her ürün beyaz ve ahşap kaplamayla bir kez üretilir; paneller PanelSummary'ye çevrilir.
// Çıktı src/seed/data/catalog.generated.json; aynı girişte aynı dosya oluşur.
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { type CatalogEntry, type PanelSummary, productName } from "@/seed/data/products";

const SITE_PRODUCTS = new URL("../../../Baltacıoğlu's/src/furniture/book/products.ts", import.meta.url);
const OUT = "src/seed/data/catalog.generated.json";

type Vec3 = readonly [number, number, number];
type Panel = { role: string; slot: string; size: Vec3 };
type Handle = { style: string };
type Assembly = {
  staticPanels: Panel[];
  doors: { panel: Panel; handle: Handle }[];
  drawers: { front: Panel; box: Panel[]; handle: Handle }[];
  flaps: { panel: Panel; inner: Panel[]; handle: Handle }[];
  shelves: { panel: Panel }[];
  rods: { length: number }[];
};
type Book = {
  BOOK_PRODUCTS: {
    id: string;
    chapter: string;
    category: string;
    name: string;
    dims: { width: number; height: number; depth: number };
    build: (finish: "white" | "wood") => { modules: { assembly: Assembly }[] };
  }[];
  CHAPTERS: { id: string; title: string }[];
};

const FINISHES = [
  ["white", "beyaz"],
  ["wood", "ahsap"],
] as const;

/** Ölçüler 0,1 mm'ye yuvarlanır; kayan nokta artıkları dosyaya girmez. */
const mm = (n: number) => Math.round(n * 10) / 10;

function summarize(p: Panel): PanelSummary {
  const [t, b, a] = p.size.map((n) => mm(Math.abs(n))).sort((x, y) => x - y) as [number, number, number];
  return { t, a, b, slot: p.slot, role: p.role };
}

const panelOrder = (x: PanelSummary, y: PanelSummary) =>
  x.slot.localeCompare(y.slot) || x.role.localeCompare(y.role) || y.a - x.a || y.b - x.b || y.t - x.t;

function entry(product: Book["BOOK_PRODUCTS"][number], finish: "white" | "wood", label: "beyaz" | "ahsap", collection: string): CatalogEntry {
  const modules = product.build(finish).modules.map((m) => m.assembly);
  const panels: Panel[] = [];
  const doors: { height: number }[] = [];
  const drawers: { depth: number }[] = [];
  let flaps = 0;
  let barHandles = 0;
  let rodLengthMm = 0;
  for (const a of modules) {
    panels.push(...a.staticPanels);
    for (const d of a.doors) {
      panels.push(d.panel);
      doors.push({ height: mm(d.panel.size[1]) });
      if (d.handle.style === "bar") barHandles++;
    }
    for (const d of a.drawers) {
      panels.push(d.front, ...d.box);
      drawers.push({ depth: mm(Math.max(...d.box.map((p) => p.size[2]))) });
      if (d.handle.style === "bar") barHandles++;
    }
    for (const f of a.flaps) {
      panels.push(f.panel, ...f.inner);
      flaps++;
      if (f.handle.style === "bar") barHandles++;
    }
    panels.push(...a.shelves.map((s) => s.panel));
    rodLengthMm += a.rods.reduce((sum, r) => sum + r.length, 0);
  }
  return {
    modelKey: product.id,
    name: productName(product.name, product.category),
    category: product.category,
    collection,
    finish: label,
    dims: { width: product.dims.width, depth: product.dims.depth, height: product.dims.height },
    panels: panels.map(summarize).sort(panelOrder),
    doors: doors.sort((x, y) => y.height - x.height),
    drawers: drawers.sort((x, y) => y.depth - x.depth),
    flaps,
    barHandles,
    rodLengthMm: mm(rodLengthMm),
    hasPlinth: panels.some((p) => p.slot === "plinth"),
  };
}

/** Kayıt başına okunur blok, panel başına tek satır: farklar gözle izlenebilsin. */
function format(entries: CatalogEntry[]): string {
  const blocks = entries.map((e) => {
    const { panels, ...rest } = e;
    const fields = Object.entries(rest).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const rows = panels.map((p) => `      ${JSON.stringify(p)}`).join(",\n");
    return `  {\n${fields.join(",\n")},\n    "panels": [\n${rows}\n    ]\n  }`;
  });
  return `[\n${blocks.join(",\n")}\n]\n`;
}

test("mobilya sitesi kataloğunu dışa aktar", async () => {
  const path = fileURLToPath(SITE_PRODUCTS);
  if (!existsSync(path)) {
    throw new Error(`Mobilya sitesi bulunamadı: ${path}. Katalog yalnızca site bu klasörün yanındayken dışa aktarılır.`);
  }
  const book = (await import(/* @vite-ignore */ SITE_PRODUCTS.href)) as Book;
  const titles = new Map(book.CHAPTERS.map((c) => [c.id, c.title]));
  const entries = book.BOOK_PRODUCTS.flatMap((product) =>
    FINISHES.map(([finish, label]) => {
      const collection = titles.get(product.chapter);
      if (!collection) throw new Error(`${product.id}: bölüm başlığı yok (${product.chapter})`);
      return entry(product, finish, label, collection);
    }),
  );
  expect(entries).toHaveLength(40);

  writeFileSync(OUT, format(entries));
  const panelCount = entries.reduce((sum, e) => sum + e.panels.length, 0);
  console.log(`catalog.generated.json yazıldı (${entries.length} kayıt, ${panelCount} panel)`);
}, 120_000);
