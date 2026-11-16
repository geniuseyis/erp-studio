"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { can } from "@/domain/permissions";
import { istanbulDayStart } from "@/domain/production/calendar";
import type { WorkOrderDetail, WorkOrderRow } from "@/domain/production/queries";
import type { WorkOrderStatus } from "@/domain/production/types";
import { formatNumber, formatQty } from "@/domain/units";
import { dueFromInput, formatDue, formatShortage } from "@/features/sales/labels";
import { useSession } from "@/shell/session";
import { errorMessage } from "@/shell/useAction";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Drawer } from "@/ui/Drawer";
import { Input } from "@/ui/Field";
import { formatDateTime } from "@/ui/format";
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, RefreshIcon, SawIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip, type Tone } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useFinishStep, usePlanWorkOrder, useRetryMaterials, useStartStep, useWorkOrder } from "./hooks";
import { formatMinutes, materialStateLabel, nextWorkdayInput, stepControls, todayInput, WO_STATUS_LABEL, WO_STATUS_TONE } from "./labels";

const BADGE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
};

export function WorkOrderStatusChips({ status }: { status: WorkOrderStatus }) {
  return <StatusChip tone={WO_STATUS_TONE[status]}>{WO_STATUS_LABEL[status]}</StatusChip>;
}

/** Malzeme sütunu: planlıyken ayrıldı (ok) ya da bekliyor (uyarı) çipi; başladıysa düz metin. */
export function MaterialState({ workOrder: w }: { workOrder: Pick<WorkOrderRow, "status" | "materialsReserved"> }) {
  const label = materialStateLabel(w);
  if (w.status !== "planned") return <span className="text-sm text-fg-muted">{label || "—"}</span>;
  return <StatusChip tone={w.materialsReserved ? "ok" : "warn"}>{label}</StatusChip>;
}

type Busy = "plan" | "retry" | "start" | "finish" | null;

