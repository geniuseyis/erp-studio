"use client";

import { can } from "@/domain/permissions";
import type { PurchaseOrderRow } from "@/domain/purchasing/queries";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatDate, formatMoneyWhole } from "@/ui/format";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { usePurchaseOrders, useSuppliers } from "./hooks";
import { approvalLabel, asPoStatus, PO_STATUS_LABEL, PO_STATUS_ORDER, userCanApprove } from "./labels";
import { PurchaseOrderDrawer } from "./PurchaseOrderDrawer";
import { PurchaseStatusChips } from "./PurchaseStatus";

const OPEN = new Set(["pending_approval", "sent", "partial"]);

const COLUMNS: Column<PurchaseOrderRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (o) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{o.code}</span>,
    sortValue: (o) => o.code,
  },
  {
    id: "supplier",
    header: "Tedarikçi",
    cell: (o) => (
      <span className="block min-w-48">
        <span className="font-semibold">{o.supplierName}</span> <span className="tabular text-xs text-fg-muted">{o.supplierCode}</span>
      </span>
    ),
    sortValue: (o) => o.supplierName,
    csvValue: (o) => `${o.supplierCode} ${o.supplierName}`,
  },
  {
    id: "status",
    header: "Durum",
    cell: (o) => <PurchaseStatusChips status={o.status} late={o.late} />,
    sortValue: (o) => PO_STATUS_ORDER.indexOf(o.status),
    csvValue: (o) => (o.late ? `${PO_STATUS_LABEL[o.status]} (gecikti)` : PO_STATUS_LABEL[o.status]),
  },
  { id: "lines", header: "Kalem", align: "right", cell: (o) => <span className="tabular">{o.lineCount}</span>, sortValue: (o) => o.lineCount },
  {
    id: "net",
    header: "Tutar (KDV hariç)",
    align: "right",
    cell: (o) => <span className="tabular font-semibold whitespace-nowrap">{formatMoney(o.netKurus)}</span>,
    sortValue: (o) => o.netKurus,
    csvValue: (o) => o.netKurus / 100,
  },
  { id: "creator", header: "Oluşturan", cell: (o) => <span className="whitespace-nowrap">{o.createdByName}</span>, sortValue: (o) => o.createdByName },
  {
    id: "expected",
    header: "Beklenen teslim",
    cell: (o) =>
      o.expectedAt ? (
        <span className={o.late ? "tabular font-semibold whitespace-nowrap text-danger" : "tabular whitespace-nowrap"}>{formatDate(o.expectedAt)}</span>
      ) : (
        <span className="text-fg-muted">—</span>
      ),
    sortValue: (o) => o.expectedAt?.getTime() ?? 0,
    csvValue: (o) => (o.expectedAt ? formatDate(o.expectedAt) : ""),
  },
  {
    id: "approval",
    header: "Onay durumu",
    cell: (o) => {
      const text = approvalLabel(o);
      return o.status === "pending_approval" ? <StatusChip tone="warn">{text}</StatusChip> : <span className="whitespace-nowrap text-fg-muted">{text}</span>;
    },
    sortValue: (o) => approvalLabel(o),
  },
];

export function PurchaseOrdersScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();

  const search = params.get("q") ?? "";
  const status = asPoStatus(params.get("durum"));
  const supplierId = params.get("tedarikci") ?? "";
  const openId = params.get("ac");
  const filtered = search !== "" || status !== undefined || supplierId !== "";
  const canWrite = user ? can(user, "purchasing", "write") : false;

  const orders = usePurchaseOrders({ search, status, supplierId: supplierId || undefined });
  // Özet ve çip sayıları süzgeçten bağımsızdır: bütün siparişler.
  const all = usePurchaseOrders();
  const suppliers = useSuppliers();
  const list = all.data;
  const countOf = (st: PurchaseOrderRow["status"]) => (list ?? []).filter((o) => o.status === st).length;

  const open = (list ?? []).filter((o) => OPEN.has(o.status));
  const pending = open.filter((o) => o.status === "pending_approval");
  const mine = user ? pending.filter((o) => userCanApprove(user, o)) : [];
  const late = open.filter((o) => o.late).length;
  const canApproveAny = user ? can(user, "purchasing", "approve") : false;

  return (
    <Page fill>
      <PageHeader
        title="Satın alma siparişleri"
        description="Tedarikçilere verilen siparişler: taslaktan teslime kadar durumları, onayları ve tutarlarıyla."
        stats={
          list ? (
            <>
              <HeroStat index={0} label="Açık sipariş tutarı" value={<CountUp value={open.reduce((n, o) => n + o.openNetKurus, 0)} format={formatMoneyWhole} />} hint="KDV hariç, teslim alınmamış kısım" />
              <HeroStat
                index={1}
                label={canApproveAny ? "Sizi bekleyen onay" : "Onay bekleyen"}
                tone={(canApproveAny ? mine.length : pending.length) > 0 ? "alert" : "default"}
                value={<CountUp value={canApproveAny ? mine.length : pending.length} format={String} />}
                hint={canApproveAny ? `Toplam ${pending.length} sipariş onay bekliyor` : "Satın Alma müdürü ya da Yönetim onaylar"}
                href="/satin-alma/siparisler?durum=pending_approval"
              />
              <HeroStat index={2} label="Geciken" tone={late > 0 ? "alert" : "default"} value={<CountUp value={late} format={String} />} hint="Beklenen teslim günü geçmiş" />
              <HeroStat index={3} label="Sipariş" value={<CountUp value={list.length} format={String} />} hint="Taslak ve iptal dahil" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Satın alma siparişleri"
        rows={orders.data ?? []}
        columns={COLUMNS}
        rowId={(o) => o.id}
        rowLabel={(o) => `${o.code}, ${o.supplierName}`}
        loading={orders.isPending}
        csvFileName="satin-alma-siparisleri"
        onRowClick={(o) => setParams({ ac: o.id })}
        toolbar={
          <>
            <SearchBox label="Sipariş ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />
            <select
              aria-label="Tedarikçi süz"
              value={supplierId}
              onChange={(e) => setParams({ tedarikci: e.target.value || null })}
              className="h-9 max-w-56 min-w-0 rounded-full border border-line bg-surface-2/60 px-3 text-sm text-fg hover:border-line-strong focus:border-accent"
            >
              <option value="">Bütün tedarikçiler</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
          </>
        }
        filters={
          <div role="group" aria-label="Durum" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="durum" pressed={!status} count={list?.length} onClick={() => setParams({ durum: null })}>
              Tümü
            </FilterChip>
            {PO_STATUS_ORDER.map((st) => (
              <FilterChip key={st} group="durum" pressed={status === st} count={countOf(st)} onClick={() => setParams({ durum: status === st ? null : st })}>
                {PO_STATUS_LABEL[st]}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Süzgeçle eşleşen sipariş yok" action={<Button onClick={() => setParams({ q: null, durum: null, tedarikci: null })}>Süzgeçleri temizle</Button>}>
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz satın alma siparişi yok">{canWrite ? "Öneriler ekranından taslak açabilirsiniz." : "Siparişleri Satın Alma ekibi açar."}</EmptyState>
          )
        }
      />
      {openId ? <PurchaseOrderDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
    </Page>
  );
}
