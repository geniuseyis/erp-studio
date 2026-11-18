"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { sql } from "drizzle-orm";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type BootStep, type DbHandle, openBrowserDb } from "@/db/client";
import { loadSnapshot, type Snapshot } from "@/seed/snapshot";
import { BootScreen } from "./BootScreen";
import { DbContext, listenForChanges, queryClient } from "./db-context";
import { restoreSession } from "./session";
import { useScrollActivity } from "./useScrollActivity";

type Boot = { status: "booting"; step: BootStep } | { status: "ready"; handle: DbHandle } | { status: "error" };

/** Tarayıcıdaki veritabanını açar; hazır olana dek açılış ekranını gösterir. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ status: "booting", step: "engine" });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  useScrollActivity();

  useEffect(() => {
    mounted.current = true;
    openBrowserDb({
      onProgress: (step) => {
        if (mounted.current && step !== "ready") setBoot({ status: "booting", step });
      },
      seed: async (db) => {
        // Hazır anlık görüntü ayrı bir parçada durur; yalnızca veritabanı ilk kez kurulurken indirilir.
        const { default: snapshot } = await import("@/seed/snapshot.generated.json");
        await loadSnapshot(db, snapshot as Snapshot, new Date());
      },
    })
      .then(async (handle) => {
        await restoreSession(handle.db);
        if (process.env.NEXT_PUBLIC_E2E === "1") {
          // Tarayıcı testleri için sonda; yayın derlemesinde tanımlanmaz.
          (window as unknown as { __erp: unknown }).__erp = {
            query: async (text: string) => (await handle.db.execute(sql.raw(text))).rows,
          };
        }
        if (mounted.current) setBoot({ status: "ready", handle });
      })
      .catch((error: unknown) => {
        console.error("Veritabanı açılamadı", error);
        if (mounted.current) setBoot({ status: "error" });
      });
    return () => {
      mounted.current = false;
    };
  }, [attempt]);

  useEffect(() => listenForChanges(), []);

  if (boot.status !== "ready") {
    return (
      <BootScreen
        step={boot.status === "booting" ? boot.step : null}
        onRetry={() => {
          setBoot({ status: "booting", step: "engine" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <DbContext.Provider value={boot.handle}>{children}</DbContext.Provider>
    </QueryClientProvider>
  );
}
