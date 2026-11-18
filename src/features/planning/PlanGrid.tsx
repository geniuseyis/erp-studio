"use client";

import type { ReactNode } from "react";
import { istanbulDayStart } from "@/domain/production/calendar";
import type { PlanCell, PlanStep, WeekPlan } from "@/domain/production/schedule";
import { formatNumber } from "@/domain/units";
import { cn } from "@/ui/cn";
import { CapacityBar } from "./CapacityBar";
import { dayHeader, loadText, longDay, weekKey } from "./labels";
import { PlanCard, stepKey } from "./PlanCard";

type Station = WeekPlan["stations"][number];

type Props = {
  plan: WeekPlan;
  /** Yeni hafta yüklenirken önceki haftanın verisi gösteriliyor. */
  stale: boolean;
  today: Date;
  onOpen: (step: PlanStep) => void;
};

/** Haftalık plan ızgarası: satırlar istasyonlar (rota sırasıyla), sütunlar haftanın beş iş günü. */
export function PlanGrid({ plan, stale, today, onOpen }: Props) {
  const todayMs = istanbulDayStart(today).getTime();
  const cellOf = new Map(plan.cells.map((c) => [`${c.stationId}|${c.day.getTime()}`, c]));

  return (
    <div
      role="table"
      aria-label="Haftalık üretim planı"
      aria-busy={stale || undefined}
      className={cn("w-full min-w-[calc(var(--plan-station)+5*10.5rem)] transition-opacity", stale && "opacity-60")}
    >
      <div role="rowgroup" className="sticky top-0 z-20">
        <div role="row" className="grid grid-cols-[var(--plan-station)_repeat(5,minmax(10.5rem,1fr))] border-b border-line bg-surface-2/95 backdrop-blur">
          <div role="columnheader" className="sticky left-0 z-10 flex items-end bg-surface-2 px-3 py-2.5 text-xs font-semibold text-fg-muted sm:px-4">
            İstasyon
          </div>
          {plan.days.map((d) => {
            const isToday = d.getTime() === todayMs;
            const h = dayHeader(d);
            const dayLoad = plan.cells.filter((c) => c.day.getTime() === d.getTime()).reduce((n, c) => n + c.loadMinutes, 0);
            return (
              <div
                key={d.getTime()}
                role="columnheader"
                data-day={weekKey(d)}
                aria-current={isToday ? "date" : undefined}
                className={cn("relative border-l border-line px-3 py-2.5", isToday && "bg-honey/12")}
              >
                {isToday ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-honey to-brass" /> : null}
                <span className="flex items-baseline gap-2">
                  <span className={cn("font-display text-base font-semibold", isToday ? "text-fg" : d.getTime() < todayMs ? "text-fg-muted" : "text-fg")}>{h.weekday}</span>
                  <span className="tabular text-sm text-fg-muted">{h.date}</span>
                  {isToday ? <span className="ml-auto rounded-full bg-accent px-2 text-[11px] leading-5 font-semibold text-accent-fg">Bugün</span> : null}
                </span>
                <span className="tabular mt-0.5 block text-xs text-fg-muted">
                  <span className="sr-only">{longDay(d)}, toplam yük </span>
                  {formatNumber(dayLoad)} dk
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div role="rowgroup">
        {plan.stations.map((st, row) => {
          const cells = plan.days.map((d) => cellOf.get(`${st.id}|${d.getTime()}`)).filter((c): c is PlanCell => c !== undefined);
          const weekLoad = cells.reduce((n, c) => n + c.loadMinutes, 0);
          return (
            <div
              key={st.id}
              role="row"
              className="grid grid-cols-[var(--plan-station)_repeat(5,minmax(10.5rem,1fr))] border-b border-line last:border-b-0 animate-[row-in_420ms_var(--ease-spring)_both]"
              style={{ animationDelay: `${row * 40}ms` }}
            >
              <div role="rowheader" className="sticky left-0 z-10 grid content-start gap-1 border-r border-line bg-surface px-3 py-3 sm:px-4">
                <span className="font-display leading-tight font-semibold break-words">{st.name}</span>
                <span className="tabular text-xs text-fg-muted">
                  {st.code} · {formatNumber(st.capacityMin)} dk/gün
                </span>
                <span className="tabular text-xs text-fg-muted">
                  <span className="sr-only">Haftalık yük </span>
                  {loadText(weekLoad, st.capacityMin * plan.days.length)}
                </span>
              </div>
              {cells.map((c) => (
                <Cell key={c.day.getTime()} cell={c} station={st} isToday={c.day.getTime() === todayMs} isPast={c.day.getTime() < todayMs}>
                  {c.steps.map((s) => (
                    <li key={stepKey(s)}>
                      <PlanCard step={s} stationName={st.name} onOpen={() => onOpen(s)} />
                    </li>
                  ))}
                </Cell>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CellProps = { cell: PlanCell; station: Station; isToday: boolean; isPast: boolean; children: ReactNode };

/** İstasyon × gün hücresi: kapasite çubuğu ve kartlar. */
function Cell({ cell, station, isToday, isPast, children }: CellProps) {
  const over = cell.loadMinutes > cell.capacityMin;
  return (
    <div
      role="cell"
      data-cell={`${station.code}:${weekKey(cell.day)}`}
      data-over={over || undefined}
      className={cn(
        "relative grid min-h-36 content-start gap-2 border-l border-line p-2.5",
        isToday && "bg-honey/[0.07]",
        isPast && !isToday && "bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--line)_9px_10px)]",
        over && "shadow-[inset_0_3px_0_var(--danger)]",
      )}
    >
      <CapacityBar
        load={cell.loadMinutes}
        capacity={cell.capacityMin}
        label={`${station.name}, ${longDay(cell.day)}: ${loadText(cell.loadMinutes, cell.capacityMin)}${over ? ", kapasite aşıldı" : ""}`}
      />
      <ul className="grid gap-2">{children}</ul>
    </div>
  );
}
