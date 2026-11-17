"use client";

import { type FormEvent, useRef, useState } from "react";
import type { OrderDetail } from "@/domain/sales/queries";
import { matchesSearch } from "@/domain/text";
import { formatMoney, formatNumber } from "@/domain/units";
import { errorMessage } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { ChangeList } from "@/ui/ConfirmDialog";
import { NumberField } from "@/ui/Field";
import { PlusIcon } from "@/ui/icons";
import { PickList } from "@/ui/PickList";
import { useToast } from "@/ui/Toast";
import { useAddLine, useSellableProducts } from "./hooks";
import { FINISH_LABEL, formatDiscount, lineErrorField, parseDiscount, parseOrderQty, previewAddLine } from "./labels";

type Errors = { product?: string; qty?: string; discount?: string };

/**
 * Taslak siparişe satır ekler: ürün (aranabilir liste), adet ve yüzde iskonto. Fiyat ve KDV ürün kartından kopyalanır.
 * Kaydetmeden önce onay sorulur: yeni satır ve tutar değişimi; ürün zaten varsa değişen adet ve iskonto.
 */
export function LineForm({ order }: { order: OrderDetail }) {
  const toast = useToast();
  const ask = useConfirm();
  const add = useAddLine();
  const products = useSellableProducts();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [discount, setDiscount] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const items = (products.data ?? [])
    .filter((p) => matchesSearch([p.code, p.name], query))
    .map((p) => ({
      id: p.id,
      primary: p.name,
      secondary: `${p.code} · ${FINISH_LABEL[p.finish]} · KDV %${p.vatRate}`,
      trailing: formatMoney(p.priceKurus),
    }));

  const selected = products.data?.find((p) => p.id === productId);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const q = parseOrderQty(qty);
    const d = parseDiscount(discount);
    const next: Errors = {};
    if (!selected) next.product = "Ürün seçin";
    if ("error" in q) next.qty = q.error;
    if ("error" in d) next.discount = d.error;
    setErrors(next);
    if (!selected || "error" in q || "error" in d) return;

    const preview = previewAddLine(order.lines, selected, q.qtyMilli, d.permille);
    const what = `${selected.code} ${selected.name}`;
    const total = `Sipariş tutarı ${formatMoney(preview.beforeKurus)} → ${formatMoney(preview.afterKurus)} olacak.`;
    const action = () => save(selected.id, selected.code, q.qtyMilli, d.permille);
    void ask.confirm(
      preview.merged
        ? {
            title: "Satır güncellensin mi?",
            body: (
              <>
                <p>{what} zaten siparişte; satırı güncellenecek.</p>
                <ChangeList changes={preview.changes} />
                <p>{total}</p>
              </>
            ),
            confirmLabel: "Satırı güncelle",
            action,
          }
        : {
            title: "Satır eklensin mi?",
            body: `${what} × ${formatNumber(q.qtyMilli / 1000)} eklenecek${d.permille ? `, iskonto ${formatDiscount(d.permille)}` : ""}. ${total}`,
            confirmLabel: "Satırı ekle",
            action,
          },
    );
  }

  async function save(id: string, code: string, qtyMilli: number, discountPermille: number | undefined): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    try {
      // Boş iskonto undefined gider: aynı ürün yeniden eklenirse satırın iskontosu korunur.
      const line = await add.mutateAsync({ orderId: order.id, productId: id, qtyMilli, discountPermille });
      toast.success(line.merged ? `${code} adet artırıldı` : `${code} eklendi`);
      setProductId(null);
      setQuery("");
      setQty("1");
      setDiscount("");
      return true;
    } catch (error) {
      const field = lineErrorField(error);
      if (field) setErrors({ [field]: errorMessage(error).replace(/\.$/, "") });
      else toast.error(errorMessage(error));
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} noValidate aria-label="Satır ekle" className="grid gap-3 rounded-2xl bg-surface-2/50 p-4 ring-1 ring-line ring-inset">
        <h3 className="text-lg font-semibold">Satır ekle</h3>
        <PickList
          label="Ürün"
          searchLabel="Ürün ara"
          query={query}
          onQuery={setQuery}
          items={items}
          value={productId}
          onChange={(id) => {
            setProductId(id);
            setErrors((e) => ({ ...e, product: undefined }));
          }}
          error={errors.product}
          empty="Aramayla eşleşen etkin ürün yok."
          loading={products.isPending}
        />
        {selected ? (
          // Arama seçili ürünü listeden gizlese de neyin ekleneceği görünür kalır.
          <p className="-mt-1 text-sm text-fg-muted">
            Seçili:{" "}
            <span className="font-semibold text-fg">
              {selected.code} {selected.name}
            </span>
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Adet" suffix="adet" value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty} inputMode="numeric" />
          <NumberField label="İskonto" suffix="%" value={discount} onChange={(e) => setDiscount(e.target.value)} error={errors.discount} placeholder="0" />
        </div>
        <Button type="submit" variant="primary" icon={<PlusIcon />} loading={busy} className="justify-self-start">
          Satırı ekle
        </Button>
      </form>
      {ask.element}
    </>
  );
}
