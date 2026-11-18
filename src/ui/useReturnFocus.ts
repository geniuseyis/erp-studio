"use client";

import { useRef } from "react";

/**
 * Pencere ya da çekmece kapanınca odağı, onu açan öğeye geri verir.
 * Radix bunu yalnızca kendi Trigger bileşeniyle yapar; bizim pencerelerimiz dışarıdan (open) yönetildiği için burada yapılır.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const target = opener.current;
      if (target?.isConnected) {
        event.preventDefault();
        target.focus();
        return;
      }
      // Açan düğme onaylanan işlemle ekrandan kalktı (Sevk et, Satırı sil, Bitti): odak body'ye düşmesin. Önce hâlâ
      // açık olan çekmecenin başlığına, çekmece yoksa sayfanın main öğesine gider.
      const titles = [...document.querySelectorAll<HTMLElement>("[data-drawer-title]")].filter((t) => t.closest('[role="dialog"]')?.getAttribute("data-state") === "open");
      const fallback = titles.at(-1) ?? document.querySelector<HTMLElement>("main");
      if (fallback) {
        event.preventDefault();
        fallback.focus();
      }
    },
  };
}
