"use client";

import { useCallback } from "react";
import type { Ctx } from "@/domain/context";
import { useDb } from "./db-context";
import { useSession } from "./session";

/**
 * İş kurallarını çağırmak için bağlam üreten işlev döner.
 * "Şimdi" çağrı anında alınır; böylece açık kalmış bir ekrandan yapılan işlem doğru saatle kaydedilir.
 */
export function useCtx(): () => Ctx {
  const { db } = useDb();
  const { user } = useSession();
  return useCallback(() => {
    if (!user) throw new Error("Oturum yok");
    return { db, user, now: new Date() };
  }, [db, user]);
}
