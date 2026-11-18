"use client";

import { useEffect, useState } from "react";

/** `value`'nun, son değişiminden `delayMs` sonra güncellenen kopyası: her tuşta ağır iş başlatmamak için. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
