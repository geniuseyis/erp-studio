import type Anthropic from "@anthropic-ai/sdk";
import { expect, test, vi } from "vitest";
import { type ChatClient, createLimiter, type Deps, handleAsistan, HOURLY_IP_LIMIT, HOURLY_LIMIT, HOURLY_REQUEST_LIMIT, MAX_TOKENS, MAX_TOOL_ROUNDS, MAX_USER_CHARS, modelParams } from "@/assistant/server";

function reply(content: unknown[], stop_reason = "end_turn"): Anthropic.Message {
  return { id: "msg_1", type: "message", role: "assistant", model: "m", content, stop_reason, stop_sequence: null, usage: {} } as unknown as Anthropic.Message;
}

function setup(over: Partial<Deps> = {}, answer: Anthropic.Message = reply([{ type: "text", text: "Merhaba" }])) {
  const create = vi.fn<ChatClient["messages"]["create"]>(async () => answer);
  const client: ChatClient = { messages: { create } };
  const deps: Deps = {
    apiKey: "test-key",
    model: "claude-haiku-5-5",
    limiter: createLimiter(HOURLY_LIMIT, 3_600_000),
    requestLimiter: createLimiter(HOURLY_REQUEST_LIMIT, 3_600_000),
    ipLimiter: createLimiter(HOURLY_IP_LIMIT, 3_600_000),
    createClient: () => client,
    ...over,
  };
  return { create, deps };
}

const post = (deps: Deps, messages: unknown, headers: Record<string, string> = {}) =>
  handleAsistan(new Request("http://x/api/asistan", { method: "POST", body: JSON.stringify({ messages }), headers: { "x-forwarded-for": "1.2.3.4", ...headers } }), deps);

const ask = (text: string) => [{ role: "user", content: text }];

test("anahtar yoksa hızlı yardımcıya yönlendirir ve Claude çağrılmaz", async () => {
  const { create, deps } = setup({ apiKey: undefined });
  const res = await post(deps, ask("merhaba"));
  expect(await res.json()).toEqual({ mode: "simple", reason: "no_key" });
  expect(create).not.toHaveBeenCalled();
});

test("anahtar varken: modeli, 800 jeton sınırını ve araçları gönderir; cevabı döner", async () => {
  const { create, deps } = setup();
  const body = (await (await post(deps, ask("kritik stok"))).json()) as { mode: string; content: unknown[] };
  expect(body).toMatchObject({ mode: "ai", content: [{ type: "text", text: "Merhaba" }] });
  const params = create.mock.calls[0]![0];
  expect(params.model).toBe("claude-haiku-5-5");
  expect(params.max_tokens).toBe(MAX_TOKENS);
  expect(params.tools?.length).toBeGreaterThan(5);
  expect(params.messages).toEqual([{ role: "user", content: "kritik stok" }]);
});

test("araç isteği olduğu gibi döner", async () => {
  const { deps } = setup({}, reply([{ type: "tool_use", id: "tu_1", name: "malzeme_stok", input: { arama: "mese" } }], "tool_use"));
  const body = (await (await post(deps, ask("meşe stoğu"))).json()) as { content: unknown[]; stopReason: string };
  expect(body.stopReason).toBe("tool_use");
  expect(body.content).toEqual([{ type: "tool_use", id: "tu_1", name: "malzeme_stok", input: { arama: "mese" } }]);
});

test("mesaj 1000 karakteri aşarsa 400 too_long, Claude çağrılmaz ve sınır düşmez", async () => {
  const { create, deps } = setup();
  const res = await post(deps, ask("a".repeat(MAX_USER_CHARS + 1)));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "too_long" });
  expect(create).not.toHaveBeenCalled();
  expect((await post(deps, ask("a".repeat(MAX_USER_CHARS)))).status).toBe(200);
});

