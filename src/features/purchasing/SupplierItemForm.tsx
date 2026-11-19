"use client";

import { type FormEvent, useRef, useState } from "react";
import type { SupplierDetail, SupplierItemRow } from "@/domain/purchasing/queries";
import { matchesSearch } from "@/domain/text";
import { decimalError, formatMoney, formatQty, parseDecimal, toKurus, toMilli, UNIT_STEP_MILLI, unitLabel } from "@/domain/units";
import { useMaterials } from "@/features/inventory/hooks";
import { errorMessage } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { diffFields } from "@/ui/changes";
import { ChangeList } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { NumberField } from "@/ui/Field";
import { PickList } from "@/ui/PickList";
import { useToast } from "@/ui/Toast";
import { useSetSupplierItem } from "./hooks";
import { priceText } from "./labels";

type Errors = { material?: string; price?: string; moq?: string };

/**
 * Tedarikçinin malzeme fiyatını ekler ya da düzenler: malzeme (aranabilir liste; düzenlemede sabit), birim fiyat, en az
 * sipariş miktarı ve tercihli işareti. Tercihli yapmak aynı malzemenin başka tedarikçideki tercihini kaldırır; onay
 * penceresi bunu söyler. Düzenlemede yalnızca değişen alanlar eski → yeni yazılır.
 */
