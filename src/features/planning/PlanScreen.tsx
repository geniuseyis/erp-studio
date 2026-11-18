"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { type PlanStep, weekStartOf } from "@/domain/production/schedule";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { Skeleton } from "@/ui/Skeleton";
import { useEdgeFades } from "@/ui/useEdgeFades";
import { useWeekPlan } from "./hooks";
import { loadText, parseWeek, weekKey, weekLabel, weekSummary } from "./labels";
import { PlanGrid } from "./PlanGrid";

/** Haftalık üretim planı: istasyon × gün ızgarası, hücrede kapasite çubuğu ve adım kartları. */
export function PlanScreen() {
  const router = useRouter();
  const [params, setParams] = useUrlState();
  // Ekranın açıldığı an: bugün sütunu ve "bu hafta".
  const [now] = useState(() => new Date());
  const thisWeek = weekStartOf(now);
  const weekStart = parseWeek(params.get("hafta"), now);
  const query = useWeekPlan(weekStart);
  const plan = query.data;
  const stale = plan !== undefined && plan.weekStart.getTime() !== weekStart.getTime();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEdgeFades(scrollRef);

  const goWeek = useCallback(
    (day: Date) => {
      const start = weekStartOf(day);
      setParams({ hafta: start.getTime() === weekStartOf(now).getTime() ? null : weekKey(start) });
    },
    [setParams, now],
  );
  const openOrder = (step: PlanStep) => router.push(`/uretim/is-emirleri?ac=${step.workOrderId}`);

  const summary = plan && !stale ? weekSummary(plan) : null;
  const isThisWeek = weekStart.getTime() === thisWeek.getTime();
  const shift = (weeks: number) => goWeek(new Date(weekStart.getTime() + weeks * 7 * 24 * 60 * 60 * 1000));

  return (
    <Page fill>
      <PageHeader
        title="Haftalık plan"
        description="İstasyonların günlük yükü ve iş emri adımları: hangi gün hangi istasyon dolu, hangi iş termini aşıyor."
        stats={
          summary ? (
            <>
              <HeroStat
                index={0}
                label="Haftanın yükü"
                value={`%${summary.capacityMin > 0 ? Math.round((summary.loadMinutes * 100) / summary.capacityMin) : 0}`}
                hint={loadText(summary.loadMinutes, summary.capacityMin)}
              />
              <HeroStat
                index={1}
                label="Kapasiteyi aşan"
                tone={summary.overCells > 0 ? "alert" : "default"}
                value={<CountUp value={summary.overCells} format={String} />}
                hint="istasyon × gün hücresi"
              />
              <HeroStat
                index={2}
                label="Termini geçen"
                tone={summary.lateOrders > 0 ? "alert" : "default"}
                value={<CountUp value={summary.lateOrders} format={String} />}
                hint="bu haftadaki iş emri"
              />
              <HeroStat
                index={3}
                label="Planlanmamış"
                value={<CountUp value={summary.unscheduled} format={String} />}
                hint="açık iş emri · listeye git"
                href="/uretim/is-emirleri?durum=planned"
              />
            </>
          ) : null
        }
      />
      <section aria-labelledby="plan-week" className="flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-card md:min-h-[24rem] md:flex-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="plan-week" className="tabular font-display text-lg leading-tight font-semibold">
              {weekLabel(weekStart)}
              {isThisWeek ? <span className="ml-2 align-middle text-xs font-semibold text-accent">bu hafta</span> : null}
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">Kart iş emrini açar.</p>
          </div>
          <div role="group" aria-label="Hafta seçimi" className="flex items-center gap-1.5">
            <Button size="sm" aria-label="Önceki hafta" icon={<ChevronLeftIcon size={15} />} onClick={() => shift(-1)}>
              Önceki
            </Button>
            <Button size="sm" disabled={isThisWeek} onClick={() => goWeek(now)}>
              Bu hafta
            </Button>
            <Button size="sm" aria-label="Sonraki hafta" className="flex-row-reverse" icon={<ChevronRightIcon size={15} />} onClick={() => shift(1)}>
              Sonraki
            </Button>
          </div>
        </div>
        <div
          ref={scrollRef}
          data-plan-scroll
          className="scroll-x plan-scroll relative min-h-0 overflow-auto overscroll-x-contain [--plan-station:7.5rem] sm:[--plan-station:10.5rem] md:flex-1"
        >
          {plan ? (
            <PlanGrid plan={plan} stale={stale} today={now} onOpen={openOrder} />
          ) : (
            <div aria-busy="true" className="grid gap-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}
        </div>
        <Legend />
      </section>
    </Page>
  );
}

/** Izgaranın altındaki açıklama: renkler ve kart durumları metinle. */
function Legend() {
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-surface-2/40 px-4 py-2 text-xs text-fg-muted">
      <span className={item}>
        <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-honey/80 to-brass" />
        Kapasite içinde
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-danger" />
        Kapasite aşıldı
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-1 rounded-full bg-warn" />
        Çalışıyor
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-1 rounded-full bg-ok/60" />
        Bitti
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-3 rounded-[4px] border-2 border-danger" />
        Termin geçiyor
      </span>
    </div>
  );
}
