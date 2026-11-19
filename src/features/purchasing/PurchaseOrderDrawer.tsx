"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { can } from "@/domain/permissions";
import type { PurchaseOrderDetail, PurchaseOrderLineRow } from "@/domain/purchasing/queries";
import { formatMoney, formatQty } from "@/domain/units";
import { useSession } from "@/shell/session";
import { useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { entityHistory, useHistory } from "@/shell/useHistory";
import { Button, IconButton } from "@/ui/Button";
import { ChangeList } from "@/ui/ConfirmDialog";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { NumberField, Textarea } from "@/ui/Field";
import { formatDate, formatDateTime } from "@/ui/format";
import { HistoryList } from "@/ui/HistoryList";
import { AlertIcon, ArrowRightIcon, CartIcon, CheckIcon, CloseIcon, EditIcon, TrashIcon } from "@/ui/icons";
import { requiredTier } from "@/domain/settings";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import {
  useApprovalThresholds,
  useApprovePurchaseOrder,
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useRemovePurchaseLine,
  useSubmitPurchaseOrder,
  useUpdatePurchaseLine,
} from "./hooks";
import {
  approvalView,
  approveText,
  cancelText,
  expectedDelivery,
  type LineEdit,
  parseLineEdit,
  PO_STATUS_TONE,
  previewLineEdit,
  priceText,
  purchaseTotals,
  removeLineText,
  submitText,
} from "./labels";
import { PurchaseStatusChips } from "./PurchaseStatus";

const poHistory = entityHistory("purchase_order");
const CANCELLABLE = ["draft", "pending_approval", "sent", "partial"];

/**
 * Satın alma siparişi: onay zinciri (gereken kademe, kim onayladı, siz onaylayabilir misiniz), kalemler, tutar özeti, mal
 * kabuller ve geçmiş. Düğmeler duruma ve yetkiye göre görünür; her değişiklik önce onay penceresi açar.
 */
export function PurchaseOrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const order = usePurchaseOrder(id);
  const o = order.data;
  const thresholds = useApprovalThresholds();
  const history = useHistory("purchase_order", id, poHistory);
  const submit = useSubmitPurchaseOrder();
  const approve = useApprovePurchaseOrder();
  const removeLine = useRemovePurchaseLine();
  const updateLine = useUpdatePurchaseLine();
  const { busy, run: guarded } = useGuardedRun<"submit" | "approve" | "remove" | "update">();
  const ask = useConfirm();
  const [cancelling, setCancelling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const canWrite = user ? can(user, "purchasing", "write") : false;
  const view = user && o ? approvalView(user, o, thresholds.data) : null;
  const isDraft = o?.status === "draft";
  const canSubmit = isDraft && canWrite;
  const canApproveNow = view?.can === true;
  const canCancel = o ? CANCELLABLE.includes(o.status) && canWrite : false;
  const draftTier = o && thresholds.data ? requiredTier(o.netKurus, thresholds.data) : null;
  const leadDays = o?.supplierLeadDays ?? null;

  function requestSubmit(event: { detail: number }) {
    if (!o || !thresholds.data || event.detail > 1) return;
    const tier = requiredTier(o.netKurus, thresholds.data);
    const expected = leadDays !== null && tier === 0 ? expectedDelivery(new Date(), leadDays) : null;
    void ask.confirm({
      title: tier === 0 ? "Sipariş gönderilsin mi?" : "Sipariş onaya gönderilsin mi?",
      body: submitText(o, thresholds.data, expected),
      confirmLabel: tier === 0 ? "Gönder" : "Onaya gönder",
      action: () =>
        guarded("submit", async () => {
          const result = await submit.mutateAsync(o.id);
          toast.success(result.sent ? `${o.code} tedarikçiye gönderildi` : `${o.code} onaya gönderildi`);
        }),
    });
  }

  function requestApprove(event: { detail: number }) {
    if (!o || !user || event.detail > 1) return;
    const expected = leadDays !== null ? expectedDelivery(new Date(), leadDays) : null;
    void ask.confirm({
      title: "Sipariş onaylansın mı?",
      body: approveText(user, o, expected),
      confirmLabel: "Onayla",
      action: () =>
        guarded("approve", async () => {
          const result = await approve.mutateAsync(o.id);
          if (result.sent) {
            const due = result.order.expectedAt ? `, beklenen teslim ${formatDate(result.order.expectedAt)}` : "";
            toast.success(`${o.code} onaylandı ve gönderildi${due}`);
          } else {
            toast.success(`${o.code} müdür onayı verildi; Yönetim onayı bekleniyor`);
          }
        }),
    });
  }

  function requestRemove(line: PurchaseOrderLineRow) {
    if (!o) return;
    void ask.confirm({
      title: "Kalem silinsin mi?",
      body: removeLineText(o, line),
      confirmLabel: "Kalemi sil",
      tone: "danger",
      action: () =>
        guarded("remove", async () => {
          await removeLine.mutateAsync(line.id);
          toast.success(`${line.materialCode} kalemi silindi`);
        }),
    });
  }

  function requestUpdate(line: PurchaseOrderLineRow, next: LineEdit) {
    if (!o) return;
    const preview = previewLineEdit(o, line, next);
    void ask.confirm({
      title: "Kalem güncellensin mi?",
      body: (
        <>
          <p>
            {o.code}: {line.materialCode} {line.materialName}
          </p>
          <ChangeList changes={preview.changes} />
          <p>
            Sipariş tutarı {formatMoney(preview.beforeKurus)} → {formatMoney(preview.afterKurus)} olacak (KDV hariç).
          </p>
        </>
      ),
      confirmLabel: "Kalemi güncelle",
      action: async () => {
        const ok = await guarded("update", async () => {
          await updateLine.mutateAsync({ lineId: line.id, qtyMilli: next.qtyMilli, unitPriceMinor: next.unitPriceMinor });
          toast.success(`${line.materialCode} güncellendi`);
        });
        if (ok) setEditingId(null);
        return ok;
      },
    });
  }

  const actions = o && (canSubmit || canApproveNow || canCancel);

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        title={o?.code ?? (order.isPending ? "Yükleniyor" : "Sipariş bulunamadı")}
        badge={
          o ? (
            <DrawerBadge tone={PO_STATUS_TONE[o.status]}>
              <CartIcon size={22} />
            </DrawerBadge>
          ) : undefined
        }
        subtitle={
          o ? (
            <>
              <PurchaseStatusChips status={o.status} late={o.late} />
              <span className="font-semibold text-hero-fg">{o.supplierName}</span>
            </>
          ) : undefined
        }
        hero={o ? <OrderHero order={o} /> : undefined}
        footer={
          actions ? (
            <>
              {canSubmit ? (
                <Button
                  variant="primary"
                  icon={<CheckIcon />}
                  loading={busy === "submit"}
                  disabled={busy !== null || o.lines.length === 0 || draftTier === null || editingId !== null}
                  title={o.lines.length === 0 ? "Boş sipariş gönderilmez" : undefined}
                  onClick={requestSubmit}
                >
                  {draftTier === 0 || draftTier === null ? "Gönder" : "Onaya gönder"}
                </Button>
              ) : null}
              {canApproveNow ? (
                <Button variant="primary" icon={<CheckIcon />} loading={busy === "approve"} disabled={busy !== null} onClick={requestApprove}>
                  Onayla
                </Button>
              ) : null}
              {canCancel ? (
                <Button variant="danger" icon={<CloseIcon />} className="ml-auto" disabled={busy !== null} onClick={() => setCancelling(true)}>
                  İptal et
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {o && view ? (
          <div className="grid gap-6">
            <section aria-label="Onay durumu" className={cn("grid gap-2.5 rounded-2xl px-4 py-3.5 ring-1 ring-inset", o.status === "pending_approval" ? "bg-warn-bg ring-warn/25" : "bg-surface-2/70 ring-line")}>
              <p className="font-semibold">{view.required}</p>
              {view.steps.length > 0 ? (
                <ol aria-label="Onay zinciri" className="grid gap-1.5 text-sm">
                  {view.steps.map((step) => (
                    <li key={step.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip tone={step.done ? "ok" : "neutral"}>{step.done ? "Onaylandı" : "Bekliyor"}</StatusChip>
                      <span className="font-medium">{step.label}</span>
                      <span className="text-fg-muted">
                        {step.text}
                        {step.key === "manager" && o.managerApprovedAt ? `, ${formatDateTime(o.managerApprovedAt)}` : ""}
                        {step.key === "board" && o.boardApprovedAt ? `, ${formatDateTime(o.boardApprovedAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {view.waiting ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                  <AlertIcon size={16} />
                  {view.waiting}
                </p>
              ) : null}
              {view.note ? (
                <p role="note" className="text-sm text-fg-muted">
                  {view.note}
                </p>
              ) : null}
              {canApproveNow ? <p className="text-sm text-fg-muted">Bu kademeyi siz onaylayabilirsiniz.</p> : null}
            </section>

            {o.status === "cancelled" ? (
              <section aria-label="İptal gerekçesi" className="grid gap-1 rounded-2xl bg-danger-bg px-4 py-3 text-danger ring-1 ring-danger/25 ring-inset">
                <p className="text-sm font-semibold">İptal gerekçesi</p>
                <p className="break-words text-fg">{o.cancelReason}</p>
              </section>
            ) : null}

            <dl className="grid grid-cols-2 gap-2.5">
              <DetailItem label="Tedarikçi" wide>
                <Link href={`/satin-alma/tedarikciler?ac=${o.supplierId}`} className="group inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline">
                  {o.supplierName}
                  <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <span className="block text-sm font-normal text-fg-muted">
                  {o.supplierCode}
                  {leadDays !== null ? ` · Teslim süresi ${leadDays} iş günü` : ""}
                </span>
              </DetailItem>
              <DetailItem label="Oluşturan">{o.createdByName}</DetailItem>
              <DetailItem label="Oluşturma">{formatDateTime(o.createdAt)}</DetailItem>
              <DetailItem label="Gönderim">{o.sentAt ? formatDateTime(o.sentAt) : "Henüz gönderilmedi"}</DetailItem>
              <DetailItem label="Beklenen teslim">
                {o.expectedAt ? (
                  <span className={cn("tabular", o.late && "text-danger")}>
                    {formatDate(o.expectedAt)}
                    {o.late ? " (gecikti)" : ""}
                  </span>
                ) : (
                  "Gönderilince hesaplanır"
                )}
              </DetailItem>
              {o.note ? (
                <DetailItem label="Not" wide>
                  <span className="font-normal break-words">{o.note}</span>
                </DetailItem>
              ) : null}
            </dl>

            <section className="grid gap-3" aria-labelledby={`lines-${o.id}`}>
              <h3 id={`lines-${o.id}`} className="text-lg font-semibold">
                Kalemler <span className="tabular text-base font-medium text-fg-muted">({o.lines.length})</span>
              </h3>
              {o.lines.length === 0 ? (
                <p className="text-fg-muted">Bu siparişte kalem yok.</p>
              ) : (
                <ul aria-label="Kalemler" className="grid gap-2">
                  {o.lines.map((line) => (
                    <LineItem
                      key={line.id}
                      line={line}
                      editable={isDraft && canWrite}
                      editing={editingId === line.id}
                      disabled={busy !== null}
                      onEdit={() => setEditingId(line.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSave={(next) => requestUpdate(line, next)}
                      onRemove={() => requestRemove(line)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <Totals order={o} />

            {o.receipts.length > 0 ? (
              <section className="grid gap-3" aria-labelledby={`receipts-${o.id}`}>
                <h3 id={`receipts-${o.id}`} className="text-lg font-semibold">
                  Mal kabuller
                </h3>
                <ul aria-label="Mal kabuller" className="grid gap-2">
                  {o.receipts.map((r) => (
                    <li key={r.id} className="grid gap-0.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="tabular font-semibold">{r.code}</span>
                        <span className="tabular text-sm text-fg-muted">{formatDateTime(r.createdAt)}</span>
                      </span>
                      <span className="text-sm text-fg-muted">
                        İrsaliye {r.deliveryNote} · {r.lineCount} kalem · {r.receivedByName}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <HistoryList {...history} />
          </div>
        ) : order.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="w-2/3" />
            <Skeleton />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-fg-muted">Bu sipariş silinmiş ya da adres hatalı olabilir.</p>
        )}
      </Drawer>

      {o && cancelling ? <CancelDialog order={o} onClose={() => setCancelling(false)} /> : null}
      {ask.element}
    </>
  );
}

function OrderHero({ order: o }: { order: PurchaseOrderDetail }) {
  const t = purchaseTotals(o.lines);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-hero-fg-muted">KDV hariç</p>
        <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">{formatMoney(o.netKurus)}</p>
      </div>
      <div className="text-right">
        <p className="text-sm text-hero-fg-muted">KDV dahil</p>
        <p className="tabular font-display text-xl font-semibold">{formatMoney(t.totalKurus)}</p>
      </div>
    </div>
  );
}

function LineItem({
  line,
  editable,
  editing,
  disabled,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  line: PurchaseOrderLineRow;
  editable: boolean;
  editing: boolean;
  disabled: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (next: LineEdit) => void;
  onRemove: () => void;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
      <span className="grid min-w-0">
        <span className="font-semibold break-words">{line.materialName}</span>
        <span className="tabular text-xs text-fg-muted">{line.materialCode}</span>
      </span>
      <span className="flex items-start gap-0.5">
        <span className="tabular pt-0.5 font-semibold whitespace-nowrap">{formatMoney(line.lineNetMinor)}</span>
        {editable ? (
          <>
            <IconButton label={`Kalemi düzenle: ${line.materialCode}`} size="sm" className="-mt-1" disabled={disabled || editing} onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton label={`Kalemi sil: ${line.materialCode}`} size="sm" className="-mt-1 -mr-1.5 text-danger" disabled={disabled} onClick={onRemove}>
              <TrashIcon />
            </IconButton>
          </>
        ) : null}
      </span>
      <span className="tabular col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
        <span>
          {formatQty(line.qtyMilli, line.unit)} × {priceText(line.unitPriceMinor, line.unit)}
        </span>
        <span>KDV %{line.vatRate}</span>
      </span>
      <span className="tabular col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>
          Teslim alınan <span className="font-semibold">{formatQty(line.receivedMilli, line.unit)}</span>
        </span>
        <span>
          Kalan <span className="font-semibold">{formatQty(line.remainingMilli, line.unit)}</span>
        </span>
      </span>
      {editing ? <LineEditor line={line} disabled={disabled} onCancel={onCancelEdit} onSave={onSave} /> : null}
    </li>
  );
}

/** Taslak kaleminin miktarını ve birim fiyatını satır içinde düzenler; kaydetmeden önce drawer onay sorar. */
function LineEditor({ line, disabled, onCancel, onSave }: { line: PurchaseOrderLineRow; disabled: boolean; onCancel: () => void; onSave: (next: LineEdit) => void }) {
  const [qty, setQty] = useState(String(line.qtyMilli / 1000).replace(".", ","));
  const [price, setPrice] = useState((line.unitPriceMinor / 100).toFixed(2).replace(".", ","));
  const [errors, setErrors] = useState<{ qty?: string; price?: string }>({});
  const parsed = parseLineEdit(qty, price, line.unit);
  const unchanged = !parsed.errors && parsed.qtyMilli === line.qtyMilli && parsed.unitPriceMinor === line.unitPriceMinor;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (parsed.errors) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    if (unchanged) return;
    onSave(parsed);
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label={`Kalemi düzenle: ${line.materialCode}`} className="col-span-2 grid gap-3 rounded-xl bg-surface p-3 ring-1 ring-line ring-inset">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Miktar" suffix={formatQty(0, line.unit).replace(/^0\s*/, "")} value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty} />
        <NumberField label="Birim fiyat" suffix="₺" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={disabled || unchanged} title={unchanged ? "Değişiklik yok" : undefined}>
          Kaydet
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

function Totals({ order: o }: { order: PurchaseOrderDetail }) {
  const t = purchaseTotals(o.lines);
  const rates = Object.keys(t.vatByRate).sort((a, b) => Number(a) - Number(b));
  return (
    <table aria-label="Tutar özeti" className="w-full border-collapse text-sm">
      <tbody className="tabular">
        <SumRow label="KDV hariç" value={formatMoney(t.netKurus)} strong />
        {rates.map((rate) => (
          <SumRow key={rate} label={`KDV %${rate}`} value={formatMoney(t.vatByRate[rate] ?? 0)} />
        ))}
        <SumRow label="KDV dahil" value={formatMoney(t.totalKurus)} total />
      </tbody>
    </table>
  );
}

function SumRow({ label, value, strong = false, total = false }: { label: string; value: string; strong?: boolean; total?: boolean }) {
  return (
    <tr className={cn("border-line", total ? "border-t-2" : "border-t first:border-t-0")}>
      <th scope="row" className={cn("py-2 pr-3 text-left font-normal text-fg-muted", (strong || total) && "font-semibold text-fg")}>
        {label}
      </th>
      <td className={cn("py-2 text-right whitespace-nowrap", strong && "font-semibold", total && "font-display text-lg font-semibold")}>{value}</td>
    </tr>
  );
}

function CancelDialog({ order, onClose }: { order: PurchaseOrderDetail; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelPurchaseOrder();
  const { busy: running, run } = useGuardedRun<"cancel">();
  const busy = running !== null;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!reason.trim()) {
      setError("Gerekçe girin");
      return;
    }
    void run("cancel", async () => {
      await cancel.mutateAsync({ purchaseOrderId: order.id, reason });
      toast.success(`${order.code} iptal edildi`);
      onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Siparişi iptal et"
      description={cancelText(order)}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" type="submit" form="cancel-purchase-order" loading={busy}>
            Siparişi iptal et
          </Button>
        </>
      }
    >
      <form id="cancel-purchase-order" onSubmit={onSubmit} noValidate className="grid gap-4">
        <Textarea
          label="Gerekçe"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          error={error}
          placeholder="Ör. tedarikçi fiyatı değiştirdi"
          autoFocus
        />
      </form>
    </Dialog>
  );
}
