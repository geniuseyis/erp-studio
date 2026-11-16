"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { DEPARTMENT_NAMES, type SessionUser } from "@/domain/context";
import { cn } from "@/ui/cn";
import { ArrowsIcon, BoxIcon, ClipboardIcon, ContactIcon, HomeIcon, MalletIcon, PanelIcon, ReceiptIcon, SawIcon, TagIcon, UsersIcon } from "@/ui/icons";
import { SLIDE_SPRING } from "@/ui/motion";
import { Brand } from "./Brand";
import { NAV_GROUPS, visibleNav } from "./nav";

const ICON: Record<string, ComponentType<{ size?: number }>> = {
  "/": HomeIcon,
  "/satis/siparisler": ReceiptIcon,
  "/satis/musteriler": ContactIcon,
  "/uretim/urunler": TagIcon,
  "/uretim/is-emirleri": SawIcon,
  "/atolye": MalletIcon,
  "/stok/malzemeler": BoxIcon,
  "/stok/hareketler": ArrowsIcon,
  "/stok/sayim": ClipboardIcon,
  "/yonetim/kullanicilar": UsersIcon,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

type Props = {
  user: SessionUser;
  collapsed?: boolean;
  /** Verilirse altta daralt/genişlet düğmesi çıkar (masaüstü). */
  onToggle?: () => void;
  /** Bir bağlantıya tıklanınca çağrılır (telefonda menüyü kapatmak için). */
  onNavigate?: () => void;
  /** Kayan kapsülün adı; aynı anda iki menü (masaüstü ve telefon) varsa birbirine karışmasın diye ayrı verilir. */
  layoutId?: string;
  className?: string;
};

export function Sidebar({ user, collapsed = false, onToggle, onNavigate, layoutId = "nav-pill", className }: Props) {
  const pathname = usePathname();
  const items = visibleNav(user);

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col overflow-hidden text-sidebar-fg transition-[width] duration-300 ease-[var(--ease-spring)]",
        "bg-[linear-gradient(180deg,var(--hero-via)_0%,var(--sidebar-bg)_38%,var(--sidebar-bg)_100%)]",
        collapsed ? "w-[4.5rem]" : "w-64",
        className,
      )}
    >
      {/* Üst köşede bal rengi bir ışık: bantla aynı aileden. */}
      <span aria-hidden="true" className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-[radial-gradient(circle,rgb(226_165_76/0.22),transparent_65%)]" />
      <div className={cn("relative flex h-16 shrink-0 items-center", collapsed ? "justify-center" : "px-5")}>
        <Brand compact={collapsed} />
      </div>
      <nav aria-label="Ana menü" className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group} className="mb-5">
              {collapsed ? (
                <div aria-hidden="true" className="mx-3 mb-2 border-t border-white/10" />
              ) : (
                <p className="px-3 pb-1.5 text-xs font-medium text-sidebar-fg-muted">{group}</p>
              )}
              <ul className="grid gap-1">
                {groupItems.map((item) => {
                  const Icon = ICON[item.href] ?? BoxIcon;
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        onClick={onNavigate}
                        className={cn(
                          "press relative isolate flex h-10 items-center gap-3 rounded-xl text-base outline-offset-[-2px]",
                          collapsed ? "justify-center" : "px-3",
                          active ? "font-semibold text-sidebar-fg" : "text-sidebar-fg-muted hover:bg-white/5 hover:text-sidebar-fg",
                        )}
                      >
                        {active ? (
                          <motion.span
                            layoutId={layoutId}
                            transition={SLIDE_SPRING}
                            aria-hidden="true"
                            className="absolute inset-0 -z-10 rounded-xl bg-[linear-gradient(100deg,rgb(226_165_76/0.24),rgb(226_165_76/0.08))] ring-1 ring-[rgb(226_165_76/0.35)] ring-inset"
                          >
                            <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-honey" />
                          </motion.span>
                        ) : null}
                        <span className={cn(active && "text-[#f3cf8e]")}>
                          <Icon size={19} />
                        </span>
                        {collapsed ? null : <span className="truncate">{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {collapsed ? null : (
        <div className="relative mx-3 mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
          <p className="text-sm font-semibold">{DEPARTMENT_NAMES[user.departmentCode]}</p>
          <p className="mt-0.5 text-xs text-sidebar-fg-muted">
            {user.departmentCode === "yonetim"
              ? "Bütün modüllerde işlem yapabilir, onay verebilirsiniz."
              : "Kendi modülünüzde işlem yapar, diğer modülleri görüntülersiniz."}
          </p>
        </div>
      )}

      {onToggle ? (
        <div className="relative shrink-0 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
            title={collapsed ? "Menüyü genişlet" : undefined}
            className={cn(
              "press flex h-10 w-full items-center gap-3 rounded-xl text-base text-sidebar-fg-muted outline-offset-[-2px] hover:bg-white/5 hover:text-sidebar-fg",
              collapsed ? "justify-center" : "px-3",
            )}
          >
            <PanelIcon size={19} />
            {collapsed ? null : <span>Menüyü daralt</span>}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
