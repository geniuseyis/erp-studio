"use client";

import { create } from "zustand";
import type { Db } from "@/db/client";
import { getSessionUser, login } from "@/domain/auth";
import type { SessionUser } from "@/domain/context";
import { queryClient, useDb } from "./db-context";

const SESSION_KEY = "erp.session";

type State = {
  user: SessionUser | null;
  status: "loading" | "in" | "out";
  /** true: kişi kendisi çıktı. Giriş ekranı o zaman önceki sayfayı hatırlamaz; sonraki kişi ana panelden başlar. */
  signedOut: boolean;
};

const store = create<State>(() => ({ user: null, status: "loading", signedOut: false }));
/**
 * Giriş ve çıkışta artan sayaç. Süren bir doğrulama, başladıktan sonra biri giriş ya da çıkış yaptıysa
 * sonucunu yazmaz; yoksa çıkıştan hemen sonra biten doğrulama eski kullanıcıyı geri getirirdi.
 */
let epoch = 0;

/** Anlık oturum durumu (testler ve React dışı kod için). */
export function sessionState(): State {
  return store.getState();
}

function remember(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Depolama kapalıysa oturum yalnızca bu sayfa açıkken sürer.
  }
}

function remembered(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const id: unknown = raw ? (JSON.parse(raw) as { userId?: unknown }).userId : null;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

function set(user: SessionUser | null, signedOut = false): void {
  remember(user?.id ?? null);
  store.setState({ user, status: user ? "in" : "out", signedOut });
}

/** Saklanan oturumu doğrular: kullanıcı silinmiş ya da pasife alınmışsa oturum kapanır. */
export async function restoreSession(db: Db): Promise<void> {
  const started = epoch;
  const id = store.getState().user?.id ?? remembered();
  const user = id ? await getSessionUser(db, id) : null;
  if (started === epoch) set(user);
}

export function endSession(): void {
  epoch++;
  set(null, true);
  queryClient.clear();
}

export function useSession(): State & { signIn(email: string, password: string): Promise<void>; signOut(): void } {
  const state = store();
  const { db } = useDb();
  return {
    ...state,
    async signIn(email, password) {
      const user = await login(db, email, password);
      queryClient.clear();
      epoch++;
      set(user);
    },
    signOut: endSession,
  };
}
