"use client";

import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type Modifier,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { istanbulDayStart } from "@/domain/production/calendar";
import type { PlanCell, PlanStep, WeekPlan } from "@/domain/production/schedule";
import { formatNumber } from "@/domain/units";
import { cn } from "@/ui/cn";
import { CapacityBar } from "./CapacityBar";
import { announceDay, dayHeader, loadText, longDay, weekKey } from "./labels";
import { CardFace, type DragData, GhostCard, PlanCard, stepKey } from "./PlanCard";

type Station = WeekPlan["stations"][number];
/** Hedef hücrede gösterilen gölge kart: klavyeyle tutulan ya da onay bekleyen taşıma. */
export type Ghost = { key: string; stationId: string; day: Date; step: PlanStep; label: string };

type Props = {
  plan: WeekPlan;
  /** Yeni hafta yüklenirken önceki haftanın verisi gösteriliyor. */
  stale: boolean;
  today: Date;
  canWrite: boolean;
  heldKey: string | null;
  ghost: Ghost | null;
  instructionsId: string;
  onDrop: (data: DragData, toDay: Date) => void;
  onOpen: (step: PlanStep) => void;
  onCardKey: (event: KeyboardEvent<HTMLDivElement>, data: DragData) => void;
};

/** Kart yalnızca kendi satırında (istasyonunda) gider: dikey kayma sıfırlanır. */
const lockRow: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/** Bırakma hedefi yalnızca aynı istasyonun hücreleri; aralarından merkeze en yakın olanı. */
const sameStation: CollisionDetection = (args) => {
  const stationId = (args.active.data.current as DragData | undefined)?.stationId;
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.data.current?.stationId === stationId) });
};

const dataOf = (x: { data: { current?: unknown } } | null) => (x?.data.current ?? null) as DragData | null;
const overDay = (over: { data: { current?: unknown } } | null) => (over?.data.current as { day?: Date } | undefined)?.day ?? null;

const ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => {
    const d = dataOf(active);
    return d ? `${d.step.code} ${d.stationName} tutuldu, ${longDay(d.day)} üzerinde` : undefined;
  },
  onDragOver: ({ active, over }) => {
    const d = dataOf(active);
    const day = overDay(over);
    return d && day ? announceDay(d.step.code, d.stationName, day) : undefined;
  },
  onDragEnd: ({ active, over }) => {
    const d = dataOf(active);
    const day = overDay(over);
    return d && day ? `${d.step.code} ${d.stationName}, ${longDay(day)} gününe bırakıldı` : undefined;
  },
  onDragCancel: ({ active }) => {
    const d = dataOf(active);
    return d ? `Taşımadan vazgeçildi; ${d.step.code} ${d.stationName} yerinde kaldı` : undefined;
  },
};

/**
 * Haftalık plan ızgarası: satırlar istasyonlar (rota sırasıyla), sütunlar haftanın beş iş günü. Fare ve dokunma
 * sürüklemesi dnd-kit ile; klavye taşıması ekranın kendi modelidir (PlanScreen), hafta sınırını da aşar.
 */
