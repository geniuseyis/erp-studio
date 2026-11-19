"use client";

import { useState } from "react";
import { can } from "@/domain/permissions";
import type { SupplierRow } from "@/domain/purchasing/queries";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatMoneyWhole } from "@/ui/format";
import { PlusIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { useSuppliers } from "./hooks";
import { SupplierDrawer } from "./SupplierDrawer";
import { SupplierForm } from "./SupplierForm";

const COLUMNS: Column<SupplierRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (s) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{s.code}</span>,
    sortValue: (s) => s.code,
  },
  {
    id: "name",
    header: "Ad",
    cell: (s) => (
      <span className="flex min-w-52 flex-wrap items-center gap-2 font-semibold">
        {s.name}
        {s.active ? null : <StatusChip tone="warn">Pasif</StatusChip>}
      </span>
    ),
    sortValue: (s) => s.name,
    csvValue: (s) => (s.active ? s.name : `${s.name} (pasif)`),
  },
  { id: "city", header: "İl", cell: (s) => <span className="whitespace-nowrap">{s.city}</span>, sortValue: (s) => s.city },
  { id: "currency", header: "Para birimi", cell: (s) => <span>{s.currency === "TRY" ? "TL" : s.currency}</span>, sortValue: (s) => s.currency, defaultHidden: true },
  {
    id: "lead",
    header: "Teslim süresi",
    align: "right",
    cell: (s) => <span className="tabular whitespace-nowrap">{s.leadTimeDays} iş günü</span>,
    sortValue: (s) => s.leadTimeDays,
    csvValue: (s) => s.leadTimeDays,
  },
  { id: "items", header: "Kalem sayısı", align: "right", cell: (s) => <span className="tabular">{s.itemCount}</span>, sortValue: (s) => s.itemCount },
  { id: "open", header: "Açık sipariş", align: "right", cell: (s) => <span className="tabular">{s.openOrderCount}</span>, sortValue: (s) => s.openOrderCount },
  {
    id: "openNet",
    header: "Açık tutar",
    align: "right",
    cell: (s) => (
      <span className={s.openNetMinor > 0 ? "tabular font-semibold whitespace-nowrap" : "tabular whitespace-nowrap text-fg-muted"}>{formatMoney(s.openNetMinor)}</span>
    ),
    sortValue: (s) => s.openNetMinor,
    csvValue: (s) => s.openNetMinor / 100,
  },
];

export function SuppliersScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();
  const [creating, setCreating] = useState(false);

  const search = params.get("q") ?? "";
  const openId = params.get("ac");
  const canWrite = user ? can(user, "purchasing", "write") : false;

  const suppliers = useSuppliers({ search });
  // Özet süzgeçten bağımsızdır.
  const all = useSuppliers();
  const list = all.data;
  const openOrders = (list ?? []).reduce((n, s) => n + s.openOrderCount, 0);
  const openTotal = (list ?? []).reduce((n, s) => n + s.openNetMinor, 0);
  const priced = (list ?? []).filter((s) => s.itemCount > 0).length;

  return (
    <Page fill>
      <PageHeader
        title="Tedarikçiler"
        description="Tedarikçi kartları, malzeme fiyat listeleri ve açık siparişleri."
        actions={
          canWrite ? (
            <Button variant="light" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Yeni tedarikçi
            </Button>
          ) : null
        }
        stats={
          list ? (
            <>
              <HeroStat index={0} label="Tedarikçi" value={<CountUp value={list.length} format={String} />} hint={`${priced} tanesinin fiyat listesi var`} />
              <HeroStat index={1} label="Açık sipariş" value={<CountUp value={openOrders} format={String} />} hint="Onay bekleyen, gönderilen, kısmi" href="/satin-alma/siparisler" />
              <HeroStat index={2} label="Açık tutar" value={<CountUp value={openTotal} format={formatMoneyWhole} />} hint="KDV hariç, teslim alınmamış kısım" />
              <HeroStat index={3} label="Fiyatlı kalem" value={<CountUp value={(list ?? []).reduce((n, s) => n + s.itemCount, 0)} format={String} />} hint="Tedarikçi × malzeme" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Tedarikçiler"
        rows={suppliers.data ?? []}
        columns={COLUMNS}
        rowId={(s) => s.id}
        rowLabel={(s) => `${s.code}, ${s.name}`}
        loading={suppliers.isPending}
        csvFileName="tedarikciler"
        initialSort={{ id: "code", desc: false }}
        onRowClick={(s) => setParams({ ac: s.id })}
        toolbar={<SearchBox label="Tedarikçi ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />}
        empty={
          search !== "" ? (
            <EmptyState title="Aramanızla eşleşen tedarikçi yok" action={<Button onClick={() => setParams({ q: null })}>Aramayı temizle</Button>}>
              Ad, kod ya da il ile arayabilirsiniz.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz tedarikçi yok">{canWrite ? "İlk tedarikçiyi eklemek için “Yeni tedarikçi” düğmesini kullanın." : "Tedarikçileri Satın Alma ekibi ekler."}</EmptyState>
          )
        }
      />
      {openId ? <SupplierDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
      {creating ? <SupplierForm onClose={() => setCreating(false)} onCreated={(id) => setParams({ ac: id })} /> : null}
    </Page>
  );
}
