"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ActivityFilter, activityStats, listActivity } from "@/domain/audit-queries";
import { listUsers } from "@/domain/users";
import { useDb } from "@/shell/db-context";
import { useSession } from "@/shell/session";

const KEY = "activity";

/** İşlem listesi. Bir iş kuralı çalışınca bütün sorgularla birlikte yenilenir (useAction). */
export function useActivity(filter: ActivityFilter) {
  const { db } = useDb();
  const { user } = useSession();
  return useQuery({
    queryKey: [KEY, "list", user?.id, filter],
    queryFn: () => (user ? listActivity(db, user, filter) : []),
    enabled: user !== null,
    placeholderData: keepPreviousData,
  });
}

export function useActivityStats() {
  const { db } = useDb();
  const { user } = useSession();
  return useQuery({ queryKey: [KEY, "stats", user?.id], queryFn: () => (user ? activityStats(db, user, new Date()) : null), enabled: user !== null });
}

/** Kişi süzgecinin seçenekleri: pasif olanlar dahil bütün çalışanlar (geçmişte işlemleri vardır). */
export function useActivityPeople() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "people"], queryFn: () => listUsers(db) });
}
