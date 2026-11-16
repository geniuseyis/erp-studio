"use client";

import { useState } from "react";
import { MATERIAL_CATEGORIES } from "@/db/schema";
import type { MaterialRow } from "@/domain/inventory/queries";
import type { MaterialCategory } from "@/domain/inventory/types";
import { can } from "@/domain/permissions";
import { formatMoney, formatQty, unitLabel } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip, SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { formatMoneyWhole } from "@/ui/format";
import { PlusIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { CategorySwatch } from "./CategorySwatch";
import { useInventorySummary, useMaterials } from "./hooks";
import { CATEGORY_LABEL, stockScale, stockTone } from "./labels";
import { MaterialDrawer } from "./MaterialDrawer";
import { MaterialForm } from "./MaterialForm";

const COLUMNS: Column<MaterialRow>[] = [
  {
    id: "code",
    header: "Kod",
    cell: (m) => <span className="tabular text-sm font-semibold whitespace-nowrap text-fg-muted">{m.code}</span>,
    sortValue: (m) => m.code,
  },
  {
    id: "name",
    header: "Ad",
    cell: (m) => (
      <span className="flex min-w-64 items-center gap-3">
        <CategorySwatch category={m.category} />
        <span className="grid min-w-0 gap-0.5">
          <span className="font-semibold">{m.name}</span>
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            {CATEGORY_LABEL[m.category]}
            {m.isCritical ? <StatusChip tone="danger" className="h-5 px-2">Kritik</StatusChip> : null}
          </span>
        </span>
      </span>
    ),
    sortValue: (m) => m.name,
  },
  { id: "category", header: "Kategori", cell: (m) => CATEGORY_LABEL[m.category], sortValue: (m) => CATEGORY_LABEL[m.category], defaultHidden: true },
  { id: "onHand", header: "Eldeki", align: "right", cell: (m) => formatQty(m.onHandMilli, m.unit), sortValue: (m) => m.onHandMilli, csvValue: (m) => m.onHandMilli / 1000 },
  {
    id: "reserved",
    header: "Ayrılmış",
    align: "right",
    cell: (m) => formatQty(m.reservedMilli, m.unit),
    sortValue: (m) => m.reservedMilli,
    csvValue: (m) => m.reservedMilli / 1000,
    // Ayırma sipariş ve iş emirleriyle gelir; o zamana dek sütun sıfır kalacağı için başlangıçta gizli.
    defaultHidden: true,
  },
  {
    id: "available",
    header: "Kullanılabilir",
    align: "right",
    cell: (m) => (
      <span className="ml-auto grid w-36 justify-items-end gap-1.5">
        <span className={m.isCritical ? "font-semibold text-danger" : "font-semibold"}>{formatQty(m.availableMilli, m.unit)}</span>
        <Meter
          size="sm"
          value={m.availableMilli}
          max={stockScale(m)}
          mark={m.reorderPointMilli}
          tone={stockTone(m)}
          label={`Kullanılabilir ${formatQty(m.availableMilli, m.unit)}, yeniden sipariş noktası ${formatQty(m.reorderPointMilli, m.unit)}`}
          className="w-full"
        />
      </span>
    ),
    sortValue: (m) => m.availableMilli,
    csvValue: (m) => m.availableMilli / 1000,
  },
  {
    id: "reorder",
    header: "Yeniden sipariş noktası",
    align: "right",
    cell: (m) => <span className="text-fg-muted">{formatQty(m.reorderPointMilli, m.unit)}</span>,
    sortValue: (m) => m.reorderPointMilli,
    csvValue: (m) => m.reorderPointMilli / 1000,
  },
  { id: "unit", header: "Birim", cell: (m) => unitLabel(m.unit), sortValue: (m) => unitLabel(m.unit), defaultHidden: true },
  { id: "avgCost", header: "Ortalama maliyet", align: "right", cell: (m) => formatMoney(m.avgCostKurus), sortValue: (m) => m.avgCostKurus, csvValue: (m) => m.avgCostKurus / 100 },
  {
    id: "value",
    header: "Stok değeri",
    align: "right",
    cell: (m) => <span className="font-semibold">{formatMoney(m.stockValueKurus)}</span>,
    sortValue: (m) => m.stockValueKurus,
    csvValue: (m) => m.stockValueKurus / 100,
  },
  {
    id: "shelf",
    header: "Raf",
    cell: (m) => <span className="tabular inline-flex h-6 items-center rounded-md bg-surface-2 px-2 text-xs font-semibold whitespace-nowrap ring-1 ring-line ring-inset">{m.shelf}</span>,
    sortValue: (m) => m.shelf,
  },
];

function asCategory(value: string | null): MaterialCategory | undefined {
  return (MATERIAL_CATEGORIES as readonly string[]).includes(value ?? "") ? (value as MaterialCategory) : undefined;
}

export function MaterialsScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();
  const [creating, setCreating] = useState(false);

  const search = params.get("q") ?? "";
  const category = asCategory(params.get("kategori"));
  const criticalOnly = params.get("kritik") === "1";
  const openId = params.get("ac");
  const filtered = search !== "" || category !== undefined || criticalOnly;

  const materials = useMaterials({ search, category, criticalOnly });
  // Çiplerdeki sayılar süzgeçten bağımsızdır: bütün katalog.
  const all = useMaterials();
  const summary = useInventorySummary();
  const canWrite = user ? can(user, "inventory", "write") : false;
  const countOf = (c: MaterialCategory) => (all.data ?? []).filter((m) => m.category === c).length;
  const s = summary.data;

  return (
    <Page fill>
      <PageHeader
        title="Malzemeler"
        description="Üretimde kullanılan bütün malzemeler, eldeki ve kullanılabilir stoklarıyla."
        actions={
          canWrite ? (
            <Button variant="light" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Yeni malzeme
            </Button>
          ) : null
        }
        stats={
          s ? (
            <>
              <HeroStat index={0} label="Stok değeri" value={<CountUp value={s.totalValueKurus} format={formatMoneyWhole} />} hint="Ortalama maliyetle" />
              <HeroStat index={1} label="Malzeme" value={<CountUp value={s.materialCount} format={String} />} hint={`${MATERIAL_CATEGORIES.length} kategoride`} />
              <HeroStat
                index={2}
                label="Kritik kalem"
                tone={s.criticalCount > 0 ? "alert" : "default"}
                value={<CountUp value={s.criticalCount} format={String} />}
                hint="Sipariş noktasının altında"
                href="/stok/malzemeler?kritik=1"
              />
              <HeroStat index={3} label="Açık sayım" value={<CountUp value={s.openCounts} format={String} />} hint="Onay bekleyen fişler" href="/stok/sayim" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Malzemeler"
        rows={materials.data ?? []}
        columns={COLUMNS}
        rowId={(m) => m.id}
        rowLabel={(m) => m.code}
        loading={materials.isPending}
        csvFileName="malzemeler"
        initialSort={{ id: "code", desc: false }}
        onRowClick={(m) => setParams({ ac: m.id })}
        toolbar={
          <>
            <SearchBox label="Malzeme ara" value={search} onChange={(q) => setParams({ q })} className="min-w-44 flex-1" />
            <FilterChip
                tone="danger"
                pressed={criticalOnly}
                count={s?.criticalCount}
                onClick={() => setParams({ kritik: criticalOnly ? null : "1" })}
              >
              Kritik
            </FilterChip>
          </>
        }
        filters={
            <div role="group" aria-label="Süzgeçler" className="-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5">
              <FilterChip group="kategori" pressed={!category} count={all.data?.length} onClick={() => setParams({ kategori: null })}>
                Tümü
              </FilterChip>
              {MATERIAL_CATEGORIES.map((c) => (
                <FilterChip key={c} group="kategori" pressed={category === c} count={countOf(c)} onClick={() => setParams({ kategori: category === c ? null : c })}>
                  {CATEGORY_LABEL[c]}
                </FilterChip>
              ))}
            </div>
        }
        empty={
          filtered ? (
            <EmptyState
              title="Aramanızla eşleşen malzeme yok"
              action={<Button onClick={() => setParams({ q: null, kategori: null, kritik: null })}>Süzgeçleri temizle</Button>}
            >
              Yazımı kontrol edin ya da süzgeçleri kaldırın.
            </EmptyState>
          ) : (
            <EmptyState title="Henüz malzeme yok">İlk malzemeyi eklemek için “Yeni malzeme” düğmesini kullanın.</EmptyState>
          )
        }
      />
      {openId ? <MaterialDrawer id={openId} onClose={() => setParams({ ac: null })} /> : null}
      {creating ? <MaterialForm onClose={() => setCreating(false)} /> : null}
    </Page>
  );
}
