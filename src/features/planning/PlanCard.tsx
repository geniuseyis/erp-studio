"use client";

import { useDraggable } from "@dnd-kit/core";
import type { KeyboardEvent, MouseEvent } from "react";
import type { PlanStep } from "@/domain/production/schedule";
import { formatNumber } from "@/domain/units";
import { cn } from "@/ui/cn";
import { CheckIcon, ClockIcon, GripIcon } from "@/ui/icons";
import { dayMonth, stepLabel } from "./labels";

/** Sürüklenen kartın taşıdığı bilgi: bırakılan hücre aynı istasyonda mı, hangi günden geliyor. */
export type DragData = { step: PlanStep; stationId: string; stationName: string; day: Date };

export const stepKey = (s: Pick<PlanStep, "workOrderId" | "seq">) => `${s.workOrderId}:${s.seq}`;

type Props = DragData & {
  /** Planlama yetkisi var ve adım taşınabilir: fareyle, dokunarak ve klavyeyle tutulur. */
  canMove: boolean;
  /** Klavyeyle tutulmuş kart. */
  held: boolean;
  /** Klavye yönergesinin kimliği (aria-describedby). */
  instructionsId: string;
  onOpen: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** Izgaradaki adım kartı. Tıklamak iş emrini açar; taşınabilir kart sürüklenir ya da klavyeyle tutulur. */
export function PlanCard({ step, stationId, stationName, day, canMove, held, instructionsId, onOpen, onKeyDown }: Props) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: stepKey(step),
    data: { step, stationId, stationName, day } satisfies DragData,
    disabled: !canMove,
  });
  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      data-step-key={stepKey(step)}
      data-state={step.state}
      aria-label={stepLabel(step, stationName)}
      aria-roledescription={canMove ? "taşınabilir kart" : undefined}
      aria-describedby={canMove ? instructionsId : undefined}
      aria-pressed={held || undefined}
      {...(canMove ? listeners : {})}
      onClick={(e: MouseEvent) => {
        // Çift tıklamanın ikincisi yeniden açmaz; sürüklemeden sonra gelen tıklamayı ızgara süzer.
        if (e.detail <= 1) onOpen();
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "group/card relative block w-full touch-manipulation rounded-xl outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-35",
        held && "ring-2 ring-honey ring-offset-2 ring-offset-surface",
      )}
    >
      <CardFace step={step} canMove={canMove} lifted={false} />
    </div>
  );
}

/** Kartın görünüşü; sürükleme sırasında imlecin altında giden kopya da bunu kullanır. */
export function CardFace({ step, canMove, lifted }: { step: PlanStep; canMove: boolean; lifted: boolean }) {
  const running = step.state === "running";
  const done = step.state === "done";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative grid gap-1 overflow-hidden rounded-xl border border-l-[4px] bg-surface py-2 pr-2 pl-2.5 text-left transition-[box-shadow,translate] duration-200",
        step.late ? "border-danger/70 border-l-danger" : "border-line",
        !step.late && (running ? "border-l-warn" : done ? "border-l-ok/60" : "border-l-honey"),
        done && "opacity-55",
        lifted ? "shadow-panel" : "shadow-[0_1px_2px_rgb(60_38_18/0.08)]",
        canMove && !lifted && "group-hover/card:-translate-y-px group-hover/card:shadow-card",
        !canMove && !done && "group-hover/card:shadow-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="tabular truncate text-xs font-semibold tracking-wide text-fg">{step.code}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="tabular rounded-md bg-surface-2 px-1.5 text-[11px] leading-[18px] font-semibold text-fg-muted ring-1 ring-line ring-inset">
            {step.position}/{step.totalSteps}
          </span>
          {canMove ? <GripIcon size={14} className="text-fg-muted/70" /> : null}
        </span>
      </div>
      <span className="truncate text-sm leading-tight font-semibold text-fg" title={step.productName}>
        {step.productName}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <span className="tabular inline-flex items-center gap-1">
          <ClockIcon size={12} />
          {formatNumber(step.minutes)} dk
        </span>
        <span className="tabular">× {formatNumber(step.qtyMilli / 1000)}</span>
        {running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-1.5 leading-[18px] font-semibold text-warn ring-1 ring-warn/25 ring-inset">
            <span className="size-1.5 animate-pulse rounded-full bg-warn" />
            çalışıyor
          </span>
        ) : null}
        {done ? (
          <span className="inline-flex items-center gap-0.5 font-semibold text-ok">
            <CheckIcon size={12} />
            bitti
          </span>
        ) : null}
        {step.late && step.dueAt ? <span className="tabular font-semibold text-danger">termin {dayMonth(step.dueAt)}</span> : null}
      </div>
    </div>
  );
}

/**
 * Klavyeyle (ya da onay beklerken) taşınan kartın hedef hücredeki yeri: kesik bal çerçeveli gölge kart. Hafta değişip
 * asıl kart ekrandan kalkınca odak buraya gelir.
 */
export function GhostCard({ step, label }: { step: PlanStep; label: string }) {
  return (
    <div
      tabIndex={-1}
      data-ghost
      aria-label={label}
      className="grid gap-1 rounded-xl border-2 border-dashed border-honey bg-honey/10 px-2.5 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span className="tabular truncate text-xs font-semibold">{step.code}</span>
      <span className="truncate text-xs text-fg-muted">Buraya taşınacak</span>
    </div>
  );
}
