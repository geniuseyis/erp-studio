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
      }
    },
  };
}
