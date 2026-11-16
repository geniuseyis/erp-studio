import type { ComponentType } from "react";
import type { MovementType } from "@/domain/inventory/types";
import { cn } from "@/ui/cn";
import { ArrowInIcon, ArrowOutIcon, LockIcon, SawIcon, ScaleIcon, UnlockIcon } from "@/ui/icons";

const ICON: Record<MovementType, ComponentType<{ size?: number }>> = {
  receipt: ArrowInIcon,
  issue: ArrowOutIcon,
  reserve: LockIcon,
  unreserve: UnlockIcon,
  consume: SawIcon,
  count_adjust: ScaleIcon,
};

const TONE: Record<MovementType, string> = {
  receipt: "bg-ok-bg text-ok ring-ok/25",
  issue: "bg-surface-2 text-fg ring-line",
  reserve: "bg-info-bg text-info ring-info/25",
  unreserve: "bg-info-bg text-info ring-info/25",
  consume: "bg-surface-2 text-fg ring-line",
  count_adjust: "bg-warn-bg text-warn ring-warn/25",
};

/** Hareket türünün yuvarlak simgesi: giriş yeşil ok, çıkış dışa ok, sayım farkı terazi. Türün adı her zaman yanında yazar. */
export function MovementIcon({ type, size = "md" }: { type: MovementType; size?: "sm" | "md" }) {
  const Icon = ICON[type];
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full ring-1 ring-inset", TONE[type], size === "sm" ? "size-7" : "size-9")}>
      <Icon size={size === "sm" ? 14 : 17} />
    </span>
  );
}
