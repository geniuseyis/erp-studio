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
  expect(sales).toEqual(["/satis/siparisler"]);
  expect(NAV_GROUPS.slice(0, 2)).toEqual(["Genel", "Satış"]);
  expect(labels(user("depo", "uzman"))).toContain("Siparişler");
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
