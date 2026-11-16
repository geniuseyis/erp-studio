import type { Column } from "./table-types";

const SEPARATOR = ";";

function cell(value: string | number | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") {
    // Excel'in Türkçe ayarıyla sayı olarak okuması için ondalık virgül, binlik ayraç yok.
    return value.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 3 });
  }
  // Formül enjeksiyonuna karşı: =, +, -, @ ile başlayan metin düz metne çevrilir.
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Satırları Excel'in doğrudan açtığı CSV'ye çevirir: UTF-8 BOM, ";" ayracı, CRLF. Gizli sütunlar da yazılır. */
export function toCsv<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(columns.map((c) => cell((c.csvValue ?? c.sortValue)?.(row))).join(SEPARATOR));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
