"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { can, type Module } from "@/domain/permissions";
import { AppShell } from "./AppShell";
import { useDb } from "./db-context";
import { cn } from "@/ui/cn";
import { ChevronDownIcon, ChevronUpIcon } from "@/ui/icons";
import { HeroCollapsedContext, PageFillContext } from "@/ui/page-fill";
import { HERO_KEY, readPref, resolveHeroCollapsed, screenKey, writePref } from "@/ui/pref";
import { restoreSession, useSession } from "./session";

/** Oturum yoksa giriş ekranına yönlendirir; varsa ekranı uygulama kabuğu içinde gösterir. */
export function AppGuard({ children }: { children: ReactNode }) {
  const { user, status, signedOut } = useSession();
  const { db } = useDb();
  const pathname = usePathname();
  const router = useRouter();

  // Her sayfa geçişinde oturum yeniden doğrulanır: pasife alınan kullanıcı bir sonraki adımda dışarıda kalır.
  useEffect(() => {
    void restoreSession(db);
  }, [db, pathname]);

  useEffect(() => {
    // Oturum düştüyse (süresi bitti, pasife alındı) aynı sayfaya dönülür; kişi kendisi çıktıysa dönülmez.
    if (status === "out") router.replace(signedOut ? "/giris" : `/giris?sonra=${encodeURIComponent(pathname)}`);
  }, [status, signedOut, pathname, router]);

  if (status !== "in" || !user) return null;
  return <AppShell user={user}>{children}</AppShell>;
}

/** Modülü görme yetkisi olmayan kullanıcıya ekran yerine açıklama gösterir. */
export function RequireModule({ module, children }: { module: Module; children: ReactNode }) {
  const { user } = useSession();
  if (user && can(user, module, "view")) return <>{children}</>;
  return (
    <Page>
      <PageHeader title="Bu sayfayı görme yetkiniz yok" description="Bu ekranı yalnızca ilgili departman ve yönetim görebilir. Farklı bir hesapla girmek için hesap menüsünü kullanın." />
      <div className="rounded-[22px] border border-line bg-surface p-6 shadow-card">
        <Link href="/" className="font-semibold text-accent underline underline-offset-4">
          Ana panele dön
        </Link>
      </div>
    </Page>
  );
}

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Sağ üstteki düğmeler. Bant koyu olduğu için birincil düğme `variant="light"` olmalı. */
  actions?: ReactNode;
  /** Başlığın altında duran özet kutuları (HeroStat). */
  stats?: ReactNode;
  /** Başlığın üstündeki kısa satır (ör. selamlama ya da tarih). */
  kicker?: ReactNode;
};

/**
 * Ekran başlığı: ceviz bandı. Bandın hemen ardından gelen kart bandın alt kısmına biner (globals.css: .page-hero + *).
 * Bütün ekranlar bununla başlar.
 */
