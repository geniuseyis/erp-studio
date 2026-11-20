"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MATERIAL_CATEGORIES } from "@/db/schema";
import { DEPARTMENT_NAMES } from "@/domain/context";
import type { MaterialRow } from "@/domain/inventory/queries";
import { can } from "@/domain/permissions";
import { formatQty } from "@/domain/units";
import { CategorySwatch } from "@/features/inventory/CategorySwatch";
import { useInventorySummary, useMaterials, useMovements } from "@/features/inventory/hooks";
import { CATEGORY_LABEL, MOVEMENT_LABEL, stockScale, stockTone } from "@/features/inventory/labels";
import { MovementIcon } from "@/features/inventory/MovementIcon";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { cn } from "@/ui/cn";
import { formatMoneyWhole, formatSignedQty, formatTime } from "@/ui/format";
import { ArrowRightIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { CountUp } from "@/ui/motion";
import { Skeleton } from "@/ui/Skeleton";

const LONG_DATE = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
const DAY_MONTH = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" });

/** Saate göre selam: 05–12 günaydın, 12–18 iyi günler, gerisi iyi akşamlar. */
export function greeting(date: Date): string {
  const h = (date.getUTCHours() + 3) % 24; // İstanbul saati (UTC+3 sabit)
  if (h >= 5 && h < 12) return "Günaydın";
  if (h >= 12 && h < 18) return "İyi günler";
  return "İyi akşamlar";
}

/** Kullanılabilir / sipariş noktası: küçük olan daha acil. */
const fill = (m: MaterialRow) => m.availableMilli / Math.max(m.reorderPointMilli, 1);

export function DashboardScreen() {
  const { user } = useSession();
  const summary = useInventorySummary();
  const critical = useMaterials({ criticalOnly: true });
  const all = useMaterials();
  const movements = useMovements({ limit: 10 });
  if (!user) return null;

  const s = summary.data;
  const now = new Date();
  const seesInventory = can(user, "inventory", "view");
  const urgent = [...(critical.data ?? [])].sort((a, b) => fill(a) - fill(b)).slice(0, 6);

  return (
    <Page>
      <PageHeader
        kicker={<span className="block first-letter:uppercase">{LONG_DATE.format(now)}</span>}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}`}
        description={
          <>
            {user.title}, {DEPARTMENT_NAMES[user.departmentCode]}
            {s && s.criticalCount > 0 ? (
              <span className="mt-1 block">Bugün {s.criticalCount} malzeme sipariş noktasının altında; aşağıda en acil olanlar var.</span>
            ) : null}
          </>
        }
        stats={
          s ? (
            <>
              <HeroStat
                index={0}
                label="Stok değeri"
                value={<CountUp value={s.totalValueKurus} format={formatMoneyWhole} />}
                hint="Ortalama maliyetle"
                href="/stok/malzemeler"
              />
              <HeroStat index={1} label="Malzeme" value={<CountUp value={s.materialCount} format={String} />} hint="Katalogdaki kalem" href="/stok/malzemeler" />
              <HeroStat
                index={2}
                label="Kritik kalem"
                tone={s.criticalCount > 0 ? "alert" : "default"}
                value={<CountUp value={s.criticalCount} format={String} />}
                hint="Sipariş noktasının altında"
                href="/stok/malzemeler?kritik=1"
              />
              <HeroStat index={3} label="Açık sayım" value={<CountUp value={s.openCounts} format={String} />} hint="Onay bekleyen fişler" href="/stok/sayim" />
            </>
          ) : null
        }
      />

      {seesInventory ? (
        <div className="grid gap-5">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card
              title="Kritik stok"
              description="Sipariş noktasına göre en düşük dolulukta olanlar"
              link={{ href: "/stok/malzemeler?kritik=1", label: "Bütün kritik kalemler" }}
              delay={0}
            >
              {critical.isPending ? (
                <Loading />
              ) : urgent.length === 0 ? (
                <p className="py-6 text-center text-fg-muted">Sipariş noktasının altında malzeme yok.</p>
              ) : (
                <ul className="grid">
                  {urgent.map((m, i) => (
                    <li key={m.id} className="animate-[row-in_420ms_var(--ease-spring)_both]" style={{ animationDelay: `${200 + i * 50}ms` }}>
                      <Link
                        href={`/stok/malzemeler?ac=${m.id}`}
                        className="press -mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-2xl px-2 py-2.5 hover:bg-surface-2 sm:grid-cols-[auto_minmax(0,1fr)_9rem_6.5rem]"
                      >
                        <CategorySwatch category={m.category} />
                        <span className="grid min-w-0">
                          <span className="truncate font-semibold">{m.name}</span>
                          <span className="tabular text-xs text-fg-muted">
                            {m.code}, raf {m.shelf}
                          </span>
                        </span>
                        <Meter
                          size="sm"
                          value={m.availableMilli}
                          max={stockScale(m)}
                          mark={m.reorderPointMilli}
                          tone={stockTone(m)}
                          label={`Kullanılabilir ${formatQty(m.availableMilli, m.unit)}, yeniden sipariş noktası ${formatQty(m.reorderPointMilli, m.unit)}`}
                          className="col-span-3 sm:col-span-1"
                        />
                        <span className="tabular col-start-3 row-start-1 text-right sm:col-start-4">
                          <span className="block font-semibold text-danger">{formatQty(m.availableMilli, m.unit)}</span>
                          <span className="block text-xs text-fg-muted">nokta {formatQty(m.reorderPointMilli, m.unit)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Son hareketler" description="Depoda en son yazılan kayıtlar" link={{ href: "/stok/hareketler", label: "Bütün hareketler" }} delay={80}>
              {movements.isPending ? (
                <Loading />
              ) : (
                <ul className="relative grid">
                  <span aria-hidden="true" className="absolute top-4 bottom-4 left-[17px] w-px bg-line" />
                  {(movements.data ?? []).map((mv, i) => {
                    const delta = mv.deltaOnHandMilli !== 0 ? mv.deltaOnHandMilli : mv.deltaReservedMilli;
                    return (
                      <li
                        key={mv.id}
                        className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 animate-[row-in_420ms_var(--ease-spring)_both]"
                        style={{ animationDelay: `${260 + i * 40}ms` }}
                      >
                        <MovementIcon type={mv.type} />
                        <span className="grid min-w-0">
                          <span className="truncate font-semibold">{mv.materialName}</span>
                          <span className="truncate text-xs text-fg-muted">
                            {MOVEMENT_LABEL[mv.type]}, {DAY_MONTH.format(mv.createdAt)} {formatTime(mv.createdAt)}, {mv.userName}
                          </span>
                        </span>
                        <span className={cn("tabular text-sm font-semibold whitespace-nowrap", delta > 0 && "text-ok")}>{formatSignedQty(delta, mv.unit)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Kategoriye göre stok değeri" description="Kategoriye tıklayınca o kategorinin malzemeleri açılır" delay={160}>
            {all.data ? <CategoryBars rows={all.data} /> : <Loading />}
          </Card>
        </div>
      ) : (
        <div className="rounded-[22px] border border-line bg-surface p-6 shadow-card">
          <p className="text-fg-muted">Ana paneldeki özetler stok modülünden gelir; bu hesabın stok görme yetkisi yok.</p>
        </div>
      )}
    </Page>
  );
}

/** Kategori başına toplam stok değeri: büyükten küçüğe yatay çubuklar, değer ve pay çubuğun yanında yazılı. */
function CategoryBars({ rows }: { rows: MaterialRow[] }) {
  const total = rows.reduce((sum, m) => sum + m.stockValueKurus, 0) || 1;
  const byCategory = MATERIAL_CATEGORIES.map((c) => ({
    category: c,
    value: rows.filter((m) => m.category === c).reduce((sum, m) => sum + m.stockValueKurus, 0),
    count: rows.filter((m) => m.category === c).length,
  })).sort((a, b) => b.value - a.value);
  const max = byCategory[0]?.value || 1;

  return (
    <ul className="grid gap-1">
      {byCategory.map((b, i) => {
        const share = Math.round((b.value / total) * 100);
        return (
          <li key={b.category}>
            <Link
              href={`/stok/malzemeler?kategori=${b.category}`}
              title={`${CATEGORY_LABEL[b.category]}: ${formatMoneyWhole(b.value)}, toplamın %${share} kadarı, ${b.count} kalem`}
              className="press group -mx-2 grid grid-cols-[2rem_minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2"
            >
              <CategorySwatch category={b.category} size="sm" />
              <span className="truncate font-medium">{CATEGORY_LABEL[b.category]}</span>
              <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full origin-left rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent)_65%,var(--honey)),var(--accent))] transition-[filter] group-hover:brightness-110 animate-[ruler-fill_900ms_var(--ease-spring)_both]"
                  style={{ width: `${Math.max((b.value / max) * 100, 1.5)}%`, animationDelay: `${300 + i * 60}ms` }}
                />
              </span>
              <span className="tabular w-36 text-right text-sm">
                <span className="font-semibold">{formatMoneyWhole(b.value)}</span>
                <span className="ml-2 text-fg-muted">%{share}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Card({
  title,
  description,
  link,
  delay,
  children,
}: {
  title: string;
  description?: string;
  link?: { href: string; label: string };
  delay: number;
  children: ReactNode;
}) {
  const id = `card-${title.replace(/\s+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="grid content-start gap-4 rounded-[24px] border border-line bg-surface p-5 shadow-card animate-[rise-in_600ms_var(--ease-spring)_both] sm:p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id={id} className="text-xl font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        </div>
        {link ? (
          <Link href={link.href} className="group inline-flex items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline">
            {link.label}
            <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return (
    <div className="grid gap-3 py-2">
      <Skeleton className="w-3/4" />
      <Skeleton />
      <Skeleton className="w-2/3" />
    </div>
  );
}
