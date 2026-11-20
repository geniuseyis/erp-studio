"use client";

import { AnimatePresence, motion } from "motion/react";
import { Dialog as RadixDialog } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import type { SessionUser } from "@/domain/context";
import { IconButton } from "@/ui/Button";
import { AlertIcon, MenuIcon, MoonIcon, SunIcon } from "@/ui/icons";
import { StatusChip } from "@/ui/StatusChip";
import { useTheme } from "@/ui/theme";
import { AccountMenu } from "./AccountMenu";
import { Assistant } from "./Assistant";
import { CommandPalette, SearchTrigger } from "./CommandPalette";
import { useDb } from "./db-context";
import { Sidebar } from "./Sidebar";

const SIDEBAR_KEY = "erp.sidebar";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Uygulama kabuğu: solda menü, üstte çubuk, ortada ekran. Telefonda menü düğmeyle açılır. */
export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { persistent } = useDb();
  const { resolved, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Ctrl+K (Mac'te Cmd+K) her ekrandan arama paletini açar ya da kapatır.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggle() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
      } catch {
        // Depolama kapalıysa tercih yalnızca bu sayfa için geçerlidir.
      }
      return next;
    });
  }

  return (
    <div className="flex h-dvh bg-bg">
      <Sidebar user={user} collapsed={collapsed} onToggle={toggle} className="hidden shrink-0 md:flex" />

      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] animate-[fade-in_160ms_ease-out] md:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 animate-[panel-in-left_380ms_var(--ease-spring)] md:hidden">
            <RadixDialog.Title className="sr-only">Menü</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Sayfalar arasında gezinin</RadixDialog.Description>
            <Sidebar user={user} layoutId="nav-pill-mobile" onNavigate={() => setMobileOpen(false)} className="rounded-r-[26px] shadow-panel" />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-3 sm:px-6">
          <IconButton label="Menüyü aç" className="md:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon size={18} />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center">
            <SearchTrigger onOpen={() => setPaletteOpen(true)} />
          </div>
          <StatusChip tone="warn" className="shrink-0">
            Örnek veri
          </StatusChip>
          <IconButton
            label={resolved === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
            onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            className="overflow-hidden rounded-full"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={resolved}
                initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                className="grid place-items-center"
              >
                {resolved === "dark" ? <SunIcon size={19} /> : <MoonIcon size={19} />}
              </motion.span>
            </AnimatePresence>
          </IconButton>
          <AccountMenu user={user} />
        </header>

        {!persistent ? (
          <p role="status" className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-warn/30 bg-warn-bg px-4 py-2 text-sm font-medium text-warn sm:mx-6">
            <AlertIcon />
            Tarayıcı deposu kapalı. Veriler bu sekme kapanınca silinir.
          </p>
        ) : null}

        <main tabIndex={-1} className="min-h-0 flex-1 overflow-auto pb-[4.5rem] outline-none">{children}</main>
        <CommandPalette user={user} open={paletteOpen} onOpenChange={setPaletteOpen} />
        <Assistant key={user.id} />
      </div>
    </div>
  );
}
