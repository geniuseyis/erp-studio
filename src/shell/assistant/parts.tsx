"use client";

import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useRef } from "react";
import type { CardData, ChipData, Row } from "@/assistant/answers";
import { CATEGORIES, type CategoryId } from "@/assistant/intents";
import { parseRich } from "@/assistant/rich";
import type { CardState, ChatItem } from "@/assistant/useAssistant";
import { Button, Spinner } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { BoxIcon, CheckIcon, ChevronRightIcon, ClipboardIcon, FactoryIcon, InfoIcon, ReceiptIcon, SearchIcon, TruckIcon } from "@/ui/icons";
import { StatusChip } from "@/ui/StatusChip";

/** Cevaptaki uygulama içi bağlantıları ve **kalın** yazıyı çizer (ayrıştırma: rich.ts). */
export function Rich({ text, onNavigate }: { text: string; onNavigate: () => void }): ReactNode {
  return parseRich(text).map((t, i) => {
    if (t.type === "link") {
      return (
        <Link key={i} href={t.href} onClick={onNavigate} className="font-semibold text-accent underline underline-offset-2">
          {t.label}
        </Link>
      );
    }
    return t.type === "bold" ? <strong key={i}>{t.text}</strong> : <Fragment key={i}>{t.text}</Fragment>;
  });
}

const TILE_ICON: Record<CategoryId, typeof BoxIcon> = {
  satis: ReceiptIcon,
  uretim: FactoryIcon,
  stok: BoxIcon,
  satinalma: TruckIcon,
  ozet: ClipboardIcon,
  nasil: InfoIcon,
};

