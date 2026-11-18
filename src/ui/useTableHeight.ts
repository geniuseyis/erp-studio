"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { clampHeight, parseHeight, readPref, TABLE_HEIGHT_KEY, TABLE_MAX, TABLE_MIN, writePref } from "./pref";

const STEP = 40;
const PAGE_STEP = 160;
/** Sayfanın alt boşluğu (Page fill: `after:` ara öğesi, 20 px); "pencereyi doldur" bunu bırakır. */
const BOTTOM_GAP = 20;

/**
 * Tablo kabının yüksekliği: `null` otomatik (kalan alanı doldurur, 24rem'den kısa olmaz), sayı ise kullanıcının ayarı.
 * Ayar `erp:table-h:<ekran>` anahtarında durur; depo yoksa ya da bozuksa otomatiktir. Sürüklerken yalnızca durum değişir, bırakınca yazılır.
 */
export function useTableHeight(rootRef: RefObject<HTMLElement | null>, screen: string | null) {
  // Ekranlar yalnızca oturum açıldıktan sonra, tarayıcıda bağlanır (AppGuard sunucuda hiçbir şey çizmez); bu yüzden depo ilk
  // çizimde okunabilir, uyuşmazlık ve görünür sıçrama olmaz.
  const [height, setHeight] = useState<number | null>(() => (screen === null || typeof window === "undefined" ? null : parseHeight(readPref(TABLE_HEIGHT_KEY + screen))));
  const [measured, setMeasured] = useState(TABLE_MIN);
  const drag = useRef<{ startY: number; startHeight: number; before: number | null; lastY: number } | null>(null);

  // aria-valuenow, kabın ekrandaki gerçek yüksekliğini izler (otomatikken de).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const sync = () => setMeasured(el.offsetHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootRef]);

  // Ekran sürükleme sırasında kapanırsa (ör. menüden başka sayfaya geçiş) sayfada metin seçimi kapalı kalmasın.
  useEffect(
    () => () => {
      if (drag.current) document.body.style.userSelect = "";
    },
    [],
  );

  /** Sürüklemeyi bitirir. Kıpırdamadan bırakılan tıklama ayarı değiştirmez (otomatik boyut korunur). */
  function endDrag(e: PointerEvent<HTMLElement>, apply: boolean) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.userSelect = "";
    const dy = d.lastY - d.startY;
    if (apply && Math.abs(dy) > 2) commit(d.startHeight + dy);
    else setHeight(d.before);
  }

  function commit(next: number | null) {
    const value = next === null ? null : clampHeight(next);
    setHeight(value);
    if (screen !== null) writePref(TABLE_HEIGHT_KEY + screen, value === null ? null : String(value));
  }

  const current = () => rootRef.current?.offsetHeight ?? measured;

  /** Kabın üstünden `main`in görünür alt kenarına kadar olan yükseklik. */
  function fillHeight(): number {
    const el = rootRef.current;
    if (!el) return TABLE_MIN;
    const scroller = el.closest("main");
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    return bottom - el.getBoundingClientRect().top - BOTTOM_GAP;
  }

  const handleProps = {
    role: "separator" as const,
    "aria-orientation": "horizontal" as const,
    "aria-label": "Tablo yüksekliği",
    "aria-valuenow": Math.min(TABLE_MAX, Math.max(TABLE_MIN, measured)),
    "aria-valuemin": TABLE_MIN,
    "aria-valuemax": TABLE_MAX,
    tabIndex: 0,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      // Sürüklerken metin seçimi başlamasın; odak tutamaca verilir (preventDefault odağı kendiliğinden vermez).
      e.preventDefault();
      e.currentTarget.focus();
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      drag.current = { startY: e.clientY, startHeight: current(), before: height, lastY: e.clientY };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (d) d.lastY = e.clientY;
      if (d && Math.abs(e.clientY - d.startY) > 2) setHeight(clampHeight(d.startHeight + e.clientY - d.startY));
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (drag.current) drag.current.lastY = e.clientY;
      endDrag(e, true);
    },
    // İptal ve yakalama kaybı: o ana kadarki boyutla biter, sürükleme durumu takılı kalmaz.
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      endDrag(e, true);
    },
    onLostPointerCapture(e: PointerEvent<HTMLElement>) {
      endDrag(e, true);
    },
    onDoubleClick() {
      commit(null);
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      const delta = { ArrowUp: -STEP, ArrowDown: STEP, PageUp: -PAGE_STEP, PageDown: PAGE_STEP }[e.key];
      if (delta !== undefined) commit(current() + delta);
      else if (e.key === "Home") commit(TABLE_MIN);
      else if (e.key === "End") commit(fillHeight());
      else return;
      e.preventDefault();
    },
  };

  return { height, handleProps };
}
