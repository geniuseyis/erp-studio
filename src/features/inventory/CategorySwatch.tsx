import type { MaterialCategory } from "@/domain/inventory/types";
import { cn } from "@/ui/cn";

/** Malzeme türünün küçük numunesi: panel katmanları, masif damar, kenar bandı, vida başı, boya, kumaş örgüsü, karton. */
export function CategorySwatch({ category, size = "md", className }: { category: MaterialCategory; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        `swatch-${category} block shrink-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.35)]`,
        size === "sm" && "size-7 rounded-lg",
        size === "md" && "size-9 rounded-[11px]",
        size === "lg" && "size-12 rounded-2xl",
        className,
      )}
    />
  );
}
