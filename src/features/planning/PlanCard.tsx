"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import type { PlanStep } from "@/domain/production/schedule";
import { formatNumber } from "@/domain/units";
import { cn } from "@/ui/cn";
import { CheckIcon, ClockIcon } from "@/ui/icons";
import { dayMonth, stepLabel } from "./labels";

export const stepKey = (s: Pick<PlanStep, "workOrderId" | "seq">) => `${s.workOrderId}:${s.seq}`;

type Props = { step: PlanStep; stationName: string; onOpen: () => void };

/** Izgaradaki adım kartı. Tıklamak (ya da Enter, Space) iş emrini açar. */
export function PlanCard({ step, stationName, onOpen }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-step-key={stepKey(step)}
      data-state={step.state}
      aria-label={stepLabel(step, stationName)}
      onClick={(e: MouseEvent) => {
        if (e.detail <= 1) onOpen();
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat) onOpen();
      }}
      className="group/card relative block w-full cursor-pointer rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <CardFace step={step} />
    </div>
  );
}

/** Kartın görünüşü: kod, adım sırası, ürün adı, dakika, adet; çalışan, biten ve termini geçen kart ayrı işaretlenir. */
export function CardFace({ step }: { step: PlanStep }) {
  const running = step.state === "running";
  const done = step.state === "done";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative grid gap-1 overflow-hidden rounded-xl border border-l-[4px] bg-surface py-2 pr-2 pl-2.5 text-left shadow-[0_1px_2px_rgb(60_38_18/0.08)] transition-[box-shadow,translate] duration-200",
        step.late ? "border-danger/70 border-l-danger" : "border-line",
        !step.late && (running ? "border-l-warn" : done ? "border-l-ok/60" : "border-l-honey"),
        done ? "opacity-55" : "group-hover/card:shadow-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="tabular truncate text-xs font-semibold tracking-wide text-fg">{step.code}</span>
        <span className="tabular shrink-0 rounded-md bg-surface-2 px-1.5 text-[11px] leading-[18px] font-semibold text-fg-muted ring-1 ring-line ring-inset">
          {step.position}/{step.totalSteps}
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
