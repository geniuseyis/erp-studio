"use client";

import { useEffect } from "react";

const HIDE_AFTER_MS = 800;

/**
 * Kaydırma çubuğu tutamağı kaydırma sırasında görünür: kaydırılan öğeye `data-scrolling` konur,
 * son kaydırmadan ~800 ms sonra kalkar. Tek, pasif, yakalama aşamalı bir dinleyici bütün alanları
 * (sayfa, tablo kapları, çekmeceler, pencereler, palet) kapsar; zamanlayıcı öğe başınadır.
 * `scroll` olayı kabarmaz, bu yüzden dinleyici yakalama aşamasında `document` üzerindedir.
 */
export function useScrollActivity(): void {
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const onScroll = (event: Event) => {
      const target = event.target;
      // Sayfa kaydırmasında hedef `document`'tir; çubuk `html` öğesine aittir.
      const el = target instanceof Document ? target.documentElement : target instanceof Element ? target : null;
      if (!el) return;
      el.setAttribute("data-scrolling", "");
      clearTimeout(timers.get(el));
      timers.set(
        el,
        setTimeout(() => {
          el.removeAttribute("data-scrolling");
          timers.delete(el);
        }, HIDE_AFTER_MS),
      );
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      for (const [el, timer] of timers) {
        clearTimeout(timer);
        el.removeAttribute("data-scrolling");
      }
      timers.clear();
    };
  }, []);
}
