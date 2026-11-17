"use client";

import { useRef, useState } from "react";
import type { StockCountLine } from "@/domain/inventory/queries";
import { can } from "@/domain/permissions";
import { decimalError, formatNumber, formatQty, parseDecimal, toMilli, unitLabel } from "@/domain/units";
import { useSession } from "@/shell/session";
import { entityHistory, useHistory } from "@/shell/useHistory";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ChangeList } from "@/ui/ConfirmDialog";
import { Drawer } from "@/ui/Drawer";
import { formatDateTime, formatSignedQty } from "@/ui/format";
import { HistoryList } from "@/ui/HistoryList";
import { ClipboardIcon, InfoIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useApproveCount, useCancelCount, useCount, useSetCountLine } from "./hooks";
import { errorMessage, useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { COUNT_STATUS, countApproveText } from "./labels";

const countHistory = entityHistory("stock_count");

const toText = (milli: number | null) => (milli === null ? "" : formatNumber(milli / 1000).replace(/\./g, ""));

/** Sayım fişi: satır satır sayılan miktar girilir; müdür onaylayınca farklar stok hareketi olarak yazılır. */
export function CountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const query = useCount(id);
  const history = useHistory("stock_count", id, countHistory);
  const approve = useApproveCount();
  const cancel = useCancelCount();
  const { run: guarded } = useGuardedRun<"approve" | "cancel">();
  const ask = useConfirm();
  const count = query.data;

  const open = count?.status === "open";
  const canExecute = user ? can(user, "inventory", "execute") : false;
  const canWrite = user ? can(user, "inventory", "write") : false;
  const canApprove = user ? can(user, "inventory", "approve") : false;
  const allCounted = count ? count.countedCount === count.lineCount : false;
  const differing = count ? count.lines.filter((l) => l.diffMilli !== null && l.diffMilli !== 0) : [];

  function onApprove() {
    if (!count) return;
    void ask.confirm({
      title: "Sayım onaylansın mı?",
      body: (
        <>
          <p>
            {count.code}: {countApproveText(differing.length)} Onaydan sonra fiş değiştirilemez.
          </p>
          {differing.length > 0 ? (
            <ul aria-label="Farklar" className="grid gap-1.5 text-sm">
              {differing.map((l) => (
                <li key={l.materialId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.materialName}</span>
                  <span className={cn("tabular font-medium whitespace-nowrap", (l.diffMilli ?? 0) < 0 ? "text-danger" : "text-ok")}>
                    {formatSignedQty(l.diffMilli ?? 0, l.unit)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ),
      confirmLabel: "Onayla",
      action: () =>
        guarded("approve", async () => {
          await approve.mutateAsync(count.id);
          toast.success(`${count.code} onaylandı`);
        }),
    });
  }

  function onCancel() {
    if (!count) return;
    void ask.confirm({
      title: "Sayım iptal edilsin mi?",
      body: `${count.code} iptal edilecek; girilen sayım miktarları kullanılmaz ve stok değişmez. İptal edilen fiş listede kalır ama yeniden açılamaz.`,
      confirmLabel: "Sayımı iptal et",
      tone: "danger",
      action: () =>
        guarded("cancel", async () => {
          await cancel.mutateAsync(count.id);
          toast.success(`${count.code} iptal edildi`);
        }),
    });
  }

  return (
    <>
      <Drawer
        open
        onOpenChange={(o) => !o && onClose()}
        title={count?.code ?? (query.isPending ? "Yükleniyor" : "Sayım fişi bulunamadı")}
        subtitle={
          count ? (
            <>
              <StatusChip tone={COUNT_STATUS[count.status].tone}>{COUNT_STATUS[count.status].label}</StatusChip>
              <span>
                {count.countedCount} / {count.lineCount} kalem sayıldı
              </span>
            </>
          ) : undefined
        }
        badge={
          <span aria-hidden="true" className="glass grid size-12 place-items-center rounded-2xl text-hero-fg">
            <ClipboardIcon size={22} />
          </span>
        }
        hero={
          count ? (
            <div className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <p className="tabular font-display text-[2.5rem] leading-none font-semibold tracking-tight">
                  %{Math.round((count.countedCount / Math.max(count.lineCount, 1)) * 100)}
                  <span className="ml-2 text-lg font-medium text-hero-fg-muted">tamamlandı</span>
                </p>
                <p className="text-right text-sm text-hero-fg-muted">{differing.length} kalemde fark</p>
              </div>
              <Meter
                value={count.countedCount}
                max={Math.max(count.lineCount, 1)}
                tone={allCounted ? "ok" : "info"}
                label={`${count.lineCount} kalemin ${count.countedCount} tanesi sayıldı`}
              />
              <p className="text-sm text-hero-fg-muted">
                {count.createdByName}, {formatDateTime(count.createdAt)}
                {count.note ? `. ${count.note}` : ""}
              </p>
            </div>
          ) : undefined
        }
        footer={
          count && open && (canApprove || canWrite) ? (
            <>
              {canApprove ? (
                <Button variant="primary" disabled={!allCounted} onClick={onApprove}>
                  Onayla
                </Button>
              ) : null}
              {canWrite ? (
                <Button variant="danger" className="ml-auto" onClick={onCancel}>
                  Sayımı iptal et
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {count ? (
          <div className="grid gap-5">
            {open && canApprove && !allCounted ? (
              <p className="flex items-center gap-2.5 rounded-2xl bg-info-bg px-4 py-3 text-sm font-medium text-info">
                <InfoIcon size={18} /> Onaylamak için bütün kalemlerin sayılması gerekir.
              </p>
            ) : null}
            {open && !canApprove ? (
              <p className="flex items-center gap-2.5 rounded-2xl bg-info-bg px-4 py-3 text-sm font-medium text-info">
                <InfoIcon size={18} /> Sayımı depo müdürü ya da yönetim onaylar.
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Malzeme
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">
                      Eldeki
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">
                      Sayılan
                    </th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">
                      Fark
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {count.lines.map((line) => (
                    <LineRow key={line.materialId} countId={count.id} line={line} editable={open && canExecute} />
                  ))}
                </tbody>
              </table>
            </div>
            <HistoryList {...history} />
          </div>
        ) : query.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="w-1/2" />
            <Skeleton />
          </div>
        ) : (
          <p className="text-fg-muted">Bu sayım fişi silinmiş ya da adres hatalı olabilir.</p>
        )}
      </Drawer>

      {ask.element}
    </>
  );
}

function LineRow({ countId, line, editable }: { countId: string; line: StockCountLine; editable: boolean }) {
  const toast = useToast();
  const save = useSetCountLine();
  const ask = useConfirm();
  const asking = useRef(false);
  // null: kullanıcı yazmıyor, kayıtlı değer gösterilir.
  const [draft, setDraft] = useState<string | null>(null);
  // Doluysa alanın altında gösterilen hata (ör. belirsiz "1.250").
  const [invalid, setInvalid] = useState<string | null>(null);
  const value = draft ?? toText(line.countedMilli);

  async function commit() {
    if (draft === null) return;
    const parsed = parseDecimal(draft);
    if (draft.trim() === "" && line.countedMilli === null) return setDraft(null);
    if (parsed === null) return setInvalid(decimalError(draft, "miktar") ?? "Geçerli bir miktar girin");
    setInvalid(null);
    const countedMilli = toMilli(parsed);
    if (countedMilli === line.countedMilli) return setDraft(null);
    if (line.countedMilli === null) {
      // İlk sayım hiçbir kaydı değiştirmez; onaya kadar düzeltilebilir.
      if (await write(countedMilli)) setDraft(null);
      return;
    }
    // Kayıtlı sayımın üzerine yazmak değişikliktir: önce onay. Pencere açılınca alanın odak kaybı yeniden sormaz.
    if (asking.current) return;
    asking.current = true;
    const ok = await ask.confirm({
      title: "Sayılan miktar değişsin mi?",
      body: (
        <>
          <p>
            {line.materialCode} {line.materialName}:
          </p>
          <ChangeList changes={[{ label: "Sayılan", from: formatQty(line.countedMilli, line.unit), to: formatQty(countedMilli, line.unit) }]} />
        </>
      ),
      confirmLabel: "Değiştir",
      action: () => write(countedMilli),
    });
    asking.current = false;
    // Vazgeçilirse kayıtlı değer geri gelir.
    setDraft(null);
    if (!ok) setInvalid(null);
  }

  async function write(countedMilli: number): Promise<boolean> {
    try {
      await save.mutateAsync({ countId, materialId: line.materialId, countedMilli });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  }

  const diff = line.diffMilli;
  return (
    <tr className="border-t border-line align-middle transition-colors has-[input:focus]:bg-surface-2/60">
      <td className="py-2.5 pr-3">
        <span className="grid">
          <span className="font-semibold">{line.materialName}</span>
          <span className="tabular text-xs text-fg-muted">{line.materialCode}</span>
        </span>
      </td>
      <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatQty(line.currentOnHandMilli, line.unit)}</td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <span className="inline-flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label={`Sayılan: ${line.materialCode}`}
              aria-invalid={invalid ? true : undefined}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Onay penceresi tuşa basılırken açılır: Enter'ın ardından gelen keypress odaktaki Vazgeç'e düşüp
                // pencereyi hemen kapatmasın.
                e.preventDefault();
                void commit();
              }}
              className="tabular h-9 w-24 rounded-xl border border-line bg-surface px-2.5 text-right transition-colors hover:border-line-strong focus:border-accent aria-[invalid=true]:border-danger"
            />
            <span className="w-9 text-left text-xs text-fg-muted">{unitLabel(line.unit)}</span>
          </span>
        ) : (
          <span className="tabular whitespace-nowrap">{line.countedMilli === null ? "Sayılmadı" : formatQty(line.countedMilli, line.unit)}</span>
        )}
        {invalid ? <span className="block text-xs font-medium text-danger">{invalid}</span> : null}
        {ask.element}
      </td>
      <td className={cn("tabular py-2 pl-3 text-right font-medium whitespace-nowrap", diff !== null && diff < 0 && "text-danger", diff !== null && diff > 0 && "text-ok")}>
        {diff === null ? "" : diff === 0 ? "Fark yok" : formatSignedQty(diff, line.unit)}
      </td>
    </tr>
  );
}
