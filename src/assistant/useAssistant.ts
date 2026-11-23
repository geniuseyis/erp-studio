"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { announceChange } from "@/shell/db-context";
import { useSession } from "@/shell/session";
import { errorMessage } from "@/shell/useAction";
import { useCtx } from "@/shell/useCtx";
import { answerIntent, answerText, categoryReply, menuReply, MENU_CHIP, type ChipAction, type Part, type Reply, welcomeReply } from "./answers";
import { visibleIntents } from "./intents";
import { routeText } from "./match";
import type { AssistantBlock, AsistanResponse } from "./server";
import { dropIncompleteExchange, trimBySize, trimHistory } from "./history";
import { isActionTool, type ActionPreview, previewActionTool, runActionTool, runReadTool } from "./tools";

export type CardState = "pending" | "running" | "done" | "declined" | "error";
/** Sohbet satırları. `bot` tipli parçalar taşır (metin, kart, çip, menü); `confirm` işlem onay kartıdır. */
export type ChatItem =
  | { id: number; at: Date; kind: "user" | "note"; text: string }
  | { id: number; at: Date; kind: "bot"; parts: Part[] }
  | { id: number; at: Date; kind: "confirm"; preview: ActionPreview; state: CardState; text?: string };

/** Yerel cevap en az bu kadar "yazıyor…" gösterir; anında beliren cevap sohbeti ürkütücü yapar. */
const MIN_TYPING_MS = 280;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Mode = "checking" | "ai" | "simple";
const MAX_ROUNDS = 5;

type ApiMessage = { role: "user" | "assistant"; content: string | unknown[] };
type ToolUse = Extract<AssistantBlock, { type: "tool_use" }>;
type ToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

const NO_CHANGE = "Kullanıcı vazgeçti. Hiçbir şey değişmedi.";

