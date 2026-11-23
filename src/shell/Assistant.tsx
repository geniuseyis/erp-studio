"use client";

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChipData } from "@/assistant/answers";
import { visibleCategories } from "@/assistant/intents";
import { type ChatItem, type Mode, useAssistant } from "@/assistant/useAssistant";
import { cn } from "@/ui/cn";
import { formatTime } from "@/ui/format";
import { ArrowRightIcon, CloseIcon, HomeIcon } from "@/ui/icons";
import { IconButton } from "@/ui/Button";
import { AssistantMark } from "./assistant/AssistantMark";
import { AnswerCard, ChipRow, ConfirmCard, MenuGrid, Rich, Typing } from "./assistant/parts";
import { useSession } from "./session";

const MAX_CHARS = 1000;
const PHONE = "(max-width: 640px)";
const MODE_TEXT: Record<Mode, string> = { checking: "Bağlanıyor…", ai: "Claude", simple: "Hızlı mod" };

type BotItem = Extract<ChatItem, { kind: "bot" }>;
const isBot = (item: ChatItem): item is BotItem => item.kind === "bot";
const isChipsOnly = (item: ChatItem) => isBot(item) && item.parts.every((p) => p.type === "chips");

function Avatar({ className }: { className?: string }) {
  return <AssistantMark size={32} className={className} />;
}

