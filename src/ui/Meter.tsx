import { cn } from "./cn";
import type { Tone } from "./StatusChip";

type Props = {
  /** Dolu kısım. */
  value: number;
  /** Cetvelin sonu. */
  max: number;
  /** Cetvel üzerindeki eşik çentiği (ör. yeniden sipariş noktası). */
  mark?: number;
  tone?: Tone;
  /** Ekran okuyucu için: "Kullanılabilir 420 adet, yeniden sipariş noktası 1.000 adet". */
  label: string;
  /** `sm`: tablo hücresi için ince sürüm. */
  size?: "sm" | "md";
  className?: string;
};

const FILL: Record<Tone, string> = {
  neutral: "from-brass/70 to-brass",
  ok: "from-ok/70 to-ok",
  warn: "from-warn/60 to-warn",
  danger: "from-danger/70 to-danger",
  info: "from-info/70 to-info",
};

/**
 * Atölye cetveli biçiminde doluluk göstergesi: onda birlik çentikler ve eşik işareti.
 * Açılışta soldan dolarak gelir; stok düzeyini ve sipariş noktasına uzaklığı tek bakışta gösterir.
 */
export function Meter({ value, max, mark, tone = "neutral", label, size = "md", className }: Props) {
  const safeMax = max > 0 ? max : 1;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / safeMax) * 100))}%`;
  const small = size === "sm";
  return (
    <div role="img" aria-label={label} className={cn("relative", small ? "h-2.5" : "h-6", className)}>
      <div className={cn("absolute inset-x-0 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line ring-inset", small ? "top-0.5 h-1.5" : "top-1.5 h-3")}>
        <div
          className={cn("h-full origin-left rounded-full bg-gradient-to-r animate-[ruler-fill_900ms_var(--ease-spring)_both]", FILL[tone])}
          style={{ width: pct(value) }}
        />
      </div>
      {small ? null : (
        // Cetvel çentikleri: her %10'da bir, ortadaki daha uzun.
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1.5 h-3 opacity-30"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--fg) 0 1px, transparent 1px 10%)" }}
        />
      )}
      {mark !== undefined ? (
        <div aria-hidden="true" className={cn("absolute top-0 w-0.5 -translate-x-1/2 rounded-full bg-fg", small ? "h-2.5" : "h-6")} style={{ left: pct(mark) }}>
          {small ? null : <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[1px] bg-fg" />}
        </div>
      ) : null}
    </div>
  );
}
