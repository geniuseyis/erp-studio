"use client";

import { type FormEvent, useRef, useState } from "react";
import { isDomainError } from "@/domain/errors";
import type { MaterialRow } from "@/domain/inventory/queries";
import { decimalError, formatMoney, formatQty, parseDecimal, toKurus, toMilli, unitLabel } from "@/domain/units";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { NumberField, Textarea } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { useIssueStock, useReceiveStock } from "./hooks";
import { errorMessage } from "./labels";

type Props = { kind: "receipt" | "issue"; material: MaterialRow; onClose: () => void };

const COPY = {
  receipt: { title: "Stok girişi", submit: "Girişi kaydet", done: "giriş kaydedildi" },
  issue: { title: "Stok çıkışı", submit: "Çıkışı kaydet", done: "çıkış kaydedildi" },
};

const toInput = (kurus: number) => (kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Stok girişi ya da çıkışı. Miktar virgül ya da noktayla yazılabilir; çıkışta kullanılabilir miktar aşılamaz. */
export function StockActionDialog({ kind, material, onClose }: Props) {
  const copy = COPY[kind];
  const toast = useToast();
  const receive = useReceiveStock();
  const issue = useIssueStock();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(() => toInput(material.avgCostKurus));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ qty?: string; cost?: string }>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Çift tıklama: ilk gönderim bitmeden ikincisi başlamaz.
    if (submitting.current) return;

    const amount = parseDecimal(qty);
    const unitCost = parseDecimal(cost);
    const next: typeof errors = {};
    if (amount === null || toMilli(amount) <= 0) next.qty = decimalError(qty, "miktar") ?? "Geçerli bir miktar girin";
    else if (kind === "issue" && toMilli(amount) > material.availableMilli) {
      next.qty = `Kullanılabilir miktardan fazla: en çok ${formatQty(material.availableMilli, material.unit)}`;
    }
    if (kind === "receipt" && unitCost === null) next.cost = decimalError(cost, "tutar") ?? "Geçerli bir tutar girin";
    setErrors(next);
    if (next.qty || next.cost || amount === null) return;

    submitting.current = true;
    setBusy(true);
    const qtyMilli = toMilli(amount);
    try {
      if (kind === "receipt") {
        await receive.mutateAsync({ materialId: material.id, qtyMilli, unitCostKurus: toKurus(unitCost ?? 0), note });
      } else {
        await issue.mutateAsync({ materialId: material.id, qtyMilli, note });
      }
      toast.success(`${formatQty(qtyMilli, material.unit)} ${copy.done}`);
      onClose();
    } catch (error) {
      if (isDomainError(error) && error.code === "INSUFFICIENT_STOCK") setErrors({ qty: errorMessage(error) });
      else toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={copy.title}
      description={`${material.code}, ${material.name}`}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="stock-action" loading={busy}>
            {copy.submit}
          </Button>
        </>
      }
    >
      <form id="stock-action" onSubmit={onSubmit} noValidate className="grid gap-4">
        <NumberField
          label="Miktar"
          suffix={unitLabel(material.unit)}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          error={errors.qty}
          hint={kind === "issue" ? `Kullanılabilir: ${formatQty(material.availableMilli, material.unit)}` : "Virgül ya da nokta kullanabilirsiniz."}
          autoFocus
        />
        {kind === "receipt" ? (
          <NumberField
            label="Birim maliyet"
            suffix="TL"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            error={errors.cost}
            hint={`Şu anki ortalama: ${formatMoney(material.avgCostKurus)}`}
          />
        ) : null}
        <Textarea label="Not" value={note} onChange={(e) => setNote(e.target.value)} placeholder="İrsaliye numarası, teslim eden, neden" />
      </form>
    </Dialog>
  );
}
