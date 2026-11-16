"use client";

import { type FormEvent, useRef, useState } from "react";
import { isDomainError } from "@/domain/errors";
import { matchesSearch } from "@/domain/text";
import { formatMoney } from "@/domain/units";
import { Button } from "@/ui/Button";
import { NumberField } from "@/ui/Field";
import { PlusIcon } from "@/ui/icons";
import { PickList } from "@/ui/PickList";
import { useToast } from "@/ui/Toast";
import { errorMessage } from "@/shell/useAction";
import { useAddLine, useSellableProducts } from "./hooks";
import { FINISH_LABEL, parseDiscount, parseOrderQty } from "./labels";

type Errors = { product?: string; qty?: string; discount?: string };

/** Taslak siparişe satır ekler: ürün (aranabilir liste), adet ve yüzde iskonto. Fiyat ve KDV ürün kartından kopyalanır. */
export function LineForm({ orderId }: { orderId: string }) {
  const toast = useToast();
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const q = parseOrderQty(qty);
    const d = parseDiscount(discount);
    const next: Errors = {};
    if (!productId) next.product = "Ürün seçin";
    if ("error" in q) next.qty = q.error;
    if ("error" in d) next.discount = d.error;
    setErrors(next);
    if (!productId || "error" in q || "error" in d) return;

    submitting.current = true;
    setBusy(true);
    try {
      await add.mutateAsync({ orderId, productId, qtyMilli: q.qtyMilli, discountPermille: d.permille });
      const product = products.data?.find((p) => p.id === productId);
      toast.success(`${product?.code ?? "Satır"} eklendi`);
      setProductId(null);
      setQuery("");
      setQty("1");
      setDiscount("");
    } catch (error) {
      if (isDomainError(error) && error.code === "VALIDATION") setErrors({ qty: errorMessage(error).replace(/\.$/, "") });
      else toast.error(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
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
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Adet" suffix="adet" value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty} inputMode="numeric" />
        <NumberField label="İskonto" suffix="%" value={discount} onChange={(e) => setDiscount(e.target.value)} error={errors.discount} placeholder="0" />
      </div>
      <Button type="submit" variant="primary" icon={<PlusIcon />} loading={busy} className="justify-self-start">
        Satırı ekle
      </Button>
    </form>
  );
}
