"use client";

import Link from "next/link";
import type { ReceivableRow, RecentReceipt } from "@/domain/purchasing/queries";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useUrlState } from "@/shell/useUrlState";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatDate, formatDateTime } from "@/ui/format";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { useReceivable, useRecentReceipts } from "./hooks";
import { ReceiptForm } from "./ReceiptForm";

const COLUMNS: Column<ReceivableRow>[] = [
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
    id: "expected",
    header: "Beklenen teslim",
    cell: (o) =>
      o.expectedAt ? (
        <span className="inline-flex flex-wrap items-center gap-2 whitespace-nowrap">
          <span className={o.late ? "tabular font-semibold text-danger" : "tabular"}>{formatDate(o.expectedAt)}</span>
          {o.late ? <StatusChip tone="danger">Gecikti</StatusChip> : null}
        </span>
      ) : (
        <span className="text-fg-muted">—</span>
      ),
    sortValue: (o) => o.expectedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    csvValue: (o) => (o.expectedAt ? formatDate(o.expectedAt) : ""),
  },
  { id: "lines", header: "Kalem", align: "right", cell: (o) => <span className="tabular">{o.lineCount}</span>, sortValue: (o) => o.lineCount },
  { id: "remaining", header: "Kalan kalem", align: "right", cell: (o) => <span className="tabular font-semibold">{o.remainingLineCount}</span>, sortValue: (o) => o.remainingLineCount },
  {
    id: "net",
    header: "Tutar (KDV hariç)",
    align: "right",
    cell: (o) => <span className="tabular whitespace-nowrap">{formatMoney(o.netKurus)}</span>,
    sortValue: (o) => o.netKurus,
    csvValue: (o) => o.netKurus / 100,
  },
];

/** Depo: mal kabule açık siparişler (geciken önce) ve son 10 mal kabul. Satıra tıklayınca mal kabul çekmecesi açılır. */
export function ReceivingScreen() {
  const [params, setParams] = useUrlState();
  const openId = params.get("ac");
  const receivable = useReceivable();
  const recent = useRecentReceipts();
  const rows = receivable.data ?? [];
  const late = rows.filter((o) => o.late).length;

  return (
    <Page>
      <PageHeader
        title="Mal kabul"
        description="Tedarikçiden gelen malı irsaliyeyle teslim alın: stoğa girer, malzeme bekleyen iş emirleri varsa onlara ayrılır."
        stats={
          receivable.data ? (
            <>
              <HeroStat index={0} label="Bekleyen sipariş" value={<CountUp value={rows.length} format={String} />} hint="Gönderilmiş ve kısmen teslim alınmış" />
              <HeroStat index={1} label="Geciken" tone={late > 0 ? "alert" : "default"} value={<CountUp value={late} format={String} />} hint="Beklenen teslim günü geçmiş" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Mal kabule açık siparişler"
        rows={rows}
        columns={COLUMNS}
        rowId={(o) => o.id}
        rowLabel={(o) => `${o.code}, ${o.supplierName}`}
        loading={receivable.isPending}
        csvFileName="mal-kabule-acik-siparisler"
        onRowClick={(o) => setParams({ ac: o.id })}
        empty={<EmptyState title="Mal kabul bekleyen sipariş yok">Gönderilmiş satın alma siparişleri burada listelenir.</EmptyState>}
      />
      <RecentReceipts rows={recent.data} />
      {openId ? <ReceiptForm key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
    </Page>
  );
}

function RecentReceipts({ rows }: { rows: RecentReceipt[] | undefined }) {
  return (
    <section aria-labelledby="son-mal-kabuller" className="grid gap-3">
      <h2 id="son-mal-kabuller" className="font-display text-lg font-semibold">
        Son mal kabuller
      </h2>
      {rows && rows.length === 0 ? (
        <p className="text-fg-muted">Henüz mal kabul yapılmadı.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table aria-label="Son mal kabuller" className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th scope="col" className="px-4 py-2.5 font-semibold">Mal kabul</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Sipariş</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">İrsaliye</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Teslim alan</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="tabular px-4 py-2.5 font-semibold whitespace-nowrap">{r.code}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/satin-alma/siparisler?ac=${r.orderId}`} className="tabular text-accent underline-offset-4 hover:underline">
                      {r.orderCode}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-2.5">{r.deliveryNote}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.receivedByName}</td>
                  <td className="tabular px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
