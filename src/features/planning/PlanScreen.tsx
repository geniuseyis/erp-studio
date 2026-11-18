"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { istanbulDayStart, shiftWorkdays } from "@/domain/production/calendar";
import { type PlanStep, weekStartOf } from "@/domain/production/schedule";
import { DomainError } from "@/domain/errors";
import { can } from "@/domain/permissions";
import { HeroStat, Page, PageHeader } from "@/shell/AppGuard";
import { useSession } from "@/shell/session";
import { errorMessage, useGuardedRun } from "@/shell/useAction";
import { useConfirm } from "@/shell/useConfirm";
import { useUrlState } from "@/shell/useUrlState";
import { Button } from "@/ui/Button";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "@/ui/icons";
import { CountUp } from "@/ui/motion";
import { Skeleton } from "@/ui/Skeleton";
import { useToast } from "@/ui/Toast";
import { useEdgeFades } from "@/ui/useEdgeFades";
import { useMoveStep, usePreviewMove, useWeekPlan } from "./hooks";
import { announceDay, capacityWarning, dayMonth, loadPercent, loadText, longDay, moveQuestion, parseWeek, weekKey, weekLabel, weekSummary } from "./labels";
import type { DragData } from "./PlanCard";
import { stepKey } from "./PlanCard";
import { type Ghost, PlanGrid } from "./PlanGrid";

/** Klavyeyle tutulan kart: kaynağı ve şu an üzerinde durduğu gün (başka haftada olabilir). */
type Held = DragData & { toDay: Date; fromWeek: Date };

const sameDay = (a: Date, b: Date) => istanbulDayStart(a).getTime() === istanbulDayStart(b).getTime();

/**
 * Kartı odaklar. Onay penceresi kapanırken Radix odağı açan öğeye (ya da main'e) geri verir; kart taşındıysa yeni
 * hücrede yeni bir öğedir. Pencere ekrandan kalkıp iki kare sakin geçince kart bulunur ve odaklanır.
 */
