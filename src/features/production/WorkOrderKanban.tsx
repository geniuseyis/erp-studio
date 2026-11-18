"use client";

import { useId, useRef } from "react";
import { DAY_MS, istanbulDayStart } from "@/domain/production/calendar";
import {
  isWaitingForMaterial,
  type KanbanColumn,
  stepGap,
  type WorkOrderRow,
} from "@/domain/production/queries";
import { formatNumber } from "@/domain/units";
import { formatDue } from "@/features/sales/labels";
import { cn } from "@/ui/cn";
import { AlertIcon, CheckIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useEdgeFades } from "@/ui/useEdgeFades";

/** Her sütunun başlık altındaki tek satırlık tanımı: kartın neden orada olduğunu söyler. */
function hint(column: KanbanColumn): string {
  if (column.key === "waiting_material") return "Planlı, malzemesi ayrılamamış";
  if (column.key === "unplanned") return "Günü ya da adımı olmayan";
  if (column.key === "completed") return "Son 7 gün";
  return "Çalışan ya da sıradaki adım";
}

/** Termin geçmişse kaç gün geçtiği (İstanbul günleriyle); geçmemişse null. */
function daysLate(dueAt: Date | null, now: Date): number | null {
  if (!dueAt) return null;
  const late = Math.round(
    (istanbulDayStart(now).getTime() - istanbulDayStart(dueAt).getTime()) /
      DAY_MS,
  );
  return late > 0 ? late : null;
}

function cardLabel(w: WorkOrderRow, late: number | null): string {
  const parts = [
    w.code,
    w.productName,
    `${formatNumber(w.qtyMilli / 1000)} adet`,
    `adım ${w.doneSteps}/${w.totalSteps}`,
    w.orderCode ? `sipariş ${w.orderCode}` : "stok için",
  ];
  if (isWaitingForMaterial(w)) parts.push("malzeme bekliyor");
  const gap = stepGap(w);
  if (gap) parts.push(gap.toLowerCase());
  if (w.dueAt)
    parts.push(
      late
        ? `termin geçti, ${formatDue(w.dueAt)}, ${late} gün gecikti`
        : `termin ${formatDue(w.dueAt)}`,
    );
  return parts.join(", ");
}

