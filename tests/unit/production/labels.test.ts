import { expect, test } from "vitest";
import { WORK_ORDER_STATUSES } from "@/db/schema";
import type { WorkOrderDetail } from "@/domain/production/queries";
import { dayInput, formatMinutes, materialStateLabel, nextWorkdayInput, stepControls, todayInput, unitNeedMilli, WO_STATUS_LABEL, WO_STATUS_TONE } from "@/features/production/labels";

test("iş emri durumlarının Türkçe adları ve renkleri", () => {
  for (const s of WORK_ORDER_STATUSES) expect(WO_STATUS_LABEL[s], s).toBeTruthy();
  expect(WO_STATUS_TONE).toEqual({ planned: "info", in_progress: "warn", completed: "ok", cancelled: "danger" });
});

test("malzeme durumu: planlıyken ayrıldı ya da bekliyor, başladıysa tüketildi", () => {
  expect(materialStateLabel({ status: "planned", materialsReserved: true })).toBe("Ayrıldı");
  expect(materialStateLabel({ status: "planned", materialsReserved: false })).toBe("Malzeme bekliyor");
  expect(materialStateLabel({ status: "in_progress", materialsReserved: true })).toBe("Tüketildi");
  expect(materialStateLabel({ status: "completed", materialsReserved: true })).toBe("Tüketildi");
  expect(materialStateLabel({ status: "cancelled", materialsReserved: true })).toBe("");
});

test("planlama tarihinin varsayılanı İstanbul'a göre bir sonraki iş günü", () => {
  // Pazartesi 10:00 İstanbul → salı.
  expect(nextWorkdayInput(new Date("2026-11-16T07:00:00Z"))).toBe("2026-11-17");
  // Cuma → pazartesi.
  expect(nextWorkdayInput(new Date("2026-11-20T07:00:00Z"))).toBe("2026-11-23");
  // Pazartesi 23:30 UTC, İstanbul'da salı 02:30 → çarşamba.
  expect(nextWorkdayInput(new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-18");
  // Cumartesi → pazartesiden bir iş günü sonrası.
  expect(nextWorkdayInput(new Date("2026-11-21T07:00:00Z"))).toBe("2026-11-24");
  expect(todayInput(new Date("2026-11-16T22:30:00Z"))).toBe("2026-11-17");
  expect(dayInput(new Date("2026-11-16T21:00:00Z"))).toBe("2026-11-17");
});

test("dakika tr-TR biçiminde", () => {
  expect(formatMinutes(45)).toBe("45 dk");
  expect(formatMinutes(1240)).toBe("1.240 dk");
});

test("bir adet için reçete ihtiyacı fireyle ve birim adımına yukarı yuvarlanır", () => {
  expect(unitNeedMilli({ qtyMilli: 782, scrapPermille: 0, unit: "plaka" })).toBe(1000);
  expect(unitNeedMilli({ qtyMilli: 4000, scrapPermille: 50, unit: "adet" })).toBe(5000);
  expect(unitNeedMilli({ qtyMilli: 240, scrapPermille: 100, unit: "L" })).toBe(300);
});

type Step = WorkOrderDetail["steps"][number];
const step = (seq: number, name: string, state: "waiting" | "running" | "done"): Step => ({
  seq,
  stationCode: name.slice(0, 3).toUpperCase(),
  stationName: name,
  minutes: 10,
  plannedDay: null,
  startedAt: state === "waiting" ? null : new Date(),
  finishedAt: state === "done" ? new Date() : null,
  startedByName: null,
  finishedByName: null,
});
const wo = (status: WorkOrderDetail["status"], materialsReserved: boolean, steps: Step[]) => ({ status, materialsReserved, steps });

test("sıradaki adım: malzeme ayrılmışsa başlatılır", () => {
  expect(stepControls(wo("planned", true, [step(1, "Kesim", "waiting"), step(2, "Montaj", "waiting")]))).toEqual({
    start: "Kesim",
    finish: null,
    reason: null,
  });
});

test("ilk adımda malzeme ayrılmamışsa düğme yerine gerekçe", () => {
  const c = stepControls(wo("planned", false, [step(1, "Kesim", "waiting")]));
  expect(c.start).toBeNull();
  expect(c.reason).toMatch(/Malzeme ayrılmadı/);
});

test("çalışan adım varsa bitirilir; sonraki adım için gerekçe önceki adımı söyler", () => {
  const c = stepControls(wo("in_progress", true, [step(1, "Kesim", "done"), step(2, "Montaj", "running"), step(3, "Paketleme", "waiting")]));
  expect(c).toEqual({ start: null, finish: "Montaj", reason: "Önce Montaj adımını bitirin." });
  // Son adım çalışıyorsa başlatılacak adım kalmaz; gerekçe yok.
  expect(stepControls(wo("in_progress", true, [step(1, "Kesim", "done"), step(2, "Montaj", "running")]))).toEqual({
    start: null,
    finish: "Montaj",
    reason: null,
  });
  // Önceki bitti: sıradaki başlar; ilk adımdan sonra malzeme durumu önemsizdir.
  expect(stepControls(wo("in_progress", true, [step(1, "Kesim", "done"), step(2, "Montaj", "waiting")])).start).toBe("Montaj");
});

test("planlı ya da üretimde olmayan iş emri ilerletilmez", () => {
  const done = stepControls(wo("completed", true, [step(1, "Kesim", "done")]));
  expect(done.start).toBeNull();
  expect(done.finish).toBeNull();
  expect(done.reason).toMatch(/tamamlandı/);
  const cancelled = stepControls(wo("cancelled", true, [step(1, "Kesim", "waiting")]));
  expect(cancelled.start).toBeNull();
  expect(cancelled.reason).toMatch(/iptal/);
});