function focusStep(key: string) {
  const started = performance.now();
  let calm = 0;
  const tick = () => {
    calm = document.querySelector('[role="alertdialog"]') ? 0 : calm + 1;
    const el = document.querySelector<HTMLElement>(`[data-step-key="${CSS.escape(key)}"]`);
    if (el && calm >= 2) {
      el.focus();
      return;
    }
    if (performance.now() - started < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Haftalık üretim planı: istasyon × gün ızgarası, hücrede kapasite çubuğu ve adım kartları. Planlama yetkisi olan
 * kartı aynı istasyonda başka güne sürükler ya da klavyeyle taşır; her taşıma önizlenir ve onay ister.
 */
export function PlanScreen() {
  const router = useRouter();
  const { user } = useSession();
  const toast = useToast();
  const [params, setParams] = useUrlState();
  // Ekranın açıldığı an: bugün sütunu ve "bu hafta". Taşımanın kuralları her istekte güncel saatle denetlenir.
  const [now] = useState(() => new Date());
  const thisWeek = weekStartOf(now);
  const weekStart = parseWeek(params.get("hafta"), now);
  const query = useWeekPlan(weekStart);
  const plan = query.data;
  const stale = plan !== undefined && plan.weekStart.getTime() !== weekStart.getTime();
  const canWrite = user ? can(user, "planning", "write") : false;

  const preview = usePreviewMove();
  const move = useMoveStep();
  const ask = useConfirm();
  const { run: guarded } = useGuardedRun<"move">();
  // Tutulan kart hem çizim için durumda hem de tuş dinleyicisi için ref'te: art arda basılan oklar bir sonraki çizimi beklemez.
  const [held, setHeld] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  const hold = (h: Held | null) => {
    heldRef.current = h;
    setHeld(h);
  };
  const [pending, setPending] = useState<Ghost | null>(null);
  // Her bırakışın kendi numarası: sonra gelen bırakışın gölgesini önceki bırakışın sonucu silmez.
  const pendingToken = useRef(0);
  // Duyuru ve sayacı: aynı metin art arda söylenince de değişsin diye görünmez bir boşluk tek/çift sayıya göre eklenir.
  const [message, setMessage] = useState({ text: "", n: 0 });
  const instructionsId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  useEdgeFades(scrollRef);

  const say = useCallback((text: string) => setMessage((m) => ({ text, n: m.n + 1 })), []);
  const goWeek = useCallback(
    (day: Date) => {
      const start = weekStartOf(day);
      setParams({ hafta: start.getTime() === weekStartOf(now).getTime() ? null : weekKey(start) });
    },
    [setParams, now],
  );

  const openOrder = (step: PlanStep) => router.push(`/uretim/is-emirleri?ac=${step.workOrderId}`);

  /** Bırakılan taşıma: önce yazmadan önizlenir; kural ihlalinde bildirim, yoksa onay penceresi ve moveStep. */
  async function requestMove(d: DragData, toDay: Date, keyboard: { fromWeek: Date } | null) {
    const key = stepKey(d.step);
    const label = `${d.step.code} ${d.stationName}: ${longDay(toDay)} gününe taşınacak`;
    const token = ++pendingToken.current;
    setPending({ key, stationId: d.stationId, day: istanbulDayStart(toDay), step: d.step, label });
    const clearPending = () => {
      if (pendingToken.current === token) setPending(null);
    };
    const back = () => {
      if (!keyboard) return;
      if (weekStartOf(toDay).getTime() !== keyboard.fromWeek.getTime()) goWeek(keyboard.fromWeek);
      focusStep(key);
    };
    let result: Awaited<ReturnType<typeof preview>>;
    try {
      result = await preview({ workOrderId: d.step.workOrderId, seq: d.step.seq, toDay });
    } catch (error) {
      clearPending();
      toast.error(errorMessage(error));
      back();
      return;
    }
    if (result.error) {
      clearPending();
      toast.error(errorMessage(new DomainError("VALIDATION", result.error)));
      back();
      return;
    }
    const moved = await ask.confirm({
      title: "Adım taşınsın mı?",
      body: (
        <>
          <p>{moveQuestion(d.step.code, d.stationName, d.day, toDay)}</p>
          {result.overCapacity ? (
            <p className="flex items-start gap-2.5 rounded-2xl bg-danger-bg px-3.5 py-3 text-sm text-danger ring-1 ring-danger/25 ring-inset">
              <AlertIcon size={18} className="mt-px shrink-0" />
              <span>
                <span className="font-semibold">Kapasite aşılıyor.</span> {capacityWarning(d.stationName, toDay, result.loadMinutes, result.capacityMin)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              {d.stationName} {dayMonth(toDay)}: {loadText(result.loadMinutes, result.capacityMin)}
            </p>
          )}
        </>
      ),
      confirmLabel: "Taşı",
      action: () =>
        guarded("move", async () => {
          await move.mutateAsync({ workOrderId: d.step.workOrderId, seq: d.step.seq, toDay });
          toast.success(`${d.step.code} ${d.stationName} ${dayMonth(toDay)} gününe taşındı`);
        }),
    });
    clearPending();
    if (moved) {
      if (keyboard) focusStep(key);
    } else back();
  }

  function pickUp(d: DragData) {
    hold({ ...d, toDay: d.day, fromWeek: weekStartOf(d.day) });
    say(`${d.step.code} ${d.stationName} tutuldu, ${longDay(d.day)} üzerinde. Sol ve sağ okla gün değiştirin, Enter ile bırakın, Esc ile vazgeçin.`);
  }

  function onCardKey(e: KeyboardEvent<HTMLDivElement>, d: DragData) {
    if (held) return;
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      openOrder(d.step);
      return;
    }
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (e.repeat) return;
    // Taşınamayan kart (okuyucu, çalışan, biten ya da kapalı iş emri) düğme gibi davranır: iş emrini açar.
    if (!canWrite || !d.step.movable) {
      openOrder(d.step);
      return;
    }
    if (stale) {
      say(`${d.step.code} ${d.stationName}: hafta yükleniyor, birazdan yeniden deneyin.`);
      return;
    }
    pickUp(d);
  }

  /**
   * Tutmayı bırakır; kart başka haftadaysa görünüm kaynağın haftasına döner. `restoreFocus` yalnızca Esc ve yerinde
   * bırakmada: Tab, tıklama ya da başka bir kısayol (Ctrl+K) odağı kendi gittiği yerde bırakır.
   */
  function cancelHold(h: Held, restoreFocus: boolean) {
    hold(null);
    say(`Taşımadan vazgeçildi; ${h.step.code} ${h.stationName} yerinde kaldı.`);
    if (weekStartOf(h.toDay).getTime() !== h.fromWeek.getTime()) goWeek(h.fromWeek);
    if (restoreFocus) focusStep(stepKey(h.step));
  }

  // Tutulan kart: tuşlar sayfanın neresinde olursa olsun buraya gelir (hafta değişince asıl kart ekrandan kalkar).
  const onHeldKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const h = heldRef.current;
    if (!h) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      const toDay = shiftWorkdays(h.toDay, e.key === "ArrowRight" ? 1 : -1);
      hold({ ...h, toDay });
      if (weekStartOf(toDay).getTime() !== weekStartOf(h.toDay).getTime()) goWeek(toDay);
      say(announceDay(h.step.code, h.stationName, toDay));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      say(`Adım yalnızca kendi istasyonunda (${h.stationName}) gün değiştirir.`);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (sameDay(h.toDay, h.day)) return cancelHold(h, true);
      hold(null);
      void requestMove(h, h.toDay, { fromWeek: h.fromWeek });
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelHold(h, true);
    } else if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
      // Tab ve başka her tuş (Ctrl+K dahil) tutmayı bırakır ve olduğu gibi işlenir; odak geri çekilmez.
      cancelHold(h, false);
    }
  });
  // Başka bir yere tıklamak tutmayı bırakır.
  const onHeldPointer = useEffectEvent(() => {
    if (heldRef.current) cancelHold(heldRef.current, false);
  });
  const holding = held !== null;
  useEffect(() => {
    if (!holding) return;
    const key = (e: globalThis.KeyboardEvent) => onHeldKey(e);
    const pointer = () => onHeldPointer();
    window.addEventListener("keydown", key, { capture: true });
    window.addEventListener("pointerdown", pointer, { capture: true });
    return () => {
      window.removeEventListener("keydown", key, { capture: true });
      window.removeEventListener("pointerdown", pointer, { capture: true });
    };
  }, [holding]);

  // Tutarken odak: kaynak kart ekrandaysa onda, değilse (başka hafta) hedef hücredeki gölge kartta. Gölge hücreden hücreye
  // geçerken yeniden çizilir; kaynağın haftasına dönünce gölge kalkar. Her iki durumda odak body'ye düşmez.
  const heldDay = held ? held.toDay.getTime() : null;
  useEffect(() => {
    const h = heldRef.current;
    if (heldDay === null || !h || stale || !plan) return;
    const source = document.querySelector<HTMLElement>(`[data-step-key="${CSS.escape(stepKey(h.step))}"]`);
    const target = source ?? document.querySelector<HTMLElement>("[data-ghost]");
    if (target && document.activeElement !== target) target.focus();
  }, [heldDay, stale, plan]);

  const ghost: Ghost | null = held
    ? sameDay(held.toDay, held.day)
      ? null
      : {
          key: stepKey(held.step),
          stationId: held.stationId,
          day: istanbulDayStart(held.toDay),
          step: held.step,
          label: `${announceDay(held.step.code, held.stationName, held.toDay)}. Enter ile bırakın, Esc ile vazgeçin.`,
        }
    : pending;

  const summary = plan && !stale ? weekSummary(plan) : null;
  const isThisWeek = weekStart.getTime() === thisWeek.getTime();
  const shift = (weeks: number) => goWeek(new Date(weekStart.getTime() + weeks * 7 * 24 * 60 * 60 * 1000));

  return (
    <Page fill>
      <PageHeader
        title="Haftalık plan"
        description="İstasyonların günlük yükü ve iş emri adımları. Kartı aynı istasyonda başka bir güne taşıyın; her taşıma önce onay ister."
        stats={
          summary ? (
            <>
              <HeroStat
                index={0}
                label="Haftanın yükü"
                value={`%${loadPercent(summary.loadMinutes, summary.capacityMin)}`}
                hint={loadText(summary.loadMinutes, summary.capacityMin)}
              />
              <HeroStat
                index={1}
                label="Kapasiteyi aşan"
                tone={summary.overCells > 0 ? "alert" : "default"}
                value={<CountUp value={summary.overCells} format={String} />}
                hint="istasyon × gün hücresi"
              />
              <HeroStat
                index={2}
                label="Termini geçen"
                tone={summary.lateOrders > 0 ? "alert" : "default"}
                value={<CountUp value={summary.lateOrders} format={String} />}
                hint="bu haftadaki iş emri"
              />
              <HeroStat
                index={3}
                label="Planlanmamış"
                value={<CountUp value={summary.unscheduled} format={String} />}
                hint="açık iş emri · listeye git"
                href="/uretim/is-emirleri?planlanmamis=1"
              />
            </>
          ) : null
        }
      />
      <section aria-labelledby="plan-week" className="flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-card md:min-h-[24rem] md:flex-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="plan-week" className="tabular font-display text-lg leading-tight font-semibold">
              {weekLabel(weekStart)}
              {isThisWeek ? <span className="ml-2 align-middle text-xs font-semibold text-accent">bu hafta</span> : null}
            </h2>
            <p id={instructionsId} className="mt-0.5 text-xs text-fg-muted">
              {canWrite
                ? "Kartı sürükleyin ya da odaklayıp Space ile tutun; sol ve sağ okla gün değiştirin, Enter ile bırakın, Esc ile vazgeçin. Shift+Enter iş emrini açar."
                : "Yalnızca görüntüleme: kartları taşımak planlama yetkisi ister. Kart iş emrini açar."}
            </p>
          </div>
          <div role="group" aria-label="Hafta seçimi" className="flex items-center gap-1.5">
            <Button size="sm" aria-label="Önceki hafta" icon={<ChevronLeftIcon size={15} />} onClick={() => shift(-1)}>
              Önceki
            </Button>
            <Button size="sm" disabled={isThisWeek} onClick={() => goWeek(now)}>
              Bu hafta
            </Button>
            <Button size="sm" aria-label="Sonraki hafta" className="flex-row-reverse" icon={<ChevronRightIcon size={15} />} onClick={() => shift(1)}>
              Sonraki
            </Button>
          </div>
        </div>
        <div
          ref={scrollRef}
          data-plan-scroll
          className="scroll-x plan-scroll relative min-h-0 overflow-auto overscroll-x-contain [--plan-station:7.5rem] sm:[--plan-station:10.5rem] md:flex-1"
        >
          {plan ? (
            <PlanGrid
              plan={plan}
              stale={stale}
              today={now}
              canWrite={canWrite}
              heldKey={held ? stepKey(held.step) : null}
              ghost={ghost}
              instructionsId={instructionsId}
              onDrop={(d, toDay) => void requestMove(d, toDay, null)}
              onOpen={openOrder}
              onCardKey={onCardKey}
            />
          ) : (
            <div aria-busy="true" className="grid gap-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          )}
        </div>
        <Legend />
      </section>
      <div role="status" aria-label="Plan duyurusu" aria-atomic="true" className="sr-only">
        {message.text}
        {message.n % 2 ? "\u00a0" : ""}
      </div>
      {ask.element}
    </Page>
  );
}

/** Izgaranın altındaki açıklama: renkler ve kart durumları metinle. */
function Legend() {
  const item = "inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line bg-surface-2/40 px-4 py-2 text-xs text-fg-muted">
      <span className={item}>
        <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-honey/80 to-brass" />
        Kapasite içinde
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-danger" />
        Kapasite aşıldı
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-1 rounded-full bg-warn" />
        Çalışıyor (taşınamaz)
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-1 rounded-full bg-ok/60" />
        Bitti
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-3 w-3 rounded-[4px] border-2 border-danger" />
        Termin geçiyor
      </span>
    </div>
  );
}