/** İş emri ayrıntısı: adım çizelgesi, malzemeler, eksikler; yetkiye göre planlama, yeniden deneme ve adım başlatma/bitirme. */
export function WorkOrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const query = useWorkOrder(id);
  const plan = usePlanWorkOrder();
  const retry = useRetryMaterials();
  const start = useStartStep();
  const finish = useFinishStep();
  const running = useRef(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [day, setDay] = useState(() => nextWorkdayInput(new Date()));
  const [dayError, setDayError] = useState<string | null>(null);
  const w = query.data;

  const canPlan = user ? can(user, "planning", "write") : false;
  const canRetry = user ? can(user, "planning", "execute") : false;
  const canFloor = user ? can(user, "shopfloor", "execute") : false;
  const isPlanned = w?.status === "planned";
  const waitingMaterial = isPlanned && !w.materialsReserved;
  const controls = w ? stepControls(w) : null;

  /** Çift tıklama: ilk istek bitmeden ikincisi başlamaz. */
  async function guarded(kind: Exclude<Busy, null>, work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function onPlan(e: FormEvent) {
    e.preventDefault();
    if (!w) return;
    const startDay = dueFromInput(day);
    if (!startDay) {
      setDayError("Geçerli bir gün seçin");
      return;
    }
    if (startDay.getTime() < istanbulDayStart(new Date()).getTime()) {
      setDayError("Başlangıç geçmiş bir gün olamaz");
      return;
    }
    setDayError(null);
    void guarded("plan", async () => {
      const result = await plan.mutateAsync({ workOrderId: w.id, start: startDay });
      toast.success(`${w.code} planlandı: ${result.plannedStart ? formatDue(result.plannedStart) : day} başlangıç`);
    });
  }

  const onRetry = () =>
    w &&
    void guarded("retry", async () => {
      const result = await retry.mutateAsync(w.id);
      if (result.shortages.length > 0) toast.error(`${w.code}: malzeme hâlâ eksik`);
      else toast.success(`${w.code}: malzemeler ayrıldı`);
    });

  const onStart = () =>
    w &&
    controls?.start &&
    void guarded("start", async () => {
      await start.mutateAsync(w.id);
      toast.success(`${w.code} ${controls.start} başladı`);
    });

  const onFinish = () =>
    w &&
    controls?.finish &&
    void guarded("finish", async () => {
      const result = await finish.mutateAsync(w.id);
      toast.success(result.completed ? `${w.code} tamamlandı` : `${w.code} ${controls.finish} bitti`);
    });

  const showRetry = canRetry && waitingMaterial;
  const showFloor = canFloor && controls && (controls.start || controls.finish || controls.reason);

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={w?.code ?? (query.isPending ? "Yükleniyor" : "İş emri bulunamadı")}
      badge={
        w ? (
          <span aria-hidden="true" className={cn("grid size-11 place-items-center rounded-2xl", BADGE[waitingMaterial ? "warn" : WO_STATUS_TONE[w.status]])}>
            <SawIcon size={22} />
          </span>
        ) : undefined
      }
      subtitle={
        w ? (
          <>
            <WorkOrderStatusChips status={w.status} />
            {waitingMaterial ? <StatusChip tone="warn">Malzeme bekliyor</StatusChip> : null}
            <span className="font-semibold text-hero-fg">{w.productName}</span>
          </>
        ) : undefined
      }
      hero={w ? <Progress workOrder={w} /> : undefined}
      footer={
        w && (showRetry || showFloor) ? (
          <>
            {showRetry ? (
              <Button variant="primary" icon={<RefreshIcon />} loading={busy === "retry"} disabled={busy !== null} onClick={onRetry}>
                Malzemeyi yeniden dene
              </Button>
            ) : null}
            {showFloor && controls.finish ? (
              <Button variant="primary" icon={<CheckIcon />} loading={busy === "finish"} disabled={busy !== null} onClick={onFinish}>
                Adımı bitir
              </Button>
            ) : null}
            {showFloor && controls.start ? (
              <Button variant="primary" icon={<ArrowRightIcon />} loading={busy === "start"} disabled={busy !== null} onClick={onStart}>
                Sıradaki adımı başlat
              </Button>
            ) : null}
            {showFloor && controls.reason ? <p className="flex basis-full items-start gap-2 text-sm text-fg-muted">{controls.reason}</p> : null}
          </>
        ) : undefined
      }
    >
      {w ? (
        <div className="grid gap-6">
          {w.shortages.length > 0 ? <Shortages workOrder={w} /> : null}

          <dl className="grid grid-cols-2 gap-2.5">
            <Item label="Ürün" wide>
              <Link href={`/uretim/urunler?ac=${w.productId}`} className="group inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline">
                {w.productName}
                <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <span className="tabular block text-sm font-normal text-fg-muted">{w.productCode}</span>
            </Item>
            <Item label="Adet">{formatNumber(w.qtyMilli / 1000)}</Item>
            <Item label="Sipariş">
              {w.orderCode ? (
                <Link
                  href={`/satis/siparisler?q=${encodeURIComponent(w.orderCode)}`}
                  className="group tabular inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline"
                >
                  {w.orderCode}
                  <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : (
                "Stok için"
              )}
            </Item>
            <Item label="Planlanan başlangıç">{w.plannedStart ? formatDue(w.plannedStart) : "Planlanmadı"}</Item>
            <Item label="Şu anki istasyon">{w.currentStation ?? "—"}</Item>
          </dl>

          {canPlan && isPlanned ? (
            <form onSubmit={onPlan} noValidate className="grid gap-3 rounded-2xl bg-surface-2/70 p-3.5 ring-1 ring-line ring-inset">
              <div className="flex flex-wrap items-end gap-2.5">
                <Input
                  type="date"
                  label="Başlangıç günü"
                  value={day}
                  min={todayInput(new Date())}
                  onChange={(e) => setDay(e.target.value)}
                  error={dayError}
                  wrapperClassName="min-w-0 flex-1 basis-40"
                />
                <Button type="submit" loading={busy === "plan"} disabled={busy !== null}>
                  Planla
                </Button>
              </div>
              <p className="text-xs text-fg-muted">Adımlar rota sırasıyla, her biri bir sonraki iş gününe yazılır. Hafta sonu seçilirse pazartesiden başlar.</p>
            </form>
          ) : null}

          <Steps workOrder={w} />
          <Materials workOrder={w} />
        </div>
      ) : query.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="w-2/3" />
          <Skeleton />
          <Skeleton className="w-1/2" />
        </div>
      ) : (
        <p className="text-fg-muted">Bu iş emri silinmiş ya da adres hatalı olabilir.</p>
      )}
    </Drawer>
  );
}

function Progress({ workOrder: w }: { workOrder: WorkOrderDetail }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-hero-fg-muted">İlerleme</p>
          <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">
            {w.doneSteps}/{w.totalSteps}
            <span className="ml-1.5 text-lg font-medium text-hero-fg-muted">adım</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-hero-fg-muted">Adet</p>
          <p className="tabular font-display text-xl font-semibold">{formatNumber(w.qtyMilli / 1000)}</p>
        </div>
      </div>
      <Meter
        value={w.doneSteps}
        max={w.totalSteps}
        tone={w.status === "completed" ? "ok" : w.status === "cancelled" ? "neutral" : "warn"}
        label={`${w.totalSteps} adımın ${w.doneSteps} adımı bitti`}
      />
    </div>
  );
}

