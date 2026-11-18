"use client";

import { type RefObject, useEffect } from "react";

/**
 * Yatay kayan alanda içerik solda ya da sağda sürüyorsa `data-fade-left` / `data-fade-right` koyar
 * (`.scroll-x` sınıfı kenarı 24 px'te yumuşatır). Öznitelikle çalışır; her kaydırmada yeniden çizim olmaz.
 * İlk durum, boyut değişimi ve kaydırma sırasında güncellenir.
 */
// Not: ref hedefi koşulsuz bağlanmalıdır; etki yalnızca bağlanma anında bir kez kurulur.
export function useEdgeFades(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute("data-fade-left", el.scrollLeft > 1);
      el.toggleAttribute("data-fade-right", max - el.scrollLeft > 1);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [ref]);
}
