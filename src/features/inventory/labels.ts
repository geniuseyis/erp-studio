import type { CountStatus, MaterialCategory, MovementType } from "@/domain/inventory/types";
import type { Tone } from "@/ui/StatusChip";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  receipt: "Giriş",
  issue: "Çıkış",
  reserve: "Ayırma",
  unreserve: "Ayırma iptali",
  consume: "Üretim tüketimi",
  count_adjust: "Sayım farkı",
};

export const MOVEMENT_TONE: Record<MovementType, Tone> = {
  receipt: "ok",
  issue: "neutral",
  reserve: "info",
  unreserve: "info",
  consume: "neutral",
  count_adjust: "warn",
};

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  panel: "Panel",
  masif: "Masif",
  kenar_bandi: "Kenar bandı",
  hirdavat: "Hırdavat",
  boya: "Boya ve kimyasal",
  kumas: "Kumaş",
  ambalaj: "Ambalaj",
};

export const COUNT_STATUS: Record<CountStatus, { label: string; tone: Tone }> = {
  open: { label: "Açık", tone: "info" },
  approved: { label: "Onaylandı", tone: "ok" },
  cancelled: { label: "İptal", tone: "neutral" },
};

/** Stok düzeyinin rengi: sipariş noktasının altı kritik, %25 yakını uyarı, gerisi yeterli. */
export function stockTone(m: { isCritical: boolean; availableMilli: number; reorderPointMilli: number }): Tone {
  if (m.isCritical) return "danger";
  return m.availableMilli < m.reorderPointMilli * 1.25 ? "warn" : "ok";
}

/** Cetvelin sonu: eldeki miktar ya da sipariş noktasının iki katı, hangisi büyükse. */
export function stockScale(m: { onHandMilli: number; reorderPointMilli: number }): number {
  return Math.max(m.onHandMilli, m.reorderPointMilli * 2, 1);
}
