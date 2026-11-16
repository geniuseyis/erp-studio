"use client";

import { useState } from "react";
import { CUSTOMER_KINDS } from "@/db/schema";
import { can } from "@/domain/permissions";
import type { CustomerRow } from "@/domain/sales/queries";
import type { CustomerKind } from "@/domain/sales/types";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatDate, formatMoneyWhole } from "@/ui/format";
import { PlusIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { CustomerDrawer } from "./CustomerDrawer";
import { CustomerForm } from "./CustomerForm";
import { useCustomers } from "./hooks";
import { CUSTOMER_KIND_LABEL } from "./labels";

const COLUMNS: Column<CustomerRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (c) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{c.code}</span>,
    sortValue: (c) => c.code,
  },
  { id: "name", header: "Ad", cell: (c) => <span className="block min-w-52 font-semibold">{c.name}</span>, sortValue: (c) => c.name },
  {
    id: "kind",
    header: "Tür",
    cell: (c) => <StatusChip tone={c.kind === "kurumsal" ? "info" : "neutral"}>{CUSTOMER_KIND_LABEL[c.kind]}</StatusChip>,
    sortValue: (c) => CUSTOMER_KIND_LABEL[c.kind],
  },
  {
    id: "place",
    header: "İl / İlçe",
    cell: (c) => (
      <span className="whitespace-nowrap">
        {c.city} <span className="text-fg-muted">/ {c.district}</span>
      </span>
    ),
    sortValue: (c) => `${c.city} ${c.district}`,
  },
  { id: "phone", header: "Telefon", cell: (c) => <span className="tabular whitespace-nowrap">{c.phone}</span>, sortValue: (c) => c.phone, defaultHidden: true },
  { id: "orders", header: "Sipariş sayısı", align: "right", cell: (c) => <span className="tabular">{c.orderCount}</span>, sortValue: (c) => c.orderCount },
  {
    id: "open",
    header: "Açık tutar",
    align: "right",
    cell: (c) => (
      <span className={c.openOrderTotalKurus > 0 ? "tabular font-semibold whitespace-nowrap" : "tabular whitespace-nowrap text-fg-muted"}>{formatMoney(c.openOrderTotalKurus)}</span>
    ),
    sortValue: (c) => c.openOrderTotalKurus,
    csvValue: (c) => c.openOrderTotalKurus / 100,
  },
  {
    id: "last",
    header: "Son sipariş",
    cell: (c) => <span className="tabular whitespace-nowrap text-fg-muted">{c.lastOrderAt ? formatDate(c.lastOrderAt) : "Yok"}</span>,
    sortValue: (c) => c.lastOrderAt?.getTime() ?? 0,
    csvValue: (c) => (c.lastOrderAt ? formatDate(c.lastOrderAt) : ""),
    defaultHidden: true,
  },
];

function asKind(value: string | null): CustomerKind | undefined {
  return (CUSTOMER_KINDS as readonly string[]).includes(value ?? "") ? (value as CustomerKind) : undefined;
}

export function CustomersScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();
  const [creating, setCreating] = useState(false);

  const search = params.get("q") ?? "";
  const kind = asKind(params.get("tur"));
  const openId = params.get("ac");
  const filtered = search !== "" || kind !== undefined;
  const canWrite = user ? can(user, "sales", "write") : false;

  const customers = useCustomers({ search, kind });
  // Özet ve çip sayıları süzgeçten bağımsızdır.
  const all = useCustomers();
  const list = all.data;
  const countOf = (k: CustomerKind) => (list ?? []).filter((c) => c.kind === k).length;
  const withOpen = (list ?? []).filter((c) => c.openOrderTotalKurus > 0).length;
  const openTotal = (list ?? []).reduce((sum, c) => sum + c.openOrderTotalKurus, 0);

  return (
    <Page fill>
      <PageHeader
        title="Müşteriler"
        description="Bireysel ve kurumsal müşteriler, siparişleri ve açık tutarlarıyla."
        actions={
          canWrite ? (
            <Button variant="light" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Yeni müşteri
            </Button>
          ) : null
        }
        stats={
          list ? (
            <>
              <HeroStat index={0} label="Müşteri" value={<CountUp value={list.length} format={String} />} hint={`${countOf("kurumsal")} kurumsal, ${countOf("bireysel")} bireysel`} />
              <HeroStat index={1} label="Açık siparişi olan" value={<CountUp value={withOpen} format={String} />} hint="Onaylı, sevk edilmemiş siparişi var" />
              <HeroStat index={2} label="Açık tutar" value={<CountUp value={openTotal} format={formatMoneyWhole} />} hint="KDV dahil" />
              <HeroStat
                index={3}
                label="Sipariş"
                value={<CountUp value={list.reduce((n, c) => n + c.orderCount, 0)} format={String} />}
                hint="Taslak ve iptal dahil"
                href="/satis/siparisler"
              />
            </>
          ) : null
        }
      />
      <DataTable
        label="Müşteriler"
        rows={customers.data ?? []}
        columns={COLUMNS}
        rowId={(c) => c.id}
        rowLabel={(c) => `${c.code}, ${c.name}`}
        loading={customers.isPending}
        csvFileName="musteriler"
        initialSort={{ id: "name", desc: false }}
        onRowClick={(c) => setParams({ ac: c.id })}
        toolbar={<SearchBox label="Müşteri ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />}
        filters={
          <div role="group" aria-label="Tür" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="tur" pressed={!kind} count={list?.length} onClick={() => setParams({ tur: null })}>
              Tümü
            </FilterChip>
            {CUSTOMER_KINDS.map((k) => (
              <FilterChip key={k} group="tur" pressed={kind === k} count={countOf(k)} onClick={() => setParams({ tur: kind === k ? null : k })}>
                {CUSTOMER_KIND_LABEL[k]}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Aramanızla eşleşen müşteri yok" action={<Button onClick={() => setParams({ q: null, tur: null })}>Süzgeçleri temizle</Button>}>
              Ad, kod ya da il ile arayabilirsiniz.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz müşteri yok">{canWrite ? "İlk müşteriyi eklemek için “Yeni müşteri” düğmesini kullanın." : "Müşterileri satış ekibi ekler."}</EmptyState>
          )
        }
      />
      {openId ? <CustomerDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
      {creating ? <CustomerForm onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}