test("saatte 20 mesaj: 21.si hızlı yardımcıya yönlenir; başka ziyaretçi etkilenmez", async () => {
  const { create, deps } = setup();
  const cookie = { cookie: "asistan_id=11111111-1111-1111-1111-111111111111" };
  for (let i = 0; i < 20; i++) expect((await (await post(deps, ask(`soru ${i}`), cookie)).json()) as { mode: string }).toMatchObject({ mode: "ai" });
  expect(await (await post(deps, ask("yirmi bir"), cookie)).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(create).toHaveBeenCalledTimes(20);

  const other = { cookie: "asistan_id=22222222-2222-2222-2222-222222222222" };
  expect((await (await post(deps, ask("başka kişi"), other)).json()) as { mode: string }).toMatchObject({ mode: "ai" });
});

const fakeTurn = (id = "t1") => [
  { role: "user", content: "x" },
  { role: "assistant", content: [{ type: "tool_use", id, name: "oneri_ozeti", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "{}" }] },
];

test("uydurma araç turu sınırı aşmaz: her istek hak yer, ziyaretçi başına saatte en çok 120", async () => {
  const { create, deps } = setup();
  const cookie = { cookie: "asistan_id=33333333-3333-3333-3333-333333333333" };
  for (let i = 0; i < HOURLY_REQUEST_LIMIT; i++) expect((await (await post(deps, fakeTurn(), cookie)).json()) as { mode: string }).toMatchObject({ mode: "ai" });
  expect(await (await post(deps, fakeTurn(), cookie)).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(await (await post(deps, ask("yeni mesaj"), cookie)).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(create).toHaveBeenCalledTimes(HOURLY_REQUEST_LIMIT);
});

test("IP sınırı bütün istekleri bağlar; çerezi her seferinde yenilemek kurtarmaz", async () => {
  const { create, deps } = setup({ ipLimiter: createLimiter(3, 3_600_000) });
  for (let i = 0; i < 3; i++) await post(deps, fakeTurn());
  expect(await (await post(deps, fakeTurn())).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(create).toHaveBeenCalledTimes(3);
});

test("IP hakkı önce alınır: IP reddederse ziyaretçi hakları yanmaz", async () => {
  const requestLimiter = { take: vi.fn(() => true) };
  const limiter = { take: vi.fn(() => true) };
  const { deps } = setup({ ipLimiter: { take: () => false }, requestLimiter, limiter });
  expect(await (await post(deps, ask("merhaba"))).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(requestLimiter.take).not.toHaveBeenCalled();
  expect(limiter.take).not.toHaveBeenCalled();
});

test("araç sonucu hemen önceki asistan turundaki bir araç çağrısına bağlı olmalı; sayı ve boyut sınırları", async () => {
  const { create, deps } = setup();
  const forged = fakeTurn("a");
  (forged[2]!.content as { tool_use_id: string }[])[0]!.tool_use_id = "baska";
  const orphan = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] }];
  const many = fakeTurn();
  many[1]!.content = Array.from({ length: 9 }, (_, i) => ({ type: "tool_use", id: `u${i}`, name: "oneri_ozeti", input: {} }));
  many[2]!.content = Array.from({ length: 9 }, (_, i) => ({ type: "tool_result", tool_use_id: `u${i}`, content: "{}" }));
  const big = fakeTurn();
  big[2]!.content = [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(12_000) }];
  const twoBig = [...fakeTurn("t1"), ...fakeTurn("t2").slice(1), ...fakeTurn("t3").slice(1)];
  (twoBig[2]!.content as { content: string }[])[0]!.content = "x".repeat(12_000);
  (twoBig[4]!.content as { content: string }[])[0]!.content = "x".repeat(12_000);
  (twoBig[6]!.content as { content: string }[])[0]!.content = "x".repeat(1);
  const startsWithAssistant = [
    { role: "assistant", content: "merhaba" },
    { role: "user", content: "x" },
  ];
  for (const bad of [forged, orphan, many, startsWithAssistant, twoBig]) expect((await post(deps, bad)).status).toBe(400);
  expect((await post(deps, big)).status).toBe(200);
  expect(create).toHaveBeenCalledTimes(1);
});

test("asistan metni kırpılır", async () => {
  const { create, deps } = setup();
  const turn = fakeTurn();
  turn[1]!.content = [{ type: "text", text: "a".repeat(9000) }, ...(turn[1]!.content as unknown[])];
  await post(deps, turn);
  const sent = create.mock.calls[0]![0].messages[1]!.content as { type: string; text?: string }[];
  expect(sent[0]!.text).toHaveLength(4000);
});

test("model ayarları: Haiku 5.5 düşünme kapalı + low; Haiku 4.5 ikisi de yok; Opus 5.5 desteklenmez", async () => {
  expect(modelParams("claude-haiku-5-5")).toEqual({ thinking: { type: "disabled" }, output_config: { effort: "low" } });
  expect(modelParams("claude-opus-4-8")).toEqual({ thinking: { type: "disabled" }, output_config: { effort: "low" } });
  expect(modelParams("claude-haiku-4-5")).toEqual({});
  expect(modelParams("claude-bilinmeyen")).toEqual({});
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-mythos-5-2"]) expect(modelParams(m)).toBeNull();

  const old = setup({ model: "claude-haiku-4-5" });
  await post(old.deps, ask("merhaba"));
  expect(old.create.mock.calls[0]![0]).not.toHaveProperty("thinking");
  expect(old.create.mock.calls[0]![0]).not.toHaveProperty("output_config");

  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const unsupported = setup({ model: "claude-opus-5-5" });
  expect(await (await post(unsupported.deps, ask("merhaba"))).json()).toEqual({ mode: "simple", reason: "upstream_error" });
  expect(unsupported.create).not.toHaveBeenCalled();
  quiet.mockRestore();
});

test("max_tokens: araç çağrısı atılır, metne (cevap kısaldı) eklenir", async () => {
  const cut = setup({}, reply([{ type: "text", text: "Şu malzemeler" }, { type: "tool_use", id: "t", name: "oneri_ozeti", input: {} }], "max_tokens"));
  const body = (await (await post(cut.deps, ask("merhaba"))).json()) as { content: { type: string; text?: string }[] };
  expect(body.content).toEqual([{ type: "text", text: "Şu malzemeler (cevap kısaldı)" }]);
  const empty = setup({}, reply([{ type: "tool_use", id: "t", name: "oneri_ozeti", input: {} }], "max_tokens"));
  expect(((await (await post(empty.deps, ask("merhaba"))).json()) as { content: unknown[] }).content).toEqual([{ type: "text", text: "(cevap kısaldı)" }]);
});

test("Claude hatasında yalnızca durum kodu günlüğe yazılır, ileti gövdesi ve anahtar yazılmaz", async () => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const error = new Anthropic.APIError(529, { message: "gizli-govde test-key" }, "gizli-govde test-key", new Headers());
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { deps } = setup({ createClient: () => ({ messages: { create: async () => Promise.reject(error) } }) });
  expect(await (await post(deps, ask("merhaba"))).json()).toEqual({ mode: "simple", reason: "upstream_error" });
  const line = String(logged.mock.calls[0]?.[0]);
  expect(line).toContain("529");
  expect(line).not.toContain("gizli-govde");
  expect(line).not.toContain("test-key");
  logged.mockRestore();
});

