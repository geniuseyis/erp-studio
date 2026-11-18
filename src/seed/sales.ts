// Satış ve üretim örnek verisi: istasyonlar, mamul kataloğu (reçete ve rota), müşteriler, açılış mamul
// stoğu ve son haftaların sipariş ve iş emri geçmişi. Katalog tablolara toplu yazılır; stok ve sipariş ile
// iş emrinin her durum değişikliği gerçek servislerle, işi yapan departmanın demo hesabıyla yapılır. Böylece
// malzeme ve mamul defterleri kendiliğinden tutarlıdır (tests/unit/seed/sales.test.ts denetler).
//
// Geçmiş, zaman sırasıyla işleyen bir olay kuyruğudur: her olay kendi anında bir servisi çağırır ve sonraki
// olayları (planlama, istasyon adımları, sevk) kuyruğa ekler. Her an ayrıdır, mesai içindedir (08:00–18:00,
// iş günü) ve `now`'dan öncedir.
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bomLines, materials, products, routings, salesOrderLines, stations, stockMovements, users, workOrders, workOrderSteps } from "@/db/schema";
import { toSessionUser } from "@/domain/auth";
import type { Ctx, SessionUser } from "@/domain/context";
import { receiveStock } from "@/domain/inventory/ledger";
import { addWorkdays, isWorkday, istanbulDayStart } from "@/domain/production/calendar";
import { produceIn } from "@/domain/production/productLedger";
import { finishCurrentStep, materialNeeds, planWorkOrder, startNextStep } from "@/domain/production/workOrders";
import { createCustomer } from "@/domain/sales/customers";
import { addLine, cancelOrder, confirmOrder, createOrder, shipOrder } from "@/domain/sales/orders";
import { roundUpToStep, toKurus, type Unit } from "@/domain/units";
import { SEED_CUSTOMERS } from "./data/customers";
import { SEED_MATERIALS } from "./data/materials";
import { SEED_PRODUCTS, STATIONS } from "./data/products";
import { mulberry32 } from "./rng";

const DEFAULT_SEED = 20261116;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Sipariş geçmişi bu kadar takvim günü geriye gider. Malzemeler 29 gün önce açıldığı için daha eskisi olmaz. */
const HISTORY_DAYS = 28;
/** Açılış mamul stoğu bu kadar gün önce girer (iş günü değilse önceki iş günü). */
const OPENING_DAYS = 30;
const OPENING_PRODUCTS = 8;
const DAY_OPEN = 8 * 60;
/** Son olayın en geç dakikası; 18:00'den önce. */
const DAY_LAST = 17 * 60 + 50;
const SUPPLY_MINUTE = 8 * 60 + 30;
/** "Malzeme bekliyor" siparişlerinde bilerek tamamlanmayan, örnek veride kritik işaretli kalem. */
const SHORT_MATERIAL = "MDF Lam 8 mm Beyaz Arkalık 2100×2800";
/** Üretimdeki siparişlerin ilk satırları sırayla bu istasyonlarda bekletilir; her istasyonun kuyruğu dolu olur. */
const COVERAGE_ORDER = ["PKT", "BYA", "MNT", "CNC", "KNR", "KSM"];
const CANCEL_REASONS = ["Müşteri vazgeçti", "Müşteri teslim tarihini kabul etmedi", "Ödeme onayı gelmedi"];

type Fate = "shipped" | "ready" | "in_production" | "waiting" | "draft" | "cancelled";
type PlannedLine = { product: number; qtyMilli: number };
type PlannedOrder = {
  day: Date;
  minute: number;
  customer: number;
  fate: Fate;
  lines: PlannedLine[];
  dueOffset: number;
  /** Üretimdeki siparişin ilk satırının bekletileceği istasyon. */
  coverage?: string;
  /** İptal onaydan sonra mı (müdür) yoksa taslakken mi (uzman). */
  cancelConfirmed?: boolean;
};

type StepInfo = { seq: number; plannedDay: Date; minutes: number; stationCode: string };

const SPEC_BY_NAME = new Map(SEED_MATERIALS.map((m) => [m.name, m]));

