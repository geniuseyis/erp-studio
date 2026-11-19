import { expect, test } from "vitest";
import type { DepartmentCode, Level, SessionUser } from "@/domain/context";
import { NAV, NAV_GROUPS, safeNextPath, visibleNav } from "@/shell/nav";

const user = (departmentCode: DepartmentCode, level: Level): SessionUser => ({
  id: "x",
  name: "x",
  email: "x@baltacioglus.example",
  title: "x",
  departmentCode,
  level,
});
const labels = (u: SessionUser) => visibleNav(u).map((n) => n.label);

test("satış uzmanı stok sayfalarını görür, kullanıcı yönetimini görmez", () => {
  const seen = labels(user("satis", "uzman"));
  expect(seen).toContain("Malzemeler");
  expect(seen).toContain("Stok hareketleri");
  expect(seen).toContain("Sayım");
  expect(seen).not.toContain("Kullanıcılar");
});

test("satış ekranları 'Satış' grubunda, ana panelin hemen ardından", () => {
  const sales = NAV.filter((n) => n.group === "Satış").map((n) => n.href);
  expect(sales).toEqual(["/satis/siparisler", "/satis/musteriler"]);
  expect(NAV_GROUPS.slice(0, 2)).toEqual(["Genel", "Satış"]);
  expect(labels(user("depo", "uzman"))).toContain("Siparişler");
});

test("üretim ekranları 'Üretim' grubunda, satıştan sonra; haftalık plan iş emirlerinin hemen ardından", () => {
  const production = NAV.filter((n) => n.group === "Üretim").map((n) => n.href);
  expect(production).toEqual(["/uretim/urunler", "/uretim/is-emirleri", "/uretim/plan", "/atolye"]);
  expect(NAV_GROUPS.slice(0, 3)).toEqual(["Genel", "Satış", "Üretim"]);
  expect(NAV.find((n) => n.href === "/uretim/plan")).toMatchObject({ label: "Haftalık plan", module: "planning" });
  // Ürünler, iş emirleri ve plan herkese görünür (görüntüleme serbest; plan taşıma planning:write ister).
  for (const dept of ["satis", "depo", "planlama", "atolye"] as const) {
    expect(labels(user(dept, "uzman"))).toEqual(expect.arrayContaining(["Ürünler", "İş emirleri", "Haftalık plan"]));
  }
});

test("atölye menüsü yalnızca işlem yetkisi olanlara: atölye ve yönetim görür, satış görmez", () => {
  expect(labels(user("atolye", "operator"))).toContain("Atölye");
  expect(labels(user("yonetim", "mudur"))).toContain("Atölye");
  expect(labels(user("satis", "uzman"))).not.toContain("Atölye");
  expect(labels(user("satis", "mudur"))).not.toContain("Atölye");
  expect(labels(user("planlama", "mudur"))).not.toContain("Atölye");
});

test("bilgi işlem ve yönetim kullanıcı yönetimini görür", () => {
  expect(labels(user("bt", "uzman"))).toContain("Kullanıcılar");
  expect(labels(user("yonetim", "mudur"))).toContain("Kullanıcılar");
});

test("menü maddeleri benzersiz adreslere sahip ve ana panelle başlar", () => {
  expect(NAV[0]).toMatchObject({ href: "/", label: "Ana panel" });
  expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  expect(NAV.every((n) => n.href.startsWith("/"))).toBe(true);
});

test("girişten sonraki adres yalnızca uygulama içi bir yol olabilir", () => {
  expect(safeNextPath("/stok/malzemeler?kritik=1")).toBe("/stok/malzemeler?kritik=1");
  expect(safeNextPath("/stok/sayim?fis=Cp{c}")).toBe("/stok/sayim?fis=Cp{c}");
  expect(safeNextPath("/yonetim/kullanicilar")).toBe("/yonetim/kullanicilar");
  expect(safeNextPath("/x\ty")).toBe("/");
  for (const bad of [null, "", "stok", "https://evil.com", "//evil.com", String.raw`/\evil.com`, String.raw`/\/evil.com`, String.raw`\\evil.com`, "/giris", "/giris?sonra=/x"]) {
    expect(safeNextPath(bad), String(bad)).toBe("/");
  }
});

test("İşlemler herkese görünür, Genel grubunda ana panelin hemen altında", () => {
  expect(NAV.filter((n) => n.group === "Genel").map((n) => n.href)).toEqual(["/", "/islemler"]);
  for (const dept of ["yonetim", "satis", "planlama", "atolye", "depo", "satinalma", "bt"] as const) {
    for (const level of ["operator", "uzman", "mudur"] as const) expect(labels(user(dept, level))).toContain("İşlemler");
  }
});

test("satın alma ekranları 'Satın alma' grubunda, üretimden sonra stoktan önce", () => {
  const purchasing = NAV.filter((n) => n.group === "Satın alma");
  expect(purchasing.map((n) => n.href)).toEqual(["/satin-alma/oneriler", "/satin-alma/siparisler", "/satin-alma/tedarikciler"]);
  expect(purchasing.map((n) => n.label)).toEqual(["Öneriler", "Satın alma siparişleri", "Tedarikçiler"]);
  expect(purchasing.every((n) => n.module === "purchasing")).toBe(true);
  expect(NAV_GROUPS).toEqual(["Genel", "Satış", "Üretim", "Satın alma", "Stok", "Yönetim"]);
  // Menüdeki sıra grup sırasını izler: bir grubun maddeleri hiçbir zaman sonraki grubun maddesinden sonra gelmez.
  const order = NAV.map((n) => NAV_GROUPS.indexOf(n.group));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("satış uzmanı satın alma ekranlarını görür (görüntüleme serbest)", () => {
  for (const dept of ["satis", "depo", "planlama", "atolye", "satinalma", "yonetim"] as const) {
    expect(labels(user(dept, "uzman"))).toEqual(expect.arrayContaining(["Öneriler", "Satın alma siparişleri", "Tedarikçiler"]));
  }
});

test("Mal kabul Stok grubunda, Malzemelerden önce; herkes görür", () => {
  const stok = NAV.filter((n) => n.group === "Stok");
  expect(stok[0]).toMatchObject({ href: "/depo/mal-kabul", label: "Mal kabul", module: "inventory" });
  expect(stok.map((n) => n.label)).toEqual(["Mal kabul", "Malzemeler", "Stok hareketleri", "Sayım"]);
  for (const dept of ["satis", "depo", "planlama", "atolye", "satinalma", "yonetim"] as const) expect(labels(user(dept, "uzman"))).toContain("Mal kabul");
});