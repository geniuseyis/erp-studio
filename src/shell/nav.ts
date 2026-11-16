import type { SessionUser } from "@/domain/context";
import { can, type Module } from "@/domain/permissions";

export type NavGroup = "Genel" | "Satış" | "Stok" | "Yönetim";
export type NavItem = { href: string; label: string; module: Module; group: NavGroup };

/** Yan menü. Yalnızca çalışan ekranlar yer alır; yeni modüller hazır olduklarında buraya eklenir. */
export const NAV: NavItem[] = [
  { href: "/", label: "Ana panel", module: "reports", group: "Genel" },
  { href: "/satis/siparisler", label: "Siparişler", module: "sales", group: "Satış" },
  { href: "/stok/malzemeler", label: "Malzemeler", module: "inventory", group: "Stok" },
  { href: "/stok/hareketler", label: "Stok hareketleri", module: "inventory", group: "Stok" },
  { href: "/stok/sayim", label: "Sayım", module: "inventory", group: "Stok" },
  { href: "/yonetim/kullanicilar", label: "Kullanıcılar", module: "users", group: "Yönetim" },
];

export const NAV_GROUPS: NavGroup[] = ["Genel", "Satış", "Stok", "Yönetim"];

/** Kullanıcının görme yetkisi olan menü maddeleri. */
export function visibleNav(user: SessionUser): NavItem[] {
  return NAV.filter((item) => can(user, item.module, "view"));
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Girişten sonra gidilecek adres yalnızca uygulama içi bir yol olabilir; değilse ana panel. */
export function safeNextPath(value: string | null | undefined): string {
  // Ters eğik çizgi tarayıcıda "/" gibi okunur: "/\evil.com" başka siteye gider. Denetim karakterleri de reddedilir.
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControlChar(value)) return "/";
  if (value === "/giris" || value.startsWith("/giris?") || value.startsWith("/giris/")) return "/";
  return value;
}
