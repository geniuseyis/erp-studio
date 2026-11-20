"use client";

import { useState } from "react";
import { MOVEMENT_TYPES } from "@/db/schema";
import type { MovementRow } from "@/domain/inventory/queries";
import type { MovementType } from "@/domain/inventory/types";
import { matchesSearch } from "@/domain/text";
import { formatMoney } from "@/domain/units";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { initials } from "@/shell/LoginScreen";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { SearchBox } from "@/ui/Chip";
import { cn } from "@/ui/cn";
import { type Column, DataTable } from "@/ui/DataTable";
import { EmptyState } from "@/ui/EmptyState";
import { Input, Select } from "@/ui/Field";
import { formatDate, formatSignedQty, formatTime } from "@/ui/format";
import { CloseIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { CategorySwatch } from "./CategorySwatch";
import { useMaterial, useMovements } from "./hooks";
import { MOVEMENT_LABEL } from "./labels";
import { MovementIcon } from "./MovementIcon";

const LIMIT = 500;

const COLUMNS: Column<MovementRow>[] = [
  {
    id: "date",
    header: "Tarih",
    cell: (m) => (
      <span className="tabular grid whitespace-nowrap">
        <span className="font-semibold">{formatDate(m.createdAt)}</span>
        <span className="text-xs text-fg-muted">{formatTime(m.createdAt)}</span>
      </span>
    ),
    sortValue: (m) => m.createdAt.getTime(),
    csvValue: (m) => `${formatDate(m.createdAt)} ${formatTime(m.createdAt)}`,
  },
  {
    id: "material",
    header: "Malzeme",
    cell: (m) => (
      <span className="flex min-w-52 items-center gap-3">
        <CategorySwatch category={m.materialCategory} size="sm" />
        <span className="grid min-w-0">
          <span className="font-semibold">{m.materialName}</span>
          <span className="tabular text-xs text-fg-muted">{m.materialCode}</span>
        </span>
      </span>
    ),
    sortValue: (m) => m.materialName,
    csvValue: (m) => `${m.materialCode} ${m.materialName}`,
  },
  {
    id: "type",
    header: "Tür",
    cell: (m) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <MovementIcon type={m.type} size="sm" />
        <span className="font-medium">{MOVEMENT_LABEL[m.type]}</span>
      </span>
    ),
    sortValue: (m) => MOVEMENT_LABEL[m.type],
    csvValue: (m) => MOVEMENT_LABEL[m.type],
  },
  {
    id: "onHand",
    header: "Eldeki değişimi",
    align: "right",
    cell: (m) =>
      m.deltaOnHandMilli === 0 ? (
        ""
      ) : (
        <span className={cn("font-semibold", m.deltaOnHandMilli > 0 ? "text-ok" : "text-fg")}>{formatSignedQty(m.deltaOnHandMilli, m.unit)}</span>
      ),
    sortValue: (m) => m.deltaOnHandMilli,
    csvValue: (m) => m.deltaOnHandMilli / 1000,
  },
  {
    id: "reserved",
    header: "Ayrılmış değişimi",
    align: "right",
    cell: (m) => (m.deltaReservedMilli === 0 ? "" : formatSignedQty(m.deltaReservedMilli, m.unit)),
    sortValue: (m) => m.deltaReservedMilli,
    csvValue: (m) => m.deltaReservedMilli / 1000,
    // Ayırma, sipariş ve iş emirleriyle gelir; o zamana dek sütun boş kalacağı için başlangıçta gizli.
    defaultHidden: true,
  },
  {
    id: "cost",
    header: "Birim maliyet",
    align: "right",
    cell: (m) => (m.unitCostKurus === null ? <span className="text-fg-muted">–</span> : formatMoney(m.unitCostKurus)),
    sortValue: (m) => m.unitCostKurus ?? -1,
    csvValue: (m) => (m.unitCostKurus === null ? "" : m.unitCostKurus / 100),
  },
  { id: "note", header: "Not", cell: (m) => <span className="block max-w-64 truncate text-fg-muted">{m.note}</span>, sortValue: (m) => m.note },
  {
    id: "user",
    header: "Kullanıcı",
    cell: (m) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-surface-2 text-[0.6875rem] font-bold ring-1 ring-line ring-inset">
          {initials(m.userName)}
        </span>
        {m.userName}
      </span>
    ),
    sortValue: (m) => m.userName,
    csvValue: (m) => m.userName,
  },
];

function asType(value: string | null): MovementType | undefined {
  return (MOVEMENT_TYPES as readonly string[]).includes(value ?? "") ? (value as MovementType) : undefined;
}

