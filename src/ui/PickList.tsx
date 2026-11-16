"use client";

import { type ReactNode, useId } from "react";
import { SearchBox } from "./Chip";
import { cn } from "./cn";

export type PickItem = { id: string; primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode };

type Props = {
  /** Grubun adı (ör. "Müşteri"). */
  label: string;
  /** Arama kutusunun adı (ör. "Müşteri ara"). */
  searchLabel: string;
  query: string;
  onQuery: (query: string) => void;
  /** Aramaya göre süzülmüş seçenekler; süzme çağıranın işidir. */
  items: readonly PickItem[];
  value: string | null;
  onChange: (id: string) => void;
  error?: string | null;
  /** Arama sonuçsuzken gösterilen satır. */
  empty: string;
  loading?: boolean;
};

/**
 * Aranabilir tek seçimli liste: arama kutusu ve altında radyo düğmeleri. Seçenekler arasında ok tuşlarıyla
 * gezilir; seçili satır vurgulanır. Uzun listeler kendi içinde kayar.
 */
export function PickList({ label, searchLabel, query, onQuery, items, value, onChange, error, empty, loading = false }: Props) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset className="grid min-w-0 gap-2" aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-fg">{label}</legend>
      <SearchBox label={searchLabel} value={query} onChange={onQuery} className="max-w-none" />
      <div
        className={cn(
          "grid max-h-56 min-w-0 overflow-y-auto rounded-xl border bg-surface p-1",
          error ? "border-danger" : "border-line",
        )}
      >
        {items.length === 0 ? <p className="px-3 py-3 text-sm text-fg-muted">{loading ? "Yükleniyor" : empty}</p> : null}
        {items.map((item) => {
          const checked = item.id === value;
          return (
            <label
              key={item.id}
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-focus",
                checked ? "bg-surface-2 ring-1 ring-line-strong ring-inset" : "hover:bg-surface-2/70",
              )}
            >
              <input
                type="radio"
                name={name}
                value={item.id}
                checked={checked}
                onChange={() => onChange(item.id)}
                className="size-4 shrink-0 accent-[var(--accent)] focus-visible:outline-none"
              />
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-semibold">{item.primary}</span>
                {item.secondary ? <span className="truncate text-xs text-fg-muted">{item.secondary}</span> : null}
              </span>
              {item.trailing ? <span className="tabular shrink-0 text-sm font-semibold">{item.trailing}</span> : null}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
