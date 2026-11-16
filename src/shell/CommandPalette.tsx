"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Dialog as RadixDialog } from "radix-ui";
import { type ComponentType, useMemo, useState } from "react";
import type { SessionUser } from "@/domain/context";
import { CategorySwatch } from "@/features/inventory/CategorySwatch";
import { useMaterials } from "@/features/inventory/hooks";
import { cn } from "@/ui/cn";
import { ArrowRightIcon, LogoutIcon, MoonIcon, SearchIcon, UsersIcon } from "@/ui/icons";
import { useTheme } from "@/ui/theme";
import { buildItems, type PaletteGroup, type PaletteItem } from "./commands";
import { useSession } from "./session";

const GROUPS: PaletteGroup[] = ["Sayfalar", "Malzemeler", "Komutlar"];
const COMMAND_ICON: Record<string, ComponentType<{ size?: number }>> = {
  "komut:tema": MoonIcon,
  "komut:hesap": UsersIcon,
  "komut:cikis": LogoutIcon,
};

/** Ctrl+K ya da Cmd+K ile açılan arama: sayfaya git, malzemeyi aç, komut çalıştır. */
export function CommandPalette({ user, open, onOpenChange }: { user: SessionUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { resolved, setTheme } = useTheme();
  const { signOut } = useSession();
  const materials = useMaterials();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");

  const items = useMemo(
    () =>
      buildItems({
        user,
        query,
        materials: materials.data ?? [],
        go: (href) => router.push(href),
        actions: { toggleTheme: () => setTheme(resolved === "dark" ? "light" : "dark"), switchAccount: signOut, signOut },
      }),
    [user, query, materials.data, router, resolved, setTheme, signOut],
  );
  const categoryOf = useMemo(() => new Map((materials.data ?? []).map((m) => [`malzeme:${m.id}`, m.category])), [materials.data]);

  // Her yazışta ilk sonuç seçili gelir; Enter onu çalıştırır.
  const firstId = items[0]?.id ?? "";
  const [lastFirst, setLastFirst] = useState(firstId);
  if (firstId !== lastFirst) {
    setLastFirst(firstId);
    setSelected(firstId);
  }

  function change(next: boolean) {
    // Kapanınca arama temizlenir; bir sonraki açılış boş listeyle başlar.
    if (!next) setQuery("");
    onOpenChange(next);
  }

  function run(item: PaletteItem) {
    change(false);
    item.run();
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={change}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] animate-[fade-in_160ms_ease-out]" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-[24px] border border-line bg-surface shadow-panel animate-[pop-in_280ms_var(--ease-pop)]"
        >
          <RadixDialog.Title className="sr-only">Ara ve git</RadixDialog.Title>
          <Command label="Ara ve git" shouldFilter={false} value={selected} onValueChange={setSelected} loop>
            <div className="flex items-center gap-3 border-b border-line px-5">
              <SearchIcon size={18} className="shrink-0 text-fg-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Sayfa, malzeme ya da komut ara"
                className="h-14 w-full bg-transparent text-lg text-fg outline-none placeholder:text-fg-muted"
              />
              <kbd className="hidden shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-fg-muted ring-1 ring-line ring-inset sm:inline">Esc</kbd>
            </div>
            <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-10 text-center text-fg-muted">“{query}” ile eşleşen bir şey yok.</Command.Empty>
              {GROUPS.map((group) => {
                const list = items.filter((i) => i.group === group);
                if (list.length === 0) return null;
                return (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted"
                  >
                    {list.map((item) => {
                      const Icon = COMMAND_ICON[item.id];
                      const category = categoryOf.get(item.id);
                      return (
                        <Command.Item
                          key={item.id}
                          value={item.id}
                          onSelect={() => run(item)}
                          className={cn(
                            "group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-base",
                            "data-[selected=true]:bg-surface-2 data-[selected=true]:ring-1 data-[selected=true]:ring-line data-[selected=true]:ring-inset",
                          )}
                        >
                          {category ? (
                            <CategorySwatch category={category} size="sm" />
                          ) : (
                            <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted ring-1 ring-line ring-inset">
                              {Icon ? <Icon size={15} /> : <ArrowRightIcon size={15} />}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                          {item.hint ? <span className="tabular shrink-0 text-sm text-fg-muted">{item.hint}</span> : null}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                );
              })}
            </Command.List>
          </Command>
          <div className="flex items-center gap-4 border-t border-line bg-surface-2/50 px-5 py-2.5 text-xs text-fg-muted" aria-hidden="true">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> gez
            </span>
            <span>
              <Kbd>Enter</Kbd> aç
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded bg-surface px-1.5 py-0.5 font-sans ring-1 ring-line ring-inset">{children}</kbd>;
}

/** Üst çubuktaki arama düğmesi: paleti açar, kısayolu gösterir. */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  // Kısayol etiketi işletim sistemine göre. Kabuk yalnızca tarayıcıda çizildiği için navigator hazırdır.
  const [mac] = useState(() => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="Control+K Meta+K"
      className="press flex h-10 w-full max-w-sm items-center gap-2.5 rounded-full border border-line bg-surface px-3.5 text-left text-fg-muted shadow-[0_1px_2px_rgb(60_38_18/0.06)] hover:border-line-strong"
    >
      <SearchIcon size={17} />
      <span className="flex-1 truncate">Ara</span>
      <span className="hidden truncate text-sm sm:inline">sayfa, malzeme, komut</span>
      <kbd className="hidden rounded-md bg-surface-2 px-1.5 py-0.5 font-sans text-xs ring-1 ring-line ring-inset sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
