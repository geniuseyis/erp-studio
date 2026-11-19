"use client";

import Link from "next/link";
import { useState } from "react";
import { can } from "@/domain/permissions";
import type { SupplierItemRow } from "@/domain/purchasing/queries";
import { formatMoney, formatQty } from "@/domain/units";
import { useSession } from "@/shell/session";
import { useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { entityHistory, useHistory } from "@/shell/useHistory";
import { Button, IconButton } from "@/ui/Button";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { HistoryList } from "@/ui/HistoryList";
import { ArrowRightIcon, ClockIcon, EditIcon, FactoryIcon, PlusIcon, TrashIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { usePurchaseOrders, useRemoveSupplierItem, useSupplier } from "./hooks";
import { PO_STATUS_LABEL, PO_STATUS_TONE, priceText } from "./labels";
import { SupplierForm } from "./SupplierForm";
import { SupplierItemForm } from "./SupplierItemForm";

const supplierHistory = entityHistory("supplier");
// Üstteki "Açık sipariş" sayısıyla aynı küme (taslak açık sayılmaz).
const OPEN = ["pending_approval", "sent", "partial"] as const;

/** Tedarikçi kartı, fiyat listesi, açık siparişleri ve geçmişi. Fiyat ekleme, düzenleme ve kaldırma `purchasing:write` ister. */
export function SupplierDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const supplier = useSupplier(id);
  const orders = usePurchaseOrders({ supplierId: id });
  const history = useHistory("supplier", id, supplierHistory);
  const remove = useRemoveSupplierItem();
  const { busy, run } = useGuardedRun<"remove">();
  const ask = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState<{ item?: SupplierItemRow } | null>(null);
  const s = supplier.data;
  const canWrite = user ? can(user, "purchasing", "write") : false;
  const open = (orders.data ?? []).filter((o) => (OPEN as readonly string[]).includes(o.status));

  function removeItem(item: SupplierItemRow) {
    if (!s) return;
    void ask.confirm({
      title: "Fiyat kaldırılsın mı?",
      body: `${s.code} ${s.name}: ${item.materialCode} ${item.materialName} fiyatı (${priceText(item.unitPriceMinor, item.unit)}) kaldırılacak. Öneri bu malzemeyi artık bu tedarikçiden istemez${
        item.isPreferred ? "; tercihli tedarikçi işareti de kalkar" : ""
      }. Açık siparişler etkilenmez.`,
      confirmLabel: "Fiyatı kaldır",
      tone: "danger",
      action: () =>
        run("remove", async () => {
          await remove.mutateAsync(item.id);
          toast.success(`${item.materialCode} fiyatı kaldırıldı`);
        }),
    });
  }

  return (
    <>
      <Drawer
        open
        onOpenChange={(next) => !next && onClose()}
        title={s?.name ?? (supplier.isPending ? "Yükleniyor" : "Tedarikçi bulunamadı")}
        badge={
          s ? (
            <DrawerBadge tone={s.active ? "neutral" : "warn"}>
              <FactoryIcon size={22} />
            </DrawerBadge>
          ) : undefined
        }
        subtitle={
          s ? (
            <>
              <span className="tabular font-semibold text-hero-fg">{s.code}</span>
              <StatusChip tone={s.active ? "ok" : "warn"}>{s.active ? "Etkin" : "Pasif"}</StatusChip>
            </>
          ) : undefined
        }
        hero={
          s ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-hero-fg-muted">Açık sipariş tutarı, KDV hariç</p>
                <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">{formatMoney(s.openNetMinor)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-hero-fg-muted">Açık sipariş</p>
                <p className="tabular font-display text-xl font-semibold">{s.openOrderCount}</p>
              </div>
            </div>
          ) : undefined
        }
        footer={
          s && canWrite ? (
            <>
              <Button variant="primary" icon={<PlusIcon />} disabled={busy !== null} onClick={() => setPricing({})}>
                Fiyat ekle
              </Button>
              <Button variant="ghost" icon={<EditIcon />} className="ml-auto" disabled={busy !== null} onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            </>
          ) : undefined
        }
      >
        {s ? (
          <div className="grid gap-6">
            <dl className="grid grid-cols-2 gap-2.5">
              <DetailItem label="İl">{s.city}</DetailItem>
              <DetailItem label="Yetkili">{s.contact || "Yok"}</DetailItem>
              <DetailItem label="Telefon">
                <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="text-accent underline-offset-4 hover:underline">
                  {s.phone}
                </a>
              </DetailItem>
              <DetailItem label="Para birimi">TL</DetailItem>
              <DetailItem label="Teslim süresi" icon={<ClockIcon size={14} />}>
                {s.leadTimeDays} iş günü
              </DetailItem>
              <DetailItem label="Ödeme vadesi">{s.paymentTermDays} gün</DetailItem>
            </dl>

            <section className="grid gap-3" aria-labelledby={`prices-${s.id}`}>
              <h3 id={`prices-${s.id}`} className="text-lg font-semibold">
                Fiyat listesi <span className="tabular text-base font-medium text-fg-muted">({s.items.length})</span>
              </h3>
              {s.items.length === 0 ? (
                <p className="text-fg-muted">{canWrite ? "Henüz fiyat yok. “Fiyat ekle” ile tedarikçinin sunduğu malzemeleri girin." : "Henüz fiyat girilmemiş."}</p>
              ) : (
                <ul aria-label="Fiyat listesi" className="grid gap-2">
                  {s.items.map((item) => (
                    <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
                      <span className="grid min-w-0">
                        <span className="font-semibold break-words">{item.materialName}</span>
                        <span className="tabular text-xs text-fg-muted">{item.materialCode}</span>
                      </span>
                      {canWrite ? (
                        <span className="flex items-start gap-0.5">
                          <IconButton label={`Fiyatı düzenle: ${item.materialCode}`} size="sm" className="-mt-1" disabled={busy !== null} onClick={() => setPricing({ item })}>
                            <EditIcon />
                          </IconButton>
                          <IconButton label={`Fiyatı kaldır: ${item.materialCode}`} size="sm" className="-mt-1 -mr-1.5 text-danger" disabled={busy !== null} onClick={() => removeItem(item)}>
                            <TrashIcon />
                          </IconButton>
                        </span>
                      ) : null}
                      <span className="tabular col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                        <span className="font-semibold">{priceText(item.unitPriceMinor, item.unit)}</span>
                        <span className="text-fg-muted">{item.moqMilli > 0 ? `En az ${formatQty(item.moqMilli, item.unit)}` : "En az miktar yok"}</span>
                        {item.isPreferred ? (
                          <StatusChip tone="ok">
                            <span aria-hidden="true">★</span> Tercihli
                          </StatusChip>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="grid gap-3" aria-labelledby={`orders-${s.id}`}>
              <h3 id={`orders-${s.id}`} className="text-lg font-semibold">
                Açık siparişler
              </h3>
              {orders.data && open.length === 0 ? <p className="text-fg-muted">Bu tedarikçide açık sipariş yok.</p> : null}
              <ul className="grid gap-2">
                {open.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/satin-alma/siparisler?ac=${o.id}`}
                      className="press grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset hover:bg-surface-2"
                    >
                      <span className="tabular font-semibold">{o.code}</span>
                      <span className="tabular font-semibold whitespace-nowrap">{formatMoney(o.openNetKurus)}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-muted">
                        <StatusChip tone={PO_STATUS_TONE[o.status]}>{PO_STATUS_LABEL[o.status]}</StatusChip>
                        <span>{o.lineCount} kalem, KDV hariç{o.status === "partial" ? `; sipariş ${formatMoney(o.netKurus)}, kalan tutar` : ""}</span>
                      </span>
                      <ArrowRightIcon size={16} className="justify-self-end text-fg-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <HistoryList {...history} />
          </div>
        ) : supplier.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="w-2/3" />
            <Skeleton />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-fg-muted">Bu tedarikçi silinmiş ya da adres hatalı olabilir.</p>
        )}
      </Drawer>

      {s && editing ? <SupplierForm supplier={s} onClose={() => setEditing(false)} /> : null}
      {s && pricing ? <SupplierItemForm supplier={s} item={pricing.item} onClose={() => setPricing(null)} /> : null}
      {ask.element}
    </>
  );
}
