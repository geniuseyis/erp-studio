"use client";

import { type FormEvent, useRef, useState } from "react";
import { CUSTOMER_KINDS } from "@/db/schema";
import type { CustomerRow } from "@/domain/sales/queries";
import type { CustomerKind } from "@/domain/sales/types";
import { Button } from "@/ui/Button";
import { diffFields } from "@/ui/changes";
import { ChangeList, SummaryList } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { Input, NumberField, Select } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { errorMessage } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { useCreateCustomer, useUpdateCustomer } from "./hooks";
import { CUSTOMER_KIND_LABEL } from "./labels";

type Props = {
  /** Verilirse düzenleme, verilmezse yeni kayıt. */
  customer?: CustomerRow;
  onClose: () => void;
};

type Errors = Partial<Record<"name" | "city" | "district" | "phone" | "term", string>>;

/** Yalnızca rakam, boşluk ve +; 10–13 rakam (servisteki kuralla aynı). */
function phoneError(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "").length;
  return /^[\d\s+]+$/.test(phone.trim()) && digits >= 10 && digits <= 13 ? undefined : "Telefon yalnızca rakam, boşluk ve + içermeli (10-13 rakam)";
}

/** Müşteri kartı ekleme ve düzenleme. Kod kaydedilince otomatik verilir. */
export function CustomerForm({ customer, onClose }: Props) {
  const editing = customer !== undefined;
  const toast = useToast();
  const ask = useConfirm();
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(customer?.name ?? "");
  const [kind, setKind] = useState<CustomerKind>(customer?.kind ?? "bireysel");
  const [city, setCity] = useState(customer?.city ?? "");
  const [district, setDistrict] = useState(customer?.district ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [term, setTerm] = useState(String(customer?.paymentTermDays ?? 0));
  const [errors, setErrors] = useState<Errors>({});

  const termText = (t: string) => (/^\d+$/.test(t.trim()) ? `${Number(t.trim())} gün` : t);
  const shown = [
    { label: "Ad", before: customer?.name ?? "", after: name },
    { label: "Tür", before: customer ? CUSTOMER_KIND_LABEL[customer.kind] : "", after: CUSTOMER_KIND_LABEL[kind] },
    { label: "Telefon", before: customer?.phone ?? "", after: phone },
    { label: "İl", before: customer?.city ?? "", after: city },
    { label: "İlçe", before: customer?.district ?? "", after: district },
    { label: "Ödeme vadesi", before: customer ? `${customer.paymentTermDays} gün` : "", after: termText(term) },
  ];
  // Düzenlemede yalnızca değişen alanlar; değişiklik yoksa kaydet pasif.
  const changes = editing ? diffFields(shown) : [];
  const unchanged = editing && changes.length === 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const termDays = Number(term.trim());
    const next: Errors = {};
    if (!name.trim()) next.name = "Ad girin";
    if (!city.trim()) next.city = "İl girin";
    if (!district.trim()) next.district = "İlçe girin";
    const badPhone = phoneError(phone);
    if (badPhone) next.phone = badPhone;
    if (!/^\d+$/.test(term.trim()) || !Number.isInteger(termDays)) next.term = "Vadeyi gün olarak tam sayı girin";
    setErrors(next);
    if (Object.keys(next).length > 0 || unchanged) return;

    const fields = { name, kind, city, district, phone, paymentTermDays: termDays };
    void ask.confirm(
      customer
        ? {
            title: "Değişiklikler kaydedilsin mi?",
            body: (
              <>
                <p>
                  {customer.code} {customer.name}:
                </p>
                <ChangeList changes={changes} />
              </>
            ),
            confirmLabel: "Kaydet",
            action: () => save(fields),
          }
        : {
            title: "Müşteri eklensin mi?",
            body: <SummaryList items={shown.map((f) => ({ label: f.label, value: f.after.trim() }))} />,
            confirmLabel: "Müşteriyi ekle",
            action: () => save(fields),
          },
    );
  }

  async function save(fields: { name: string; kind: CustomerKind; city: string; district: string; phone: string; paymentTermDays: number }): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    try {
      if (customer) {
        await update.mutateAsync({ id: customer.id, patch: fields });
        toast.success(`${customer.code} güncellendi`);
      } else {
        const created = await create.mutateAsync(fields);
        toast.success(`${created.code} eklendi`);
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
      title={editing ? "Müşteriyi düzenle" : "Yeni müşteri"}
      description={editing ? `${customer.code}, ${customer.name}` : "Kod kaydedilince otomatik verilir."}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="customer-form" loading={busy} disabled={unchanged} title={unchanged ? "Değişiklik yok" : undefined}>
            {editing ? "Değişiklikleri kaydet" : "Müşteriyi ekle"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Ad" wrapperClassName="sm:col-span-2" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
        <Select label="Tür" value={kind} onChange={(e) => setKind(e.target.value as CustomerKind)}>
          {CUSTOMER_KINDS.map((k) => (
            <option key={k} value={k}>
              {CUSTOMER_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Input label="Telefon" type="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} placeholder="0212 555 01 23" />
        <Input label="İl" value={city} onChange={(e) => setCity(e.target.value)} error={errors.city} />
        <Input label="İlçe" value={district} onChange={(e) => setDistrict(e.target.value)} error={errors.district} />
        <NumberField
          label="Ödeme vadesi"
          suffix="gün"
          inputMode="numeric"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          error={errors.term}
          hint="Peşin satışta 0."
        />
      </form>
      {ask.element}
    </Dialog>
  );
}