test("ilk istekte çerez verilir", async () => {
  const { deps } = setup();
  const res = await post(deps, ask("merhaba"));
  expect(res.headers.get("set-cookie")).toMatch(/^asistan_id=[0-9a-f-]{36}; Path=\/api\/asistan; .*HttpOnly/);
});

function rounds(n: number) {
  const messages: unknown[] = [{ role: "user", content: "başla" }];
  for (let i = 0; i < n; i++) {
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "oneri_ozeti", input: {} }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "{}" }] });
  }
  return messages;
}

test("araç turu sınırı: 5. turda araç kapatılır, 6. tur reddedilir", async () => {
  const { create, deps } = setup();
  await post(deps, rounds(MAX_TOOL_ROUNDS - 1));
  expect(create.mock.calls[0]![0].tool_choice).toEqual({ type: "auto" });
  await post(deps, rounds(MAX_TOOL_ROUNDS));
  expect(create.mock.calls[1]![0].tool_choice).toEqual({ type: "none" });

  const res = await post(deps, rounds(MAX_TOOL_ROUNDS + 1));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "tool_loop" });
});

test("geçersiz gövde: bilinmeyen araç, yabancı blok türü, asistanla biten konuşma", async () => {
  const { create, deps } = setup();
  const unknownTool = [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "tool_use", id: "t", name: "sil_hepsini", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] }];
  const image = [{ role: "user", content: [{ type: "image", source: {} }] }];
  const endsWithAssistant = [{ role: "user", content: "x" }, { role: "assistant", content: "y" }];
  for (const bad of [unknownTool, image, endsWithAssistant, [], "metin"]) expect((await post(deps, bad)).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

test("Claude hata verirse hızlı yardımcıya düşer; ret cevabı nazik metne çevrilir", async () => {
  const failing = setup({ createClient: () => ({ messages: { create: async () => Promise.reject(new Error("503")) } }) });
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await (await post(failing.deps, ask("merhaba"))).json()).toEqual({ mode: "simple", reason: "upstream_error" });
  quiet.mockRestore();

  const refused = setup({}, reply([], "refusal"));
  const body = (await (await post(refused.deps, ask("merhaba"))).json()) as { content: { type: string; text: string }[] };
  expect(body.content[0]!.text).toContain("yardımcı olamıyorum");
});
