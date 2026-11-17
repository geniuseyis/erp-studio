import { useId } from "react";
import type { HistoryEntry } from "@/domain/audit-queries";
import { Button } from "./Button";
import { formatIstanbulDateTime } from "./format";
import { Skeleton } from "./Skeleton";

export type HistoryListProps = {
  entries: HistoryEntry[] | undefined;
  loading: boolean;
  /** Gösterilenden eski kayıt var: "Tümünü göster" düğmesi çıkar. */
  hasMore: boolean;
  onShowAll: () => void;
};

/** Çekmecenin sonundaki "Geçmiş" bölümü: kim (ad ve departman), ne zaman (İstanbul saati), ne; yeniden eskiye. */
export function HistoryList({ entries, loading, hasMore, onShowAll }: HistoryListProps) {
  const headingId = useId();
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-semibold">
        Geçmiş
      </h3>
      {entries === undefined ? (
        loading ? (
          <div className="grid gap-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-fg-muted">Geçmiş okunamadı.</p>
        )
      ) : entries.length === 0 ? (
        <p className="text-fg-muted">Henüz kayıt yok</p>
      ) : (
        <ol className="relative grid">
          {/* Zaman çizgisi */}
          <span aria-hidden="true" className="absolute top-3 bottom-3 left-[5px] w-px bg-line" />
          {entries.map((e) => (
            <li key={e.id} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-2">
              <span aria-hidden="true" className="relative mt-1.5 size-[11px] rounded-full bg-surface ring-2 ring-line-strong ring-inset" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-sm break-words">{e.summary}</span>
                <span className="tabular text-xs text-fg-muted">
                  <time dateTime={e.at.toISOString()}>{formatIstanbulDateTime(e.at)}</time>
                  {" · "}
                  {e.userName}, {e.departmentName}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {hasMore ? (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={onShowAll}>
          Tümünü göster
        </Button>
      ) : null}
    </section>
  );
}
