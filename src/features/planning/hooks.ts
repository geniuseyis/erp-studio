"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { weekPlan } from "@/domain/production/schedule";
import { useDb } from "@/shell/db-context";

/** Haftanın istasyon × gün ızgarası. Hafta değişirken önceki hafta yeni veri gelene dek ekranda kalır. */
export function useWeekPlan(weekStart: Date) {
  const { db } = useDb();
  return useQuery({ queryKey: ["planning", "week", weekStart.getTime()], queryFn: () => weekPlan(db, weekStart), placeholderData: keepPreviousData });
}