function Shortages({ workOrder: w }: { workOrder: WorkOrderDetail }) {
  const headingId = `shortages-${w.id}`;
  return (
    <section aria-labelledby={headingId} className="grid gap-2 rounded-2xl bg-warn-bg px-4 py-3.5 text-warn ring-1 ring-warn/25 ring-inset">
      <h3 id={headingId} className="flex items-center gap-2 font-semibold">
        <AlertIcon size={18} />
        Eksikler
      </h3>
      <ul className="grid gap-1 pl-7 text-sm text-fg">
        {w.shortages.map((s) => (
          <li key={s.materialId} className="list-disc break-words">
            {formatShortage(s)}
          </li>
        ))}
      </ul>
      <p className="pl-7 text-sm text-fg-muted">Depo giriş yapınca planlama “Malzemeyi yeniden dene” ile ayırır.</p>
    </section>
  );
}

type StepState = "done" | "running" | "waiting";
const STEP: Record<StepState, { label: string; tone: Tone }> = {
  done: { label: "Bitti", tone: "ok" },
  running: { label: "Çalışıyor", tone: "warn" },
  waiting: { label: "Bekliyor", tone: "neutral" },
};

function Steps({ workOrder: w }: { workOrder: WorkOrderDetail }) {
  const headingId = `steps-${w.id}`;
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-semibold">
        Adımlar
      </h3>
      {w.steps.length === 0 ? (
        <p className="text-fg-muted">Bu iş emrinin rotası yok.</p>
      ) : (
        <ol aria-label="Adımlar" className="relative grid gap-1">
          {/* Zaman çizgisi */}
          <span aria-hidden="true" className="absolute top-5 bottom-5 left-[15px] w-px bg-line" />
          {w.steps.map((s) => {
            const state: StepState = s.finishedAt ? "done" : s.startedAt ? "running" : "waiting";
            return (
              <li key={s.seq} className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "tabular relative grid size-8 place-items-center rounded-full text-sm font-semibold ring-1 ring-inset",
                    state === "done" && "bg-ok-bg text-ok ring-ok/30",
                    state === "running" && "bg-warn-bg text-warn ring-warn/30",
                    state === "waiting" && "bg-surface text-fg-muted ring-line-strong",
                  )}
                >
                  {state === "done" ? <CheckIcon size={16} /> : s.seq}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{s.stationName}</span>
                    <StatusChip tone={STEP[state].tone} className="h-5 px-2">
                      {STEP[state].label}
                    </StatusChip>
                  </span>
                  <span className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-fg-muted">
                    <span>{s.plannedDay ? `Planlanan gün ${formatDue(s.plannedDay)}` : "Gün verilmedi"}</span>
                    <span className="inline-flex items-center gap-1">
                      <ClockIcon size={13} />
                      {formatMinutes(s.minutes)}
                    </span>
                  </span>
                  {s.startedAt ? (
                    <span className="tabular text-sm break-words">
                      Başladı {formatDateTime(s.startedAt)}
                      {s.startedByName ? `, ${s.startedByName}` : ""}
                    </span>
                  ) : null}
                  {s.finishedAt ? (
                    <span className="tabular text-sm break-words">
                      Bitti {formatDateTime(s.finishedAt)}
                      {s.finishedByName ? `, ${s.finishedByName}` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Materials({ workOrder: w }: { workOrder: WorkOrderDetail }) {
  const headingId = `materials-${w.id}`;
  const amount = !w.materialsReserved ? "Gereken" : w.status === "planned" || w.status === "cancelled" ? "Ayrılan" : "Tüketilen";
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-lg font-semibold">
        Malzemeler <span className="tabular text-base font-medium text-fg-muted">({w.materials.length})</span>
      </h3>
      {w.materials.length === 0 ? (
        <p className="text-fg-muted">Bu iş emrinde malzeme yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line ring-inset">
          <table aria-label="Malzemeler" className="w-full border-collapse text-sm">
            <thead className="bg-surface-2/70 text-left text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Malzeme
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {amount}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Kullanılabilir
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {w.materials.map((m) => {
                const short = !w.materialsReserved && m.availableMilli < m.neededMilli;
                return (
                  <tr key={m.materialId} className="border-t border-line align-top">
                    <td className="px-3 py-2.5">
                      <span className="grid min-w-36">
                        <span className="font-semibold break-words">{m.name}</span>
                        <span className="text-xs text-fg-muted">{m.code}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{formatQty(m.neededMilli, m.unit)}</td>
                    <td className={cn("px-3 py-2.5 text-right whitespace-nowrap", short && "font-semibold text-danger")}>
                      {formatQty(m.availableMilli, m.unit)}
                      {short ? <span className="block text-xs font-medium">yetmiyor</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Item({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5 rounded-2xl bg-surface-2/70 px-3.5 py-3 ring-1 ring-line ring-inset", wide && "col-span-2")}>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="min-w-0 font-semibold">{children}</dd>
    </div>
  );
}