export function PlanGrid({ plan, stale, today, canWrite, heldKey, ghost, instructionsId, onDrop, onOpen, onCardKey }: Props) {
  const sensors = useSensors(
    // Kıpırdamadan bırakılan tıklama sürükleme sayılmaz: çekmece açılır.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Dokunmada kısa basılı tutma sürükler; hemen kaydırmak ızgarayı kaydırır.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const [active, setActive] = useState<DragData | null>(null);
  // Bırakışın hemen ardından gelen tıklama (bırakılan yer kartın üstüyse) çekmece açmaz.
  const justDropped = useRef(false);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const todayMs = istanbulDayStart(today).getTime();

  function onDragStart(e: DragStartEvent) {
    setActive(dataOf(e.active));
  }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    justDropped.current = true;
    window.setTimeout(() => (justDropped.current = false), 0);
    const d = dataOf(e.active);
    const target = e.over?.data.current as { stationId?: string; day?: Date } | undefined;
    if (!d || !target?.day || target.stationId !== d.stationId) return;
    if (istanbulDayStart(target.day).getTime() === istanbulDayStart(d.day).getTime()) return;
    onDrop(d, target.day);
  }
  const open = (step: PlanStep) => {
    if (!justDropped.current) onOpen(step);
  };

  const cellOf = new Map(plan.cells.map((c) => [`${c.stationId}|${c.day.getTime()}`, c]));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={sameStation}
      modifiers={[lockRow]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
      accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: { draggable: "Kartı basılı tutup aynı istasyonda başka bir güne sürükleyin." } }}
    >
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
            const rowActive = active?.stationId === st.id;
            return (
              <div
                key={st.id}
                role="row"
                className={cn(
                  "grid grid-cols-[var(--plan-station)_repeat(5,minmax(10.5rem,1fr))] border-b border-line last:border-b-0 animate-[row-in_420ms_var(--ease-spring)_both]",
                )}
                style={{ animationDelay: `${row * 40}ms` }}
              >
                <div role="rowheader" className={cn("sticky left-0 z-10 grid content-start gap-1 border-r border-line bg-surface px-3 py-3 sm:px-4", rowActive && "bg-surface-2")}>
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
                  <Cell
                    key={c.day.getTime()}
                    cell={c}
                    station={st}
                    isToday={c.day.getTime() === todayMs}
                    isPast={c.day.getTime() < todayMs}
                    dragging={active !== null}
                    ghost={ghost && ghost.stationId === st.id && ghost.day.getTime() === c.day.getTime() ? ghost : null}
                  >
                    {c.steps.map((s) => {
                      const data: DragData = { step: s, stationId: st.id, stationName: st.name, day: c.day };
                      return (
                        <li key={stepKey(s)}>
                          <PlanCard
                            {...data}
                            canMove={canWrite && s.movable && !stale}
                            held={heldKey === stepKey(s)}
                            instructionsId={instructionsId}
                            onOpen={() => open(s)}
                            onKeyDown={(e) => onCardKey(e, data)}
                          />
                        </li>
                      );
                    })}
                  </Cell>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {typeof document === "undefined"
        ? null
        : createPortal(
            <DragOverlay dropAnimation={reduced ? null : { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }} zIndex={70}>
              {active ? (
                <div className="-rotate-1 cursor-grabbing motion-reduce:rotate-0">
                  <CardFace step={active.step} canMove lifted />
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
    </DndContext>
  );
}

type CellProps = {
  cell: PlanCell;
  station: Station;
  isToday: boolean;
  isPast: boolean;
  dragging: boolean;
  ghost: Ghost | null;
  children: ReactNode;
};

/** İstasyon × gün hücresi: kapasite çubuğu ve kartlar; sürüklemede aynı satırın hücreleri hedef olur. */
function Cell({ cell, station, isToday, isPast, dragging, ghost, children }: CellProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${station.id}|${cell.day.getTime()}`, data: { stationId: station.id, day: cell.day } });
  const candidate = dataOf(active)?.stationId === station.id;
  const over = cell.loadMinutes > cell.capacityMin;
  return (
    <div
      ref={setNodeRef}
      role="cell"
      data-cell={`${station.code}:${weekKey(cell.day)}`}
      data-over={over || undefined}
      className={cn(
        "relative grid min-h-36 content-start gap-2 border-l border-line p-2.5 transition-[background-color,opacity,box-shadow] duration-150",
        isToday && "bg-honey/[0.07]",
        isPast && !isToday && "bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--line)_9px_10px)]",
        over && "shadow-[inset_0_3px_0_var(--danger)]",
        dragging && !candidate && "opacity-45",
        candidate && "bg-surface-2/60",
        isOver && "bg-honey/15 shadow-[inset_0_0_0_2px_var(--honey)]",
      )}
    >
      <CapacityBar
        load={cell.loadMinutes}
        capacity={cell.capacityMin}
        label={`${station.name}, ${longDay(cell.day)}: ${loadText(cell.loadMinutes, cell.capacityMin)}${over ? ", kapasite aşıldı" : ""}`}
      />
      <ul className="grid gap-2">
        {children}
        {ghost ? (
          <li>
            <GhostCard step={ghost.step} label={ghost.label} />
          </li>
        ) : null}
      </ul>
    </div>
  );
}
