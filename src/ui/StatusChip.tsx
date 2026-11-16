import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg ring-line",
  ok: "bg-ok-bg text-ok ring-ok/20",
  warn: "bg-warn-bg text-warn ring-warn/20",
  danger: "bg-danger-bg text-danger ring-danger/25",
  info: "bg-info-bg text-info ring-info/20",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-fg-muted",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

/** Durumu renk ve metinle birlikte gösterir; renk tek başına bilgi taşımaz. */
export function StatusChip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}
