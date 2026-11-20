"use client";

import Link from "next/link";
import { type FormEvent, Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type CardState, type ChatItem, type Mode, useAssistant } from "@/assistant/useAssistant";
import { Button, IconButton, Spinner } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { CloseIcon, SparkIcon } from "@/ui/icons";

const MAX_CHARS = 1000;
const SUGGESTIONS = ["Kritik stok", "Geciken siparişler", "Bugünün iş emirleri", "Sipariş nasıl açılır?"];
const MODE_TITLE: Record<Mode, string> = { checking: "Asistan", ai: "Claude", simple: "Hızlı yardımcı · yapay zekâ kapalı" };

const RICH = /\[([^\]]+)\]\((\/[^)\s]*)\)|\*\*([^*]+)\*\*/g;

/** Cevaptaki uygulama içi bağlantıları ([KOD](/yol?ac=…)) ve **kalın** yazıyı çizer; başka bağlantı türü çizilmez. */
function Rich({ text, onNavigate }: { text: string; onNavigate: () => void }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RICH)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (m[2] && !m[2].startsWith("//")) {
      parts.push(
        <Link key={at} href={m[2]} onClick={onNavigate} className="font-semibold text-accent underline underline-offset-2">
          {m[1]}
        </Link>,
      );
    } else if (m[3]) {
      parts.push(<strong key={at}>{m[3]}</strong>);
    } else {
      parts.push(m[0]);
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

const CARD_NOTE: Record<CardState, string> = { pending: "", running: "İşleniyor…", done: "", declined: "", error: "" };

function Card({ item, onDecide }: { item: Extract<ChatItem, { kind: "card" }>; onDecide: (approved: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = item.state === "pending";
  // Onay kartlarında olduğu gibi odak güvenli seçenekte başlar: Enter tek başına işlem yapmaz.
  useEffect(() => {
    if (pending) cancel.current?.focus();
  }, [pending]);
  const tone = item.state === "error" ? "border-danger/40 bg-danger-bg" : item.state === "done" ? "border-ok/30 bg-ok-bg" : "border-line-strong bg-surface";
  return (
    <div role="group" aria-label="Onay kartı" className={cn("rounded-2xl border p-3 text-sm shadow-card", tone)}>
      <p className="font-semibold text-fg">{item.preview.title}</p>
      <ul className="mt-1.5 space-y-1 text-fg-muted">
        {item.preview.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {pending ? (
        <div className="mt-3 flex gap-2">
          <Button ref={cancel} size="sm" onClick={() => onDecide(false)}>
            Vazgeç
          </Button>
          <Button size="sm" variant="primary" onClick={() => onDecide(true)}>
            {item.preview.confirmLabel}
          </Button>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-2 font-medium text-fg">
          {item.state === "running" ? <Spinner /> : null}
          {item.text ?? CARD_NOTE[item.state]}
        </p>
      )}
    </div>
  );
}

function Bubble({ item, onNavigate }: { item: ChatItem; onNavigate: () => void }) {
  if (item.kind === "user") {
    return <p className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-fg">{item.text}</p>;
  }
  if (item.kind === "note") {
    return <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm font-medium text-warn">{item.text}</p>;
  }
  if (item.kind === "bot") {
    return (
      <p className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2 text-sm text-fg">
        <Rich text={item.text} onNavigate={onNavigate} />
      </p>
    );
  }
  return null;
}

/** Sağ alttaki asistan balonu ve sohbet penceresi. Konuşma pencere kapanınca da kalır; hesap değişince sıfırlanır (key). */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { items, mode, busy, send, decide } = useAssistant();
  const panelId = useId();
  const bubble = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [items]);

  const panelRef = useRef<HTMLElement>(null);
  // Esc pencereyi kapatır. Odak gönderim sırasında kilitlenen düğmeden body'ye düşebildiği için dinleyici belgededir;
  // başka bir pencerenin ya da çekmecenin Esc'ine karışmamak için yalnızca odak bu pencerede ya da boştayken çalışır.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Node ? e.target : null;
      if (target === document.body || (target && panelRef.current?.contains(target))) {
        setOpen(false);
        bubble.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    bubble.current?.focus();
  }
  function navigated() {
    // Telefonda pencere sayfanın üstünü kaplar; bağlantıya gidilince kapanır.
    if (window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || mode === "checking") return;
    setDraft("");
    void send(text);
  }
  function ask(text: string) {
    if (busy || mode === "checking") return;
    void send(text);
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-30 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Asistan"
          className="pointer-events-auto flex h-[min(34rem,calc(100dvh-7.5rem))] w-[min(24rem,calc(100vw-2rem))] animate-[pop-in_160ms_ease-out] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-panel"
        >
          <header className="flex items-center gap-2 border-b border-line bg-surface-2 py-2 pr-2 pl-4">
            <SparkIcon size={16} aria-hidden="true" className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-fg">Asistan</h2>
              <p data-testid="assistant-mode" className="truncate text-xs text-fg-muted">
                {MODE_TITLE[mode]}
              </p>
            </div>
            <IconButton label="Asistanı kapat" size="sm" onClick={close}>
              <CloseIcon size={16} />
            </IconButton>
          </header>

          <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Sohbet" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {items.length === 0 ? (
              <>
                <p className="rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2 text-sm text-fg">
                  Merhaba, ben ERP asistanıyım. Stok, sipariş, iş emri ve satın alma hakkında sorabilirsiniz.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy || mode === "checking"}
                      onClick={() => ask(s)}
                      className="press rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:border-line-strong hover:bg-surface-2 disabled:opacity-55"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {items.map((item) => (item.kind === "card" ? <Card key={item.id} item={item} onDecide={(ok) => decide(item.id, ok)} /> : <Bubble key={item.id} item={item} onNavigate={navigated} />))}
            {busy && !items.some((i) => i.kind === "card" && i.state === "pending") ? (
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Spinner /> Düşünüyor…
              </p>
            ) : null}
            <div ref={end} />
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_CHARS}
              aria-label="Mesajınız"
              placeholder={mode === "checking" ? "Bağlanıyor…" : "Bir şey sorun"}
              disabled={mode === "checking"}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base text-fg placeholder:text-fg-muted disabled:opacity-55"
            />
            <Button type="submit" variant="primary" disabled={busy || mode === "checking" || !draft.trim()}>
              Gönder
            </Button>
          </form>
        </section>
      ) : null}

      <button
        ref={bubble}
        type="button"
        aria-label={open ? "Asistanı kapat" : "Asistanı aç"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="press pointer-events-auto grid size-14 place-items-center rounded-full border border-transparent bg-accent text-accent-fg shadow-button hover:bg-accent-hover"
      >
        {open ? <CloseIcon size={22} /> : <SparkIcon size={22} />}
      </button>
    </div>
  );
}
