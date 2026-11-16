"use client";

import { ORDER_STATUSES } from "@/db/schema";
import type { OrderRow } from "@/domain/sales/queries";
import type { OrderStatus } from "@/domain/sales/types";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatDate, formatMoneyWhole } from "@/ui/format";
import { CountUp } from "@/ui/motion";
import { useOrders, useSalesSummary } from "./hooks";
import { formatDue, ORDER_STATUS_LABEL } from "./labels";
import { OrderDrawer } from "./OrderDrawer";
import { DueDate, OrderStatusChips } from "./OrderStatus";

const COLUMNS: Column<OrderRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (o) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{o.code}</span>,
    sortValue: (o) => o.code,
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: (o) => <span className="block min-w-48 font-semibold">{o.customerName}</span>,
    sortValue: (o) => o.customerName,
  },
  {
    id: "status",
    header: "Durum",
    cell: (o) => <OrderStatusChips status={o.status} waitingMaterial={o.waitingMaterial} />,
    sortValue: (o) => ORDER_STATUSES.indexOf(o.status),
    csvValue: (o) => (o.waitingMaterial ? `${ORDER_STATUS_LABEL[o.status]} (malzeme bekliyor)` : ORDER_STATUS_LABEL[o.status]),
  },
  {
    id: "due",
    header: "Termin",
    cell: (o) => <DueDate order={o} />,
    sortValue: (o) => o.dueAt.getTime(),
    csvValue: (o) => formatDue(o.dueAt),
  },
  { id: "lines", header: "Kalem", align: "right", cell: (o) => <span className="tabular">{o.lineCount}</span>, sortValue: (o) => o.lineCount },
  {
    id: "total",
    header: "Tutar (KDV dahil)",
    align: "right",
    cell: (o) => <span className="tabular font-semibold whitespace-nowrap">{formatMoney(o.totalKurus)}</span>,
    sortValue: (o) => o.totalKurus,
    csvValue: (o) => o.totalKurus / 100,
  },
  {
    id: "created",
    header: "Açılış",
    cell: (o) => <span className="tabular whitespace-nowrap text-fg-muted">{formatDate(o.createdAt)}</span>,
    sortValue: (o) => o.createdAt.getTime(),
    csvValue: (o) => formatDate(o.createdAt),
    defaultHidden: true,
  },
];

function asStatus(value: string | null): OrderStatus | undefined {
  return (ORDER_STATUSES as readonly string[]).includes(value ?? "") ? (value as OrderStatus) : undefined;
}

export function OrdersScreen() {
  const [params, setParams] = useUrlState();

  const search = params.get("q") ?? "";
  const status = asStatus(params.get("durum"));
  const waitingOnly = params.get("bekleyen") === "1";
  const overdueOnly = params.get("geciken") === "1";
  const openId = params.get("ac");
  const filtered = search !== "" || status !== undefined || waitingOnly || overdueOnly;

  const orders = useOrders({ search, status });
  // Çip sayıları süzgeçten bağımsızdır: bütün siparişler.
  const all = useOrders();
  const summary = useSalesSummary();
  const s = summary.data;
  const rows = (orders.data ?? []).filter((o) => (!waitingOnly || o.waitingMaterial) && (!overdueOnly || o.overdue));
  const countOf = (st: OrderStatus) => (all.data ?? []).filter((o) => o.status === st).length;

  return (
    <Page fill>
      <PageHeader
        title="Siparişler"
        description="Müşteri siparişleri: taslaktan sevke kadar durumları, terminleri ve tutarlarıyla."
        stats={
          s ? (
            <>
              <HeroStat index={0} label="Açık sipariş" value={<CountUp value={s.openOrders} format={String} />} hint="Onaylı, henüz sevk edilmemiş" />
              <HeroStat
                index={1}
                label="Malzeme bekliyor"
                tone={s.waitingMaterial > 0 ? "alert" : "default"}
                value={<CountUp value={s.waitingMaterial} format={String} />}
                hint="İş emri malzeme bekleyen"
                href="/satis/siparisler?bekleyen=1"
              />
              <HeroStat
                index={2}
                label="Geciken"
                tone={s.overdue > 0 ? "alert" : "default"}
                value={<CountUp value={s.overdue} format={String} />}
                hint="Termini geçmiş açık sipariş"
                href="/satis/siparisler?geciken=1"
              />
              <HeroStat index={3} label="Açık tutar" value={<CountUp value={s.openTotalKurus} format={formatMoneyWhole} />} hint="KDV dahil" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Siparişler"
        rows={rows}
        columns={COLUMNS}
        rowId={(o) => o.id}
        rowLabel={(o) => `${o.code}, ${o.customerName}`}
        loading={orders.isPending}
        csvFileName="siparisler"
        onRowClick={(o) => setParams({ ac: o.id })}
        toolbar={
          <>
            <SearchBox label="Sipariş ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />
            <FilterChip tone="danger" pressed={waitingOnly} count={s?.waitingMaterial} onClick={() => setParams({ bekleyen: waitingOnly ? null : "1" })}>
              Malzeme bekliyor
            </FilterChip>
            <FilterChip tone="danger" pressed={overdueOnly} count={s?.overdue} onClick={() => setParams({ geciken: overdueOnly ? null : "1" })}>
              Geciken
            </FilterChip>
          </>
        }
        filters={
          <div role="group" aria-label="Durum" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="durum" pressed={!status} count={all.data?.length} onClick={() => setParams({ durum: null })}>
              Tümü
            </FilterChip>
            {ORDER_STATUSES.map((st) => (
              <FilterChip key={st} group="durum" pressed={status === st} count={countOf(st)} onClick={() => setParams({ durum: status === st ? null : st })}>
                {ORDER_STATUS_LABEL[st]}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState
              title="Süzgeçle eşleşen sipariş yok"
              action={<Button onClick={() => setParams({ q: null, durum: null, bekleyen: null, geciken: null })}>Süzgeçleri temizle</Button>}
            >
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz sipariş yok">Siparişleri satış ekibi açar.</EmptyState>
          )
        }
      />
      {openId ? <OrderDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
    </Page>
  );
}
