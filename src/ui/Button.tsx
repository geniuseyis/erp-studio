import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";

/** `light`: ceviz bandının üstünde duran birincil düğme. */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "light";
type Size = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: Variant;
  size?: Size;
  /** İşlem sürerken düğmeyi kilitler ve dönen işaret gösterir. */
  loading?: boolean;
  icon?: ReactNode;
  /** Yalnızca simge taşıyan kare düğme: yan dolgu yerine eşit en ve boy. */
  square?: boolean;
};

const VARIANT: Record<Variant, string> = {
  primary:
    "border-transparent text-accent-fg shadow-button bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent)_82%,white)_0%,var(--accent)_55%,var(--accent-hover)_100%)] hover:brightness-110",
  secondary: "border-line bg-surface text-fg shadow-[0_1px_2px_rgb(60_38_18/0.06)] hover:border-line-strong hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-fg hover:bg-surface-2",
  danger: "border-danger/40 bg-danger-bg text-danger hover:border-danger",
  light: "border-transparent bg-hero-fg text-[#2a1a0e] shadow-[0_8px_24px_-10px_rgb(0_0_0/0.6)] hover:bg-white",
};
const SIZE: Record<Size, string> = { sm: "h-8 px-3 text-sm gap-1.5 rounded-[10px]", md: "h-10 px-4 text-base gap-2 rounded-xl", lg: "h-12 px-5 text-lg gap-2.5 rounded-[14px]" };
const SQUARE: Record<Size, string> = { sm: "size-8 rounded-[10px]", md: "size-10 rounded-xl", lg: "size-12 rounded-[14px]" };

export function Button({ variant = "secondary", size = "md", loading = false, icon, square = false, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "press inline-flex shrink-0 items-center justify-center border font-semibold whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT[variant],
        square ? SQUARE[size] : SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

/** Yalnızca simge taşıyan düğme; erişilebilir ad zorunludur. */
export function IconButton({ label, children, className, ...rest }: Omit<ButtonProps, "icon"> & { label: string }) {
  return (
    <Button aria-label={label} title={label} variant="ghost" square className={className} {...rest}>
      {children}
    </Button>
  );
}