/** "2026-11-15" → o İstanbul gününün başlangıcı ya da sonu. Geçersizse undefined. */
function dayBound(value: string | null, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}+03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function MovementsScreen() {
  const [params, setParams] = useUrlState();
  const type = asType(params.get("tur"));
  const fromText = params.get("bas") ?? "";
  const toText = params.get("bit") ?? "";
  const materialId = params.get("malzeme") ?? undefined;
  const search = params.get("q") ?? "";

  const movements = useMovements({ type, materialId, from: dayBound(fromText, false), to: dayBound(toText, true), limit: LIMIT });
  const material = useMaterial(materialId ?? null);
  const rows = (movements.data ?? []).filter((m) => matchesSearch([m.materialCode, m.materialName, m.note, m.userName], search));
  const filtered = Boolean(type || fromText || toText || materialId || search);
  const clear = () => setParams({ tur: null, bas: null, bit: null, malzeme: null, q: null });

  const countOf = (...types: MovementType[]) => rows.filter((m) => types.includes(m.type)).length;
  // Ekran açıldığı andaki "bir hafta önce"; her çizimde yeniden hesaplanmaz.
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);

  return (
    <Page fill>
      <PageHeader
        title="Stok hareketleri"
        description="Eldeki ve ayrılmış stoğu değiştiren bütün kayıtlar. Stok yalnızca buradaki hareketlerle değişir."
        stats={
          movements.data ? (
            <>
              <HeroStat index={0} label="Listelenen" value={<CountUp value={rows.length} format={String} />} hint={filtered ? "Süzgeçlere göre" : "En yeni kayıtlar"} />
              <HeroStat index={1} label="Giriş" value={<CountUp value={countOf("receipt")} format={String} />} hint="Tedarikçi teslimatları" />
              <HeroStat index={2} label="Çıkış" value={<CountUp value={countOf("issue", "consume")} format={String} />} hint="Atölyeye ve üretime" />
              <HeroStat
                index={3}
                label="Son 7 gün"
                value={<CountUp value={rows.filter((m) => m.createdAt.getTime() >= weekAgo).length} format={String} />}
                hint="Bu hafta yazılan hareket"
              />
            </>
          ) : null
        }
      />
      <DataTable
        label="Stok hareketleri"
        rows={rows}
        columns={COLUMNS}
        rowId={(m) => m.id}
        loading={movements.isPending}
        csvFileName="stok-hareketleri"
        toolbar={<SearchBox label="Malzeme, not ya da kullanıcı ara" value={search} onChange={(q) => setParams({ q })} className="max-w-80 min-w-44 flex-1" />}
        filters={
          <div className="grid w-full min-w-0 gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Tür" wrapperClassName="w-44" value={type ?? ""} onChange={(e) => setParams({ tur: e.target.value })}>
                <option value="">Tümü</option>
                {MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MOVEMENT_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Input label="Başlangıç" type="date" wrapperClassName="w-40" value={fromText} onChange={(e) => setParams({ bas: e.target.value })} />
              <Input label="Bitiş" type="date" wrapperClassName="w-40" value={toText} onChange={(e) => setParams({ bit: e.target.value })} />
            </div>
            {(materialId && material.data) || filtered || (movements.data && movements.data.length >= LIMIT) ? (
              <div className="flex flex-wrap items-center gap-2">
                {materialId && material.data ? (
                  <span className="inline-flex h-8 items-center gap-2 rounded-full bg-accent pr-1 pl-3 text-sm text-accent-fg">
                    <span className="opacity-80">Malzeme:</span>
                    <span className="font-semibold">{material.data.code}</span>
                    <button
                      type="button"
                      aria-label="Malzeme süzgecini kaldır"
                      className="grid size-6 place-items-center rounded-full hover:bg-black/15"
                      onClick={() => setParams({ malzeme: null })}
                    >
                      <CloseIcon size={13} />
                    </button>
                  </span>
                ) : null}
                {filtered ? (
                  <Button size="sm" variant="ghost" onClick={clear}>
                    Süzgeçleri temizle
                  </Button>
                ) : null}
                {movements.data && movements.data.length >= LIMIT ? (
                  <span className="text-sm text-fg-muted">En yeni {LIMIT} hareket gösteriliyor. Daraltmak için tarih aralığı seçin.</span>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        empty={
          filtered ? (
            <EmptyState title="Bu süzgeçlerle eşleşen hareket yok" action={<Button onClick={clear}>Süzgeçleri temizle</Button>} />
          ) : (
            <EmptyState title="Henüz stok hareketi yok">Stok girişi ya da çıkışı yapıldığında burada görünür.</EmptyState>
          )
        }
      />
    </Page>
  );
}
