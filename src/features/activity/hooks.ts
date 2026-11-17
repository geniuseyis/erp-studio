"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ActivityFilter, activityStats, listActivity } from "@/domain/audit-queries";
import { listUsers } from "@/domain/users";
import { useDb } from "@/shell/db-context";

const KEY = "activity";

/** İşlem listesi. Bir iş kuralı çalışınca bütün sorgularla birlikte yenilenir (useAction). */
export function useActivity(filter: ActivityFilter) {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "list", filter], queryFn: () => listActivity(db, filter), placeholderData: keepPreviousData });
}

export function useActivityStats() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "stats"], queryFn: () => activityStats(db, new Date()) });
}

/** Kişi süzgecinin seçenekleri: pasif olanlar dahil bütün çalışanlar (geçmişte işlemleri vardır). */
export function useActivityPeople() {
  const { db } = useDb();
  return useQuery({ queryKey: [KEY, "people"], queryFn: () => listUsers(db) });
}
