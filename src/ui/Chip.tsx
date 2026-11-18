"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { SearchIcon } from "./icons";
import { SLIDE_SPRING } from "./motion";

type FilterChipProps = {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Sayı rozeti (ör. o kategorideki kalem sayısı). Görseldir; erişilebilir ad yalnızca etikettir. */
  count?: number;
  /** Aynı gruptaki çiplerin seçili kapsülü bu adla bir çipten ötekine kayar. */
  group?: string;
  tone?: "default" | "danger";
  /** `lg`: 48 px yüksekliğinde, dokunmatik ekran (atölye tableti) için. */
  size?: "md" | "lg";
};

/** Aç-kapa süzgeç çipi. Seçili olduğu `aria-pressed` ile de bildirilir; seçili zemin gruptaki çipler arasında kayar. */
export function FilterChip({ pressed, onClick, children, count, group, tone = "default", size = "md" }: FilterChipProps) {
  const fill = tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "press relative isolate inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "lg" ? "h-12 px-4 text-base" : "h-8 px-3 text-sm",
        pressed ? (tone === "danger" ? "text-danger-bg" : "text-accent-fg") : "text-fg hover:bg-surface-2",
        !pressed && "ring-1 ring-line ring-inset",
      )}
    >
      {pressed ? (
        group ? (
          <motion.span layoutId={`chip-${group}`} transition={SLIDE_SPRING} aria-hidden="true" className={cn("absolute inset-0 -z-10 rounded-full shadow-button", fill)} />
        ) : (
          <span aria-hidden="true" className={cn("absolute inset-0 -z-10 rounded-full shadow-button", fill)} />
        )
      ) : null}
      {tone === "danger" ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", pressed ? "bg-danger-bg" : "bg-danger")} /> : null}
      {children}
      {count !== undefined ? (
        <span
          aria-hidden="true"
          className={cn("tabular min-w-5 rounded-full px-1.5 text-center text-xs font-semibold", pressed ? "bg-black/15" : "bg-surface-2 text-fg-muted")}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Arama kutusu: büyüteç simgeli, `searchbox` rolünde. */
export function SearchBox({
  label,
  value,
  onChange,
  onSubmit,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Verilirse Enter'a basınca çağrılır (gecikmeli aramayı beklemeden uygulamak için). */
  onSubmit?: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn("relative block w-full max-w-72", className)}>
      <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onSubmit ? (e) => e.key === "Enter" && onSubmit(e.currentTarget.value) : undefined}
        className="h-9 w-full rounded-full border border-line bg-surface-2/60 pr-3 pl-9 text-sm text-fg transition-colors placeholder:text-fg-muted hover:border-line-strong focus:border-accent focus:bg-surface"
      />
    </label>
  );
}
