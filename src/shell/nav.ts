import type { SessionUser } from "@/domain/context";
import { type Action, can, type Module } from "@/domain/permissions";

export type NavGroup = "Genel" | "Satış" | "Üretim" | "Satın alma" | "Stok" | "Yönetim";
/** `action`: maddeyi görmek için gereken işlem; verilmezse görüntüleme. Atölye ekranı yalnızca işlem yapanlara gösterilir. */
/** `keywords`: Ctrl+K paletinde sayfayı adı dışında bulduran sözcükler. */
export type NavItem = { href: string; label: string; module: Module; group: NavGroup; action?: Action; keywords?: string[] };

/** Yan menü. Yalnızca çalışan ekranlar yer alır; yeni modüller hazır olduklarında buraya eklenir. */
export const NAV: NavItem[] = [
  { href: "/", label: "Ana panel", module: "reports", group: "Genel" },
  // Herkes görür: kayıtlarda gizli bilgi yoktur. Kayıt bağlantıları yalnızca görülebilen ekranlara verilir.
  { href: "/islemler", label: "İşlemler", module: "reports", group: "Genel" },
  { href: "/satis/siparisler", label: "Siparişler", module: "sales", group: "Satış" },
  { href: "/satis/musteriler", label: "Müşteriler", module: "sales", group: "Satış" },
  { href: "/uretim/urunler", label: "Ürünler", module: "planning", group: "Üretim" },
  { href: "/uretim/is-emirleri", label: "İş emirleri", module: "planning", group: "Üretim" },
  // Herkes görür; kart taşımak planning:write ister (ekranda sürükleme kapalı, serviste FORBIDDEN).
  { href: "/uretim/plan", label: "Haftalık plan", module: "planning", group: "Üretim", keywords: ["kapasite", "takvim", "istasyon"] },
  { href: "/atolye", label: "Atölye", module: "shopfloor", group: "Üretim", action: "execute" },
  // Herkes görür; taslak açmak purchasing:write, onay purchasing:approve ister (düğmeler ekranda kapalı, serviste FORBIDDEN).
  { href: "/satin-alma/oneriler", label: "Öneriler", module: "purchasing", group: "Satın alma", keywords: ["satın alma önerisi", "eksik malzeme", "kritik"] },
  { href: "/satin-alma/siparisler", label: "Satın alma siparişleri", module: "purchasing", group: "Satın alma", keywords: ["SAS", "onay"] },
  { href: "/satin-alma/tedarikciler", label: "Tedarikçiler", module: "purchasing", group: "Satın alma" },
  { href: "/stok/malzemeler", label: "Malzemeler", module: "inventory", group: "Stok" },
  { href: "/stok/hareketler", label: "Stok hareketleri", module: "inventory", group: "Stok" },
  { href: "/stok/sayim", label: "Sayım", module: "inventory", group: "Stok" },
  { href: "/yonetim/kullanicilar", label: "Kullanıcılar", module: "users", group: "Yönetim" },
];

export const NAV_GROUPS: NavGroup[] = ["Genel", "Satış", "Üretim", "Satın alma", "Stok", "Yönetim"];

/** Kullanıcının görme yetkisi olan menü maddeleri. */
export function visibleNav(user: SessionUser): NavItem[] {
  return NAV.filter((item) => can(user, item.module, item.action ?? "view"));
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
