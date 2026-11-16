import { cn } from "./cn";

/** Yüklenen içeriğin yerini tutan soluk şerit. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-4 rounded-sm bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--line)_50%,var(--surface-2)_75%)] bg-[length:200%_100%] animate-[shimmer_1.4s_linear_infinite]",
        className,
      )}
    />
  );
}
