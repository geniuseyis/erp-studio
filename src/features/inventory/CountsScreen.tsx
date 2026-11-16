"use client";

import { type FormEvent, useRef, useState } from "react";
import { MATERIAL_CATEGORIES } from "@/db/schema";
import type { StockCountSummary } from "@/domain/inventory/queries";
import type { MaterialCategory } from "@/domain/inventory/types";
import { can } from "@/domain/permissions";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { initials } from "@/shell/LoginScreen";
import { useSession } from "@/shell/session";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { SearchBox } from "@/ui/Chip";
import { type Column, DataTable } from "@/ui/DataTable";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Textarea } from "@/ui/Field";
import { formatDateTime } from "@/ui/format";
import { ClipboardIcon, PlusIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { CountUp } from "@/ui/motion";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { CategorySwatch } from "./CategorySwatch";
import { CountDetail } from "./CountDetail";
import { useCounts, useCreateCount, useMaterials } from "./hooks";
import { CATEGORY_LABEL, COUNT_STATUS, errorMessage } from "./labels";

const COLUMNS: Column<StockCountSummary>[] = [
  {
    id: "code",
    header: "Fiş",
    cell: (c) => (
      <span className="flex items-center gap-3 whitespace-nowrap">
        <span aria-hidden="true" className="grid size-9 place-items-center rounded-[11px] bg-surface-2 text-fg-muted ring-1 ring-line ring-inset">
          <ClipboardIcon size={17} />
        </span>
        <span className="tabular font-semibold">{c.code}</span>
      </span>
    ),
    sortValue: (c) => c.code,
  },
  { id: "status", header: "Durum", cell: (c) => <StatusChip tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</StatusChip>, sortValue: (c) => COUNT_STATUS[c.status].label },
  { id: "lines", header: "Kalem", align: "right", cell: (c) => c.lineCount, sortValue: (c) => c.lineCount },
  {
    id: "counted",
    header: "Sayılan",
    align: "right",
    cell: (c) => (
      <span className="ml-auto grid w-32 justify-items-end gap-1.5">
        <span className="font-semibold">
          {c.countedCount} / {c.lineCount}
        </span>
        <Meter
          size="sm"
          value={c.countedCount}
          max={Math.max(c.lineCount, 1)}
          tone={c.countedCount === c.lineCount ? "ok" : "info"}
          label={`${c.lineCount} kalemin ${c.countedCount} tanesi sayıldı`}
          className="w-full"
        />
      </span>
    ),
    sortValue: (c) => c.countedCount,
    csvValue: (c) => c.countedCount,
  },
  { id: "note", header: "Not", cell: (c) => <span className="block max-w-72 truncate text-fg-muted">{c.note}</span>, sortValue: (c) => c.note },
  {
    id: "by",
    header: "Açan",
    cell: (c) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-surface-2 text-[0.6875rem] font-bold ring-1 ring-line ring-inset">
          {initials(c.createdByName)}
        </span>
        {c.createdByName}
      </span>
    ),
    sortValue: (c) => c.createdByName,
    csvValue: (c) => c.createdByName,
  },
  {
    id: "date",
    header: "Tarih",
    cell: (c) => <span className="tabular whitespace-nowrap">{formatDateTime(c.createdAt)}</span>,
    sortValue: (c) => c.createdAt.getTime(),
    csvValue: (c) => formatDateTime(c.createdAt),
  },
];

