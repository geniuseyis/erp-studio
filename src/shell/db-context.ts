"use client";

import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { DbHandle } from "@/db/client";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false, refetchOnWindowFocus: true } },
});

export const DbContext = createContext<DbHandle | null>(null);

export function useDb(): DbHandle {
  const handle = useContext(DbContext);
  if (!handle) throw new Error("useDb, AppProviders içinde kullanılmalı");
  return handle;
}

const CHANNEL = "erp-studio";

/** Veri değişti: bu sekmedeki sorguları yeniler ve açık diğer sekmelere haber verir. */
export function announceChange(): void {
  void queryClient.invalidateQueries();
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("changed");
    channel.close();
  } catch {
    // BroadcastChannel yoksa diğer sekmeler pencereye dönüldüğünde yenilenir.
  }
}

/** Diğer sekmelerden gelen "veri değişti" haberini dinler. Aboneliği kapatan işlevi döner. */
export function listenForChanges(): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => void queryClient.invalidateQueries();
  return () => channel.close();
}
