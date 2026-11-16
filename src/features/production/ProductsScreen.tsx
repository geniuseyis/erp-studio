"use client";

import { PRODUCT_FINISHES } from "@/db/schema";
import type { ProductRow } from "@/domain/production/queries";
import type { ProductFinish } from "@/domain/production/types";
import { formatMoney, formatNumber } from "@/domain/units";
import { FINISH_LABEL } from "@/features/sales/labels";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatMoneyWhole } from "@/ui/format";
import { CountUp } from "@/ui/motion";
import { useProducts } from "./hooks";
import { FinishChip, ProductDrawer } from "./ProductDrawer";

const adet = (milli: number) => formatNumber(milli / 1000);

const COLUMNS: Column<ProductRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (p) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{p.code}</span>,
    sortValue: (p) => p.code,
  },
  {
    id: "name",
    header: "Ad",
    cell: (p) => (
      <span className="grid min-w-52 gap-0.5">
        <span className="font-semibold">{p.name}</span>
        <span className="text-xs text-fg-muted">{p.category}</span>
      </span>
    ),
    sortValue: (p) => p.name,
  },
  {
    id: "collection",
    header: "Koleksiyon",
    cell: (p) => (
      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-line ring-inset">
        {p.collection}
      </span>
    ),
    sortValue: (p) => p.collection,
  },
  { id: "finish", header: "Kaplama", cell: (p) => <FinishChip finish={p.finish} />, sortValue: (p) => FINISH_LABEL[p.finish], csvValue: (p) => FINISH_LABEL[p.finish] },
  {
    id: "price",
    header: "Fiyat (KDV hariç)",
    align: "right",
    cell: (p) => <span className="tabular font-semibold whitespace-nowrap">{formatMoney(p.priceKurus)}</span>,
    sortValue: (p) => p.priceKurus,
    csvValue: (p) => p.priceKurus / 100,
  },
  {
    id: "cost",
    header: "Birim maliyet",
    align: "right",
    cell: (p) => <span className="tabular whitespace-nowrap text-fg-muted">{formatMoney(p.unitCostKurus)}</span>,
    sortValue: (p) => p.unitCostKurus,
    csvValue: (p) => p.unitCostKurus / 100,
  },
  {
    id: "stock",
    header: "Mamul eldeki / ayrılmış",
    align: "right",
    cell: (p) => (
      <span className="tabular whitespace-nowrap">
        <span className="font-semibold">{adet(p.onHandMilli)}</span>
        <span className="text-fg-muted"> / {adet(p.reservedMilli)}</span>
      </span>
    ),
    sortValue: (p) => p.onHandMilli,
    csvValue: (p) => `${p.onHandMilli / 1000} / ${p.reservedMilli / 1000}`,
  },
];

function asFinish(value: string | null): ProductFinish | undefined {
  return (PRODUCT_FINISHES as readonly string[]).includes(value ?? "") ? (value as ProductFinish) : undefined;
}

export function ProductsScreen() {
  const [params, setParams] = useUrlState();
  const search = params.get("q") ?? "";
  const collection = params.get("koleksiyon") || undefined;
  const finish = asFinish(params.get("kaplama"));
  const openId = params.get("ac");
  const filtered = search !== "" || collection !== undefined || finish !== undefined;

  const products = useProducts({ search, collection, finish });
  // Çip sayıları ve özet süzgeçten bağımsızdır: bütün katalog.
  const all = useProducts();
  const catalog = all.data ?? [];
  const collections = [...new Set(catalog.map((p) => p.collection))].sort((a, b) => a.localeCompare(b, "tr"));
  const onHand = catalog.reduce((n, p) => n + p.onHandMilli, 0);
  const reserved = catalog.reduce((n, p) => n + p.reservedMilli, 0);
  const stockValue = catalog.reduce((n, p) => n + Math.round((p.onHandMilli / 1000) * p.unitCostKurus), 0);

  return (
    <Page fill>
      <PageHeader
        title="Ürünler"
        description="Mamul kataloğu: fiyatı, maliyeti, reçetesi ve atölyedeki rotasıyla."
        stats={
          all.data ? (
            <>
              <HeroStat index={0} label="Ürün" value={<CountUp value={catalog.length} format={String} />} hint={`${collections.length} koleksiyonda`} />
              <HeroStat index={1} label="Mamul stoğu" value={<CountUp value={onHand / 1000} format={(n) => formatNumber(Math.round(n))} />} hint="Adet, depoda" />
              <HeroStat index={2} label="Ayrılmış mamul" value={<CountUp value={reserved / 1000} format={(n) => formatNumber(Math.round(n))} />} hint="Siparişlere ayrılan adet" />
              <HeroStat index={3} label="Mamul değeri" value={<CountUp value={stockValue} format={formatMoneyWhole} />} hint="Birim maliyetle" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Ürünler"
        rows={products.data ?? []}
        columns={COLUMNS}
        rowId={(p) => p.id}
        rowLabel={(p) => `${p.code}, ${p.name}`}
        loading={products.isPending}
        csvFileName="urunler"
        initialSort={{ id: "code", desc: false }}
        onRowClick={(p) => setParams({ ac: p.id })}
        toolbar={
          <>
            <SearchBox label="Ürün ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />
            <div role="group" aria-label="Kaplama" className="flex gap-1.5">
              {PRODUCT_FINISHES.map((f) => (
                <FilterChip key={f} pressed={finish === f} count={catalog.filter((p) => p.finish === f).length} onClick={() => setParams({ kaplama: finish === f ? null : f })}>
                  {FINISH_LABEL[f]}
                </FilterChip>
              ))}
            </div>
          </>
        }
        filters={
          <div role="group" aria-label="Koleksiyon" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
            <FilterChip group="koleksiyon" pressed={!collection} count={catalog.length} onClick={() => setParams({ koleksiyon: null })}>
              Tümü
            </FilterChip>
            {collections.map((c) => (
              <FilterChip
                key={c}
                group="koleksiyon"
                pressed={collection === c}
                count={catalog.filter((p) => p.collection === c).length}
                onClick={() => setParams({ koleksiyon: collection === c ? null : c })}
              >
                {c}
              </FilterChip>
            ))}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Süzgeçle eşleşen ürün yok" action={<Button onClick={() => setParams({ q: null, koleksiyon: null, kaplama: null })}>Süzgeçleri temizle</Button>}>
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz ürün yok">Katalog boş.</EmptyState>
          )
        }
      />
      {openId ? <ProductDrawer key={openId} id={openId} onClose={() => setParams({ ac: null })} /> : null}
    </Page>
  );
}
