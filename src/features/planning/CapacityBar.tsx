import { cn } from "@/ui/cn";
import { Meter } from "@/ui/Meter";
import { loadText } from "./labels";

/**
 * Hücrenin kapasite çubuğu: %100'e kadar bal tonu, aşınca kırmızı. Yük metni her zaman yazılır ("1.020 / 960 dk");
 * aşımda kırmızı ve kalın olur, böylece renk tek başına bilgi taşımaz.
 */
export function CapacityBar({ load, capacity, label }: { load: number; capacity: number; label: string }) {
  const over = load > capacity;
  const pct = capacity > 0 ? Math.round((load * 100) / capacity) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs leading-none">
        <span className={cn("tabular", over ? "font-semibold text-danger" : "text-fg-muted")}>{loadText(load, capacity)}</span>
        <span className={cn("tabular", over ? "rounded-full bg-danger-bg px-1.5 py-0.5 font-semibold text-danger" : "text-fg-muted")}>%{pct}</span>
      </div>
      <Meter size="sm" value={load} max={capacity} tone={over ? "danger" : "honey"} label={label} />
    </div>
  );
}
