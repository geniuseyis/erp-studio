import type { ApprovalThresholds } from "../settings";
import type { ApprovalTier } from "./types";

/**
 * Siparişin KDV hariç tutarına (kuruş) göre gereken onay kademesi: eşiğe kadar (eşik dahil) onay yok, müdür eşiğinden
 * Yönetim eşiğine kadar müdür, üstü müdür + Yönetim.
 */
export function requiredTier(netKurus: number, t: ApprovalThresholds): ApprovalTier {
  if (netKurus <= t.managerKurus) return 0;
  if (netKurus <= t.boardKurus) return 1;
  return 2;
}