export function CountsScreen() {
  const { user } = useSession();
  const [params, setParams] = useUrlState();
  const [creating, setCreating] = useState(false);
  const counts = useCounts();
  const openId = params.get("fis");
  const canWrite = user ? can(user, "inventory", "write") : false;
  const list = counts.data ?? [];
  const open = list.filter((c) => c.status === "open");
  const waiting = open.reduce((sum, c) => sum + c.lineCount - c.countedCount, 0);

  return (
    <Page fill>
      <PageHeader
        title="Sayım"
        description="Raftaki miktar sayılır, sistemdekiyle karşılaştırılır. Onaylanan sayımın farkları stok hareketi olarak yazılır."
        actions={
          canWrite ? (
            <Button variant="light" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Yeni sayım
            </Button>
          ) : null
        }
        stats={
          counts.data ? (
            <>
              <HeroStat index={0} label="Açık fiş" value={<CountUp value={open.length} format={String} />} hint="Sayımı süren fişler" />
              <HeroStat
                index={1}
                label="Sayılmayı bekleyen"
                tone={waiting > 0 ? "alert" : "default"}
                value={<CountUp value={waiting} format={String} />}
                hint="Açık fişlerdeki kalem"
              />
              <HeroStat index={2} label="Onaylanan" value={<CountUp value={list.filter((c) => c.status === "approved").length} format={String} />} hint="Farkları stoğa yazıldı" />
              <HeroStat index={3} label="Toplam fiş" value={<CountUp value={list.length} format={String} />} hint="İptaller dahil" />
            </>
          ) : null
        }
      />
      <DataTable
        label="Sayım fişleri"
        rows={counts.data ?? []}
        columns={COLUMNS}
        rowId={(c) => c.id}
        rowLabel={(c) => c.code}
        loading={counts.isPending}
        onRowClick={(c) => setParams({ fis: c.id })}
        empty={<EmptyState title="Henüz sayım yok">Bir rafı ya da kategoriyi saymak için “Yeni sayım” ile fiş açın.</EmptyState>}
      />
      {openId ? <CountDetail id={openId} onClose={() => setParams({ fis: null })} /> : null}
      {creating ? (
        <NewCountDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setParams({ fis: id });
          }}
        />
      ) : null}
    </Page>
  );
}

function NewCountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const create = useCreateCount();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MaterialCategory | "">("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const materials = useMaterials({ search, category: category || undefined });
  const listed = materials.data ?? [];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (submitting.current || selected.size === 0) return;
    submitting.current = true;
    setBusy(true);
    try {
      const count = await create.mutateAsync({ materialIds: [...selected], note });
      toast.success(`${count.code} açıldı`);
      onCreated(count.id);
    } catch (error) {
      toast.error(errorMessage(error));
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && !busy && onClose()}
      title="Yeni sayım"
      description="Sayılacak malzemeleri seçin. Fiş açıldığı andaki stok miktarı karşılaştırma için kaydedilir."
      footer={
        <>
          <span className="mr-auto self-center text-sm text-fg-muted">{selected.size} malzeme seçildi</span>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="new-count" loading={busy}>
            Sayımı aç
          </Button>
        </>
      }
    >
      <form id="new-count" onSubmit={onSubmit} noValidate className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox label="Malzeme ara" value={search} onChange={setSearch} />
          <select
            aria-label="Kategori"
            value={category}
            onChange={(e) => setCategory(e.target.value as MaterialCategory | "")}
            className="h-9 rounded-full border border-line bg-surface px-3 text-sm"
          >
            <option value="">Bütün kategoriler</option>
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={listed.length === 0} onClick={() => setSelected((prev) => new Set([...prev, ...listed.map((m) => m.id)]))}>
            Listelenenleri seç
          </Button>
          {selected.size > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Seçimi kaldır
            </Button>
          ) : null}
        </div>
        {submitted && selected.size === 0 ? (
          <p role="alert" className="text-sm font-medium text-danger">
            En az bir malzeme seçin
          </p>
        ) : null}
        <ul className="grid max-h-72 overflow-y-auto rounded-2xl border border-line">
          {listed.map((m) => (
            <li key={m.id} className="border-b border-line last:border-b-0">
              <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2 text-sm transition-colors hover:bg-surface-2 has-[:checked]:bg-surface-2">
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="size-4 accent-accent" />
                <CategorySwatch category={m.category} size="sm" />
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{m.name}</span>
                  <span className="tabular text-xs text-fg-muted">{m.code}</span>
                </span>
              </label>
            </li>
          ))}
          {listed.length === 0 && !materials.isPending ? <li className="px-3 py-3 text-sm text-fg-muted">Eşleşen malzeme yok.</li> : null}
        </ul>
        <Textarea label="Not" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ör. ay sonu sayımı, D rafı" />
      </form>
    </Dialog>
  );
}
