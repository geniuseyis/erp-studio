"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { can } from "@/domain/permissions";
import type { Shortage } from "@/domain/production/types";
import type { OrderDetail, OrderLineRow } from "@/domain/sales/queries";
import { formatMoney, formatNumber } from "@/domain/units";
import { useSession } from "@/shell/session";
import { Button, IconButton } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Dialog } from "@/ui/Dialog";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { Textarea } from "@/ui/Field";
import { formatDateTime } from "@/ui/format";
import { AlertIcon, ArrowRightIcon, CheckIcon, CloseIcon, ReceiptIcon, TrashIcon, TruckIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { errorMessage, useGuardedRun } from "@/shell/useAction";
import { useCancelOrder, useConfirmOrder, useOrder, useRemoveLine, useShipOrder } from "./hooks";
import { formatDiscount, formatShortage, LINE_STATUS_LABEL, LINE_STATUS_TONE, orderTone } from "./labels";
import { LineForm } from "./LineForm";
import { DueDate, OrderStatusChips } from "./OrderStatus";

/** Sipariş ayrıntısı: satırlar, tutar özeti ve duruma ve yetkiye göre onay, sevk ve iptal. */
export function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const order = useOrder(id);
  const confirm = useConfirmOrder();
  const ship = useShipOrder();
  const { busy, run: guarded } = useGuardedRun<"confirm" | "ship">();
  const [cancelling, setCancelling] = useState(false);
  // Onayda dönen eksikler çekmece kapanana dek kalır; sonraki sorgular onları geri getirmez.
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const o = order.data;

  const canWrite = user ? can(user, "sales", "write") : false;
  const canApprove = user ? can(user, "sales", "approve") : false;
  const canShip = user ? can(user, "inventory", "execute") : false;
  const isDraft = o?.status === "draft";
  const canConfirm = isDraft && canWrite;
  const canShipNow = o?.status === "ready" && canShip;
  const canCancel = o ? (isDraft ? canWrite : (o.status === "confirmed" || o.status === "in_production" || o.status === "ready") && canApprove) : false;

  /** Çift tıklama ve yenileme bitmeden ikinci istek ortak kancada engellenir. */
  function run(kind: "confirm" | "ship", event: { detail: number }) {
    if (!o) return;
    void guarded(
      kind,
      async () => {
        if (kind === "confirm") {
          const result = await confirm.mutateAsync(o.id);
          setShortages(result.shortages);
          if (result.shortages.length > 0) toast.error(`${o.code} onaylandı; bazı iş emirleri malzeme bekliyor`);
          else toast.success(`${o.code} onaylandı`);
        } else {
          await ship.mutateAsync(o.id);
          toast.success(`${o.code} sevk edildi`);
        }
      },
      event,
    );
  }

  const actions = o && (canConfirm || canShipNow || canCancel);

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        title={o?.code ?? (order.isPending ? "Yükleniyor" : "Sipariş bulunamadı")}
        badge={
          o ? (
            <DrawerBadge tone={orderTone(o.status, o.waitingMaterial)}>
              <ReceiptIcon size={22} />
            </DrawerBadge>
          ) : undefined
        }
        subtitle={
          o ? (
            <>
              <OrderStatusChips status={o.status} waitingMaterial={o.waitingMaterial} />
              <span className="font-semibold text-hero-fg">{o.customerName}</span>
            </>
          ) : undefined
        }
        hero={o ? <OrderHero order={o} /> : undefined}
        footer={
          actions ? (
            <>
              {canConfirm ? (
                <Button variant="primary" icon={<CheckIcon />} loading={busy === "confirm"} disabled={busy !== null || o.lines.length === 0} onClick={(e) => run("confirm", e)}>
                  Onayla
                </Button>
              ) : null}
              {canShipNow ? (
                <Button variant="primary" icon={<TruckIcon />} loading={busy === "ship"} disabled={busy !== null} onClick={(e) => run("ship", e)}>
                  Sevk et
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
        {o ? (
          <div className="grid gap-6">
            {shortages.length > 0 ? <ShortageBox shortages={shortages} /> : null}

            <dl className="grid grid-cols-2 gap-2.5">
              <DetailItem label="Müşteri" wide>
                <Link
                  href={`/satis/musteriler?ac=${o.customerId}`}
                  className="group inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline"
                >
                  {o.customer.name}
                  <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <span className="block text-sm font-normal text-fg-muted">
                  {o.customer.code} · {o.customer.city} / {o.customer.district}
                </span>
              </DetailItem>
              <DetailItem label="Termin">
                <DueDate order={o} />
              </DetailItem>
              <DetailItem label="Ödeme vadesi">{o.customer.paymentTermDays} gün</DetailItem>
              <DetailItem label="Açan">{o.createdByName}</DetailItem>
              <DetailItem label="Açılış">{formatDateTime(o.createdAt)}</DetailItem>
              {o.note ? (
                <DetailItem label="Not" wide>
                  <span className="font-normal break-words">{o.note}</span>
                </DetailItem>
              ) : null}
            </dl>

            <section className="grid gap-3" aria-labelledby={`lines-${o.id}`}>
              <h3 id={`lines-${o.id}`} className="text-lg font-semibold">
                Satırlar <span className="tabular text-base font-medium text-fg-muted">({o.lines.length})</span>
              </h3>
              {o.lines.length === 0 ? (
                <p className="text-fg-muted">{isDraft && canWrite ? "Henüz satır yok. Aşağıdan ürün ekleyin." : "Bu siparişte satır yok."}</p>
              ) : (
                <ul aria-label="Satırlar" className="grid gap-2">
                  {o.lines.map((line) => (
                    <LineItem key={line.id} line={line} showStatus={!isDraft} removable={isDraft && canWrite} />
                  ))}
                </ul>
              )}
            </section>

            {isDraft && canWrite ? <LineForm orderId={o.id} /> : null}

            <Totals order={o} />
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
    </>
  );
}

function OrderHero({ order: o }: { order: OrderDetail }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-hero-fg-muted">KDV dahil</p>
        <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">{formatMoney(o.totals.totalKurus)}</p>
      </div>
      <div className="text-right">
        <p className="text-sm text-hero-fg-muted">KDV hariç</p>
        <p className="tabular font-display text-xl font-semibold">{formatMoney(o.totals.netKurus)}</p>
      </div>
    </div>
  );
}

function ShortageBox({ shortages }: { shortages: Shortage[] }) {
  return (
    <div role="alert" className="grid gap-2 rounded-2xl bg-warn-bg px-4 py-3.5 text-warn ring-1 ring-warn/25 ring-inset">
      <p className="flex items-center gap-2 font-semibold">
        <AlertIcon size={18} />
        Malzeme eksik: iş emirleri malzeme bekliyor
      </p>
      <ul className="grid gap-1 pl-7 text-sm text-fg">
        {shortages.map((s) => (
          <li key={s.materialId} className="list-disc break-words">
            {formatShortage(s)}
          </li>
        ))}
      </ul>
      <p className="pl-7 text-sm text-fg-muted">Malzeme gelince planlama iş emirlerini yeniden dener.</p>
    </div>
  );
}

function LineItem({ line, showStatus, removable }: { line: OrderLineRow; showStatus: boolean; removable: boolean }) {
  const toast = useToast();
  const remove = useRemoveLine();
  const qty = formatNumber(line.qtyMilli / 1000);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
      <span className="grid min-w-0">
        <span className="font-semibold break-words">{line.productName}</span>
        <span className="tabular text-xs text-fg-muted">{line.productCode}</span>
      </span>
      <span className="flex items-start gap-1">
        <span className="tabular pt-0.5 font-semibold whitespace-nowrap">{formatMoney(line.netKurus)}</span>
        {removable ? (
          <IconButton
            label={`Satırı sil: ${line.productCode}`}
            size="sm"
            className="-mt-1 -mr-1.5 text-danger"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(line.id, {
                onSuccess: () => toast.success(`${line.productCode} satırı silindi`),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            <TrashIcon />
          </IconButton>
        ) : null}
      </span>
      <span className="tabular col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
        <span>
          {qty} adet × {formatMoney(line.unitPriceKurus)}
        </span>
        {line.discountPermille > 0 ? <span>İskonto {formatDiscount(line.discountPermille)}</span> : null}
        <span>KDV %{line.vatRate}</span>
      </span>
      {showStatus || line.workOrder ? (
        <span className="col-span-2 flex flex-wrap items-center gap-2">
          {showStatus ? <StatusChip tone={LINE_STATUS_TONE[line.status]}>{LINE_STATUS_LABEL[line.status]}</StatusChip> : null}
          {line.workOrder ? (
            <Link
              href={`/uretim/is-emirleri?ac=${line.workOrder.id}`}
              className="group inline-flex items-center gap-1 text-sm font-semibold text-accent underline-offset-4 hover:underline"
            >
              İş emri {line.workOrder.code}
              <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

function Totals({ order: o }: { order: OrderDetail }) {
  const t = o.totals;
  const rates = Object.keys(t.vatByRate).sort((a, b) => Number(a) - Number(b));
  return (
    <table aria-label="Tutar özeti" className="w-full border-collapse text-sm">
      <tbody className="tabular">
        <SumRow label="Ara toplam" value={formatMoney(t.grossBeforeDiscountKurus)} />
        <SumRow label="İskonto" value={t.discountKurus > 0 ? `−${formatMoney(t.discountKurus)}` : formatMoney(0)} />
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

function CancelDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelOrder();
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
      await cancel.mutateAsync({ orderId: order.id, reason });
      toast.success(`${order.code} iptal edildi`);
      onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Siparişi iptal et"
      description={`${order.code}, ${order.customerName}. Ayrılmış mamul serbest kalır, başlamamış iş emirleri iptal olur. Bu işlem geri alınmaz.`}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="danger" type="submit" form="cancel-order" loading={busy}>
            Siparişi iptal et
          </Button>
        </>
      }
    >
      <form id="cancel-order" onSubmit={onSubmit} noValidate className="grid gap-4">
        <Textarea
          label="Gerekçe"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error}
          placeholder="Ör. müşteri vazgeçti"
          autoFocus
        />
      </form>
    </Dialog>
  );
}
