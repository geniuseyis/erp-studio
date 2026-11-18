"use client";

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";
import { useReturnFocus } from "./useReturnFocus";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Başlığın altındaki kısa satır (kod, durum gibi). */
  subtitle?: ReactNode;
  /** Başlık bandının sol üstündeki küçük görsel (ör. kategori numunesi). */
  badge?: ReactNode;
  /** Başlık bandının içinde, başlığın altında duran özet (ör. büyük stok rakamı). */
  hero?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** Sağdan kayarak açılan ayrıntı paneli. Üstünde ceviz bandı vardır. Telefonda tam genişliktir. Liste arkada görünür kalır. */
export function Drawer({ open, onOpenChange, title, subtitle, badge, hero, children, footer }: Props) {
  const focus = useReturnFocus();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] animate-[fade-in_180ms_ease-out]" />
        <RadixDialog.Content
          {...focus}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[32rem] flex-col overflow-hidden bg-surface shadow-panel animate-[panel-in_420ms_var(--ease-spring)] sm:inset-y-2 sm:right-2 sm:rounded-[26px]"
        >
          <header className="walnut shrink-0 px-6 pt-5 pb-6">
            <div className="flex items-start gap-3">
              {badge ? <div className="shrink-0">{badge}</div> : null}
              <div className="min-w-0 flex-1">
                <RadixDialog.Title tabIndex={-1} data-drawer-title className="font-display text-xl leading-tight font-semibold break-words text-hero-fg outline-none">{title}</RadixDialog.Title>
                <RadixDialog.Description asChild>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-hero-fg-muted">{subtitle ?? <span className="sr-only">{title}</span>}</div>
                </RadixDialog.Description>
              </div>
              <RadixDialog.Close asChild>
                <IconButton label="Kapat" size="sm" className="-mr-2 text-hero-fg hover:bg-white/10">
                  <CloseIcon />
                </IconButton>
              </RadixDialog.Close>
            </div>
            {hero ? <div className="mt-5">{hero}</div> : null}
            <span className="walnut-ruler" aria-hidden="true" />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? <footer className="flex flex-wrap gap-2 border-t border-line bg-surface-2/50 px-6 py-4">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
