"use client";

import { animate, MotionConfig, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Bütün yaylı hareketler için ortak ayar: "hareketi azalt" açıksa animasyonlar son durumuna atlar. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}>
      {children}
    </MotionConfig>
  );
}

/** Menü kapsülü, sekme göstergesi gibi kayan öğelerin yayı. */
export const SLIDE_SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const;

/**
 * Sayıyı sıfırdan (ya da önceki değerinden) hedefe doğru sayarak gösterir.
 * Ekran okuyucu ve testler için son değer her zaman metin olarak bulunur; sayma yalnızca görseldir.
 */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    // Hareket azaltılmışsa sayma yok; aşağıda değer doğrudan yazılır.
    if (reduce) {
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);

  if (reduce) return <span className={className}>{format(value)}</span>;
  return (
    <span className={className}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