/** Telefon boyutu: pencere tam ekran sayfadır, modal gibi davranır. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

type Focus = "tile" | "chip" | "input" | null;

/** Sağ alttaki asistan balonu ve rehberli sohbet penceresi. Konuşma pencere kapanınca da kalır; hesap değişince sıfırlanır (key). */
export function Assistant() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [seen, setSeen] = useState(0);
  const { items, mode, busy, send, choose, home, decide } = useAssistant();
  const panelId = useId();
  const bubble = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const wantFocus = useRef<Focus>(null);
  const wasOpen = useRef(false);
  const phone = usePhone();

  const categories = useMemo(() => (user ? visibleCategories(user) : []), [user]);
  const lastId = items.length ? items[items.length - 1]!.id : 0;
  const lastBotId = [...items].reverse().find(isBot)?.id;
  const lastMenuId = [...items].reverse().find((i) => isBot(i) && i.parts.some((p) => p.type === "menu"))?.id;
  const pendingConfirm = items.some((i) => i.kind === "confirm" && i.state === "pending");
  const locked = busy || mode === "checking";

  // Pencere kapalıyken gelen cevaplar balonda okunmamış sayısı olur.
  const unread = open ? 0 : items.filter((i) => i.id > seen && i.kind !== "user").length;
  if (open && seen !== lastId) setSeen(lastId);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
    // Odak cevap geldikten sonra taşınır: çip ve kutucuk seçiminde ilk yeni çipe, yazıda kutuya.
    const last = items[items.length - 1];
    if (!open || !wantFocus.current || !last || last.kind === "user") return;
    const kind = wantFocus.current;
    wantFocus.current = null;
    const root = panelRef.current;
    if (kind === "tile") root?.querySelector<HTMLElement>("[data-menu-tile]")?.focus();
    else if (kind === "chip") (root?.querySelector<HTMLElement>("[data-chip-group] :is(button, a)") ?? input.current)?.focus();
    else input.current?.focus();
  }, [items, open]);

  // Açılışta menü odak alır.
  useEffect(() => {
    if (!open) return;
    const tile = panelRef.current?.querySelector<HTMLElement>("[data-menu-tile]");
    (tile ?? input.current)?.focus();
  }, [open]);

  // Kapanınca odak balona döner. Telefonda balon pencere açıkken gizlidir (display:none); odak ancak kapandıktan sonra,
  // balon yeniden görünür olunca verilebilir. Bu yüzden kapatan her yol (Esc, düğme, bağlantı) bu tek etkiden geçer.
  useEffect(() => {
    if (!open && wasOpen.current) bubble.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Esc pencereyi kapatır. Odak gönderim sırasında kilitlenen düğmeden body'ye düşebildiği için dinleyici belgededir;
  // başka bir pencerenin ya da çekmecenin Esc'ine karışmamak için yalnızca odak bu pencerede ya da boştayken çalışır.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Node ? e.target : null;
      if (target === document.body || (target && panelRef.current?.contains(target))) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
  }
  // Telefonda sayfa modaldır: Tab pencerenin içinde döner.
  function trapTab(e: ReactKeyboardEvent) {
    if (!phone || e.key !== "Tab") return;
    const nodes = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])") ?? [])];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function navigated() {
    // Telefonda pencere ekranı kaplar; bağlantıya gidilince kapanır.
    if (window.matchMedia(PHONE).matches) setOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    setDraft("");
    wantFocus.current = "input";
    void send(text);
  }
  function pick(chip: ChipData) {
    if (busy) return;
    wantFocus.current = chip.action.type === "menu" ? "tile" : "chip";
    void choose(chip.action, chip.label);
  }

  // Aynı gönderenin art arda mesajları gruplanır: avatar ilkinde, saat sonuncuda.
  const flags = useMemo(() => {
    const map = new Map<number, { first: boolean; last: boolean }>();
    const content = items.filter((i) => !isChipsOnly(i));
    const who = (i: ChatItem) => (i.kind === "user" ? "user" : "bot");
    content.forEach((item, idx) => map.set(item.id, { first: content[idx - 1] === undefined || who(content[idx - 1]!) !== who(item), last: content[idx + 1] === undefined || who(content[idx + 1]!) !== who(item) }));
    return map;
  }, [items]);

  function renderItem(item: ChatItem) {
    const f = flags.get(item.id) ?? { first: true, last: true };
    const time = f.last ? (
      <time dateTime={item.at.toISOString()} className={cn("px-1 text-[0.6875rem] text-fg-muted", item.kind === "user" && "text-right")}>
        {formatTime(item.at)}
      </time>
    ) : null;
    if (item.kind === "user") {
      return (
        <div key={item.id} className={cn("flex flex-col items-end gap-0.5", !f.first && "-mt-1")}>
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-fg">{item.text}</p>
          {time}
        </div>
      );
    }
    if (item.kind === "note") {
      return (
        <p key={item.id} className="rounded-xl bg-warn-bg px-3 py-2 text-sm font-medium text-warn">
          {item.text}
        </p>
      );
    }
    if (item.kind === "confirm") {
      return (
        <div key={item.id} className="pl-9">
          <ConfirmCard item={item} onDecide={(ok) => decide(item.id, ok)} />
        </div>
      );
    }
    if (!isBot(item)) return null;
    const chips = item.parts.find((p) => p.type === "chips");
    const chipsOnly = isChipsOnly(item);
    const showChips = chips?.type === "chips" && item.id === lastBotId && !pendingConfirm;
    return (
      <div key={item.id} className={cn("flex items-end gap-2", !f.first && !chipsOnly && "-mt-1")}>
        {chipsOnly ? <span className="w-7 shrink-0" /> : f.first ? <Avatar className="size-7" /> : <span className="w-7 shrink-0" />}
        <div className="flex min-w-0 max-w-[92%] flex-1 flex-col items-start gap-1.5">
          {item.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <p key={i} className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2 text-sm text-fg">
                  <Rich text={part.text} onNavigate={navigated} />
                </p>
              );
            }
            if (part.type === "card") return <div key={i} className="w-full"><AnswerCard card={part.card} onNavigate={navigated} /></div>;
            if (part.type === "menu") {
              return item.id === lastMenuId && item.id === lastBotId ? (
                <div key={i} className="w-full">
                  <MenuGrid categories={categories} disabled={busy} onPick={(id, label) => pick({ label, action: { type: "category", id } })} />
                </div>
              ) : null;
            }
            return showChips ? <ChipRow key={i} chips={part.chips} onPick={pick} onNavigate={navigated} disabled={busy} /> : null;
          })}
          {!chipsOnly ? time : null}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-30 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Atölye Asistanı"
          aria-modal={phone ? true : undefined}
          onKeyDown={trapTab}
          className="pointer-events-auto flex h-[min(38rem,calc(100dvh-7.5rem))] w-[min(26rem,calc(100vw-2rem))] animate-[pop-in_180ms_ease-out] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-panel max-[640px]:fixed max-[640px]:inset-0 max-[640px]:h-dvh max-[640px]:w-full max-[640px]:rounded-none max-[640px]:border-0"
        >
          <header className="flex items-center gap-2.5 bg-[linear-gradient(135deg,var(--hero-from),var(--hero-via)_55%,var(--hero-to))] py-2.5 pr-2 pl-3.5 text-hero-fg max-[640px]:pt-[max(0.625rem,env(safe-area-inset-top))]">
            <Avatar className="size-10" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">Atölye Asistanı</h2>
              <p data-testid="assistant-mode" className="flex items-center gap-1.5 truncate text-xs text-hero-fg-muted">
                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", mode === "ai" ? "bg-honey" : "bg-hero-fg-muted")} />
                <span>{MODE_TEXT[mode]}</span>
              </p>
            </div>
            <button
              type="button"
              aria-label="Ana menü"
              onClick={() => {
                wantFocus.current = "tile";
                home();
              }}
              className="press inline-flex h-9 items-center gap-1.5 rounded-xl border border-hero-fg/25 bg-hero-fg/10 px-3 text-sm font-semibold hover:bg-hero-fg/20 pointer-coarse:h-11"
            >
              <HomeIcon size={16} aria-hidden="true" />
              <span aria-hidden="true">Ana menü</span>
            </button>
            <IconButton label="Asistanı kapat" size="sm" onClick={close} className="text-hero-fg hover:bg-hero-fg/15 pointer-coarse:size-11">
              <CloseIcon size={16} />
            </IconButton>
          </header>

          <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Sohbet" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-bg/60 p-3">
            {items.map(renderItem)}
            {busy && !pendingConfirm ? <Typing /> : null}
            <div ref={end} />
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line bg-surface p-3 max-[640px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_CHARS}
              aria-label="Mesajınız"
              placeholder={mode === "checking" ? "Bağlanıyor…" : "Ne öğrenmek istersiniz?"}
              disabled={mode === "checking"}
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-full border border-line bg-bg px-4 text-base text-fg placeholder:text-fg-muted disabled:opacity-55"
            />
            <button
              type="submit"
              aria-label="Gönder"
              disabled={locked || !draft.trim()}
              className="press grid size-11 shrink-0 place-items-center rounded-full border border-transparent bg-accent text-accent-fg shadow-button hover:bg-accent-hover disabled:opacity-55"
            >
              <ArrowRightIcon size={18} />
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={bubble}
        type="button"
        aria-label={open ? "Asistanı kapat" : unread > 0 ? `Asistanı aç, ${unread} yeni mesaj` : "Asistanı aç"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn("press pointer-events-auto relative grid size-14 place-items-center rounded-full border border-transparent shadow-button", open ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-transparent", open && "max-[640px]:hidden")}
      >
        {open ? <CloseIcon size={22} /> : <AssistantMark size={56} pulse />}
        {unread > 0 ? (
          <span aria-hidden="true" data-testid="assistant-unread" className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full border-2 border-bg bg-danger px-1 text-[0.6875rem] font-bold leading-4 text-white">
            {unread}
          </span>
        ) : null}
      </button>
    </div>
  );
}