export async function seedSales(db: Db, opts: { now: Date; seed?: number }): Promise<void> {
  const rnd = mulberry32(opts.seed ?? DEFAULT_SEED);
  const nowMs = opts.now.getTime();
  const today = istanbulDayStart(opts.now);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)] as T;
  const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);
  const workdayOnOrBefore = (day: Date) => {
    let d = day;
    while (!isWorkday(d)) d = new Date(d.getTime() - DAY);
    return d;
  };

  await db.transaction(async (tx) => {
    // ---- Zaman: her an bir kez kullanılır --------------------------------------------------------------
    const used = new Set((await tx.select({ at: stockMovements.createdAt }).from(stockMovements)).map((r) => r.at.getTime()));
    /** Günün `minute`. dakikası (+ rastgele saniye); an alınmışsa bir saniye ileri kayar. */
    const take = (day: Date, minute: number): Date => {
      let ms = day.getTime() + minute * MINUTE + int(0, 59) * 1000;
      while (used.has(ms)) ms += 1000;
      const hour = (ms - day.getTime()) / HOUR;
      if (!isWorkday(day) || hour < 8 || hour >= 18 || ms >= nowMs) throw new Error(`mesai dışı an: ${new Date(ms).toISOString()}`);
      used.add(ms);
      return new Date(ms);
    };
    const minuteOf = (at: Date, day: Date) => Math.floor((at.getTime() - day.getTime()) / MINUTE);

    // ---- Kişiler -----------------------------------------------------------------------------------------
    const byName = new Map((await tx.select().from(users)).map((u) => [u.name, toSessionUser(u)]));
    const person = (name: string): SessionUser => {
      const u = byName.get(name);
      if (!u) throw new Error(`demo hesabı yok: ${name}`);
      return u;
    };
    const sellers = [person("Elif Karaca"), person("Elif Karaca"), person("Tolga Erden")];
    const salesManager = person("Tolga Erden");
    const planner = person("Zeynep Arıkan");
    const operators = [person("Cem Doğru"), person("Murat Özkaya")];
    const warehouse = [person("Onur Tekin"), person("Burak Şen")];
    const ctx = (user: SessionUser, at: Date): Ctx => ({ db: tx, user, now: at });

    // ---- Katalog (ana veri, toplu) ---------------------------------------------------------------------
    const openingDay = workdayOnOrBefore(daysAgo(OPENING_DAYS));
    const catalogAt = new Date(openingDay.getTime() + DAY_OPEN * MINUTE);
    const stationRows = await tx.insert(stations).values(STATIONS).returning();
    const stationId = new Map(stationRows.map((s) => [s.code, s.id]));
    const productRows = await tx
      .insert(products)
      .values(
        SEED_PRODUCTS.map((p) => ({
          code: p.code,
          modelKey: p.modelKey,
          // Katalogdaki ad zaten "<model> <kategori>" biçimindedir (catalog.gen.ts productName).
          name: p.name,
          collection: p.collection,
          category: p.category,
          widthMm: p.dims.width,
          depthMm: p.dims.depth,
          heightMm: p.dims.height,
          finish: p.finish,
          priceKurus: p.priceKurus,
          vatRate: p.vatRate,
          createdAt: catalogAt,
        })),
      )
      .returning();
    const productId = new Map(productRows.map((p) => [p.code, p.id]));
    const pid = (index: number) => productId.get(SEED_PRODUCTS[index]?.code ?? "") as string;

    const materialRows = await tx.select().from(materials).orderBy(asc(materials.code));
    const materialByName = new Map(materialRows.map((m) => [m.name, m]));
    const materialId = (name: string) => {
      const m = materialByName.get(name);
      if (!m) throw new Error(`malzeme yok: ${name}`);
      return m.id;
    };
    await tx.insert(bomLines).values(
      SEED_PRODUCTS.flatMap((p, i) =>
        p.bom.map((l) => ({ productId: pid(i), materialId: materialId(l.material), qtyMilli: l.qtyMilli, scrapPermille: l.scrapPermille })),
      ),
    );
    await tx.insert(routings).values(
      SEED_PRODUCTS.flatMap((p, i) =>
        p.routing.map((r, seq) => ({ productId: pid(i), seq: seq + 1, stationId: stationId.get(r.station) as string, minutesPerUnit: r.minutesPerUnit })),
      ),
    );
    const shortId = materialId(SHORT_MATERIAL);

    // ---- Müşteriler: satış ekibi yıllar içinde açmış ------------------------------------------------------
    const customerIds: string[] = [];
    for (const [i, c] of SEED_CUSTOMERS.entries()) {
      const day = workdayOnOrBefore(daysAgo(OPENING_DAYS + 9 * (SEED_CUSTOMERS.length - i)));
      const created = await createCustomer(ctx(pick(sellers), take(day, int(9 * 60, 16 * 60))), c);
      customerIds.push(created.id);
    }

    // ---- Açılış mamul stoğu -------------------------------------------------------------------------------
    const shuffled = SEED_PRODUCTS.map((_, i) => i);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as number, shuffled[i] as number];
    }
    const opening = new Set(shuffled.slice(0, OPENING_PRODUCTS));
    for (const [i, index] of [...opening].sort((x, y) => x - y).entries()) {
      await produceIn(ctx(warehouse[0] as SessionUser, take(openingDay, DAY_OPEN + 20 + i)), {
        productId: pid(index),
        qtyMilli: int(1, 4) * 1000,
        ref: { type: "opening", id: "acilis" },
        note: "Açılış stoğu",
      });
    }

    // ---- Sipariş planı: gün, müşteri, satırlar ve varılacak durum -----------------------------------------
    const usesShort = (i: number) => SEED_PRODUCTS[i]?.bom.some((l) => l.material === SHORT_MATERIAL) ?? false;
    const routeOf = (i: number) => SEED_PRODUCTS[i]?.routing.map((r) => r.station) ?? [];
    const indices = SEED_PRODUCTS.map((_, i) => i);
    const plan: PlannedOrder[] = [];
    for (let back = HISTORY_DAYS; back >= 1; back--) {
      const day = daysAgo(back);
      if (!isWorkday(day)) continue;
      const minutes = Array.from({ length: int(1, 2) }, () => int(8 * 60 + 45, 15 * 60 + 45)).sort((x, y) => x - y);
      for (const minute of minutes) {
        plan.push({ day, minute, customer: int(0, customerIds.length - 1), fate: "shipped", lines: [], dueOffset: int(7, 21) });
      }
    }
    // Yeniden eskiye: taslaklar en yeni, sonra malzeme bekleyenler, üretimdekiler ve hazırlar; kalanı sevk edilmiş.
    const share = (ratio: number) => Math.max(1, Math.round(plan.length * ratio));
    let cursor = plan.length;
    const band = (fate: Fate, n: number) => {
      for (let k = 0; k < n; k++) (plan[--cursor] as PlannedOrder).fate = fate;
    };
    band("draft", share(0.07));
    band("waiting", share(0.08));
    band("in_production", share(0.2));
    band("ready", share(0.15));
    const older = Array.from({ length: cursor }, (_, i) => i);
    for (let k = share(0.05); k > 0 && older.length > 0; k--) {
      const [i] = older.splice(Math.floor(rnd() * older.length), 1);
      const o = plan[i as number] as PlannedOrder;
      o.fate = "cancelled";
      o.cancelConfirmed = rnd() < 0.5;
    }

    let coverage = 0;
    for (const o of plan) {
      const chosen: number[] = [];
      const free = (ok: (i: number) => boolean) => indices.filter((i) => !chosen.includes(i) && ok(i));
      if (o.fate === "in_production") {
        o.coverage = COVERAGE_ORDER[coverage++ % COVERAGE_ORDER.length] as string;
        const station = o.coverage;
        chosen.push(pick(free((i) => !opening.has(i) && routeOf(i).includes(station))));
      } else if (o.fate === "waiting") {
        chosen.push(pick(free((i) => !opening.has(i) && usesShort(i))));
      }
      // Taslakta en az iki satır olur: satır silme gibi akışlar örnek taslaklarla denenebilsin.
      const total = Math.max(chosen.length, o.fate === "draft" ? 2 : 1, int(1, 3));
      while (chosen.length < total) chosen.push(pick(free(() => true)));
      o.lines = chosen.map((product) => ({ product, qtyMilli: int(1, 4) * 1000 }));
    }
    // En eski iki açık sipariş terminini kaçırmış olsun.
    for (const o of plan.filter((x) => x.fate === "ready" || x.fate === "in_production").slice(0, 2)) o.dueOffset = 7;

    // ---- Olay kuyruğu -------------------------------------------------------------------------------------
    type Event = { at: number; run: () => Promise<void> };
    const queue: Event[] = [];
    const schedule = (at: Date, run: () => Promise<void>) => {
      const ms = at.getTime();
      let lo = 0;
      let hi = queue.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((queue[mid] as Event).at <= ms) lo = mid + 1;
        else hi = mid;
      }
      queue.splice(lo, 0, { at: ms, run });
    };

    type Live = { plan: PlannedOrder; id: string; openWorkOrders: number; lastDay: Date };

    /** Onaydan önce, aynı gün 08:30'da tedarikçi girişi: eksik kalan ya da sipariş noktasının altına inecek malzeme. */
    const supplyBeforeConfirm = async (live: Live, day: Date, holdWaiting = false) => {
      const lines = await tx
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.orderId, live.id))
        .orderBy(asc(salesOrderLines.createdAt), asc(salesOrderLines.id));
      const productFree = new Map((await tx.select().from(products)).map((p) => [p.id, p.onHandMilli - p.reservedMilli]));
      const mats = await tx.select().from(materials).orderBy(asc(materials.code));
      const info = new Map(mats.map((m) => [m.id, m]));
      const available = new Map(mats.map((m) => [m.id, m.onHandMilli - m.reservedMilli]));
      if (holdWaiting) {
        // Malzemesini bekleyen iş emirlerinin eksik olmayan kalemleri ayrılmamıştır; sonraki siparişler onları tüketmesin.
        for (const w of (await tx.select().from(workOrders)).filter((x) => x.status === "planned" && !x.materialsReserved)) {
          for (const n of await materialNeeds(tx, w.productId, w.qtyMilli)) {
            if (n.materialId !== shortId) available.set(n.materialId, (available.get(n.materialId) ?? 0) - n.neededMilli);
          }
        }
      }
      const receipts = new Map<string, number>();
      for (const line of lines) {
        const reserve = Math.min(Math.max(productFree.get(line.productId) ?? 0, 0), line.qtyMilli);
        productFree.set(line.productId, (productFree.get(line.productId) ?? 0) - reserve);
        const remaining = line.qtyMilli - reserve;
        if (remaining === 0) continue;
        const needs = await materialNeeds(tx, line.productId, remaining);
        const waits = live.plan.fate === "waiting" && needs.some((n) => n.materialId === shortId && (available.get(shortId) ?? 0) < n.neededMilli);
        for (const n of needs) {
          if (waits && n.materialId === shortId) continue;
          const m = info.get(n.materialId);
          if (!m) throw new Error("malzeme okunamadı");
          let free = available.get(m.id) ?? 0;
          let top = 0;
          if (SPEC_BY_NAME.get(m.name)?.critical) {
            if (free < n.neededMilli) top = n.neededMilli - free;
          } else if (free - n.neededMilli < m.reorderPointMilli) {
            top = n.neededMilli - free + Math.round(m.reorderPointMilli * 1.5);
          }
          if (top > 0) {
            top = roundUpToStep(top, m.unit as Unit);
            receipts.set(m.id, (receipts.get(m.id) ?? 0) + top);
            free += top;
          }
          available.set(m.id, waits ? free : free - n.neededMilli);
        }
      }
      for (const m of mats) {
        const qtyMilli = receipts.get(m.id);
        if (!qtyMilli) continue;
        const spec = SPEC_BY_NAME.get(m.name);
        if (!spec) throw new Error(`malzeme kataloğu: ${m.name}`);
        await receiveStock(ctx(pick(warehouse), take(day, SUPPLY_MINUTE)), {
          materialId: m.id,
          qtyMilli,
          unitCostKurus: toKurus(spec.price),
          note: "Tedarikçi irsaliyesi",
        });
      }
    };

    const scheduleShip = (live: Live, afterDay: Date) => {
      const day = addWorkdays(afterDay, 1);
      if (day.getTime() >= today.getTime()) return;
      const at = take(day, int(9 * 60, 16 * 60));
      schedule(at, async () => {
        await shipOrder(ctx(pick(warehouse), at), live.id);
      });
    };

    /** Adım `i`'yi planlı gününde başlatır; `done` adım bitince durur, `running` ise son adım açık kalır. */
    const runSteps = (live: Live, workOrderId: string, steps: StepInfo[], i: number, done: number, running: boolean) => {
      const step = steps[i];
      if (!step || i > done || (i === done && !running)) return;
      const day = step.plannedDay;
      if (day.getTime() >= today.getTime()) return;
      const operator = pick(operators);
      const startAt = take(day, int(8 * 60 + 10, 13 * 60 + 10));
      schedule(startAt, async () => {
        await startNextStep(ctx(operator, startAt), workOrderId);
        if (i === done) return;
        const finishAt = take(day, Math.min(minuteOf(startAt, day) + Math.max(10, step.minutes), DAY_LAST));
        schedule(finishAt, async () => {
          const { completed } = await finishCurrentStep(ctx(operator, finishAt), workOrderId);
          if (!completed) return runSteps(live, workOrderId, steps, i + 1, done, running);
          live.openWorkOrders -= 1;
          if (day.getTime() > live.lastDay.getTime()) live.lastDay = day;
          if (live.openWorkOrders === 0 && live.plan.fate === "shipped") scheduleShip(live, live.lastDay);
        });
      });
    };

    const stepsOf = async (workOrderId: string): Promise<StepInfo[]> => {
      const rows = await tx
        .select({ seq: workOrderSteps.seq, plannedDay: workOrderSteps.plannedDay, minutes: workOrderSteps.minutes, stationCode: stations.code })
        .from(workOrderSteps)
        .innerJoin(stations, eq(stations.id, workOrderSteps.stationId))
        .where(eq(workOrderSteps.workOrderId, workOrderId))
        .orderBy(asc(workOrderSteps.seq));
      return rows.map((r) => ({ ...r, plannedDay: r.plannedDay as Date }));
    };

    const afterConfirm = async (live: Live, day: Date, confirmedAt: Date) => {
      const { plan: o } = live;
      const lineIds = (
        await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.orderId, live.id)).orderBy(asc(salesOrderLines.createdAt))
      ).map((l) => l.id);
      const wos = await tx.select().from(workOrders).where(inArray(workOrders.salesOrderLineId, lineIds)).orderBy(asc(workOrders.code));
      for (const wo of wos) {
        const waiting = !wo.materialsReserved;
        if (waiting && o.fate !== "waiting") throw new Error(`${wo.code}: malzeme beklenmiyordu`);
      }
      if (o.fate === "waiting" && !wos.some((w) => !w.materialsReserved)) throw new Error("malzeme bekleyen iş emri oluşmadı");

      const cancel = (after: Date) => {
        const cancelAt = take(day, Math.min(minuteOf(after, day) + int(5, 30), DAY_LAST));
        schedule(cancelAt, async () => {
          await cancelOrder(ctx(salesManager, cancelAt), { orderId: live.id, reason: pick(CANCEL_REASONS) });
        });
      };
      if (wos.length === 0) {
        if (o.fate === "shipped") scheduleShip(live, day);
        if (o.fate === "cancelled") cancel(confirmedAt);
        return;
      }
      const planAt = take(day, Math.min(minuteOf(confirmedAt, day) + int(10, 40), DAY_LAST));
      schedule(planAt, async () => {
        const start = addWorkdays(day, 1);
        for (const wo of wos) await planWorkOrder(ctx(planner, planAt), { workOrderId: wo.id, start });

        if (o.fate === "cancelled") return cancel(planAt);
        if (o.fate === "waiting") return;

        live.openWorkOrders = wos.length;
        for (const wo of wos) {
          const steps = await stepsOf(wo.id);
          const past = steps.filter((s) => s.plannedDay.getTime() < today.getTime()).length;
          let done = steps.length;
          let running = false;
          if (o.fate === "in_production") {
            if (wo.salesOrderLineId === lineIds[0] && o.coverage) {
              const at = steps.findIndex((s) => s.stationCode === o.coverage);
              done = at >= 0 ? at : steps.length - 1;
            } else {
              done = int(0, steps.length - 1);
            }
            running = rnd() < 0.5;
            if (done >= past) {
              done = past;
              running = false;
            }
          }
          runSteps(live, wo.id, steps, 0, done, running);
        }
      });
    };

    for (const o of plan) {
      const seller = pick(sellers);
      const createdAt = take(o.day, o.minute);
      schedule(createdAt, async () => {
        const created = await createOrder(ctx(seller, createdAt), {
          customerId: customerIds[o.customer] as string,
          dueAt: addWorkdays(o.day, o.dueOffset),
        });
        const live: Live = { plan: o, id: created.id, openWorkOrders: 0, lastDay: o.day };
        let minute = o.minute;
        for (const line of o.lines) {
          minute += int(1, 3);
          await addLine(ctx(seller, take(o.day, minute)), { orderId: created.id, productId: pid(line.product), qtyMilli: line.qtyMilli });
        }
        if (o.fate === "draft") return;
        if (o.fate === "cancelled" && !o.cancelConfirmed) {
          const cancelAt = take(o.day, Math.min(minute + int(30, 120), DAY_LAST));
          schedule(cancelAt, async () => {
            await cancelOrder(ctx(seller, cancelAt), { orderId: created.id, reason: pick(CANCEL_REASONS) });
          });
          return;
        }
        const confirmAt = take(o.day, minute + int(20, 80));
        schedule(confirmAt, async () => {
          await supplyBeforeConfirm(live, o.day);
          await confirmOrder(ctx(seller, confirmAt), created.id);
          await afterConfirm(live, o.day, confirmAt);
        });
      });
    }

    while (queue.length > 0) await (queue.shift() as Event).run();

    // ---- Haftanın yoğunluğu: son üç iş gününde açılan siparişler ----------------------------------------------
    // Yukarıdaki geçmiş son günlerde seyrektir; haftalık plan, kanban ve termin önerisi gerçekçi bir atölye
    // haftası göstersin diye bu siparişler ayrıca eklenir. Her biri yine gerçek servislerle ve kendi anında
    // yapılır. Dört tür var:
    //   busy      onaylı, iş emirleri önümüzdeki günlerden başlayarak planlı (ızgarayı doldurur, bazı hücreleri aştırır)
    //   late      terminine yetişmeyen: iş emri geçen hafta başladı, bir adımı hâlâ sürüyor, kalanlar terminden sonra
    //   unplanned onaylı ama planlamacı henüz planlamadı (planlanmamış iş emri)
    //   waiting   planlı ama kritik arkalık gelmedi (kanbanda "Malzeme bekliyor")
    // Önümüzdeki günler `now`'a göre belirlendiği için senaryolar anlık görüntü hangi gün açılırsa açılsın geçerlidir:
    // yükleme tarihleri iş günü olarak birlikte kaydırır (snapshot.ts makeDateShift).
    type Extra = { kind: "busy" | "late" | "unplanned" | "waiting"; day: Date; minute: number; due: Date; start?: Date; products: number[]; qty: number[] };
    const recentDays: Date[] = [];
    for (let d = workdayOnOrBefore(daysAgo(1)); recentDays.length < 3; d = workdayOnOrBefore(new Date(d.getTime() - DAY))) recentDays.unshift(d);
    const [dayA, dayB, dayC] = recentDays as [Date, Date, Date]; // dayC: son iş günü
    const ahead = (n: number) => addWorkdays(today, n);
    const unusedProduct = (taken: number[], ok: (i: number) => boolean) => pick(indices.filter((i) => !opening.has(i) && !taken.includes(i) && ok(i)));
    const mix = (count: number, ok: (i: number) => boolean = () => true) => {
      const products: number[] = [];
      while (products.length < count) products.push(unusedProduct(products, ok));
      return { products, qty: products.map(() => int(1, 3) * 1000) };
    };
    const extras: Extra[] = [];
    const busyDays = [dayA, dayA, dayA, dayB, dayB, dayB, dayC, dayC, dayC];
    const busyStarts = [0, 0, 1, 0, 1, 2, 0, 1, 3];
    for (const [k, day] of busyDays.entries()) {
      // Termin, rotanın en uzun satırı bitince birkaç iş günü pay bırakır: yoğun hafta gerçekçi görünür, geciken siparişler ayrıca "late" ile yapılır.
      const start = ahead(busyStarts[k] as number);
      const order = mix(int(2, 3));
      const span = Math.max(...order.products.map((i) => routeOf(i).length));
      extras.push({ kind: "busy", day, minute: int(14 * 60, 15 * 60 + 30), due: addWorkdays(start, span + int(1, 4)), start, ...order });
    }
    // Toplu iş: sürmekte olan ikinci adım istasyonun günlük kapasitesini tek başına aşar (geçen haftanın ızgarasında da kırmızı hücre kalır).
    const secondStep = (i: number) => SEED_PRODUCTS[i]?.routing[1];
    const bulk = mix(1, (i) => routeOf(i).length >= 4 && !usesShort(i) && (secondStep(i)?.minutesPerUnit ?? 0) >= 20);
    const bulkStep = secondStep(bulk.products[0] as number) as { station: string; minutesPerUnit: number };
    const bulkCapacity = STATIONS.find((s) => s.code === bulkStep.station)?.dailyCapacityMin ?? 0;
    bulk.qty = [Math.ceil((bulkCapacity + 60) / bulkStep.minutesPerUnit) * 1000];
    extras.push({ kind: "late", day: dayA, minute: 14 * 60 + 10, due: addWorkdays(dayA, 1), start: dayB, ...bulk });
    extras.push({ kind: "late", day: dayC, minute: 14 * 60 + 20, due: addWorkdays(dayC, 1), start: ahead(0), ...mix(1, (i) => routeOf(i).length >= 3 && !usesShort(i)) });
    extras.push({ kind: "unplanned", day: dayC, minute: 15 * 60 + 40, due: addWorkdays(dayC, 9), ...mix(2) });
    extras.push({ kind: "unplanned", day: dayC, minute: 16 * 60 + 5, due: addWorkdays(dayC, 11), ...mix(1) });
    extras.push({ kind: "waiting", day: dayB, minute: 15 * 60, due: addWorkdays(dayB, 10), start: ahead(0), ...mix(1, usesShort) });
    extras.push({ kind: "waiting", day: dayC, minute: 15 * 60 + 15, due: addWorkdays(dayC, 12), start: ahead(1), ...mix(1, usesShort) });

    for (const x of extras) {
      const seller = pick(sellers);
      const customer = customerIds[int(0, customerIds.length - 1)] as string;
      const createdAt = take(x.day, x.minute);
      schedule(createdAt, async () => {
        const created = await createOrder(ctx(seller, createdAt), { customerId: customer, dueAt: x.due });
        const shell: PlannedOrder = { day: x.day, minute: x.minute, customer: 0, fate: x.kind === "waiting" ? "waiting" : "in_production", lines: [], dueOffset: 0 };
        const live: Live = { plan: shell, id: created.id, openWorkOrders: 0, lastDay: x.day };
        let minute = x.minute;
        for (const [k, product] of x.products.entries()) {
          minute += int(1, 3);
          await addLine(ctx(seller, take(x.day, minute)), { orderId: created.id, productId: pid(product), qtyMilli: x.qty[k] as number });
        }
        const confirmAt = take(x.day, minute + int(20, 80));
        schedule(confirmAt, async () => {
          await supplyBeforeConfirm(live, x.day, true);
          await confirmOrder(ctx(seller, confirmAt), created.id);
          const lineIds = (
            await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.orderId, created.id)).orderBy(asc(salesOrderLines.createdAt))
          ).map((l) => l.id);
          const wos = await tx.select().from(workOrders).where(inArray(workOrders.salesOrderLineId, lineIds)).orderBy(asc(workOrders.code));
          if (x.kind !== "busy" && wos.length === 0) throw new Error(`${x.kind}: iş emri oluşmadı`);
          if (x.kind === "waiting" && !wos.some((w) => !w.materialsReserved)) throw new Error("malzeme bekleyen iş emri oluşmadı");
          if (x.kind === "unplanned") return;
          const planAt = take(x.day, Math.min(minuteOf(confirmAt, x.day) + int(10, 40), DAY_LAST));
          schedule(planAt, async () => {
            for (const wo of wos) await planWorkOrder(ctx(planner, planAt), { workOrderId: wo.id, start: x.start as Date });
            if (x.kind !== "late") return;
            live.openWorkOrders = wos.length;
            for (const wo of wos) runSteps(live, wo.id, await stepsOf(wo.id), 0, 1, true);
          });
        });
      });
    }
    while (queue.length > 0) await (queue.shift() as Event).run();
  });
}
