import { expect, test, vi } from "vitest";
import type { DepartmentCode, Level, SessionUser } from "@/domain/context";
import type { MaterialRow } from "@/domain/inventory/queries";
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

function build(u: SessionUser, query: string) {
  const go = vi.fn();
  const actions = { toggleTheme: vi.fn(), switchAccount: vi.fn(), signOut: vi.fn() };
  return { items: buildItems({ user: u, query, materials: MATERIALS, go, actions }), go, actions };
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
  expect(build(user("depo", "uzman"), "zzzz").items).toEqual([]);
});
