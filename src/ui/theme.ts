"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
import { THEME_KEY } from "./theme-script";

const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme): void {
  document.documentElement.dataset.theme = resolve(theme);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    apply(read());
    onChange();
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", onMedia);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onMedia);
  };
}

/** Seçilen tema (`theme`) ve ekranda geçerli olan (`resolved`). Seçim tarayıcıda saklanır. */
export function useTheme(): { theme: Theme; resolved: "light" | "dark"; setTheme(theme: Theme): void } {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolve(read()),
    () => "light" as const,
  );
  return {
    theme,
    resolved,
    setTheme(next) {
      try {
        if (next === "system") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch {
        // Depolama kapalıysa seçim yalnızca bu sayfa için geçerli olur.
      }
      document.documentElement.dataset.theme = next === "system" ? resolve("system") : next;
      for (const l of listeners) l();
    },
  };
}