/** Asistanın sohbet durumu ve mantığı: iki mod, araç döngüsü (en çok 5 tur) ve onay kartları. */
export function useAssistant() {
  const ctx = useCtx();
  const { user } = useSession();
  const [items, setItems] = useState<ChatItem[]>(() => (user ? [{ id: 0, at: new Date(), kind: "bot", parts: welcomeReply(user).parts }] : []));
  /** Asistanın girdi beklediği boşluk (ör. order_lookup); sonraki serbest yazı onu doldurur. */
  const slot = useRef<string | null>(null);
  const [mode, setMode] = useState<Mode>("checking");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const history = useRef<ApiMessage[]>([]);
  const running = useRef(false);
  const waiting = useRef(new Map<number, (approved: boolean) => void>());

  useEffect(() => {
    let alive = true;
    fetch("/api/asistan")
      .then((r) => r.json() as Promise<{ ai?: boolean }>)
      .then((s) => alive && setMode(s.ai ? "ai" : "simple"))
      .catch(() => alive && setMode("simple"));
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback((item: DistributiveOmit<ChatItem, "id">): number => {
    const id = ++seq.current;
    setItems((all) => [...all, { ...item, id } as ChatItem]);
    return id;
  }, []);
  const patch = useCallback((id: number, change: Partial<Extract<ChatItem, { kind: "confirm" }>>) => {
    setItems((all) => all.map((i) => (i.id === id && i.kind === "confirm" ? { ...i, ...change } : i)));
  }, []);

  const decide = useCallback((id: number, approved: boolean) => waiting.current.get(id)?.(approved), []);

  const runTool = useCallback(
    async (use: ToolUse): Promise<ToolResult> => {
      const reply = (content: string, is_error = false): ToolResult => ({ type: "tool_result", tool_use_id: use.id, content, is_error });
      if (!isActionTool(use.name)) {
        try {
          return reply(JSON.stringify(await runReadTool(ctx(), use.name, use.input)));
        } catch (e) {
          return reply(errorMessage(e), true);
        }
      }
      let preview: ActionPreview;
      try {
        preview = await previewActionTool(ctx(), use.name, use.input);
      } catch (e) {
        const message = errorMessage(e);
        add({ kind: "note", at: new Date(), text: message });
        return reply(message, true);
      }
      // Kart gösterilir; kullanıcı Onayla ya da Vazgeç diyene kadar hiçbir şey yazılmaz.
      const id = add({ kind: "confirm", preview, state: "pending", at: new Date() });
      const approved = await new Promise<boolean>((resolve) => waiting.current.set(id, resolve));
      waiting.current.delete(id);
      if (!approved) {
        patch(id, { state: "declined", text: "Vazgeçildi, hiçbir şey değişmedi." });
        return reply(NO_CHANGE);
      }
      patch(id, { state: "running" });
      try {
        const result = await runActionTool(ctx(), use.name, use.input);
        await announceChange();
        patch(id, { state: "done", text: typeof result.sonuc === "string" ? result.sonuc : "İşlem tamamlandı." });
        return reply(JSON.stringify(result));
      } catch (e) {
        const message = errorMessage(e);
        patch(id, { state: "error", text: message });
        return reply(message, true);
      }
    },
    [add, ctx, patch],
  );

  const showReply = useCallback(
    (r: Reply) => {
      slot.current = r.slot ?? null;
      add({ kind: "bot", at: new Date(), parts: r.parts });
    },
    [add],
  );

  /** Yerel cevap: veritabanından hesaplanır, API çağrısı yapmaz. */
  const answerLocally = useCallback(
    async (run: (c: ReturnType<typeof ctx>) => Promise<Reply>) => {
      try {
        const [r] = await Promise.all([run(ctx()), wait(MIN_TYPING_MS)]);
        showReply(r);
      } catch {
        add({ kind: "note", at: new Date(), text: "Bu soru cevaplanamadı. Biraz sonra yeniden deneyin." });
      }
    },
    [add, ctx, showReply],
  );

  const askClaude = useCallback(
    async (question: string) => {
      history.current.push({ role: "user", content: question });
      // Sunucuya yalnızca son birkaç alışveriş gider: konuşma uzadıkça istek ve maliyet büyümez.
      history.current = trimBySize(trimHistory(history.current));
      let retried = false;
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const res = await fetch("/api/asistan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.current }) });
        const data = (await res.json()) as AsistanResponse;
        if ("error" in data) {
          if ((data.error === "too_many_messages" || data.error === "too_large") && !retried) {
            // Konuşma sunucunun üst sınırını aştı: yalnızca şimdiki soruyla bir kez yeniden denenir.
            retried = true;
            history.current = [{ role: "user", content: question }];
            round = -1;
            continue;
          }
          history.current = [];
          add({ kind: "note", at: new Date(), text: data.error === "too_long" ? "Mesaj en çok 1000 karakter olabilir." : "Bu konuşma çok uzadı. Yeni bir soru sorarak devam edin." });
          return;
        }
        if (data.mode === "simple") {
          history.current = [];
          // Geçici hata oturumu kalıcı olarak hızlı yardımcıya çevirmez: bir sonraki soru yine Claude'a gider.
          if (data.reason === "upstream_error") {
            add({ kind: "note", at: new Date(), text: "Yapay zekâya şu an ulaşılamadı; bu soru hızlı yardımcıyla cevaplandı." });
          } else {
            setMode("simple");
            if (data.reason === "rate_limited") add({ kind: "note", at: new Date(), text: "Saatlik yapay zekâ sınırı doldu; hızlı yardımcıya geçildi." });
            else if (data.reason === "unsupported_model") add({ kind: "note", at: new Date(), text: "Yapay zekâ modeli bu yayında desteklenmiyor; hızlı yardımcıya geçildi." });
          }
          await answerLocally((c) => answerText(c, question, null));
          return;
        }
        history.current.push({ role: "assistant", content: data.content });
        for (const block of data.content) if (block.type === "text") add({ kind: "bot", at: new Date(), parts: [{ type: "text", text: block.text }] });
        const uses = data.content.filter((b): b is ToolUse => b.type === "tool_use");
        if (uses.length === 0) {
          add({ kind: "bot", at: new Date(), parts: [{ type: "chips", chips: [MENU_CHIP] }] });
          return;
        }
        const results: ToolResult[] = [];
        for (const use of uses) results.push(await runTool(use));
        history.current.push({ role: "user", content: results });
      }
      // Döngü cevap yazılmadan bitti: yarım alışveriş atılır, sonraki soru sunucunun rol denetimine takılmaz.
      history.current = dropIncompleteExchange(history.current);
    },
    [add, answerLocally, runTool],
  );

  const begin = useCallback(async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await task();
    } catch {
      history.current = [];
      add({ kind: "note", at: new Date(), text: "Bağlantı kurulamadı. Biraz sonra yeniden deneyin." });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [add]);

  /** Serbest yazı. Yapay zekâ açıksa yalnızca menü dışı sorular Claude'a gider; boşluk cevapları ve selam yereldir. */
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || running.current) return;
      add({ kind: "user", at: new Date(), text });
      await begin(async () => {
        const social = user ? ["greeting", "thanks", "menu"].includes(routeText(text, visibleIntents(user), null).kind) : false;
        if (mode === "ai" && !slot.current && !social) await askClaude(text);
        else await answerLocally((c) => answerText(c, text, slot.current));
      });
    },
    [add, answerLocally, askClaude, begin, mode, user],
  );

  /** Menü, kutucuk ve çip seçimleri: her zaman yerel, maliyetsiz. */
  const choose = useCallback(
    async (action: ChipAction, label: string) => {
      if (!user || running.current) return;
      if (action.type === "link") return;
      add({ kind: "user", at: new Date(), text: label });
      await begin(() =>
        answerLocally(async (c) => {
          if (action.type === "menu") return menuReply(user);
          if (action.type === "category") return categoryReply(user, action.id);
          if (action.type === "intent") return answerIntent(c, action.id);
          return answerText(c, action.text, slot.current);
        }),
      );
    },
    [add, answerLocally, begin, user],
  );

  /** Başlıktaki "Ana menü": sohbeti silmeden menüyü en alta getirir ve bekleyen boşluğu bırakır. */
  const home = useCallback(() => {
    if (!user) return;
    slot.current = null;
    add({ kind: "bot", at: new Date(), parts: menuReply(user).parts });
  }, [add, user]);

  return { items, mode, busy, send, choose, home, decide };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
