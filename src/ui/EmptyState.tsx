import type { ReactNode } from "react";
import { cn } from "./cn";
import { SearchIcon } from "./icons";

/** Boş liste ya da sonuçsuz arama: ne olduğunu ve sıradaki adımı söyler. */
export function EmptyState({ title, children, action, icon, className }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid justify-items-center gap-2 px-6 py-14 text-center animate-[rise-in_400ms_var(--ease-spring)]", className)}>
      <span aria-hidden="true" className="mb-2 grid size-14 place-items-center rounded-2xl bg-surface-2 text-fg-muted ring-1 ring-line">
        {icon ?? <SearchIcon size={24} />}
      </span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <p className="max-w-sm text-fg-muted">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
