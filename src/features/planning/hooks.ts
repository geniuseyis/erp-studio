"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { moveStep, previewMove, weekPlan } from "@/domain/production/schedule";
import { useDb } from "@/shell/db-context";
import { useAction } from "@/shell/useAction";

/** Haftanın istasyon × gün ızgarası. Hafta değişirken önceki hafta yeni veri gelene dek ekranda kalır. */
export function useWeekPlan(weekStart: Date) {
  const { db } = useDb();
  return useQuery({ queryKey: ["planning", "week", weekStart.getTime()], queryFn: () => weekPlan(db, weekStart), placeholderData: keepPreviousData });
}

/** Taşımanın sonucunu yazmadan hesaplar (onay metni ya da reddetme iletisi). "Şimdi" çağrı anında alınır. */
export function usePreviewMove() {
  const { db } = useDb();
  return useCallback((i: { workOrderId: string; seq: number; toDay: Date }) => previewMove(db, { ...i, now: new Date() }), [db]);
}

export const useMoveStep = () => useAction(moveStep);
