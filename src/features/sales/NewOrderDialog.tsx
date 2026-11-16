"use client";

import { type FormEvent, useRef, useState } from "react";
import { matchesSearch } from "@/domain/text";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, Textarea } from "@/ui/Field";
import { PickList } from "@/ui/PickList";
import { useToast } from "@/ui/Toast";
import { errorMessage } from "@/shell/useAction";
import { useCreateOrder, useCustomers } from "./hooks";
import { CUSTOMER_KIND_LABEL, defaultDueInput, dueFromInput, orderErrorField } from "./labels";

type Props = {
  onClose: () => void;
  /** Taslak açılınca çağrılır; çağıran çekmeceyi açar. */
  onCreated: (orderId: string) => void;
};

/** Yeni sipariş taslağı: müşteri, termin ve not. Satırlar taslak açıldıktan sonra çekmecede eklenir. */
export function NewOrderDialog({ onClose, onCreated }: Props) {
  const toast = useToast();
  const create = useCreateOrder();
  const customers = useCustomers();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [due, setDue] = useState(() => defaultDueInput(new Date()));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ customer?: string; due?: string }>({});

  const items = (customers.data ?? [])
    .filter((c) => matchesSearch([c.code, c.name], query))
    .map((c) => ({ id: c.id, primary: c.name, secondary: `${c.code} · ${CUSTOMER_KIND_LABEL[c.kind]} · ${c.city} / ${c.district}` }));
  const selected = customers.data?.find((c) => c.id === customerId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const dueAt = dueFromInput(due);
    const next: typeof errors = {};
    if (!customerId) next.customer = "Müşteri seçin";
    if (!dueAt) next.due = "Termin girin";
    setErrors(next);
    if (!customerId || !dueAt) return;

    submitting.current = true;
    setBusy(true);
    try {
      const order = await create.mutateAsync({ customerId, dueAt, note });
      toast.success(`${order.code} taslağı açıldı`);
      onCreated(order.id);
    } catch (error) {
      if (orderErrorField(error) === "due") setErrors({ due: errorMessage(error) });
      else toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Yeni sipariş"
      description="Önce taslak açılır; ürünler taslağın çekmecesinde eklenir. Kod kaydedilince otomatik verilir."
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="new-order" loading={busy}>
            Taslağı aç
          </Button>
        </>
      }
    >
      <form id="new-order" onSubmit={onSubmit} noValidate className="grid gap-4">
        <PickList
          label="Müşteri"
          searchLabel="Müşteri ara"
          query={query}
          onQuery={setQuery}
          items={items}
          value={customerId}
          onChange={(id) => {
            setCustomerId(id);
            setErrors((e) => ({ ...e, customer: undefined }));
          }}
          error={errors.customer}
          empty="Aramayla eşleşen müşteri yok."
          loading={customers.isPending}
        />
        {selected ? (
          <p className="-mt-2 text-sm text-fg-muted">
            Seçili: <span className="font-semibold text-fg">{selected.name}</span>, vade {selected.paymentTermDays} gün
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Input label="Termin" type="date" value={due} onChange={(e) => setDue(e.target.value)} error={errors.due} hint="Varsayılan: 14 gün sonra" />
          <Textarea label="Not" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Teslim adresi, renk isteği, irtibat" />
        </div>
      </form>
    </Dialog>
  );
}