function KanbanCard({
  w,
  now,
  column,
  onOpen,
}: {
  w: WorkOrderRow;
  now: Date;
  column: KanbanColumn["key"];
  onOpen: () => void;
}) {
  const done = column === "completed";
  const late = done ? null : daysLate(w.dueAt, now);
  const running = w.status === "in_progress";
  const gap = stepGap(w);
  return (
    <li>
      <button
        type="button"
        aria-label={cardLabel(w, late)}
        onClick={onOpen}
        className={cn(
          "group/card relative grid w-full gap-1 overflow-hidden rounded-xl border border-l-[4px] bg-surface py-2 pr-2 pl-2.5 text-left shadow-[0_1px_2px_rgb(60_38_18/0.08)] outline-none transition-[box-shadow,translate] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-px hover:shadow-card",
          late ? "border-danger/70 border-l-danger" : "border-line",
          !late &&
            (done
              ? "border-l-ok/60"
              : running
                ? "border-l-warn"
                : "border-l-honey"),
          done && "opacity-70",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            data-testid="kanban-code"
            className="tabular truncate text-xs font-semibold tracking-wide text-fg"
          >
            {w.code}
          </span>
          <span className="tabular shrink-0 rounded-md bg-surface-2 px-1.5 text-[11px] leading-[18px] font-semibold text-fg-muted ring-1 ring-line ring-inset">
            {w.doneSteps}/{w.totalSteps}
          </span>
        </span>
        <span
          className="truncate text-sm leading-tight font-semibold text-fg"
          title={w.productName}
        >
          {w.productName}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          <span className="tabular">
            × {formatNumber(w.qtyMilli / 1000)} adet
          </span>
          <span className="tabular">{w.orderCode ?? "Stok için"}</span>
          {running ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-1.5 leading-[18px] font-semibold text-warn ring-1 ring-warn/25 ring-inset">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-warn"
              />
              üretimde
            </span>
          ) : null}
          {done ? (
            <span className="inline-flex items-center gap-0.5 font-semibold text-ok">
              <CheckIcon size={12} aria-hidden="true" />
              bitti
            </span>
          ) : null}
        </span>
        {gap ? (
          <span
            data-testid="kanban-gap"
            className="text-xs font-semibold text-fg-muted"
          >
            {gap}
          </span>
        ) : null}
        {isWaitingForMaterial(w) && column !== "waiting_material" ? (
          <StatusChip tone="warn" className="h-5 w-fit text-[11px]">
            Malzeme bekliyor
          </StatusChip>
        ) : null}
        {w.dueAt ? (
          late ? (
            <span
              data-testid="kanban-late"
              className="tabular inline-flex items-center gap-1 text-xs font-semibold text-danger"
            >
              <AlertIcon size={12} aria-hidden="true" />
              termin {formatDue(w.dueAt)} · {late} gün gecikti
            </span>
          ) : (
            <span className="tabular text-xs text-fg-muted">
              termin {formatDue(w.dueAt)}
            </span>
          )
        ) : null}
      </button>
    </li>
  );
}

function KanbanColumnView({
  column,
  now,
  onOpen,
}: {
  column: KanbanColumn;
  now: Date;
  onOpen: (id: string) => void;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-column={column.key}
      className="flex max-h-[34rem] min-h-0 w-[17.5rem] shrink-0 flex-col rounded-2xl bg-surface-2/60 ring-1 ring-line ring-inset md:max-h-none"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <h2
            id={titleId}
            className="truncate font-display text-base leading-tight font-semibold text-fg"
          >
            {column.title}
          </h2>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {hint(column)}
          </p>
        </div>
        <span
          data-testid="kanban-count"
          className="tabular min-w-6 shrink-0 rounded-full bg-surface px-2 text-center text-xs leading-6 font-semibold text-fg-muted ring-1 ring-line ring-inset"
        >
          {column.items.length}
        </span>
      </header>
      {column.items.length > 0 ? (
        <ul className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-y-contain px-2.5 pt-1 pb-3">
          {column.items.map((w) => (
            <KanbanCard
              key={w.id}
              w={w}
              now={now}
              column={column.key}
              onOpen={() => onOpen(w.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="mx-2.5 mb-3 grid flex-1 place-items-center rounded-xl border border-dashed border-line-strong px-3 py-8 text-center text-sm text-fg-muted">
          {column.key === "completed"
            ? "Son 7 günde biten iş emri yok"
            : column.key === "waiting_material"
              ? "Malzemesi eksik planlı iş emri yok"
              : "Burada bekleyen iş emri yok"}
        </p>
      )}
    </section>
  );
}

function Board({
  columns,
  onOpen,
}: {
  columns: KanbanColumn[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Kenar solması yalnızca bağlanma anındaki çocukları izler; bu yüzden kap, sütunlar gelince kurulur (iskelet ayrı).
  useEdgeFades(ref);
  const now = new Date();
  return (
    <div
      ref={ref}
      data-testid="kanban-board"
      className="scroll-x flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain p-3"
    >
      {columns.map((c) => (
        <KanbanColumnView key={c.key} column={c} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** Sütunlar yatay kayar (dar ekranda kendi kabında); her sütun uzayınca kendi içinde dikey kayar. */
export function WorkOrderKanban({
  columns,
  onOpen,
}: {
  columns: KanbanColumn[] | undefined;
  onOpen: (id: string) => void;
}) {
  if (columns) return <Board columns={columns} onOpen={onOpen} />;
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden p-3"
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="grid h-48 w-[17.5rem] shrink-0 content-start gap-3 rounded-2xl bg-surface-2/60 p-4 ring-1 ring-line ring-inset"
        >
          <Skeleton className="w-1/2" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
