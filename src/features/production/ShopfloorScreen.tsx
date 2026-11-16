"use client";

import { type MouseEvent, type ReactNode, useState } from "react";
import { can } from "@/domain/permissions";
import type { QueueItem } from "@/domain/production/queries";
import { formatNumber } from "@/domain/units";
import { formatDue } from "@/features/sales/labels";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { useGuardedRun } from "@/shell/useAction";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { FilterChip } from "@/ui/Chip";
import { EmptyState } from "@/ui/EmptyState";
import { ArrowRightIcon, CheckIcon, SawIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useFinishStep, useStartStep, useStationQueues, useStations } from "./hooks";
import { formatMinutes } from "./labels";

const STORAGE_KEY = "erp-studio:atolye-istasyon";

/** Atölye tabletinde son seçilen istasyon. Depolama kapalı ya da dolu olabilir; okuma ve yazma hata vermez. */
function readStoredStation(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeStation(code: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Depolama kullanılamıyorsa seçim yalnızca adreste kalır.
  }
}

/**
 * Atölye istasyon ekranı (tablet): istasyon seçimi ve kuyruk kartları, büyük Başla ve Bitti düğmeleriyle.
 * Seçim önceliği: adresteki `?istasyon=`, atölye kullanıcısında son seçim, ilk istasyon.
 */
export function ShopfloorScreen() {
  const { user } = useSession();
  const toast = useToast();
  const [params, setParams] = useUrlState();
  const remembers = user?.departmentCode === "atolye";
  const [stored, setStored] = useState(() => (remembers ? readStoredStation() : null));
  const stations = useStations();
  const list = stations.data ?? [];
  const codes = list.map((s) => s.code);
  const queues = useStationQueues(codes);
  const start = useStartStep();
  const finish = useFinishStep();
  const { busy, run } = useGuardedRun<string>();

  const fromUrl = params.get("istasyon");
  const selected = [fromUrl, stored].find((c) => c && codes.includes(c)) ?? codes[0] ?? null;
  const station = list.find((s) => s.code === selected);
  const queue = (selected && queues.data?.get(selected)) || [];
  const canExecute = user ? can(user, "shopfloor", "execute") : false;
  const waiting = queue.filter((q) => q.state === "waiting");
  const runningItems = queue.filter((q) => q.state === "running");
  const minutes = queue.reduce((n, q) => n + q.minutes, 0);

  function choose(code: string) {
    setParams({ istasyon: code });
    if (remembers) {
      storeStation(code);
      setStored(code);
    }
  }

  // Aynı düğme Başla'dan Bitti'ye döner: çift dokunma ve yenileme bitmeden gelen ikinci dokunma ortak kancada yok sayılır.
  function act(item: QueueItem, event: MouseEvent) {
    if (!station) return;
    void run(
      item.workOrderId,
      async () => {
        if (item.state === "waiting") {
          await start.mutateAsync(item.workOrderId);
          toast.success(`${item.code} ${station.name} başladı`);
        } else {
          const result = await finish.mutateAsync(item.workOrderId);
          toast.success(result.completed ? `${item.code} tamamlandı` : `${item.code} ${station.name} bitti`);
        }
      },
      event,
    );
  }

  return (
    <Page>
      <PageHeader
        title="Atölye"
        description={station ? `${station.name} istasyonunun kuyruğu: sıradaki işler ve çalışanlar.` : "İstasyon kuyrukları."}
        stats={
          station && queues.data ? (
            <>
              <HeroStat index={0} label="Çalışıyor" value={<CountUp value={runningItems.length} format={String} />} hint="Başlamış adım" />
              <HeroStat index={1} label="Sırada" value={<CountUp value={waiting.length} format={String} />} hint="Başlamaya hazır" />
              <HeroStat index={2} label="Kuyruk süresi" value={<CountUp value={minutes} format={formatMinutes} />} hint="Kuyruktaki adımların toplamı" />
              <HeroStat index={3} label="Günlük kapasite" value={formatMinutes(station.dailyCapacityMin)} hint={station.name} />
            </>
          ) : null
        }
      />

      <section aria-label="İstasyon kuyruğu" className="grid gap-5 rounded-[22px] border border-line bg-surface p-4 shadow-card sm:p-5">
        <div role="group" aria-label="İstasyon" className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-0.5 sm:flex-wrap">
          {list.map((s) => (
            <FilterChip key={s.code} group="istasyon" size="lg" pressed={s.code === selected} count={queues.data?.get(s.code)?.length} onClick={() => choose(s.code)}>
              {s.name}
            </FilterChip>
          ))}
        </div>

        {queues.isPending || stations.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : queue.length === 0 ? (
          <EmptyState title="Bu istasyonda bekleyen iş yok" icon={<SawIcon size={24} />}>
            Önceki istasyonda biten ya da planlamanın malzemesini ayırdığı işler burada görünür.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {queue.map((item) => (
              <li key={item.workOrderId} className="min-w-0">
                <QueueCard item={item} canExecute={canExecute} busy={busy} onAct={(e) => act(item, e)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

function QueueCard({ item, canExecute, busy, onAct }: { item: QueueItem; canExecute: boolean; busy: string | null; onAct: (event: MouseEvent) => void }) {
  const headingId = `queue-${item.workOrderId}`;
  const isRunning = item.state === "running";
  return (
    <article
      aria-labelledby={headingId}
      className="grid h-full content-between gap-4 rounded-2xl bg-surface-2/70 p-4 ring-1 ring-line ring-inset animate-[rise-in_400ms_var(--ease-spring)_both]"
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="tabular font-display text-xl font-semibold">
            {item.code}
          </h2>
          <StatusChip tone={isRunning ? "warn" : "info"}>{isRunning ? "Çalışıyor" : "Sırada"}</StatusChip>
        </div>
        <p className="text-lg leading-snug font-semibold break-words">
          {item.productName}
          <span className="tabular ml-2 font-medium text-fg-muted">× {formatNumber(item.qtyMilli / 1000)} adet</span>
        </p>
        <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Fact label="Adım">
            {item.seq}/{item.totalSteps}
          </Fact>
          <Fact label="Süre">{formatMinutes(item.minutes)}</Fact>
          <Fact label="Planlanan gün">{item.plannedDay ? formatDue(item.plannedDay) : "Verilmedi"}</Fact>
          <Fact label="Sipariş">{item.orderCode ? `${item.orderCode}${item.dueAt ? ` · termin ${formatDue(item.dueAt)}` : ""}` : "Stok için"}</Fact>
        </dl>
      </div>
      {canExecute ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          icon={isRunning ? <CheckIcon /> : <ArrowRightIcon />}
          loading={busy === item.workOrderId}
          disabled={busy !== null}
          onClick={onAct}
        >
          {isRunning ? "Bitti" : "Başla"}
        </Button>
      ) : null}
    </article>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="font-semibold break-words">{children}</dd>
    </div>
  );
}
