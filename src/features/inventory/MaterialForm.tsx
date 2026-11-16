"use client";

import { type FormEvent, useRef, useState } from "react";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@/db/schema";
import type { MaterialRow } from "@/domain/inventory/queries";
import type { MaterialCategory } from "@/domain/inventory/types";
import { decimalError, formatNumber, parseDecimal, toMilli, type Unit, unitLabel } from "@/domain/units";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input, NumberField, Select } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { useCreateMaterial, useUpdateMaterial } from "./hooks";
import { CATEGORY_LABEL, errorMessage } from "./labels";

type Props = {
  /** Verilirse düzenleme, verilmezse yeni kayıt. */
  material?: MaterialRow;
  onClose: () => void;
};

const fromMilliText = (milli: number) => formatNumber(milli / 1000).replace(/\./g, "");

/** Malzeme kartı ekleme ve düzenleme. Stok ve maliyet burada değişmez; onlar stok hareketleriyle değişir. */
export function MaterialForm({ material, onClose }: Props) {
  const editing = material !== undefined;
  const toast = useToast();
  const create = useCreateMaterial();
  const update = useUpdateMaterial();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(material?.name ?? "");
  const [category, setCategory] = useState<MaterialCategory>(material?.category ?? "panel");
  const [unit, setUnit] = useState<Unit>(material?.unit ?? "plaka");
  const [reorder, setReorder] = useState(material ? fromMilliText(material.reorderPointMilli) : "0");
  const [safety, setSafety] = useState(material ? fromMilliText(material.safetyStockMilli) : "0");
  const [lead, setLead] = useState(String(material?.leadTimeDays ?? 7));
  const [shelf, setShelf] = useState(material?.shelf ?? "");
  const [errors, setErrors] = useState<Partial<Record<"name" | "reorder" | "safety" | "lead", string>>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const reorderValue = parseDecimal(reorder);
    const safetyValue = parseDecimal(safety);
    const leadValue = parseDecimal(lead);
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Ad girin";
    if (reorderValue === null) next.reorder = decimalError(reorder, "miktar") ?? "Geçerli bir miktar girin";
    if (safetyValue === null) next.safety = decimalError(safety, "miktar") ?? "Geçerli bir miktar girin";
    if (leadValue === null || !Number.isInteger(leadValue)) next.lead = "Gün sayısını tam sayı girin";
    setErrors(next);
    if (Object.keys(next).length > 0 || reorderValue === null || safetyValue === null || leadValue === null) return;

    submitting.current = true;
    setBusy(true);
    const fields = {
      name,
      category,
      reorderPointMilli: toMilli(reorderValue),
      safetyStockMilli: toMilli(safetyValue),
      leadTimeDays: leadValue,
      shelf,
    };
    try {
      if (material) {
        await update.mutateAsync({ id: material.id, patch: fields });
        toast.success(`${material.code} güncellendi`);
      } else {
        const created = await create.mutateAsync({ ...fields, unit });
        toast.success(`${created.code} eklendi`);
      }
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && !busy && onClose()}
      title={editing ? "Malzemeyi düzenle" : "Yeni malzeme"}
      description={editing ? `${material.code}, ${material.name}` : "Kod kaydedilince otomatik verilir. Stok, kayıttan sonra stok girişiyle eklenir."}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="material-form" loading={busy}>
            {editing ? "Değişiklikleri kaydet" : "Malzemeyi ekle"}
          </Button>
        </>
      }
    >
      <form id="material-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Ad" wrapperClassName="sm:col-span-2" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoFocus />
        <Select label="Kategori" value={category} onChange={(e) => setCategory(e.target.value as MaterialCategory)}>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select
          label="Birim"
          value={unit}
          disabled={editing}
          hint={editing ? "Birim, kayıttan sonra değiştirilemez." : undefined}
          onChange={(e) => setUnit(e.target.value as Unit)}
        >
          {MATERIAL_UNITS.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </Select>
        <NumberField
          label="Yeniden sipariş noktası"
          suffix={unitLabel(unit)}
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
          error={errors.reorder}
          hint="Kullanılabilir stok bunun altına inince malzeme kritik sayılır."
        />
        <NumberField label="Güvenlik stoğu" suffix={unitLabel(unit)} value={safety} onChange={(e) => setSafety(e.target.value)} error={errors.safety} />
        <NumberField label="Tedarik süresi" suffix="gün" value={lead} onChange={(e) => setLead(e.target.value)} error={errors.lead} />
        <Input label="Raf" value={shelf} onChange={(e) => setShelf(e.target.value)} />
      </form>
    </Dialog>
  );
}
