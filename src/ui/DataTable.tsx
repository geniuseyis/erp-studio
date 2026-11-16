"use client";

import { DropdownMenu } from "radix-ui";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import { downloadCsv, toCsv } from "./csv";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ColumnsIcon, DownloadIcon, SortIcon } from "./icons";
import { Skeleton } from "./Skeleton";
import { type Column, sortRows } from "./table-types";

export type { Column } from "./table-types";

type Props<T> = {
  /** Tablonun erişilebilir adı. */
  label: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowId: (row: T) => string;
  /** Seçim kutusunun ve satırın ekran okuyucudaki adı (ör. malzeme kodu). */
  rowLabel?: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  bulkActions?: (selected: T[]) => ReactNode;
  /** Verilirse "CSV indir" düğmesi çıkar. */
  csvFileName?: string;
  /** Satır yokken gösterilir. */
  empty: ReactNode;
  loading?: boolean;
  initialSort?: { id: string; desc: boolean };
  /** Araç çubuğunun soluna yerleşir (arama). */
  toolbar?: ReactNode;
  /** Araç çubuğunun altında, tam genişlikte ikinci satır (süzgeç çipleri, tarih aralığı). */
  filters?: ReactNode;
};

export function DataTable<T>({
  label,
  rows,
  columns,
  rowId,
  rowLabel,
  onRowClick,
  selectable = false,
  bulkActions,
  csvFileName,
  empty,
  loading = false,
  initialSort,
  toolbar,
  filters,
}: Props<T>) {
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(initialSort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const visible = columns.filter((c) => !hidden.has(c.id));
  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
    return column ? sortRows(rows, column, sort?.desc ?? false) : [...rows];
  }, [rows, columns, sort]);
  const selected = sorted.filter((r) => selectedIds.has(rowId(r)));
  const allSelected = sorted.length > 0 && selected.length === sorted.length;

  function toggleSort(id: string) {
    setSort((s) => (s?.id !== id ? { id, desc: false } : s.desc ? null : { id, desc: true }));
  }
  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function toggleColumn(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const colSpan = visible.length + (selectable ? 1 : 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-60 flex-wrap items-center gap-2">{toolbar}</div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="ghost" icon={<ColumnsIcon />}>
              Sütunlar
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-48 rounded-2xl border border-line bg-surface p-1.5 text-sm shadow-panel animate-[pop-in_160ms_var(--ease-spring)]"
            >
              {columns.map((c) => (
                <DropdownMenu.CheckboxItem
                  key={c.id}
                  checked={!hidden.has(c.id)}
                  onCheckedChange={() => toggleColumn(c.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-surface-2"
                >
                  <span className="grid size-4 place-items-center rounded-[5px] border border-line-strong data-[state=checked]:border-accent">
                    <DropdownMenu.ItemIndicator>
                      <CheckIcon size={12} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {c.header}
                </DropdownMenu.CheckboxItem>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {csvFileName ? (
          <Button size="sm" variant="ghost" icon={<DownloadIcon />} onClick={() => downloadCsv(csvFileName, toCsv(sorted, columns))}>
            CSV indir
          </Button>
        ) : null}
        {filters ? <div className="w-full min-w-0 pt-1">{filters}</div> : null}
      </div>

      {selectable && selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-info-bg px-4 py-2 text-sm text-info animate-[fade-in_160ms_ease-out]">
          <span className="font-semibold">{selected.length} satır seçildi</span>
          {bulkActions?.(selected)}
          <button type="button" className="ml-auto underline" onClick={() => setSelectedIds(new Set())}>
            Seçimi kaldır
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={label} aria-busy={loading || undefined} className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2/95 text-left text-xs text-fg-muted backdrop-blur">
            <tr>
              {selectable ? (
                <th scope="col" className="w-10 py-2.5 pr-2 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Tüm satırları seç"
                    checked={allSelected}
                    onChange={() => setSelectedIds(allSelected ? new Set() : new Set(sorted.map(rowId)))}
                    className="size-4 accent-accent"
                  />
                </th>
              ) : null}
              {visible.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort?.desc ? "descending" : "ascending") : undefined}
                    className={cn("px-3 py-2.5 font-semibold whitespace-nowrap first:pl-4 last:pr-4", c.align === "right" && "text-right")}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn("inline-flex items-center gap-1 rounded-sm transition-colors hover:text-fg", active && "text-fg", c.align === "right" && "flex-row-reverse")}
                      >
                        {c.header}
                        <span className={cn(active ? "text-accent" : "text-fg-muted/60")}>
                          {active ? sort?.desc ? <ChevronDownIcon size={14} /> : <ChevronUpIcon size={14} /> : <SortIcon size={14} />}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-t border-line">
                    <td colSpan={colSpan} className="px-4 py-4">
                      <Skeleton className={i % 2 ? "w-2/3" : "w-5/6"} />
                    </td>
                  </tr>
                ))
              : sorted.map((row, index) => {
                  const id = rowId(row);
                  const name = rowLabel?.(row) ?? id;
                  const isSelected = selectedIds.has(id);
                  return (
                    <tr
                      key={id}
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-label={onRowClick ? `${name}: ayrıntıyı aç` : undefined}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row);
                            }
                          : undefined
                      }
                      className={cn(
                        "group/row border-t border-line -outline-offset-2 transition-colors animate-[row-in_420ms_var(--ease-spring)_both]",
                        onRowClick && "cursor-pointer hover:bg-surface-2/70",
                        isSelected && "bg-info-bg/50",
                      )}
                      // Satırlar sırayla belirir; uzun listelerde gecikme 0,4 sn ile sınırlı.
                      style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}
                    >
                      {selectable ? (
                        <td className="py-3 pr-2 pl-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Satırı seç: ${name}`}
                            checked={isSelected}
                            onChange={() => toggleRow(id)}
                            className="size-4 accent-accent"
                          />
                        </td>
                      ) : null}
                      {visible.map((c) => (
                        <td key={c.id} className={cn("px-3 py-3 align-middle first:pl-4 last:pr-4", c.align === "right" && "tabular text-right whitespace-nowrap")}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && sorted.length === 0 ? empty : null}
      </div>
      {!loading && sorted.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2/40 px-4 py-2 text-xs text-fg-muted">
          <span className="tabular">{sorted.length} kayıt</span>
          {sort ? <span>Sıralama: {columns.find((c) => c.id === sort.id)?.header}, {sort.desc ? "azalan" : "artan"}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
