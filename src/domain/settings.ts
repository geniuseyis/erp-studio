import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

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
  return {
    managerKurus: read(SETTING_KEYS.approvalManagerKurus, DEFAULT_THRESHOLDS.managerKurus),
    boardKurus: read(SETTING_KEYS.approvalBoardKurus, DEFAULT_THRESHOLDS.boardKurus),
  };
}
