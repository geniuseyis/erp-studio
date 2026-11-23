import { useId } from "react";
import { cn } from "@/ui/cn";

type Props = {
  size: number;
  /** Kapalı balonda kıvılcımın çevresi çok hafif nabız atar (hareketi azalt açıkken durur). */
  pulse?: boolean;
  className?: string;
};

/**
 * Asistanın simgesi: cevizden bir daire içinde krem konuşma balonu ve bal rengi dört köşeli kıvılcım.
 * Renkler atölye belirteçlerinden gelir, bu yüzden açık ve koyu temada kendiliğinden uyum sağlar.
 * Süs amaçlıdır (aria-hidden); erişilebilir ad onu taşıyan düğmededir. Dolu şekillerle çizildiği için 20 pikselde de keskin kalır.
 */
export function AssistantMark({ size, pulse = false, className }: Props) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="var(--hero-to)" />
          <stop offset="0.55" stopColor="var(--hero-via)" />
          <stop offset="1" stopColor="var(--hero-from)" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill={`url(#${id}-body)`} />
      <circle cx="24" cy="24" r="24" fill={`url(#${id}-shine)`} />
      <circle cx="24" cy="24" r="22.6" fill="none" stroke="var(--honey)" strokeOpacity="0.8" strokeWidth="2.4" />
      <path d="M17.5 12.5h13A7.5 7.5 0 0 1 38 20v6a7.5 7.5 0 0 1-7.5 7.5H25L18.2 38.5v-5h-.7A7.5 7.5 0 0 1 10 26v-6a7.5 7.5 0 0 1 7.5-7.5Z" fill="#fff6e8" />
      {pulse ? <circle cx="24" cy="23" r="8" fill="var(--honey)" className="assistant-glow" /> : null}
      <path d="M24 16.2c.9 4.4 2.4 5.9 6.8 6.8-4.4.9-5.9 2.4-6.8 6.8-.9-4.4-2.4-5.9-6.8-6.8 4.4-.9 5.9-2.4 6.8-6.8Z" fill="var(--honey)" />
    </svg>
  );
}
