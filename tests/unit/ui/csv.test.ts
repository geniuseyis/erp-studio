import { expect, test } from "vitest";
import { toCsv } from "@/ui/csv";
import { type Column, sortRows } from "@/ui/table-types";

type Row = { a: string; b: number; c?: string };
const cols: Column<Row>[] = [
  { id: "a", header: "Ad", cell: (r) => r.a, sortValue: (r) => r.a },
  { id: "b", header: "Miktar", cell: (r) => r.b, csvValue: (r) => r.b, sortValue: (r) => r.b },
];

test("başlık, noktalı virgül ayracı, BOM, CRLF ve tırnak kaçışı", () => {
  expect(toCsv([{ a: 'Meşe "masif"', b: 1250.5 }], cols)).toBe('﻿Ad;Miktar\r\n"Meşe ""masif""";1250,5\r\n');
});

test("ayraç ya da satır sonu içeren metin tırnaklanır; düz metin tırnaklanmaz", () => {
  const csv = toCsv(
    [
      { a: "MDF; 18 mm", b: 1 },
      { a: "iki\nsatır", b: 2 },
      { a: "Ceviz", b: 3 },
    ],
    cols,
  );
  expect(csv).toBe('﻿Ad;Miktar\r\n"MDF; 18 mm";1\r\n"iki\nsatır";2\r\nCeviz;3\r\n');
});

test("csvValue yoksa sortValue, o da yoksa boş; gizli sütun da dışa aktarılır", () => {
  const withHidden: Column<Row>[] = [
    ...cols,
    { id: "c", header: "Raf", cell: (r) => r.c, csvValue: (r) => r.c ?? "", defaultHidden: true },
    { id: "d", header: "İşlem", cell: () => null },
  ];
  expect(toCsv([{ a: "A", b: 2, c: "D-01" }], withHidden)).toBe("﻿Ad;Miktar;Raf;İşlem\r\nA;2;D-01;\r\n");
});

test("formül gibi başlayan hücre etkisizleştirilir", () => {
  expect(toCsv([{ a: "=TOPLA(A1:A9)", b: 1 }], cols)).toContain("'=TOPLA(A1:A9);1");
});

test("sıralama: sayılar sayısal, metinler Türkçe alfabe sırasıyla", () => {
  const rows: Row[] = [
    { a: "Şerit", b: 10 },
    { a: "çivi", b: 9 },
    { a: "Zımpara", b: 100 },
    { a: "Ceviz", b: 2 },
    { a: "ıhlamur", b: 5 },
    { a: "İğne", b: 7 },
  ];
  expect(sortRows(rows, cols[1] as Column<Row>, false).map((r) => r.b)).toEqual([2, 5, 7, 9, 10, 100]);
  expect(sortRows(rows, cols[1] as Column<Row>, true).map((r) => r.b)).toEqual([100, 10, 9, 7, 5, 2]);
  expect(sortRows(rows, cols[0] as Column<Row>, false).map((r) => r.a)).toEqual(["Ceviz", "çivi", "ıhlamur", "İğne", "Şerit", "Zımpara"]);
  expect(rows[0]?.a).toBe("Şerit");
});
