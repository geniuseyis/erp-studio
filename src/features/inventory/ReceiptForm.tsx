"use client";

import { type FormEvent, useState } from "react";
import { can } from "@/domain/permissions";
import { type PurchaseOrderDetail, waitingWorkOrderCodes } from "@/domain/purchasing/queries";
import { formatMoney, formatQty, lineValueKurus, unitLabel } from "@/domain/units";
import { usePurchaseOrder } from "@/features/purchasing/hooks";
import { PO_STATUS_TONE } from "@/features/purchasing/labels";
import { PurchaseStatusChips } from "@/features/purchasing/PurchaseStatus";
import { useDb } from "@/shell/db-context";
import { useSession } from "@/shell/session";
import { useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { Input, NumberField } from "@/ui/Field";
import { formatDate, formatDateTime } from "@/ui/format";
import { CheckIcon, TruckIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { useToast } from "@/ui/Toast";
import { useReceiveGoods } from "./hooks";
import { completesOrder, parseReceipt, remainingText } from "./receipt";

const MAX_NOTE = 40;

/** Mal kabul çekmecesi: irsaliye no, her kalem için alınan miktar (varsayılan kalan). Yetkisiz kullanıcı yalnızca kalemleri okur. */
export function ReceiptForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const order = usePurchaseOrder(id);
  const o = order.data;
  const guard = useGuardedRun<"receive">();
  const permitted = user ? can(user, "inventory", "execute") : false;
  const canReceive = permitted && (o?.status === "sent" || o?.status === "partial");

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={o ? `Mal kabul ${o.code}` : order.isPending ? "Yükleniyor" : "Sipariş bulunamadı"}
      badge={
        o ? (
          <DrawerBadge tone={PO_STATUS_TONE[o.status]}>
            <TruckIcon size={22} />
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
      footer={
        o && canReceive ? (
          <ReceiptFooter busy={guard.busy === "receive"} />
        ) : undefined
      }
    >
      {o ? (
        canReceive ? (
          <Form key={o.id} order={o} onDone={onClose} run={guard.run} />
        ) : (
          <ReadOnly order={o} permitted={permitted} />
        )
      ) : order.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="w-2/3" />
          <Skeleton />
        </div>
      ) : (
        <p className="text-fg-muted">Bu sipariş silinmiş ya da adres hatalı olabilir.</p>
      )}
    </Drawer>
  );
}

const FORM_ID = "receipt-form";

function ReceiptFooter({ busy }: { busy: boolean }) {
  return (
    <Button variant="primary" icon={<CheckIcon />} type="submit" form={FORM_ID} loading={busy} disabled={busy}>
      Mal kabul et
    </Button>
  );
}

function Header({ order: o }: { order: PurchaseOrderDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5">
      <DetailItem label="Tedarikçi" wide>
        {o.supplierName}
        <span className="block text-sm font-normal text-fg-muted">{o.supplierCode}</span>
      </DetailItem>
      <DetailItem label="Beklenen teslim">{o.expectedAt ? formatDate(o.expectedAt) : "—"}</DetailItem>
      <DetailItem label="Gönderim">{o.sentAt ? formatDateTime(o.sentAt) : "—"}</DetailItem>
    </dl>
  );
}

/** Form yokken nedeni söyler: yetki yok, sipariş tamamlandı, iptal edildi ya da henüz gönderilmedi. */
function readOnlyReason(o: PurchaseOrderDetail, permitted: boolean): string {
  if (!permitted) return "Mal kabul etmek için depo yetkisi gerekir.";
  if (o.status === "received") return "Bu sipariş tamamen teslim alındı.";
  if (o.status === "cancelled") return "Bu sipariş iptal edildi.";
  return "Bu sipariş henüz tedarikçiye gönderilmedi; mal kabule açık değil.";
}

function ReadOnly({ order: o, permitted }: { order: PurchaseOrderDetail; permitted: boolean }) {
  return (
    <div className="grid gap-6">
      <Header order={o} />
      <ul aria-label="Kalemler" className="grid gap-2">
        {o.lines.map((l) => (
          <li key={l.id} className="grid gap-0.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
            <span className="font-semibold">
              {l.materialName} <span className="tabular text-xs font-normal text-fg-muted">{l.materialCode}</span>
            </span>
            <span className="tabular text-sm text-fg-muted">
              Sipariş {formatQty(l.qtyMilli, l.unit)} · Teslim alınan {formatQty(l.receivedMilli, l.unit)} · Kalan {formatQty(l.remainingMilli, l.unit)}
            </span>
          </li>
        ))}
      </ul>
      <p role="note" className="text-sm text-fg-muted">
        {readOnlyReason(o, permitted)}
      </p>
    </div>
  );
}

function Form({ order: o, onDone, run }: { order: PurchaseOrderDetail; onDone: () => void; run: ReturnType<typeof useGuardedRun<"receive">>["run"] }) {
  const { db } = useDb();
  const toast = useToast();
  const receive = useReceiveGoods();
  const ask = useConfirm();
  const open = o.lines.filter((l) => l.remainingMilli > 0);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, remainingText(l)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const fillAll = () => setValues(Object.fromEntries(open.map((l) => [l.id, remainingText(l)])));
  const clear = () => setValues(Object.fromEntries(open.map((l) => [l.id, ""])));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const deliveryNote = note.trim();
    const parsed = parseReceipt(open, values);
    setNoteError(!deliveryNote ? "İrsaliye numarasını yazın" : deliveryNote.length > MAX_NOTE ? `En çok ${MAX_NOTE} karakter` : null);
    setErrors(parsed.errors);
    setFormError(parsed.none ? "En az bir kalemde miktar girin" : null);
    if (!deliveryNote || deliveryNote.length > MAX_NOTE || Object.keys(parsed.errors).length > 0 || parsed.none) return;

    const waiting = await waitingWorkOrderCodes(db, parsed.entries.map((e) => e.line.materialId));
    const total = parsed.entries.reduce((n, e) => n + lineValueKurus(e.qtyMilli, e.line.unitPriceMinor), 0);
    const complete = completesOrder(open, parsed.entries);
    void ask.confirm({
      title: "Mal kabul edilsin mi?",
      large: true,
      body: (
        <div className="grid gap-2">
          <p>
            {o.code} · {o.supplierName} · irsaliye {deliveryNote}
          </p>
          <ul className="grid gap-1">
            {parsed.entries.map((e) => (
              <li key={e.line.id} className="tabular">
                {e.line.materialCode} {e.line.materialName}: {formatQty(e.qtyMilli, e.line.unit)} × {formatMoney(e.line.unitPriceMinor)} = {formatMoney(lineValueKurus(e.qtyMilli, e.line.unitPriceMinor))}
              </li>
            ))}
          </ul>
          <p className="font-semibold">Toplam {formatMoney(total)} (KDV hariç) stoğa girer.</p>
          <p>{complete ? "Sipariş bu teslimle tamamlanır." : "Kısmi teslim: eksik kalemler için sipariş açık kalır."}</p>
          {waiting.length > 0 ? (
            <p>
              Bu malzemeleri bekleyen {waiting.length} iş emri var ({waiting.join(", ")}); yetiyorsa malzemeleri ayrılacak.
            </p>
          ) : null}
        </div>
      ),
      confirmLabel: "Mal kabul et",
      action: () =>
        run("receive", async () => {
          const result = await receive.mutateAsync({
            purchaseOrderId: o.id,
            deliveryNote,
            lines: parsed.entries.map((e) => ({ lineId: e.line.id, qtyMilli: e.qtyMilli })),
          });
          const ready = result.readyWorkOrders.length > 0 ? `; ${result.readyWorkOrders.join(", ")} üretime hazır` : "";
          toast.success(`${result.receipt.code} kaydedildi${ready}`);
          onDone();
        }),
    });
  }

  return (
    <>
      <form id={FORM_ID} onSubmit={onSubmit} noValidate aria-label={`Mal kabul formu ${o.code}`} className="grid gap-6">
        <Header order={o} />
        <Input
          label="İrsaliye no"
          value={note}
          maxLength={MAX_NOTE + 10}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteError(null);
          }}
          error={noteError}
          autoComplete="off"
        />
        <section className="grid gap-3" aria-labelledby={`recv-${o.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`recv-${o.id}`} className="text-lg font-semibold">
              Teslim alınan miktarlar
            </h3>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={fillAll}>
                Kalanların hepsi
              </Button>
              <Button size="sm" variant="ghost" onClick={clear}>
                Temizle
              </Button>
            </span>
          </div>
          <ul aria-label="Kalemler" className="grid gap-2">
            {open.map((l) => (
              <li key={l.id} className="grid gap-2 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
                <span className="grid">
                  <span className="font-semibold break-words">{l.materialName}</span>
                  <span className="tabular text-xs text-fg-muted">
                    {l.materialCode} · Sipariş {formatQty(l.qtyMilli, l.unit)} · Teslim alınan {formatQty(l.receivedMilli, l.unit)} · Kalan {formatQty(l.remainingMilli, l.unit)}
                  </span>
                </span>
                <NumberField
                  label={`${l.materialCode} miktarı`}
                  suffix={unitLabel(l.unit)}
                  value={values[l.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [l.id]: e.target.value }))}
                  error={errors[l.id]}
                />
              </li>
            ))}
          </ul>
          {formError ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {formError}
            </p>
          ) : null}
        </section>
      </form>
      {ask.element}
    </>
  );
}
