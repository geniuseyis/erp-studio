"use client";

import { type FormEvent, useRef, useState } from "react";
import type { SupplierRow } from "@/domain/purchasing/queries";
import { errorMessage } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { diffFields } from "@/ui/changes";
import { ChangeList, SummaryList } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { Input, NumberField } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { useCreateSupplier, useUpdateSupplier } from "./hooks";

type Props = {
  /** Verilirse düzenleme, verilmezse yeni kayıt. */
  supplier?: SupplierRow;
  onClose: () => void;
  /** Yeni kayıt eklenince çağrılır (çekmeceyi açmak için). */
  onCreated?: (id: string) => void;
};

type Errors = Partial<Record<"name" | "city" | "phone" | "lead" | "term", string>>;

const MAX_LEAD_DAYS = 90;

/** Tedarikçi kartı ekleme ve düzenleme (`CustomerForm` deseni). Kod kaydedilince otomatik verilir; para birimi bu sürümde TL. */
export function SupplierForm({ supplier, onClose, onCreated }: Props) {
  const editing = supplier !== undefined;
  const toast = useToast();
  const ask = useConfirm();
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(supplier?.name ?? "");
  const [city, setCity] = useState(supplier?.city ?? "");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [lead, setLead] = useState(String(supplier?.leadTimeDays ?? 7));
  const [term, setTerm] = useState(String(supplier?.paymentTermDays ?? 0));
  const [errors, setErrors] = useState<Errors>({});

  const days = (t: string, unit: string) => (/^\d+$/.test(t.trim()) ? `${Number(t.trim())} ${unit}` : t);
  const shown = [
    { label: "Ad", before: supplier?.name ?? "", after: name },
    { label: "İl", before: supplier?.city ?? "", after: city },
    { label: "Yetkili", before: supplier?.contact ?? "", after: contact },
    { label: "Telefon", before: supplier?.phone ?? "", after: phone },
    { label: "Teslim süresi", before: supplier ? `${supplier.leadTimeDays} iş günü` : "", after: days(lead, "iş günü") },
    { label: "Ödeme vadesi", before: supplier ? `${supplier.paymentTermDays} gün` : "", after: days(term, "gün") },
  ];
  // Düzenlemede yalnızca değişen alanlar; değişiklik yoksa kaydet pasif.
  const changes = editing ? diffFields(shown) : [];
  const unchanged = editing && changes.length === 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const leadDays = Number(lead.trim());
    const termDays = Number(term.trim());
    const next: Errors = {};
    if (!name.trim()) next.name = "Ad girin";
    if (!city.trim()) next.city = "İl girin";
    if (!phone.trim()) next.phone = "Telefon girin";
    if (!/^\d+$/.test(lead.trim()) || leadDays < 1 || leadDays > MAX_LEAD_DAYS) next.lead = `Teslim süresi 1 ile ${MAX_LEAD_DAYS} iş günü arasında tam sayı olmalı`;
    if (!/^\d+$/.test(term.trim())) next.term = "Vadeyi gün olarak tam sayı girin";
    setErrors(next);
    if (Object.keys(next).length > 0 || unchanged) return;

    const fields = { name, city, contact, phone, leadTimeDays: leadDays, paymentTermDays: termDays };
    void ask.confirm(
      supplier
        ? {
            title: "Değişiklikler kaydedilsin mi?",
            body: (
              <>
                <p>
                  {supplier.code} {supplier.name}:
                </p>
                <ChangeList changes={changes} />
              </>
            ),
            confirmLabel: "Kaydet",
            action: () => save(fields),
          }
        : {
            title: "Tedarikçi eklensin mi?",
            body: <SummaryList items={shown.map((f) => ({ label: f.label, value: f.after.trim() }))} />,
            confirmLabel: "Tedarikçiyi ekle",
            action: () => save(fields),
          },
    );
  }

  async function save(fields: { name: string; city: string; contact: string; phone: string; leadTimeDays: number; paymentTermDays: number }): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    try {
      if (supplier) {
        await update.mutateAsync({ id: supplier.id, patch: fields });
        toast.success(`${supplier.code} güncellendi`);
      } else {
        const created = await create.mutateAsync(fields);
        toast.success(`${created.code} eklendi`);
        onCreated?.(created.id);
      }
      onClose();
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
      return false;
    }
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && !busy && onClose()}
      title={editing ? "Tedarikçiyi düzenle" : "Yeni tedarikçi"}
      description={editing ? `${supplier.code}, ${supplier.name}` : "Kod kaydedilince otomatik verilir. Fiyatlar tedarikçi eklendikten sonra girilir."}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="supplier-form" loading={busy} disabled={unchanged} title={unchanged ? "Değişiklik yok" : undefined}>
            {editing ? "Değişiklikleri kaydet" : "Tedarikçiyi ekle"}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Ad" wrapperClassName="sm:col-span-2" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
        <Input label="İl" value={city} onChange={(e) => setCity(e.target.value)} error={errors.city} />
        <Input label="Yetkili" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="İsteğe bağlı" />
        <Input label="Telefon" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} placeholder="0224 555 01 23" />
        <NumberField
          label="Teslim süresi"
          suffix="iş günü"
          inputMode="numeric"
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          error={errors.lead}
          hint="Sipariş gönderilince beklenen teslim günü bundan hesaplanır."
        />
        <NumberField label="Ödeme vadesi" suffix="gün" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} error={errors.term} hint="Peşin alımda 0." />
      </form>
      {ask.element}
    </Dialog>
  );
}