export function PageHeader({ title, description, actions, stats, kicker }: PageHeaderProps) {
  const fill = useContext(PageFillContext);
  const { ref, collapsed, toggle } = useHeroCollapse(fill?.screen ?? null);
  const regionId = useId();
  // Daraltılmış bantta özet kutusu başlıkla eylemler arasında, açıkken satırın altındadır; DOM sırası görsel sıradır.
  const statsBlock = stats ? (
    <div id={regionId} className={collapsed ? "flex min-w-0" : "mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4"}>
      <HeroCollapsedContext.Provider value={collapsed}>{stats}</HeroCollapsedContext.Provider>
    </div>
  ) : null;
  return (
    <div
      ref={ref}
      data-collapsed={collapsed || undefined}
      className="page-hero walnut shrink-0 overflow-hidden rounded-[28px] px-5 pt-6 pb-[4.5rem] shadow-card animate-[rise-in_520ms_var(--ease-spring)] data-[collapsed]:pt-4 sm:px-8 sm:pt-7 sm:data-[collapsed]:pt-4"
    >
      <div className={cn("flex flex-wrap gap-x-6 gap-y-4", collapsed ? "items-center" : "items-start")}>
        <div className={cn("min-w-0 flex-1", collapsed ? "basis-40" : "basis-72")}>
          {kicker && !collapsed ? <div className="mb-1.5 text-sm text-hero-fg-muted">{kicker}</div> : null}
          <h1 className={cn("leading-tight font-semibold tracking-tight text-hero-fg", collapsed ? "truncate text-xl sm:text-2xl" : "text-[1.75rem] sm:text-3xl")}>{title}</h1>
          {description && !collapsed ? (
            <p id={stats ? undefined : regionId} className="mt-1.5 max-w-prose text-hero-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {collapsed ? statsBlock : null}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        {fill ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={stats || description ? regionId : undefined}
            onClick={toggle}
            className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-hero-fg-muted transition-colors hover:bg-white/[0.1] hover:text-hero-fg"
          >
            {collapsed ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
            {collapsed ? "Özeti göster" : "Özeti gizle"}
          </button>
        ) : null}
      </div>
      {collapsed ? null : statsBlock}
      <span className="walnut-ruler" aria-hidden="true" />
    </div>
  );
}

/**
 * Özet bandının açık/kapalı durumu. İlk çizim kayıtlı seçimle ya da pencere ölçüsüne göre
 * varsayılanla başlar; sonradan düzeltme olmadığı için görünür sıçrama olmaz. Seçim `erp:hero:<ekran>` anahtarında durur; depo yoksa varsayılan geçerlidir.
 * Düğmeyle değişimde bandın yüksekliği animasyonla geçer; azaltılmış harekette anında olur.
 */
function useHeroCollapse(screen: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  // Sunucuda çizilmeyen ekranlarda ilk çizim doğrudan kayıtlı seçimle başlar (bkz. useTableHeight).
  const [collapsed, setCollapsed] = useState(() =>
    screen === null || typeof window === "undefined" ? false : resolveHeroCollapsed(readPref(HERO_KEY + screen), window.innerWidth, window.innerHeight),
  );
  const previousHeight = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);

  // Yalnızca düğmeyle değişimde çalışır (previousHeight o zaman dolar): eski yükseklikten yenisine geçiş.
  useLayoutEffect(() => {
    const el = ref.current;
    const from = previousHeight.current;
    previousHeight.current = null;
    if (!el || from === null) return;
    const to = el.offsetHeight;
    if (Math.abs(from - to) < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    running.current = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [collapsed]);

  function toggle() {
    const el = ref.current;
    if (el) {
      previousHeight.current = el.offsetHeight;
      running.current?.cancel();
    }
    const next = !collapsed;
    setCollapsed(next);
    if (screen !== null) writePref(HERO_KEY + screen, next ? "1" : "0");
  }

  return { ref, collapsed, toggle };
}

type HeroStatProps = {
  label: string;
  value: ReactNode;
  /** Değerin altındaki kısa açıklama. */
  hint?: ReactNode;
  /** Verilirse kutu o listeye götüren bağlantı olur. */
  href?: string;
  tone?: "default" | "alert";
  /** Sırayla belirme için 0, 1, 2... */
  index?: number;
};

/** Bant üstündeki cam özet kutusu: küçük etiket, büyük rakam. */
export function HeroStat({ label, value, hint, href, tone = "default", index = 0 }: HeroStatProps) {
  const compact = useContext(HeroCollapsedContext);
  // Daraltılmış bantta yalnızca ilk kutu, etiket ve rakam tek satırda görünür.
  if (compact && index > 0) return null;
  const body = compact ? (
    <span className="flex min-w-0 items-baseline gap-2.5">
      <span className="truncate text-sm text-hero-fg-muted">{label}</span>
      <span data-testid="stat-value" className="tabular font-display text-xl leading-none font-semibold tracking-tight text-hero-fg">
        {value}
      </span>
    </span>
  ) : (
    <>
      <span className="flex items-center gap-2 text-sm text-hero-fg-muted">
        {tone === "alert" ? <span aria-hidden="true" className="size-2 rounded-full bg-[#f4aa97] shadow-[0_0_0_4px_rgb(244_170_151/0.18)]" /> : null}
        {label}
      </span>
      <span data-testid="stat-value" className="tabular mt-1 block truncate font-display text-[1.375rem] leading-none sm:text-[1.75rem] font-semibold tracking-tight text-hero-fg">{value}</span>
      {hint ? <span className="mt-1.5 block truncate text-xs text-hero-fg-muted">{hint}</span> : null}
    </>
  );
  const cls = cn("glass block min-w-0 animate-[rise-in_600ms_var(--ease-spring)_both]", compact ? "rounded-xl px-3.5 py-2" : "rounded-2xl px-4 py-3.5");
  const style = { animationDelay: `${120 + index * 70}ms` };
  return href ? (
    <Link href={href} className={`${cls} press transition-colors hover:bg-white/[0.13]`} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/**
 * Ekran gövdesi: kenar boşlukları ve dikey aralık. `fill` tablo gibi kalan yüksekliği dolduran ekranlar içindir.
 * Fill'de alt boşluk padding değil, boş bir son öğedir (ara boşluk 20 px, öğenin kutusu üste binen -mt-5): `h-full` kabın dışına taşan
 * içerikte padding kaybolur, öğenin kutusu ise kaydırılabilir alana girer; böylece alt boşluk iki durumda da 20 px kalır.
 */
export function Page({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  const screen = screenKey(usePathname());
  const fillValue = useMemo(() => ({ screen }), [screen]);
  const body = (
    <div className={fill ? "flex flex-col gap-5 px-3 after:-mt-5 after:block after:shrink-0 after:h-5 after:content-[''] sm:px-6 md:h-full md:min-h-[44rem]" : "grid grid-cols-[minmax(0,1fr)] gap-5 px-3 pb-8 sm:px-6"}>
      {children}
    </div>
  );
  return fill ? <PageFillContext.Provider value={fillValue}>{body}</PageFillContext.Provider> : body;
}