/** Ana menü: yetkiye göre süzülmüş kategori kutucukları. */
export function MenuGrid({ categories, onPick, disabled }: { categories: typeof CATEGORIES; onPick: (id: CategoryId, label: string) => void; disabled: boolean }) {
  return (
    <div role="group" aria-label="Başlıklar" className="grid grid-cols-2 gap-2">
      {categories.map((c) => {
        const Icon = TILE_ICON[c.id];
        return (
          <button
            key={c.id}
            type="button"
            data-menu-tile
            aria-label={c.label}
            disabled={disabled}
            onClick={() => onPick(c.id, c.label)}
            className="press flex min-h-[4.5rem] flex-col items-start gap-1.5 rounded-2xl border border-line bg-surface p-3 text-left shadow-[0_1px_2px_rgb(60_38_18/0.05)] hover:border-line-strong hover:bg-surface-2 disabled:opacity-55"
          >
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-[10px] bg-accent/12 text-accent">
              <Icon size={18} />
            </span>
            <span className="text-sm font-semibold text-fg">{c.label}</span>
            <span aria-hidden="true" className="-mt-1 text-xs text-fg-muted">
              {c.blurb}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const CHIP = "press inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium pointer-coarse:min-h-11 disabled:opacity-55";

/** Hızlı yanıt çipleri. Yalnızca son mesajdakiler etkindir; eskileri sohbeti kalabalıklaştırmasın diye çizilmez. */
export function ChipRow({ chips, onPick, onNavigate, disabled }: { chips: ChipData[]; onPick: (chip: ChipData) => void; onNavigate: () => void; disabled: boolean }) {
  return (
    <div role="group" aria-label="Hızlı yanıtlar" data-chip-group className="flex flex-wrap gap-2 pt-0.5">
      {chips.map((chip) => {
        const isMenu = chip.action.type === "menu";
        const tone = isMenu ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15" : "border-line-strong/50 bg-surface text-fg hover:border-line-strong hover:bg-surface-2";
        if (chip.action.type === "link") {
          return (
            <Link key={chip.label} href={chip.action.href} onClick={onNavigate} className={cn(CHIP, tone, "gap-1")}>
              {chip.label}
              <ChevronRightIcon size={14} aria-hidden="true" />
            </Link>
          );
        }
        return (
          <button key={chip.label} type="button" disabled={disabled} aria-label={isMenu ? "Ana menüye dön" : undefined} onClick={() => onPick(chip)} className={cn(CHIP, tone)}>
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function RowItem({ row, onNavigate }: { row: Row; onNavigate: () => void }) {
  return (
    <li className="flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          {row.code ? <span className="shrink-0 text-xs font-bold tracking-wide text-fg">{row.code}</span> : null}
          <span className="truncate text-sm text-fg">{row.name}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.chip ? <StatusChip tone={row.chip.tone}>{row.chip.label}</StatusChip> : null}
          {row.sub ? <span className="truncate text-xs text-fg-muted">{row.sub}</span> : null}
        </p>
      </div>
      <Link
        href={row.href}
        onClick={onNavigate}
        aria-label={`${row.code ?? row.name} kaydını aç`}
        className="press grid min-h-9 min-w-11 shrink-0 place-items-center rounded-[10px] border border-line bg-surface-2 px-3 text-sm font-semibold text-accent hover:border-line-strong pointer-coarse:min-h-11"
      >
        Aç
      </Link>
    </li>
  );
}

/** Cevap kartı: başlık ve sayı, en çok 5 satır, "Hepsini gör" ya da dostça boş durum. */
export function AnswerCard({ card, onNavigate }: { card: CardData; onNavigate: () => void }) {
  const empty = card.rows.length === 0 && !card.steps;
  return (
    <section aria-label={card.title} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <h3 className="truncate text-sm font-semibold text-fg">{card.title}</h3>
        {card.count !== undefined ? (
          <span className="shrink-0 rounded-full bg-accent px-2 text-xs font-bold text-accent-fg" aria-label={`${card.count} kayıt`}>
            {card.count}
          </span>
        ) : null}
      </header>
      {card.steps ? (
        <ol className="space-y-2 px-3 py-3">
          {card.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-fg">
              <span aria-hidden="true" className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-bold text-accent">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {empty ? (
        <p className="flex items-center gap-2.5 px-3 py-3.5 text-sm text-fg">
          <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-full", card.emptyTone === "none" ? "bg-surface-2 text-fg-muted" : "bg-ok-bg text-ok")}>
            {card.emptyTone === "none" ? <SearchIcon size={14} /> : <CheckIcon size={14} />}
          </span>
          {card.empty}
        </p>
      ) : card.rows.length > 0 ? (
        <ul>
          {card.rows.map((row) => (
            <RowItem key={row.key} row={row} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
      {card.more ? (
        <Link href={card.more.href} onClick={onNavigate} className="flex min-h-10 items-center justify-end border-t border-line px-3 text-sm font-semibold text-accent hover:bg-surface-2 pointer-coarse:min-h-11">
          {card.more.label}
        </Link>
      ) : null}
    </section>
  );
}

const CARD_NOTE: Record<CardState, string> = { pending: "", running: "İşleniyor…", done: "", declined: "", error: "" };

/** İşlem onay kartı: Vazgeç / Onayla. Odak güvenli seçenekte başlar, Enter tek başına işlem yapmaz. */
export function ConfirmCard({ item, onDecide }: { item: Extract<ChatItem, { kind: "confirm" }>; onDecide: (approved: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = item.state === "pending";
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
          <Button ref={cancel} size="sm" onClick={() => onDecide(false)} className="pointer-coarse:h-11">
            Vazgeç
          </Button>
          <Button size="sm" variant="primary" onClick={() => onDecide(true)} className="pointer-coarse:h-11">
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

/** "Yazıyor…" göstergesi; ekran okuyucuya da bildirilir. */
export function Typing() {
  return (
    <div role="status" className="flex items-center gap-2 text-xs text-fg-muted">
      <span aria-hidden="true" className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ animationDelay: `${i * 140}ms` }} className="size-1.5 animate-[typing-dot_1.1s_ease-in-out_infinite] rounded-full bg-fg-muted" />
        ))}
      </span>
      <span>yazıyor…</span>
    </div>
  );
}
