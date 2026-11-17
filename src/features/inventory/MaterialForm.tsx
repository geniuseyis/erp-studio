"use client";

import { type FormEvent, useRef, useState } from "react";
import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from "@/db/schema";
import type { MaterialRow } from "@/domain/inventory/queries";
import type { MaterialCategory } from "@/domain/inventory/types";
import { decimalError, formatNumber, formatQty, parseDecimal, toMilli, type Unit, unitLabel } from "@/domain/units";
import { Button } from "@/ui/Button";
import { diffFields } from "@/ui/changes";
import { ChangeList, SummaryList } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { Input, NumberField, Select } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { useCreateMaterial, useUpdateMaterial } from "./hooks";
import { errorMessage } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { CATEGORY_LABEL } from "./labels";

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
  const ask = useConfirm();
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

  // Görünen değerler: sayılar okunabiliyorsa birimiyle normalleştirilir ("15" ile "15,0" aynı sayılır).
  const qtyText = (text: string) => {
    const v = parseDecimal(text);
    return v === null ? text : formatQty(toMilli(v), unit);
  };
  const leadText = (text: string) => {
    const v = parseDecimal(text);
    return v === null ? text : `${formatNumber(v)} gün`;
  };
  const shown = [
    { label: "Ad", before: material?.name ?? "", after: name },
    { label: "Kategori", before: material ? CATEGORY_LABEL[material.category] : "", after: CATEGORY_LABEL[category] },
    { label: "Birim", before: material ? unitLabel(material.unit) : "", after: unitLabel(unit) },
    { label: "Yeniden sipariş noktası", before: material ? formatQty(material.reorderPointMilli, material.unit) : "", after: qtyText(reorder) },
    { label: "Güvenlik stoğu", before: material ? formatQty(material.safetyStockMilli, material.unit) : "", after: qtyText(safety) },
    { label: "Tedarik süresi", before: material ? `${material.leadTimeDays} gün` : "", after: leadText(lead) },
    { label: "Raf", before: material?.shelf ?? "", after: shelf },
  ];
  // Düzenlemede yalnızca değişen alanlar; değişiklik yoksa kaydet pasif.
  const changes = editing ? diffFields(shown) : [];
  const unchanged = editing && changes.length === 0;

  function onSubmit(e: FormEvent) {
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
    if (Object.keys(next).length > 0 || reorderValue === null || safetyValue === null || leadValue === null || unchanged) return;

    const fields = {
      name,
      category,
      reorderPointMilli: toMilli(reorderValue),
      safetyStockMilli: toMilli(safetyValue),
      leadTimeDays: leadValue,
      shelf,
    };
    void ask.confirm(
      material
        ? {
            title: "Değişiklikler kaydedilsin mi?",
            body: (
              <>
                <p>
                  {material.code} {material.name}:
                </p>
                <ChangeList changes={changes} />
              </>
            ),
            confirmLabel: "Kaydet",
            action: () => save(fields),
          }
        : {
            title: "Malzeme eklensin mi?",
            body: <SummaryList items={shown.map((f) => ({ label: f.label, value: f.after.trim() }))} />,
            confirmLabel: "Malzemeyi ekle",
            action: () => save(fields),
          },
    );
  }

  async function save(fields: {
    name: string;
    category: MaterialCategory;
    reorderPointMilli: number;
    safetyStockMilli: number;
    leadTimeDays: number;
    shelf: string;
  }): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    try {
      if (material) {
        await update.mutateAsync({ id: material.id, patch: fields });
        toast.success(`${material.code} güncellendi`);
      } else {
        const created = await create.mutateAsync({ ...fields, unit });
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
      title={editing ? "Malzemeyi düzenle" : "Yeni malzeme"}
      description={editing ? `${material.code}, ${material.name}` : "Kod kaydedilince otomatik verilir. Stok, kayıttan sonra stok girişiyle eklenir."}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="material-form" loading={busy} disabled={unchanged} title={unchanged ? "Değişiklik yok" : undefined}>
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
      {ask.element}
    </Dialog>
  );
}
