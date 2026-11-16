"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { can, type Module } from "@/domain/permissions";
import { AppShell } from "./AppShell";
import { useDb } from "./db-context";
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
  return (
    <div className="page-hero walnut shrink-0 overflow-hidden rounded-[28px] px-5 pt-6 pb-[4.5rem] shadow-card animate-[rise-in_520ms_var(--ease-spring)] sm:px-8 sm:pt-7">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-72">
          {kicker ? <div className="mb-1.5 text-sm text-hero-fg-muted">{kicker}</div> : null}
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-hero-fg sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1.5 max-w-prose text-hero-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {stats ? <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">{stats}</div> : null}
      <span className="walnut-ruler" aria-hidden="true" />
    </div>
  );
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
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-hero-fg-muted">
        {tone === "alert" ? <span aria-hidden="true" className="size-2 rounded-full bg-[#f4aa97] shadow-[0_0_0_4px_rgb(244_170_151/0.18)]" /> : null}
        {label}
      </span>
      <span data-testid="stat-value" className="tabular mt-1 block truncate font-display text-[1.375rem] leading-none sm:text-[1.75rem] font-semibold tracking-tight text-hero-fg">{value}</span>
      {hint ? <span className="mt-1.5 block truncate text-xs text-hero-fg-muted">{hint}</span> : null}
    </>
  );
  const cls = "glass block min-w-0 rounded-2xl px-4 py-3.5 animate-[rise-in_600ms_var(--ease-spring)_both]";
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

/** Ekran gövdesi: kenar boşlukları ve dikey aralık. `fill` tablo gibi kalan yüksekliği dolduran ekranlar içindir. */
export function Page({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return (
    <div className={fill ? "flex flex-col gap-5 px-3 pb-5 sm:px-6 md:h-full md:min-h-[44rem]" : "grid grid-cols-[minmax(0,1fr)] gap-5 px-3 pb-8 sm:px-6"}>
      {children}
    </div>
  );
}
