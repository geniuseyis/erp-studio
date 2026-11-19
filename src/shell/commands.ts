// Ctrl+K paleti: sayfalar (menüdeki her madde, İşlemler dahil), kayıtlar (sipariş, iş emri, müşteri, ürün, malzeme) ve komutlar tek listede. React içermez; birim testiyle denetlenir.
import type { SessionUser } from "@/domain/context";
import type { MaterialRow } from "@/domain/inventory/queries";
import { can } from "@/domain/permissions";
import type { ProductRow, WorkOrderRow } from "@/domain/production/queries";
import type { PurchaseOrderRow, SupplierRow } from "@/domain/purchasing/queries";
import type { CustomerRow, OrderRow } from "@/domain/sales/queries";
import { matchesSearch } from "@/domain/text";
import { visibleNav } from "./nav";

export type PaletteGroup = "Sayfalar" | "Satış siparişleri" | "Satın alma siparişleri" | "İş emirleri" | "Müşteriler" | "Tedarikçiler" | "Ürünler" | "Malzemeler" | "Komutlar";
export type PaletteItem = { id: string; group: PaletteGroup; label: string; hint?: string; run: () => void };

/** Yazınca listelenen en çok malzeme sayısı. */
export const MAX_MATERIALS = 8;
/** Sipariş, satın alma siparişi, iş emri, müşteri, tedarikçi ve ürün gruplarının her birinde listelenen en çok kayıt. */
export const MAX_RECORDS = 5;

type Args = {
  user: SessionUser;
  query: string;
  materials: readonly MaterialRow[];
  orders: readonly OrderRow[];
  purchaseOrders: readonly PurchaseOrderRow[];
  workOrders: readonly WorkOrderRow[];
  customers: readonly CustomerRow[];
  suppliers: readonly SupplierRow[];
  products: readonly ProductRow[];
  go: (href: string) => void;
  actions: { toggleTheme(): void; switchAccount(): void; signOut(): void };
};

type RecordItem = Omit<PaletteItem, "run"> & { open: string };

/**
 * Boş sorguda sayfalar ve komutlar; yazınca sayfalar, kayıtlar ve komutlar süzülür.
 * Sıra: sayfalar, siparişler, satın alma siparişleri, iş emirleri, müşteriler, tedarikçiler, ürünler (her biri en çok 5), malzemeler (en çok 8), komutlar.
 * Kullanıcının göremediği sayfalar ve o sayfalara ait kayıtlar hiç listelenmez.
 */
export function buildItems({ user, query, materials, orders, purchaseOrders, workOrders, customers, suppliers, products, go, actions }: Args): PaletteItem[] {
  const q = query.trim();
  const nav = visibleNav(user);
  const sees = (href: string) => nav.some((n) => n.href === href);

  const pages: PaletteItem[] = nav
    .filter((n) => matchesSearch([n.label, n.group, ...(n.keywords ?? [])], q))
    .map((n) => ({ id: `sayfa:${n.href}`, group: "Sayfalar", label: n.label, hint: n.group, run: () => go(n.href) }));

  /** Yazılan sorguya uyan kayıtlar; sorgu boşsa ya da ekranı göremiyorsa hiçbiri. */
  function records<T>(href: string, rows: readonly T[], fields: (row: T) => string[], max: number, item: (row: T) => RecordItem): PaletteItem[] {
    if (!q || !sees(href)) return [];
    return rows
      .filter((r) => matchesSearch(fields(r), q))
      .slice(0, max)
      .map((r) => {
        const { open, ...rest } = item(r);
        return { ...rest, run: () => go(open) };
      });
  }

  const found: PaletteItem[] = [
    ...records("/satis/siparisler", orders, (o) => [o.code, o.customerName], MAX_RECORDS, (o) => ({
      id: `siparis:${o.id}`,
      group: "Satış siparişleri",
      label: o.code,
      hint: o.customerName,
      open: `/satis/siparisler?ac=${o.id}`,
    })),
    ...records("/satin-alma/siparisler", purchaseOrders, (o) => [o.code, o.supplierCode, o.supplierName], MAX_RECORDS, (o) => ({
      id: `satin-alma:${o.id}`,
      group: "Satın alma siparişleri",
      label: o.code,
      hint: o.supplierName,
      open: `/satin-alma/siparisler?ac=${o.id}`,
    })),
    ...records("/uretim/is-emirleri", workOrders, (w) => [w.code, w.productName, w.orderCode ?? ""], MAX_RECORDS, (w) => ({
      id: `is-emri:${w.id}`,
      group: "İş emirleri",
      label: w.code,
      hint: w.productName,
      open: `/uretim/is-emirleri?ac=${w.id}`,
    })),
    ...records("/satis/musteriler", customers, (c) => [c.code, c.name], MAX_RECORDS, (c) => ({
      id: `musteri:${c.id}`,
      group: "Müşteriler",
      label: c.name,
      hint: c.code,
      open: `/satis/musteriler?ac=${c.id}`,
    })),
    ...records("/satin-alma/tedarikciler", suppliers, (s) => [s.code, s.name], MAX_RECORDS, (s) => ({
      id: `tedarikci:${s.id}`,
      group: "Tedarikçiler",
      label: s.name,
      hint: s.code,
      open: `/satin-alma/tedarikciler?ac=${s.id}`,
    })),
    ...records("/uretim/urunler", products, (p) => [p.code, p.name], MAX_RECORDS, (p) => ({
      id: `urun:${p.id}`,
      group: "Ürünler",
      label: p.name,
      hint: p.code,
      open: `/uretim/urunler?ac=${p.id}`,
    })),
    ...records("/stok/malzemeler", materials, (m) => [m.code, m.name], MAX_MATERIALS, (m) => ({
      id: `malzeme:${m.id}`,
      group: "Malzemeler",
      label: m.name,
      hint: m.code,
      open: `/stok/malzemeler?ac=${m.id}`,
    })),
  ];

  const newOrder: PaletteItem[] = can(user, "sales", "write")
    ? [{ id: "komut:yeni-siparis", group: "Komutlar", label: "Yeni sipariş", hint: "Sipariş taslağı aç", run: () => go("/satis/siparisler?yeni=1") }]
    : [];
  const commands: PaletteItem[] = (
    [
      ...newOrder,
      { id: "komut:tema", group: "Komutlar", label: "Temayı değiştir", hint: "Açık ya da koyu", run: actions.toggleTheme },
      { id: "komut:hesap", group: "Komutlar", label: "Hesap değiştir", hint: "Başka bir çalışanla gir", run: actions.switchAccount },
      { id: "komut:cikis", group: "Komutlar", label: "Çıkış yap", run: actions.signOut },
    ] satisfies PaletteItem[]
  ).filter((c) => matchesSearch([c.label], q));

  return [...pages, ...found, ...commands];
}
