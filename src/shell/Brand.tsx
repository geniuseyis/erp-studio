import { cn } from "@/ui/cn";

/** Bal renginden bakıra giden kare marka işareti; içinde B harfi ve alt kenarında cetvel çentikleri. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl font-display text-lg font-bold text-[#2a1a0e]",
        "bg-[linear-gradient(140deg,#f3cf8e_0%,#d99a45_55%,#a8641f_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_6px_16px_-6px_rgb(0_0_0/0.6)]",
        className,
      )}
    >
      B
      <span
        className="absolute inset-x-1.5 bottom-1 h-1 opacity-50"
        style={{ backgroundImage: "repeating-linear-gradient(90deg, #2a1a0e 0 1px, transparent 1px 4px)" }}
      />
    </span>
  );
}

/** Marka: işaret, ad ve altında atölye cetveli çizgisi. `compact` yalnızca işareti gösterir (daraltılmış menü). */
export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) {
    return (
      <span aria-label="BALTACIOĞLU'S ERP Studio" role="img" className={className}>
        <BrandMark />
      </span>
    );
  }
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <BrandMark />
      <div className="grid min-w-0 gap-1">
        <span className="font-display text-base leading-none font-bold tracking-tight">BALTACIOĞLU&apos;S</span>
        <span
          aria-hidden="true"
          className="h-1 w-full opacity-45"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 6px)" }}
        />
        <span className="text-xs leading-none opacity-75">ERP Studio</span>
      </div>
    </div>
  );
}
