import type { ReactNode } from "react";
import { cn } from "./cn";
import type { Tone } from "./StatusChip";

const BADGE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

/** Çekmece başlığının solundaki simge kutusu; zemin kaydın durum rengini taşır. Süstür, ekran okuyucudan gizlidir. */
export function DrawerBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={cn("grid size-11 place-items-center rounded-2xl", BADGE[tone])}>
      {children}
    </span>
  );
}

/** Çekmecedeki bilgi kutusu: küçük etiket, kalın değer. `<dl>` içinde kullanılır; `wide` iki sütunu kaplar. */
export function DetailItem({ label, icon, wide = false, children }: { label: string; icon?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset", wide && "col-span-2")}>
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
        {icon}
        {label}
      </dt>
      <dd className="tabular min-w-0 font-semibold break-words">{children}</dd>
    </div>
  );
}
