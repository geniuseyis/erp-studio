import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import type { ApprovalTier } from "./purchasing/types";

/** `settings` tablosundaki satın alma anahtarları; değerler jsonb sayıdır (KDV hariç kuruş). */
export const SETTING_KEYS = {
  approvalManagerKurus: "purchasing.approval_manager_kurus",
  approvalBoardKurus: "purchasing.approval_board_kurus",
} as const;

export type ApprovalThresholds = { managerKurus: number; boardKurus: number };

/** Müdür onayı 50.000 TL'den, Yönetim onayı 250.000 TL'den (KDV hariç) sonra gerekir. */
export const DEFAULT_THRESHOLDS: ApprovalThresholds = { managerKurus: 5_000_000, boardKurus: 25_000_000 };

/** Anahtar yoksa ya da değeri negatif olmayan bir tam sayı değilse o eşik için varsayılan döner. */
export async function approvalThresholds(db: Db): Promise<ApprovalThresholds> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [SETTING_KEYS.approvalManagerKurus, SETTING_KEYS.approvalBoardKurus]));
  const read = (key: string, fallback: number): number => {
    const value = rows.find((r) => r.key === key)?.value;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
  };
  const managerKurus = read(SETTING_KEYS.approvalManagerKurus, DEFAULT_THRESHOLDS.managerKurus);
  // Yönetim eşiği müdür eşiğinin altına inemez; yalnız müdür eşiği yükseltilince kademeler ters dönmesin.
  const boardKurus = Math.max(managerKurus, read(SETTING_KEYS.approvalBoardKurus, DEFAULT_THRESHOLDS.boardKurus));
  return { managerKurus, boardKurus };
}

/**
 * Siparişin KDV hariç tutarına (kuruş) göre gereken onay kademesi: eşiğe kadar (eşik dahil) onay yok, müdür eşiğinden
 * Yönetim eşiğine kadar müdür, üstü müdür + Yönetim. Eşiklerle birlikte burada durur ki sipariş, öneri ve onay modülleri
 * birbirini içe aktarmadan aynı kuralı kullansın.
 */
export function requiredTier(netKurus: number, t: ApprovalThresholds): ApprovalTier {
  if (netKurus <= t.managerKurus) return 0;
  if (netKurus <= t.boardKurus) return 1;
  return 2;
}