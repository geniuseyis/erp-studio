import type Anthropic from "@anthropic-ai/sdk";
import { expect, test, vi } from "vitest";
import { type ChatClient, createLimiter, type Deps, handleAsistan, MAX_TOKENS, MAX_TOOL_ROUNDS, MAX_USER_CHARS } from "@/assistant/server";


function reply(content: unknown[], stop_reason = "end_turn"): Anthropic.Message {
  return { id: "msg_1", type: "message", role: "assistant", model: "m", content, stop_reason, stop_sequence: null, usage: {} } as unknown as Anthropic.Message;
}

function setup(over: Partial<Deps> = {}, answer: Anthropic.Message = reply([{ type: "text", text: "Merhaba" }])) {
  const create = vi.fn<ChatClient["messages"]["create"]>(async () => answer);
  const client: ChatClient = { messages: { create } };
  const deps: Deps = {
    apiKey: "test-key",
    model: "claude-haiku-5-5",
    limiter: createLimiter(20, 3_600_000),
    ipLimiter: createLimiter(60, 3_600_000),
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

test("saatte 20 mesaj: 21.si hızlı yardımcıya yönlenir; araç turları sayılmaz; başka ziyaretçi etkilenmez", async () => {
  const { create, deps } = setup();
  const cookie = { cookie: "asistan_id=11111111-1111-1111-1111-111111111111" };
  for (let i = 0; i < 20; i++) expect((await (await post(deps, ask(`soru ${i}`), cookie)).json()) as { mode: string }).toMatchObject({ mode: "ai" });
  expect(await (await post(deps, ask("yirmi bir"), cookie)).json()).toEqual({ mode: "simple", reason: "rate_limited" });
  expect(create).toHaveBeenCalledTimes(20);

  const turn = [
    { role: "user", content: "x" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "oneri_ozeti", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
  ];
  expect((await (await post(deps, turn, cookie)).json()) as { mode: string }).toMatchObject({ mode: "ai" });

  const other = { cookie: "asistan_id=22222222-2222-2222-2222-222222222222" };
  expect((await (await post(deps, ask("başka kişi"), other)).json()) as { mode: string }).toMatchObject({ mode: "ai" });
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
