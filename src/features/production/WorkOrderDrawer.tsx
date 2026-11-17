"use client";

import Link from "next/link";
import { type FormEvent, type MouseEvent, useState } from "react";
import { listWorkOrderHistory } from "@/domain/audit-queries";
import { can } from "@/domain/permissions";
import { istanbulDayStart } from "@/domain/production/calendar";
import type { WorkOrderDetail, WorkOrderRow } from "@/domain/production/queries";
import type { WorkOrderStatus } from "@/domain/production/types";
import { formatNumber, formatQty } from "@/domain/units";
import { dueFromInput, formatDue, formatShortage } from "@/features/sales/labels";
import { useSession } from "@/shell/session";
import { useHistory } from "@/shell/useHistory";
import { useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { Drawer } from "@/ui/Drawer";
import { DetailItem, DrawerBadge } from "@/ui/DrawerParts";
import { Input } from "@/ui/Field";
import { formatDateTime } from "@/ui/format";
import { HistoryList } from "@/ui/HistoryList";
import { AlertIcon, ArrowRightIcon, CheckIcon, ClockIcon, RefreshIcon, SawIcon } from "@/ui/icons";
import { Meter } from "@/ui/Meter";
import { Skeleton } from "@/ui/Skeleton";
import { StatusChip, type Tone } from "@/ui/StatusChip";
import { useToast } from "@/ui/Toast";
import { useFinishStep, usePlanWorkOrder, useRetryMaterials, useStartStep, useWorkOrder } from "./hooks";
import { formatMinutes, materialStateLabel, nextWorkdayInput, planText, stepControls, stepText, todayInput, WO_STATUS_LABEL, WO_STATUS_TONE } from "./labels";

export function WorkOrderStatusChips({ status }: { status: WorkOrderStatus }) {
  return <StatusChip tone={WO_STATUS_TONE[status]}>{WO_STATUS_LABEL[status]}</StatusChip>;
}

/** Malzeme sütunu: planlıyken ayrıldı (ok) ya da bekliyor (uyarı) çipi; başladıysa düz metin. */
export function MaterialState({ workOrder: w }: { workOrder: Pick<WorkOrderRow, "status" | "materialsReserved"> }) {
  const label = materialStateLabel(w);
  if (w.status !== "planned") return <span className="text-sm text-fg-muted">{label || "—"}</span>;
  return <StatusChip tone={w.materialsReserved ? "ok" : "warn"}>{label}</StatusChip>;
}

type Kind = "plan" | "retry" | "start" | "finish";

/** İş emri ayrıntısı: adım çizelgesi, malzemeler, eksikler; yetkiye göre planlama, yeniden deneme ve adım başlatma/bitirme. */
export function WorkOrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const query = useWorkOrder(id);
  const history = useHistory("work_order", id, listWorkOrderHistory);
  const plan = usePlanWorkOrder();
  const retry = useRetryMaterials();
  const start = useStartStep();
  const finish = useFinishStep();
  const { busy, run: guarded } = useGuardedRun<Kind>();
  const ask = useConfirm();
  const [day, setDay] = useState(() => nextWorkdayInput(new Date()));
  const [dayError, setDayError] = useState<string | null>(null);
  const w = query.data;

  const canPlan = user ? can(user, "planning", "write") : false;
  const canRetry = user ? can(user, "planning", "execute") : false;
  const canFloor = user ? can(user, "shopfloor", "execute") : false;
  const isPlanned = w?.status === "planned";
  const waitingMaterial = isPlanned && !w.materialsReserved;
  const controls = w ? stepControls(w) : null;
  // Ekranda görünen adım; servis başka tabletin ilerlettiği adımı bu sırayla yakalar.
  const nextSeq = w?.steps.find((s) => s.startedAt === null)?.seq;
  const runningSeq = w?.steps.find((s) => s.startedAt !== null && s.finishedAt === null)?.seq;

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
    const replan = w.steps.some((s) => s.plannedDay !== null);
    void ask.confirm({
      title: "İş emri planlansın mı?",
      body: `${planText(w.code, startDay, w.steps.length)}${replan ? " Önceki plan günlerinin yerine yazılır." : ""}`,
      confirmLabel: "Planla",
      action: () =>
        guarded("plan", async () => {
          const result = await plan.mutateAsync({ workOrderId: w.id, start: startDay });
          toast.success(`${w.code} planlandı: ${result.plannedStart ? formatDue(result.plannedStart) : day} başlangıç`);
        }),
    });
  }

  // Önce onay; çift tıklama ve yenileme bitmeden gelen ikinci istek ortak kancada yok sayılır (Adımı bitir → Sıradaki adımı başlat).
  const onRetry = (e: MouseEvent) =>
    w &&
    e.detail <= 1 &&
    void ask.confirm({
      title: "Malzeme yeniden denensin mi?",
      body: `${w.code} için malzeme yeniden ayrılmaya çalışılacak. Yeterse stok bu iş emrine ayrılır; yetmezse hiçbir şey değişmez.`,
      confirmLabel: "Yeniden dene",
      action: () =>
        guarded("retry", async () => {
          const result = await retry.mutateAsync(w.id);
          if (result.shortages.length > 0) toast.error(`${w.code}: malzeme hâlâ eksik`);
          else toast.success(`${w.code}: malzemeler ayrıldı`);
        }),
    });

  const stepInfo = (seq: number, station: string, kind: "start" | "finish") =>
    w ? stepText({ code: w.code, station, seq: w.steps.findIndex((s) => s.seq === seq) + 1, totalSteps: w.steps.length, qtyMilli: w.qtyMilli, kind }) : "";

  const onStart = (e: MouseEvent) =>
    w &&
    controls?.start &&
    nextSeq !== undefined &&
    e.detail <= 1 &&
    void ask.confirm({
      title: "Adım başlatılsın mı?",
      body: stepInfo(nextSeq, controls.start, "start"),
      confirmLabel: "Başlat",
      action: () =>
        guarded("start", async () => {
          await start.mutateAsync({ workOrderId: w.id, seq: nextSeq });
          toast.success(`${w.code} ${controls.start} başladı`);
        }),
    });

  const onFinish = (e: MouseEvent) =>
    w &&
    controls?.finish &&
    runningSeq !== undefined &&
    e.detail <= 1 &&
    void ask.confirm({
      title: "Adım bitirilsin mi?",
      body: stepInfo(runningSeq, controls.finish, "finish"),
      confirmLabel: "Bitir",
      action: () =>
        guarded("finish", async () => {
          const result = await finish.mutateAsync({ workOrderId: w.id, seq: runningSeq });
          toast.success(result.completed ? `${w.code} tamamlandı` : `${w.code} ${controls.finish} bitti`);
        }),
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
          <DrawerBadge tone={waitingMaterial ? "warn" : WO_STATUS_TONE[w.status]}>
            <SawIcon size={22} />
          </DrawerBadge>
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
            <DetailItem label="Ürün" wide>
              <Link href={`/uretim/urunler?ac=${w.productId}`} className="group inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline">
                {w.productName}
                <ArrowRightIcon size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <span className="tabular block text-sm font-normal text-fg-muted">{w.productCode}</span>
            </DetailItem>
            <DetailItem label="Adet">{formatNumber(w.qtyMilli / 1000)}</DetailItem>
            <DetailItem label="Sipariş">
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
            </DetailItem>
            <DetailItem label="Planlanan başlangıç">{w.plannedStart ? formatDue(w.plannedStart) : "Planlanmadı"}</DetailItem>
            <DetailItem label="Şu anki istasyon">{w.currentStation ?? "—"}</DetailItem>
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
          <HistoryList {...history} />
          {ask.element}
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
