import { expect, test } from "vitest";
import { trimHistory } from "@/assistant/history";
import { parseRich } from "@/assistant/rich";

type Turn = { role: "user" | "assistant"; content: string | unknown[] };

/** Bir alışveriş: soru, araç çağrısı, araç sonucu, cevap. */
const exchange = (n: number): Turn[] => [
  { role: "user", content: `soru ${n}` },
  { role: "assistant", content: [{ type: "tool_use", id: `t${n}` }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}` }] },
  { role: "assistant", content: [{ type: "text", text: `cevap ${n}` }] },
];

test("trimHistory: son 3 alışveriş kalır, kesim düz kullanıcı mesajında, araç çifti bölünmez", () => {
  const all = [1, 2, 3, 4, 5].flatMap(exchange);
  const kept = trimHistory(all);
  expect(kept).toHaveLength(12);
  expect(kept[0]).toEqual({ role: "user", content: "soru 3" });
  expect(kept.at(-1)).toEqual(exchange(5).at(-1));
  // Her araç sonucunun çağrısı kalan parçada durur.
  const ids = new Set(kept.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => (b as { type: string }).type === "tool_use").map((b) => (b as { id: string }).id) : [])));
  for (const m of kept) if (Array.isArray(m.content)) for (const b of m.content as { type: string; tool_use_id?: string }[]) if (b.type === "tool_result") expect(ids.has(b.tool_use_id!)).toBe(true);
});

test("trimHistory: kısa konuşma olduğu gibi kalır; şimdiki soru her zaman son mesajdır", () => {
  const short = [...exchange(1), { role: "user" as const, content: "yeni" }];
  expect(trimHistory(short)).toBe(short);
  const long = [...[1, 2, 3, 4].flatMap(exchange), { role: "user" as const, content: "yeni" }];
  expect(trimHistory(long).at(-1)).toEqual({ role: "user", content: "yeni" });
  expect(trimHistory(long)[0]).toEqual({ role: "user", content: "soru 3" });
});

test("parseRich: uygulama içi bağlantı çizilir; // ve /\\ ile başlayanlar ve dış adresler düz metin kalır", () => {
  expect(parseRich("bkz [SIP-1](/satis/siparisler?ac=1) **önemli**")).toEqual([
    { type: "text", text: "bkz " },
    { type: "link", label: "SIP-1", href: "/satis/siparisler?ac=1" },
    { type: "text", text: " " },
    { type: "bold", text: "önemli" },
  ]);
  for (const bad of ["[x](//evil.com)", "[x](/\\evil.com)", "[x](https://evil.com)", "[x](javascript:alert(1))"]) {
    expect(parseRich(bad).every((t) => t.type !== "link")).toBe(true);
  }
});

import { dropIncompleteExchange, trimBySize } from "@/assistant/history";

const bulky = (n: number, chars: number): Turn[] => [
  { role: "user", content: `soru ${n}` },
  { role: "assistant", content: [{ type: "tool_use", id: `t${n}` }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: "x".repeat(chars) }] },
  { role: "assistant", content: [{ type: "text", text: `cevap ${n}` }] },
];

test("trimBySize: 3 gerçekçi alışveriş (9000 karakterlik sonuç) 20 bini aşarsa en eskisi atılır", () => {
  const three = [1, 2, 3].flatMap((n) => bulky(n, 9000));
  const kept = trimBySize(three);
  expect(kept[0]).toEqual({ role: "user", content: "soru 2" });
  expect(kept).toHaveLength(8);
  // Tek alışveriş bile sınırı aşsa son alışveriş (şimdiki soru) kalır.
  expect(trimBySize(bulky(1, 30_000))).toHaveLength(4);
  // Sınır altındaysa dokunulmaz.
  const small = [1, 2, 3].flatMap((n) => bulky(n, 100));
  expect(trimBySize(small)).toBe(small);
});

test("dropIncompleteExchange: araç sonucu turuyla biten konuşmada yarım alışveriş atılır", () => {
  const done = bulky(1, 10);
  const dangling = [...done, { role: "user" as const, content: "soru 2" }, { role: "assistant" as const, content: [{ type: "tool_use", id: "t2" }] }, { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t2", content: "{}" }] }];
  expect(dropIncompleteExchange(dangling)).toEqual(done);
  expect(dropIncompleteExchange(done)).toBe(done);
  expect(dropIncompleteExchange([{ role: "user" as const, content: "x" }])).toHaveLength(1);
});