export function SupplierItemForm({ supplier, item, onClose }: { supplier: SupplierDetail; item?: SupplierItemRow; onClose: () => void }) {
  const editing = item !== undefined;
  const toast = useToast();
  const ask = useConfirm();
  const set = useSetSupplierItem();
  const materials = useMaterials();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [materialId, setMaterialId] = useState<string | null>(item?.materialId ?? null);
  const [price, setPrice] = useState(item ? String(item.unitPriceMinor / 100).replace(".", ",") : "");
  const [moq, setMoq] = useState(item ? String(item.moqMilli / 1000).replace(".", ",") : "0");
  const [preferred, setPreferred] = useState(item?.isPreferred ?? false);
  const [errors, setErrors] = useState<Errors>({});

  const taken = new Set(supplier.items.map((i) => i.materialId));
  const available = (materials.data ?? []).filter((m) => m.active && (editing || !taken.has(m.id)));
  const selected = (materials.data ?? []).find((m) => m.id === materialId);
  const items = available
    .filter((m) => matchesSearch([m.code, m.name], query))
    .map((m) => ({ id: m.id, primary: m.name, secondary: m.code, trailing: unitLabel(m.unit) }));

  const priceMinor = parseDecimal(price) === null ? null : toKurus(parseDecimal(price) ?? 0);
  const moqMilli = parseDecimal(moq) === null ? null : toMilli(parseDecimal(moq) ?? 0);
  const changes =
    item && selected && priceMinor !== null && moqMilli !== null
      ? diffFields([
          { label: "Birim fiyat", before: priceText(item.unitPriceMinor, selected.unit), after: priceText(priceMinor, selected.unit) },
          { label: "En az sipariş miktarı", before: item.moqMilli > 0 ? formatQty(item.moqMilli, selected.unit) : "Yok", after: moqMilli > 0 ? formatQty(moqMilli, selected.unit) : "Yok" },
          { label: "Tercihli", before: item.isPreferred ? "Evet" : "Hayır", after: preferred ? "Evet" : "Hayır" },
        ])
      : [];
  const unchanged = editing && changes.length === 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const next: Errors = {};
    if (!selected) next.material = "Malzeme seçin";
    const priceError = decimalError(price, "tutar");
    if (priceError) next.price = priceError;
    const moqError = decimalError(moq, "miktar");
    if (moqError) next.moq = moqError;
    else if (selected && moqMilli !== null && moqMilli % UNIT_STEP_MILLI[selected.unit] !== 0) {
      next.moq = `En az miktar ${formatQty(UNIT_STEP_MILLI[selected.unit], selected.unit)} katı olmalı`;
    }
    setErrors(next);
    if (!selected || priceMinor === null || moqMilli === null || Object.keys(next).length > 0 || unchanged) return;

    const what = `${selected.code} ${selected.name}`;
    const values = { supplierId: supplier.id, materialId: selected.id, unitPriceMinor: priceMinor, moqMilli, preferred };
    const handover = preferred && !item?.isPreferred ? " Tercihli yapmak, bu malzemenin başka tedarikçideki tercihini kaldırır." : "";
    void ask.confirm(
      item
        ? {
            title: "Fiyat güncellensin mi?",
            body: (
              <>
                <p>
                  {supplier.code} {supplier.name}, {what}:
                </p>
                <ChangeList changes={changes} />
                {handover ? <p>{handover.trim()}</p> : null}
              </>
            ),
            confirmLabel: "Fiyatı güncelle",
            action: () => save(values, `${selected.code} fiyatı güncellendi`),
          }
        : {
            title: "Fiyat eklensin mi?",
            body: (
              <>
                <p>
                  {supplier.code} {supplier.name} için {what}: birim fiyat {priceText(priceMinor, selected.unit)} ({formatMoney(priceMinor)}),{" "}
                  {moqMilli > 0 ? `en az sipariş ${formatQty(moqMilli, selected.unit)}` : "en az sipariş yok"}
                  {preferred ? ", tercihli tedarikçi" : ""}.
                </p>
                {handover ? <p>{handover.trim()}</p> : null}
              </>
            ),
            confirmLabel: "Fiyatı ekle",
            action: () => save(values, `${selected.code} fiyatı eklendi`),
          },
    );
  }

  async function save(values: { supplierId: string; materialId: string; unitPriceMinor: number; moqMilli: number; preferred: boolean }, message: string): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    try {
      await set.mutateAsync(values);
      toast.success(message);
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
      title={editing ? "Fiyatı düzenle" : "Fiyat ekle"}
      description={editing && item ? `${supplier.code} ${supplier.name}, ${item.materialCode} ${item.materialName}` : `${supplier.code} ${supplier.name}`}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="supplier-item-form" loading={busy} disabled={unchanged} title={unchanged ? "Değişiklik yok" : undefined}>
            {editing ? "Değişiklikleri kaydet" : "Fiyatı ekle"}
          </Button>
        </>
      }
    >
      <form id="supplier-item-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        {editing ? null : (
          <>
            <PickList
              label="Malzeme"
              searchLabel="Malzeme ara"
              query={query}
              onQuery={setQuery}
              items={items}
              value={materialId}
              onChange={(id) => {
                setMaterialId(id);
                setErrors((e) => ({ ...e, material: undefined }));
              }}
              error={errors.material}
              empty="Aramayla eşleşen, fiyatı girilmemiş malzeme yok."
              loading={materials.isPending}
            />
            {selected ? (
              <p className="-mt-2 text-sm text-fg-muted">
                Seçili:{" "}
                <span className="font-semibold text-fg">
                  {selected.code} {selected.name}
                </span>
              </p>
            ) : null}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Birim fiyat" suffix={selected ? `₺ / ${unitLabel(selected.unit)}` : "₺"} value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} placeholder="0,00" />
          <NumberField
            label="En az sipariş miktarı"
            suffix={selected ? unitLabel(selected.unit) : undefined}
            value={moq}
            onChange={(e) => setMoq(e.target.value)}
            error={errors.moq}
            hint="Yoksa 0. Öneri bu miktarın altına inmez."
          />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-surface-2/70 px-3.5 text-base ring-1 ring-line ring-inset has-[:checked]:bg-surface-2">
          <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} className="size-5 accent-accent" />
          <span className="grid">
            <span className="font-semibold">Tercihli tedarikçi</span>
            <span className="text-xs text-fg-muted">Öneri bu malzemeyi önce bu tedarikçiden ister. Malzeme başına bir tercihli olur.</span>
          </span>
        </label>
      </form>
      {ask.element}
    </Dialog>
  );
}
