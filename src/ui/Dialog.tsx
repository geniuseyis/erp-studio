"use client";

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "./Button";
import { cn } from "./cn";
import { CloseIcon } from "./icons";
import { useReturnFocus } from "./useReturnFocus";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Alt satırdaki düğmeler. */
  footer?: ReactNode;
  size?: "sm" | "md";
  /** Açılınca odaklanacak öğe; verilmezse Radix ilk odaklanabilir öğeyi seçer. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Onay penceresi: ekran okuyucuya `alertdialog` olarak duyurulur. */
  alert?: boolean;
  /** Dışarı tıklama; `event.preventDefault()` pencereyi açık tutar. */
  onPointerDownOutside?: (event: Event) => void;
  /** Pencerenin gövdesi açıklamadır (onay penceresinin sonuç metni): ekran okuyucu başlıktan sonra bunu okur. */
  bodyIsDescription?: boolean;
};

/** Ortada açılan pencere. Odak içeride kalır, Esc kapatır, kapanınca odak açan düğmeye döner. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "sm", initialFocus, alert = false, onPointerDownOutside, bodyIsDescription = false }: Props) {
  const focus = useReturnFocus();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] animate-[fade-in_160ms_ease-out]" />
        <RadixDialog.Content
          {...focus}
          onOpenAutoFocus={(event) => {
            focus.onOpenAutoFocus();
            const target = initialFocus?.current;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
          onPointerDownOutside={onPointerDownOutside}
          {...(alert ? { role: "alertdialog" } : {})}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "overflow-hidden rounded-[24px] border border-line bg-surface shadow-panel animate-[pop-in_320ms_var(--ease-pop)]",
            size === "sm" ? "max-w-md" : "max-w-2xl",
          )}
        >
          <header className="flex items-start gap-3 px-6 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="font-display text-xl font-semibold">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-sm text-fg-muted">{description}</RadixDialog.Description>
              ) : bodyIsDescription ? null : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Kapat" size="sm" className="-mr-1.5">
                <CloseIcon />
              </IconButton>
            </RadixDialog.Close>
          </header>
          {bodyIsDescription && !description ? (
            <RadixDialog.Description asChild>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
            </RadixDialog.Description>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
          )}
          {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/50 px-6 py-4">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
