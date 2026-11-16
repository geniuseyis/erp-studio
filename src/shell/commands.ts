// Ctrl+K paleti: sayfalar, malzemeler ve komutlar tek listede. React içermez; birim testiyle denetlenir.
import type { SessionUser } from "@/domain/context";
import type { MaterialRow } from "@/domain/inventory/queries";
import { matchesSearch } from "@/domain/text";
import { visibleNav } from "./nav";

export type PaletteGroup = "Sayfalar" | "Malzemeler" | "Komutlar";
export type PaletteItem = { id: string; group: PaletteGroup; label: string; hint?: string; run: () => void };

/** Yazınca listelenen en çok malzeme sayısı. */
export const MAX_MATERIALS = 8;

type Args = {
  user: SessionUser;
  query: string;
  materials: readonly MaterialRow[];
  go: (href: string) => void;
  actions: { toggleTheme(): void; switchAccount(): void; signOut(): void };
};

/**
 * Boş sorguda sayfalar ve komutlar; yazınca sayfalar, malzemeler (kod ya da adla, en çok 8) ve komutlar süzülür.
 * Kullanıcının göremediği sayfalar hiç listelenmez. Sıra: sayfalar, malzemeler, komutlar.
 */
export function buildItems({ user, query, materials, go, actions }: Args): PaletteItem[] {
  const q = query.trim();

  const pages: PaletteItem[] = visibleNav(user)
    .filter((n) => matchesSearch([n.label, n.group], q))
    .map((n) => ({ id: `sayfa:${n.href}`, group: "Sayfalar", label: n.label, hint: n.group, run: () => go(n.href) }));

  const found: PaletteItem[] = q
    ? materials
        .filter((m) => matchesSearch([m.code, m.name], q))
        .slice(0, MAX_MATERIALS)
        .map((m) => ({
          id: `malzeme:${m.id}`,
          group: "Malzemeler",
          label: m.name,
          hint: m.code,
          run: () => go(`/stok/malzemeler?ac=${m.id}`),
        }))
    : [];

  const commands: PaletteItem[] = (
    [
      { id: "komut:tema", group: "Komutlar", label: "Temayı değiştir", hint: "Açık ya da koyu", run: actions.toggleTheme },
      { id: "komut:hesap", group: "Komutlar", label: "Hesap değiştir", hint: "Başka bir çalışanla gir", run: actions.switchAccount },
      { id: "komut:cikis", group: "Komutlar", label: "Çıkış yap", run: actions.signOut },
    ] satisfies PaletteItem[]
  ).filter((c) => matchesSearch([c.label], q));

  return [...pages, ...found, ...commands];
}
