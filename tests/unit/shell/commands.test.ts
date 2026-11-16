import { expect, test, vi } from "vitest";
import type { DepartmentCode, Level, SessionUser } from "@/domain/context";
import type { MaterialRow } from "@/domain/inventory/queries";
import type { ProductRow, WorkOrderRow } from "@/domain/production/queries";
import type { CustomerRow, OrderRow } from "@/domain/sales/queries";
import { buildItems } from "@/shell/commands";

const user = (departmentCode: DepartmentCode, level: Level): SessionUser => ({
  id: "x",
  name: "x",
  email: "x@baltacioglus.example",
  title: "x",
  departmentCode,
  level,
});

const material = (i: number, name: string) => ({ id: `m${i}`, code: `MLZ-${String(i).padStart(4, "0")}`, name }) as MaterialRow;
const MATERIALS = [
  ...Array.from({ length: 10 }, (_, i) => material(i + 1, `Meşe Masif ${20 + i} mm`)),
  material(11, "Ceviz Masif 40 mm"),
  material(12, "Frenli Menteşe 110°"),
];

const ORDERS = Array.from({ length: 7 }, (_, i) => ({ id: `o${i + 1}`, code: `SIP-2026-${String(i + 1).padStart(4, "0")}`, customerName: "Ayhan Mobilya" }) as OrderRow);
const WORK_ORDERS = [
  { id: "w1", code: "IE-2026-0001", productName: "Eksen Gardırop", orderCode: "SIP-2026-0001" },
  { id: "w2", code: "IE-2026-0002", productName: "Sükût Komodin", orderCode: null },
] as WorkOrderRow[];
const CUSTOMERS = [
  { id: "c1", code: "MUS-0001", name: "Şahin Yapı Dekorasyon" },
  { id: "c2", code: "MUS-0002", name: "Ayhan Mobilya" },
] as CustomerRow[];
const PRODUCTS = [
  { id: "p1", code: "URN-0001", name: "Eksen Gardırop" },
  { id: "p2", code: "URN-0002", name: "Ritim Şifonyer" },
] as ProductRow[];

function build(u: SessionUser, query: string) {
  const go = vi.fn();
  const actions = { toggleTheme: vi.fn(), switchAccount: vi.fn(), signOut: vi.fn() };
  const items = buildItems({ user: u, query, materials: MATERIALS, orders: ORDERS, workOrders: WORK_ORDERS, customers: CUSTOMERS, products: PRODUCTS, go, actions });
  return { items, go, actions };
}

test("boş sorguda yalnızca sayfalar ve komutlar; görülemeyen sayfa yok", () => {
  const { items } = build(user("satis", "uzman"), "");
  expect(new Set(items.map((i) => i.group))).toEqual(new Set(["Sayfalar", "Komutlar"]));
  expect(items.map((i) => i.label)).not.toContain("Kullanıcılar");
  expect(build(user("bt", "uzman"), "").items.map((i) => i.label)).toContain("Kullanıcılar");
});

test("'mese' sorgusu Meşe kalemlerini getirir, en çok 8", () => {
  const found = build(user("depo", "uzman"), "mese").items.filter((i) => i.group === "Malzemeler");
  expect(found).toHaveLength(8);
  expect(found.every((i) => i.label.startsWith("Meşe"))).toBe(true);
  expect(found[0]?.hint).toBe("MLZ-0001");
});

test("malzeme seçmek çekmeceyi o malzemeyle açar; sayfa seçmek o sayfaya gider", () => {
  const { items, go } = build(user("depo", "uzman"), "ceviz");
  items.find((i) => i.group === "Malzemeler")?.run();
  expect(go).toHaveBeenCalledWith("/stok/malzemeler?ac=m11");
  const page = build(user("depo", "uzman"), "sayım");
  page.items[0]?.run();
  expect(page.items[0]).toMatchObject({ group: "Sayfalar", label: "Sayım" });
  expect(page.go).toHaveBeenCalledWith("/stok/sayim");
});

test("'çık' ve 'cik' Çıkış yap komutunu bulur", () => {
  for (const q of ["çık", "cik"]) {
    const { items, actions } = build(user("depo", "uzman"), q);
    const signOut = items.find((i) => i.label === "Çıkış yap");
    expect(signOut, q).toBeDefined();
    signOut?.run();
    expect(actions.signOut).toHaveBeenCalled();
  }
});

test("komutlar: tema, hesap değiştir, çıkış; eşleşmeyen sorguda boş", () => {
  const labels = build(user("depo", "uzman"), "").items.filter((i) => i.group === "Komutlar").map((i) => i.label);
  expect(labels).toEqual(["Temayı değiştir", "Hesap değiştir", "Çıkış yap"]);
  expect(build(user("satis", "uzman"), "").items.filter((i) => i.group === "Komutlar").map((i) => i.label)).toEqual([
    "Yeni sipariş",
    "Temayı değiştir",
    "Hesap değiştir",
    "Çıkış yap",
  ]);
  expect(build(user("depo", "uzman"), "zzzz").items).toEqual([]);
});

test("SIP- yazınca sipariş grubu çıkar, en çok 5 kayıt", () => {
  const found = build(user("satis", "uzman"), "SIP-").items.filter((i) => i.group === "Siparişler");
  expect(found).toHaveLength(5);
  expect(found[0]).toMatchObject({ label: "SIP-2026-0001", hint: "Ayhan Mobilya" });
});

test("boş sorguda kayıt yok; kayıt grupları sayfalardan sonra, komutlardan önce gelir", () => {
  expect(build(user("satis", "uzman"), "").items.some((i) => i.id.startsWith("siparis:"))).toBe(false);
  const groups = [...new Set(build(user("yonetim", "mudur"), "i").items.map((i) => i.group))];
  expect(groups).toEqual(["Sayfalar", "Siparişler", "İş emirleri", "Müşteriler", "Ürünler", "Malzemeler", "Komutlar"]);
});

test("iş emri, müşteri ve ürün kodla ya da adla bulunur ve çekmeceyi açan adrese gider", () => {
  const targets: [string, string, string][] = [
    ["IE-2026-0002", "İş emirleri", "/uretim/is-emirleri?ac=w2"],
    ["sahin", "Müşteriler", "/satis/musteriler?ac=c1"],
    ["ritim", "Ürünler", "/uretim/urunler?ac=p2"],
    ["SIP-2026-0003", "Siparişler", "/satis/siparisler?ac=o3"],
  ];
  for (const [q, group, href] of targets) {
    const { items, go } = build(user("depo", "uzman"), q);
    items.find((i) => i.group === group)?.run();
    expect(go, q).toHaveBeenCalledWith(href);
  }
  // İş emri bağlı sipariş koduyla da bulunur.
  expect(build(user("depo", "uzman"), "SIP-2026-0001").items.some((i) => i.id === "is-emri:w1")).toBe(true);
});

test("depo kullanıcısında 'Yeni sipariş' komutu yok; satış uzmanında var ve sihirbazı açar", () => {
  expect(build(user("depo", "uzman"), "yeni").items.some((i) => i.label === "Yeni sipariş")).toBe(false);
  expect(build(user("satis", "operator"), "yeni").items.some((i) => i.label === "Yeni sipariş")).toBe(false);
  const { items, go } = build(user("satis", "uzman"), "yeni sip");
  items.find((i) => i.label === "Yeni sipariş")?.run();
  expect(go).toHaveBeenCalledWith("/satis/siparisler?yeni=1");
});
