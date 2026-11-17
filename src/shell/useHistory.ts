"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Db } from "@/db/client";
import { HISTORY_LIMIT, type HistoryEntry, listHistory } from "@/domain/audit-queries";
import type { HistoryListProps } from "@/ui/HistoryList";
import { useDb } from "./db-context";

/** "Tümünü göster" sonrası üst sınır; bir kaydın bundan uzun geçmişi beklenmez. */
const ALL = 10_000;

type Loader = (db: Db, id: string, limit: number) => Promise<HistoryEntry[]>;

/** Tek bir kaydın kendi geçmişi (müşteri, ürün, malzeme, sayım fişi). */
export const entityHistory =
  (entity: string): Loader =>
  (db, id, limit) =>
    listHistory(db, [{ entity, entityId: id }], limit);

/**
 * Çekmecenin "Geçmiş" bölümünün verisi: önce son 50 kayıt, eskisi varsa "Tümünü göster" hepsini getirir.
 * Bir iş kuralı çalışınca bütün sorgularla birlikte yenilenir (useAction).
 */
export function useHistory(key: string, id: string, load: Loader): HistoryListProps {
  const { db } = useDb();
  const [all, setAll] = useState(false);
  const limit = all ? ALL : HISTORY_LIMIT + 1;
  const query = useQuery({
    queryKey: ["history", key, id, limit],
    queryFn: () => load(db, id, limit),
    // "Tümünü göster" yüklenirken aynı kaydın son 50 kaydı ekranda kalır; başka kayda geçince eskisi gösterilmez.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[2] === id ? previous : undefined),
  });
  const data = query.data;
  return {
    entries: data && !all ? data.slice(0, HISTORY_LIMIT) : data,
    loading: query.isPending,
    hasMore: !all && (data?.length ?? 0) > HISTORY_LIMIT,
    onShowAll: () => setAll(true),
  };
}
