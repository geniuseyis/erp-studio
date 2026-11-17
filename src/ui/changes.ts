/** Düzenleme formunda değişen bir alan: "Telefon: 0212 … → 0216 …". */
export type Change = { label: string; from: string; to: string };

/** Alanların eski ve yeni görünen değerlerinden yalnızca değişenleri döner. Baştaki ve sondaki boşluk değişiklik sayılmaz. */
export function diffFields(fields: { label: string; before: string; after: string }[]): Change[] {
  return fields
    .map((f) => ({ label: f.label, from: f.before.trim(), to: f.after.trim() }))
    .filter((c) => c.from !== c.to)
    .map((c) => ({ label: c.label, from: c.from || "—", to: c.to || "—" }));
}
