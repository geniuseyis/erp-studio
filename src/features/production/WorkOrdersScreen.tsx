"use client";

import { WORK_ORDER_STATUSES } from "@/db/schema";
import type { WorkOrderRow } from "@/domain/production/queries";
import type { WorkOrderStatus } from "@/domain/production/types";
import { formatNumber } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { CloseIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { CountUp } from "@/ui/motion";
import { useWorkOrders } from "./hooks";
import { materialStateLabel, WO_STATUS_LABEL } from "./labels";
import { MaterialState, WorkOrderDrawer, WorkOrderStatusChips } from "./WorkOrderDrawer";

const waiting = (w: Pick<WorkOrderRow, "status" | "materialsReserved">) => w.status === "planned" && !w.materialsReserved;

const COLUMNS: Column<WorkOrderRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (w) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{w.code}</span>,
    sortValue: (w) => w.code,
  },
  {
    id: "product",
    header: "Ürün",
    cell: (w) => (
      <span className="grid min-w-48 gap-0.5">
        <span className="font-semibold">{w.productName}</span>
        <span className="tabular text-xs text-fg-muted">{w.productCode}</span>
      </span>
    ),
    sortValue: (w) => w.productName,
  },
  { id: "qty", header: "Adet", align: "right", cell: (w) => <span className="tabular">{formatNumber(w.qtyMilli / 1000)}</span>, sortValue: (w) => w.qtyMilli, csvValue: (w) => w.qtyMilli / 1000 },
  {
    id: "status",
    header: "Durum",
    cell: (w) => <WorkOrderStatusChips status={w.status} />,
    sortValue: (w) => WORK_ORDER_STATUSES.indexOf(w.status),
    csvValue: (w) => WO_STATUS_LABEL[w.status],
  },
  {
    id: "materials",
    header: "Malzeme",
    cell: (w) => <MaterialState workOrder={w} />,
    sortValue: (w) => (waiting(w) ? 0 : 1),
    csvValue: (w) => materialStateLabel(w),
  },
  {
    id: "station",
    header: "Şu anki istasyon",
    cell: (w) => <span className="whitespace-nowrap">{w.currentStation ?? <span className="text-fg-muted">—</span>}</span>,
    sortValue: (w) => w.currentStation ?? "",
  },
  {
    id: "progress",
    header: "İlerleme",
    cell: (w) => (
      <span className="grid w-28 gap-1.5">
        <span className="tabular text-sm font-semibold">
          {w.doneSteps}/{w.totalSteps}
        </span>
        <Meter
          size="sm"
          value={w.doneSteps}
          max={w.totalSteps}
          tone={w.status === "completed" ? "ok" : w.status === "cancelled" ? "neutral" : "warn"}
          label={`${w.totalSteps} adımın ${w.doneSteps} adımı bitti`}
          className="w-full"
        />
      </span>
    ),
    sortValue: (w) => (w.totalSteps > 0 ? w.doneSteps / w.totalSteps : 0),
    csvValue: (w) => `${w.doneSteps}/${w.totalSteps}`,
  },
  {
    id: "order",
    header: "Sipariş",
    cell: (w) => <span className="tabular text-sm whitespace-nowrap">{w.orderCode ?? <span className="text-fg-muted">Stok için</span>}</span>,
    sortValue: (w) => w.orderCode ?? "",
  },
];

function asStatus(value: string | null): WorkOrderStatus | undefined {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value ?? "") ? (value as WorkOrderStatus) : undefined;
}

export function WorkOrdersScreen() {
  const [params, setParams] = useUrlState();
  const search = params.get("q") ?? "";
  const status = asStatus(params.get("durum"));
  const waitingOnly = params.get("bekleyen") === "1";
  // Haftalık plandaki "Planlanmamış" sayısının listesi: aynı koşul (unscheduledWorkOrder).
  const unscheduledOnly = params.get("planlanmamis") === "1";
  const openId = params.get("ac");
  const filtered = search !== "" || status !== undefined || waitingOnly || unscheduledOnly;

  const orders = useWorkOrders({ search, status, unscheduled: unscheduledOnly || undefined });
  // Çip sayıları ve özet süzgeçten bağımsızdır: bütün iş emirleri.
  const all = useWorkOrders();
  const list = all.data ?? [];
  const rows = (orders.data ?? []).filter((w) => !waitingOnly || waiting(w));
  const countOf = (st: WorkOrderStatus) => list.filter((w) => w.status === st).length;
  const waitingCount = list.filter(waiting).length;
  const openSteps = list.filter((w) => w.status === "planned" || w.status === "in_progress").reduce((n, w) => n + (w.totalSteps - w.doneSteps), 0);

  return (
    <Page fill>
      <PageHeader
        title="İş emirleri"
        description="Atölyedeki işler: planı, malzemesi ve hangi istasyonda olduğuyla."
        stats={
          all.data ? (
            <>
              <HeroStat index={0} label="Üretimde" value={<CountUp value={countOf("in_progress")} format={String} />} hint="Adımı başlamış iş emri" />
              <HeroStat index={1} label="Planlı" value={<CountUp value={countOf("planned")} format={String} />} hint="Henüz başlamamış" />
              <HeroStat
                index={2}
                label="Malzeme bekliyor"
                tone={waitingCount > 0 ? "alert" : "default"}
                value={<CountUp value={waitingCount} format={String} />}
                hint="Malzemesi ayrılamamış"
                href="/uretim/is-emirleri?bekleyen=1"
              />
              <HeroStat index={3} label="Kalan adım" value={<CountUp value={openSteps} format={String} />} hint="Açık iş emirlerinde" />
            </>
          ) : null
        }
      />
      <DataTable
        label="İş emirleri"
        rows={rows}
        columns={COLUMNS}
        rowId={(w) => w.id}
        rowLabel={(w) => `${w.code}, ${w.productName}`}
        loading={orders.isPending}
        csvFileName="is-emirleri"
        onRowClick={(w) => setParams({ ac: w.id })}
        toolbar={
          <>
            <SearchBox label="İş emri ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />
            <FilterChip tone="danger" pressed={waitingOnly} count={waitingCount} onClick={() => setParams({ bekleyen: waitingOnly ? null : "1" })}>
              Malzeme bekliyor
            </FilterChip>
            {unscheduledOnly ? (
              <FilterChip pressed onClick={() => setParams({ planlanmamis: null })}>
                Planlanmamış
                <CloseIcon size={13} aria-hidden="true" />
                <span className="sr-only">süzgecini kaldır</span>
              </FilterChip>
            ) : null}
          </>
        }
        filters={
          <div role="group" aria-label="Durum" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="durum" pressed={!status} count={list.length} onClick={() => setParams({ durum: null })}>
              Tümü
            </FilterChip>
            {WORK_ORDER_STATUSES.map((st) => (
              <FilterChip key={st} group="durum" pressed={status === st} count={countOf(st)} onClick={() => setParams({ durum: status === st ? null : st })}>
                {WO_STATUS_LABEL[st]}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Süzgeçle eşleşen iş emri yok" action={<Button onClick={() => setParams({ q: null, durum: null, bekleyen: null, planlanmamis: null })}>Süzgeçleri temizle</Button>}>
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz iş emri yok">İş emirleri, satış bir siparişi onaylayınca açılır.</EmptyState>
          )
        }
      />
      {openId ? <WorkOrderDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
    </Page>
  );
}
