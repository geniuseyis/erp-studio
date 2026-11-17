"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { Button } from "./Button";
import type { Change } from "./changes";
import { cn } from "./cn";
import { Dialog } from "./Dialog";

export type ConfirmTone = "primary" | "danger";

export type ConfirmDialogProps = {
  title: string;
  /** Ne olacağı, somut: "URN-0031 … satırı silinecek. Sipariş tutarı ₺X → ₺Y olacak." ya da değişiklik listesi. */
  body: ReactNode;
  confirmLabel: string;
  /** Geri alınamaz ya da silen işlem: kırmızı onay düğmesi. */
  tone?: ConfirmTone;
  /** Atölye tableti: en az 48 px düğmeler, büyük yazı. */
  large?: boolean;
  busy?: boolean;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
};

/** Pencereyi açan dokunuşun ikincisi (çift dokunma) arka plana düşüp pencereyi hemen kapatmasın. */
const OPEN_GRACE_MS = 400;

/**
 * İşlem öncesi onay. Odak "Vazgeç"tedir: yanlışlıkla basılan Enter vazgeçer, onaylamaz. Esc ve dışarı tıklama vazgeçer.
 * İşlem sürerken (busy) iki düğme de kilitlidir ve pencere kapanmaz.
 */
export function ConfirmDialog({ title, body, confirmLabel, tone = "primary", large = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);
  const size = large ? "lg" : "md";

  return (
    <Dialog
      open
      alert
      initialFocus={cancelRef}
      onOpenChange={(open) => !open && !busy && onCancel()}
      onPointerDownOutside={(event) => {
        if (busy || performance.now() - openedAt.current < OPEN_GRACE_MS) event.preventDefault();
      }}
      title={title}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" size={size} disabled={busy} className={cn(large && "flex-1")} onClick={onCancel}>
            Vazgeç
          </Button>
          <Button variant={tone} size={size} loading={busy} className={cn(large && "flex-1")} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={cn("grid gap-3 pb-1 break-words", large ? "text-lg leading-snug" : "text-base")}>{body}</div>
    </Dialog>
  );
}

/** Düzenleme onayında değişen alanlar: "Alan: eski → yeni". */
export function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul aria-label="Değişiklikler" className="grid gap-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 text-sm ring-1 ring-line ring-inset">
      {changes.map((c) => (
        <li key={c.label} className="min-w-0 break-words">
          <span className="font-semibold">{c.label}:</span> <span className="text-fg-muted">{c.from}</span> → <span className="font-semibold">{c.to}</span>
        </li>
      ))}
    </ul>
  );
}

/** Yeni kaydın özeti: alan adı ve değeri. */
export function SummaryList({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 text-sm ring-1 ring-line ring-inset">
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-fg-muted">{i.label}</dt>
          <dd className="font-semibold break-words">{i.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
