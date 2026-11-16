import type { ReactNode } from "react";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Verilirse sütun sıralanabilir. */
  sortValue?: (row: T) => string | number;
  /** CSV'ye yazılacak değer; yoksa sortValue kullanılır. */
  csvValue?: (row: T) => string | number;
  align?: "left" | "right";
  /** Başlangıçta gizli; "Sütunlar" menüsünden açılır. CSV'ye yine de yazılır. */
  defaultHidden?: boolean;
};

const collator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

/** Satırların sıralı bir kopyasını döner; özgün diziye dokunmaz. Metinler Türkçe alfabe sırasıyla karşılaştırılır. */
export function sortRows<T>(rows: readonly T[], column: Column<T>, desc: boolean): T[] {
  const value = column.sortValue;
  if (!value) return [...rows];
  const sorted = [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (typeof x === "number" && typeof y === "number") return x - y;
    return collator.compare(String(x), String(y));
  });
  return desc ? sorted.reverse() : sorted;
}
