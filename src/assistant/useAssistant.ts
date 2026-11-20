"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { announceChange, useDb } from "@/shell/db-context";
import { errorMessage } from "@/shell/useAction";
import { useCtx } from "@/shell/useCtx";
import type { AssistantBlock, AsistanResponse } from "./server";
import { trimHistory } from "./history";
import { answerSimple } from "./simple";
import { isActionTool, type ActionPreview, previewActionTool, runActionTool, runReadTool } from "./tools";

export type CardState = "pending" | "running" | "done" | "declined" | "error";
export type ChatItem =
  | { id: number; kind: "user" | "bot" | "note"; text: string }
  | { id: number; kind: "card"; preview: ActionPreview; state: CardState; text?: string };

export type Mode = "checking" | "ai" | "simple";
const MAX_ROUNDS = 5;

type ApiMessage = { role: "user" | "assistant"; content: string | unknown[] };
type ToolUse = Extract<AssistantBlock, { type: "tool_use" }>;
type ToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

const NO_CHANGE = "Kullanıcı vazgeçti. Hiçbir şey değişmedi.";

/** Asistanın sohbet durumu ve mantığı: iki mod, araç döngüsü (en çok 5 tur) ve onay kartları. */
export function useAssistant() {
  const { db } = useDb();
  const ctx = useCtx();
  const [items, setItems] = useState<ChatItem[]>([]);
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
  const patch = useCallback((id: number, change: Partial<Extract<ChatItem, { kind: "card" }>>) => {
    setItems((all) => all.map((i) => (i.id === id && i.kind === "card" ? { ...i, ...change } : i)));
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
        add({ kind: "note", text: message });
        return reply(message, true);
      }
      // Kart gösterilir; kullanıcı Onayla ya da Vazgeç diyene kadar hiçbir şey yazılmaz.
      const id = add({ kind: "card", preview, state: "pending" });
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

  const answerLocally = useCallback(
    async (question: string) => {
      try {
        add({ kind: "bot", text: await answerSimple(db, question, new Date()) });
      } catch {
        add({ kind: "note", text: "Bu soru cevaplanamadı. Biraz sonra yeniden deneyin." });
      }
    },
    [add, db],
  );

  const askClaude = useCallback(
    async (question: string) => {
      history.current.push({ role: "user", content: question });
      // Sunucuya yalnızca son birkaç alışveriş gider: konuşma uzadıkça istek ve maliyet büyümez.
      history.current = trimHistory(history.current);
      let retried = false;
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const res = await fetch("/api/asistan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.current }) });
        const data = (await res.json()) as AsistanResponse;
        if ("error" in data) {
          if (data.error === "too_many_messages" && !retried) {
            // Konuşma sunucunun üst sınırını aştı: yalnızca şimdiki soruyla bir kez yeniden denenir.
            retried = true;
            history.current = [{ role: "user", content: question }];
            round = -1;
            continue;
          }
          history.current = [];
          add({ kind: "note", text: data.error === "too_long" ? "Mesaj en çok 1000 karakter olabilir." : "Bu konuşma çok uzadı. Yeni bir soru sorarak devam edin." });
          return;
        }
        if (data.mode === "simple") {
          history.current = [];
          // Geçici hata oturumu kalıcı olarak hızlı yardımcıya çevirmez: bir sonraki soru yine Claude'a gider.
          if (data.reason === "upstream_error") {
            add({ kind: "note", text: "Yapay zekâya şu an ulaşılamadı; bu soru hızlı yardımcıyla cevaplandı." });
          } else {
            setMode("simple");
            if (data.reason === "rate_limited") add({ kind: "note", text: "Saatlik yapay zekâ sınırı doldu; hızlı yardımcıya geçildi." });
          }
          await answerLocally(question);
          return;
        }
        history.current.push({ role: "assistant", content: data.content });
        for (const block of data.content) if (block.type === "text") add({ kind: "bot", text: block.text });
        const uses = data.content.filter((b): b is ToolUse => b.type === "tool_use");
        if (uses.length === 0) return;
        const results: ToolResult[] = [];
        for (const use of uses) results.push(await runTool(use));
        history.current.push({ role: "user", content: results });
      }
    },
    [add, answerLocally, runTool],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || running.current) return;
      running.current = true;
      setBusy(true);
      add({ kind: "user", text });
      try {
        if (mode === "ai") await askClaude(text);
        else await answerLocally(text);
      } catch {
        history.current = [];
        add({ kind: "note", text: "Bağlantı kurulamadı. Biraz sonra yeniden deneyin." });
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [add, answerLocally, askClaude, mode],
  );

  return { items, mode, busy, send, decide };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
