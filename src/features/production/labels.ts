import { addWorkdays, istanbulDayStart, isWorkday } from "@/domain/production/calendar";
import type { WorkOrderDetail } from "@/domain/production/queries";
import type { WorkOrderStatus } from "@/domain/production/types";
import { formatNumber, roundUpToStep, type Unit } from "@/domain/units";
import type { Tone } from "@/ui/StatusChip";

export const WO_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  planned: "Planlı",
  in_progress: "Üretimde",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const WO_STATUS_TONE: Record<WorkOrderStatus, Tone> = {
  planned: "info",
  in_progress: "warn",
  completed: "ok",
  cancelled: "danger",
};

/** İş emrinin malzeme durumu: planlıyken ayrıldı ya da bekliyor; başladıysa tüketildi; iptalde boş. */
export function materialStateLabel(wo: { status: WorkOrderStatus; materialsReserved: boolean }): string {
  if (wo.status === "cancelled") return "";
  if (wo.status !== "planned") return "Tüketildi";
  return wo.materialsReserved ? "Ayrıldı" : "Malzeme bekliyor";
}

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Bir anın İstanbul günü, tarih kutusu biçiminde: "YYYY-AA-GG". */
export function dayInput(at: Date): string {
  return new Date(istanbulDayStart(at).getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** Bugün (İstanbul), tarih kutusunun en küçük değeri. */
export function todayInput(now: Date): string {
  return dayInput(now);
}

/**
 * Planlama tarihinin varsayılanı: bir sonraki iş günü (İstanbul). İş gününde ertesi iş günü (cuma → pazartesi);
 * hafta sonunda pazartesi (addWorkdays hafta sonundan önce sonraki iş gününe geçer).
 */
export function nextWorkdayInput(now: Date): string {
  return dayInput(isWorkday(now) ? addWorkdays(now, 1) : addWorkdays(now, 0));
}

/** 1240 → "1.240 dk" */
export function formatMinutes(minutes: number): string {
  return `${formatNumber(minutes)} dk`;
}

/** Bir adet için reçete ihtiyacı: miktar × (1000 + fire) / 1000, birim adımına yukarı yuvarlanır (iş emrindeki gibi). */
export function unitNeedMilli(line: { qtyMilli: number; scrapPermille: number; unit: Unit }): number {
  return roundUpToStep(Math.ceil((line.qtyMilli * (1000 + line.scrapPermille)) / 1000), line.unit);
}

type StepControls = {
  /** Başlatılabilecek adımın istasyonu; başlatılamıyorsa null. */
  start: string | null;
  /** Çalışan, bitirilebilecek adımın istasyonu. */
  finish: string | null;
  /** Sıradaki adım başlatılamıyorsa nedeni. Düğmenin yerinde gösterilir. */
  reason: string | null;
};

/**
 * Atölye düğmeleri, iş emrinin durumundan: servisin (startNextStep, finishCurrentStep) koşullarının aynısı.
 * Servis çağrılmadan gerekçe bulunur: planlı ya da üretimde değilse, önceki adım açıksa, ilk adımda malzeme ayrılmamışsa.
 */
export function stepControls(wo: Pick<WorkOrderDetail, "status" | "materialsReserved" | "steps">): StepControls {
  if (wo.status === "completed") return { start: null, finish: null, reason: "İş emri tamamlandı; bütün adımlar bitti." };
  if (wo.status === "cancelled") return { start: null, finish: null, reason: "İş emri iptal edildi; adım başlatılamaz." };

  const running = wo.steps.find((s) => s.startedAt !== null && s.finishedAt === null);
  const next = wo.steps.find((s) => s.startedAt === null);
  if (running) {
    return { start: null, finish: running.stationName, reason: next ? `Önce ${running.stationName} adımını bitirin.` : null };
  }
  if (!next) return { start: null, finish: null, reason: wo.steps.length === 0 ? "Bu iş emrinin rotası yok." : null };
  if (next.seq === wo.steps[0]?.seq && !wo.materialsReserved) {
    return { start: null, finish: null, reason: "Malzeme ayrılmadı: planlama malzemeyi ayırmadan üretim başlamaz." };
  }
  return { start: next.stationName, finish: null, reason: null };
}
