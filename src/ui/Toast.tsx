"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "./cn";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";

type Toast = { id: number; kind: "success" | "error"; message: string };
type Api = { success(message: string): void; error(message: string): void };

const ToastContext = createContext<Api | null>(null);
const LIFETIME_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );
  const api = useMemo<Api>(() => ({ success: (m) => push("success", m), error: (m) => push("error", m) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live: açık bir pencere ya da çekmece sayfanın geri kalanını ekran okuyucudan gizlerken bu bölge duyulur kalır. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "walnut pointer-events-auto flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-2xl py-3 pr-3 pl-3 text-sm shadow-panel animate-[pop-in_380ms_var(--ease-pop)]",
            )}
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full",
                t.kind === "error" ? "bg-[#f4aa97] text-[#42211a]" : "bg-[#a6d39a] text-[#1f2e1c]",
              )}
            >
              {t.kind === "error" ? <AlertIcon /> : <CheckIcon />}
            </span>
            <span className="min-w-0 flex-1 font-medium break-words">{t.message}</span>
            <button type="button" aria-label="Bildirimi kapat" onClick={() => dismiss(t.id)} className="rounded-full p-1.5 text-hero-fg-muted hover:bg-white/10 hover:text-hero-fg">
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast, ToastProvider içinde kullanılmalı");
  return api;
}
