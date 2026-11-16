"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { can } from "@/domain/permissions";
import { formatMoney } from "@/domain/units";
import { useSession } from "@/shell/session";
import { Button } from "@/ui/Button";
import { Drawer } from "@/ui/Drawer";
import { formatDate } from "@/ui/format";
import { ArrowRightIcon, ClockIcon, ContactIcon, EditIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { CustomerForm } from "./CustomerForm";
import { useCustomer, useOrders } from "./hooks";
import { CUSTOMER_KIND_LABEL } from "./labels";
import { DueDate, OrderStatusChips } from "./OrderStatus";

/** Müşteri kartı, açık tutarı ve siparişleri. Siparişe tıklamak sipariş çekmecesini açar. */
export function CustomerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const customer = useCustomer(id);
  const orders = useOrders({ customerId: id });
  const [editing, setEditing] = useState(false);
  const c = customer.data;
  const canWrite = user ? can(user, "sales", "write") : false;

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => !open && onClose()}
        title={c?.name ?? (customer.isPending ? "Yükleniyor" : "Müşteri bulunamadı")}
        badge={
          c ? (
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-fg">
              <ContactIcon size={22} />
            </span>
          ) : undefined
        }
        subtitle={
          c ? (
            <>
              <span className="tabular font-semibold text-hero-fg">{c.code}</span>
              <StatusChip tone={c.kind === "kurumsal" ? "info" : "neutral"}>{CUSTOMER_KIND_LABEL[c.kind]}</StatusChip>
            </>
          ) : undefined
        }
        hero={
          c ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-hero-fg-muted">Açık sipariş tutarı</p>
                <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">{formatMoney(c.openOrderTotalKurus)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-hero-fg-muted">Sipariş</p>
                <p className="tabular font-display text-xl font-semibold">{c.orderCount}</p>
              </div>
            </div>
          ) : undefined
        }
        footer={
          c && canWrite ? (
            <Button variant="ghost" icon={<EditIcon />} className="ml-auto" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
          ) : undefined
        }
      >
        {c ? (
          <div className="grid gap-6">
            <dl className="grid grid-cols-2 gap-2.5">
              <Item label="İl / İlçe">
                {c.city} / {c.district}
              </Item>
              <Item label="Telefon">
                <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-accent underline-offset-4 hover:underline">
                  {c.phone}
                </a>
              </Item>
              <Item label="Ödeme vadesi" icon={<ClockIcon size={14} />}>
                {c.paymentTermDays} gün
              </Item>
              <Item label="Son sipariş">{c.lastOrderAt ? formatDate(c.lastOrderAt) : "Yok"}</Item>
            </dl>

            <section className="grid gap-3" aria-labelledby={`orders-${c.id}`}>
              <h3 id={`orders-${c.id}`} className="text-lg font-semibold">
                Siparişleri
              </h3>
              {orders.data && orders.data.length === 0 ? <p className="text-fg-muted">Bu müşterinin henüz siparişi yok.</p> : null}
              <ul className="grid gap-2">
                {(orders.data ?? []).map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/satis/siparisler?ac=${o.id}`}
                      className="press grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset hover:bg-surface-2"
                    >
                      <span className="tabular font-semibold">{o.code}</span>
                      <span className="tabular font-semibold whitespace-nowrap">{formatMoney(o.totalKurus)}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-muted">
                        <OrderStatusChips status={o.status} waitingMaterial={o.waitingMaterial} />
                        <span>
                          Termin <DueDate order={o} />
                        </span>
                      </span>
                      <ArrowRightIcon size={16} className="justify-self-end text-fg-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : customer.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="w-2/3" />
            <Skeleton />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-fg-muted">Bu müşteri silinmiş ya da adres hatalı olabilir.</p>
        )}
      </Drawer>

      {c && editing ? <CustomerForm customer={c} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

function Item({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset">
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
        {icon}
        {label}
      </dt>
      <dd className="tabular min-w-0 font-semibold break-words">{children}</dd>
    </div>
  );
}
