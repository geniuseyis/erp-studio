// Temel örnek veri: departmanlar, demo hesapları, malzeme kataloğu ve son 30 günün stok hareketleri.
// Stok doğrudan tabloya yazılmaz; gerçek servisler çağrılır, böylece defter kendiliğinden tutarlıdır.
// Gerçekçilik kuralları (tests/unit/seed/base.test.ts denetler): miktarlar birime uygun yuvarlanır,
// hareketler mesai saatlerine düşer, tek bir çıkış yeniden sipariş noktasını aşmaz.
import type { Db } from "@/db/client";
import { departments, users } from "@/db/schema";
import { toSessionUser } from "@/domain/auth";
import { type Ctx, DEPARTMENT_NAMES, type SessionUser } from "@/domain/context";
import { createCount, setCountLine } from "@/domain/inventory/counts";
import { issueStock, receiveStock } from "@/domain/inventory/ledger";
import { createMaterial } from "@/domain/inventory/materials";
import { getMaterial } from "@/domain/inventory/queries";
import { hashPassword } from "@/domain/password";
import { toKurus, UNIT_STEP_MILLI } from "@/domain/units";
import { SEED_MATERIALS, type SeedMaterial, type SeedUnit } from "./data/materials";
import { DEMO_PASSWORD, demoEmail, SEED_USERS } from "./data/users";
import { mulberry32 } from "./rng";

export { DEMO_PASSWORD };
const DEFAULT_SEED = 20261115;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Türkiye saati sabit UTC+3'tür (yaz saati uygulaması yok). */
const ISTANBUL_OFFSET = 3 * HOUR;
const WORKDAY_START_HOUR = 8;
const WORKDAY_MINUTES = 10 * 60;

const SHELF_LETTER: Record<SeedMaterial["category"], string> = {
  panel: "A",
  masif: "B",
  kenar_bandi: "C",
  hirdavat: "D",
  boya: "E",
  kumas: "F",
  ambalaj: "G",
};

const ISSUE_NOTES = ["Üretime çıkış", "Atölyeye sevk", "İş emri hazırlığı"];

/** Birim cinsinden miktarı milli tam sayıya çevirir ve birimin adımına yuvarlar. En az bir adım döner. */
function qty(unit: SeedUnit, amount: number): number {
  const step = UNIT_STEP_MILLI[unit];
  return Math.max(1, Math.round((amount * 1000) / step)) * step;
}

async function seedPeople(db: Db, now: Date): Promise<SessionUser[]> {
  await db.insert(departments).values(Object.entries(DEPARTMENT_NAMES).map(([code, name]) => ({ code, name })));
  const hashes = await Promise.all(SEED_USERS.map(() => hashPassword(DEMO_PASSWORD)));
  const rows = await db
    .insert(users)
    .values(
      SEED_USERS.map((u, i) => ({
        name: u.name,
        email: demoEmail(u.name),
        passwordHash: hashes[i] as string,
        departmentCode: u.departmentCode,
        level: u.level,
        title: u.title,
        createdAt: new Date(now.getTime() - 400 * DAY),
      })),
    )
    .returning();
  return rows.map(toSessionUser);
}

export async function seedBase(db: Db, opts: { now: Date; seed?: number }): Promise<void> {
  const rnd = mulberry32(opts.seed ?? DEFAULT_SEED);
  const nowMs = opts.now.getTime();
  // "Bugün"ün İstanbul saatiyle başlangıcı; bütün zamanlar buna göre gün ve saat olarak kurulur.
  const todayStart = Math.floor((nowMs + ISTANBUL_OFFSET) / DAY) * DAY - ISTANBUL_OFFSET;
  /** `daysAgo` gün önce, verilen saat ve dakikada. */
  const at = (daysAgo: number, hour: number, minute = 0) => todayStart - daysAgo * DAY + hour * HOUR + minute * MINUTE;
  /** `daysAgo` gün önce, mesai içinde rastgele bir dakika. */
  const duringWork = (daysAgo: number) => at(daysAgo, WORKDAY_START_HOUR, Math.floor(rnd() * WORKDAY_MINUTES));
  let waybill = 4100;

  await db.transaction(async (tx) => {
    const people = await seedPeople(tx, opts.now);
    const warehouse = people.filter((p) => p.departmentCode === "depo");
    const specialist = warehouse.find((p) => p.level === "uzman");
    const clerk = warehouse.find((p) => p.level === "operator");
    if (!specialist || !clerk) throw new Error("depo çalışanları eksik");
    const ctx = (ms: number, user: SessionUser = specialist): Ctx => ({ db: tx, user, now: new Date(ms) });
    const anyone = () => warehouse[Math.floor(rnd() * warehouse.length)] as SessionUser;
    const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)] as T;

    const shelfIndex: Record<string, number> = {};
    const created: { id: string; spec: SeedMaterial }[] = [];

    for (const [i, spec] of SEED_MATERIALS.entries()) {
      const n = (shelfIndex[spec.category] = (shelfIndex[spec.category] ?? 0) + 1);
      const step = UNIT_STEP_MILLI[spec.unit];
      const reorderMilli = qty(spec.unit, spec.reorder);
      const cost = toKurus(spec.price);
      const opened = at(29, WORKDAY_START_HOUR, i);

      const material = await createMaterial(ctx(opened), {
        name: spec.name,
        category: spec.category,
        unit: spec.unit,
        reorderPointMilli: reorderMilli,
        safetyStockMilli: qty(spec.unit, spec.reorder / 2),
        leadTimeDays: spec.leadTimeDays,
        shelf: `${SHELF_LETTER[spec.category]}-${String(n).padStart(2, "0")}`,
      });
      created.push({ id: material.id, spec });

      const receive = (ms: number, qtyMilli: number, unitCostKurus: number, note: string) =>
        receiveStock(ctx(ms, anyone()), { materialId: material.id, qtyMilli, unitCostKurus, note });
      /** Kullanılabilir stoktan en fazla bir adım eksiğini çıkar; stok yoksa çıkış yapılmaz. */
      const issue = async (ms: number, wantedMilli: number) => {
        const current = await getMaterial(tx, material.id);
        const amount = Math.min(wantedMilli, (current?.availableMilli ?? 0) - step);
        if (amount > 0) await issueStock(ctx(ms, anyone()), { materialId: material.id, qtyMilli: amount, note: pick(ISSUE_NOTES) });
      };
      const delivery = () => `Tedarikçi teslimatı, irsaliye ${++waybill}`;

      // Açılış stoğu. Kritik bırakılacak kalemler sipariş noktasının az üstünde başlar ve ay içinde tüketilir.
      const openingMilli = spec.critical ? qty(spec.unit, spec.reorder * (1.15 + rnd() * 0.2)) : qty(spec.unit, spec.opening);
      await receiveStock(ctx(opened), { materialId: material.id, qtyMilli: openingMilli, unitCostKurus: cost, note: "Açılış stoğu" });

      // Ay içine yayılmış hareketler (son iki gün kapanış ayarına bırakılır).
      const count = 3 + Math.floor(rnd() * 8);
      const times = Array.from({ length: count }, () => duringWork(3 + Math.floor(rnd() * 25))).sort((a, b) => a - b);
      for (const t of times) {
        if (spec.critical) {
          await issue(t, qty(spec.unit, spec.reorder * (0.05 + rnd() * 0.07)));
        } else if (rnd() < 0.7) {
          await issue(t, qty(spec.unit, spec.opening * (0.03 + rnd() * 0.07)));
        } else {
          await receive(t, qty(spec.unit, spec.opening * (0.1 + rnd() * 0.1)), Math.round(cost * (0.97 + rnd() * 0.06)), delivery());
        }
      }

      // Kapanış ayarı: işaretli kalemler kritik seviyeye iner, diğerleri sipariş noktasının rahatça üstünde kalır.
      const closing = duringWork(1 + Math.floor(rnd() * 2));
      const onHand = (await getMaterial(tx, material.id))?.onHandMilli ?? 0;
      if (spec.critical) {
        const target = qty(spec.unit, spec.reorder * (0.35 + rnd() * 0.4));
        if (onHand > target) await issue(closing, onHand - target);
      } else if (onHand < reorderMilli * 1.25) {
        await receive(closing, qty(spec.unit, spec.reorder * 1.8) - onHand, cost, delivery());
      }
    }

    // Dün açılmış, yarım kalmış bir sayım fişi: 5 hırdavat kalemi, ikisi sayılmış.
    const counted = created.filter((m) => m.spec.category === "hirdavat").slice(0, 5);
    const count = await createCount(ctx(at(1, 15)), { materialIds: counted.map((m) => m.id), note: "Hırdavat rafı ara sayımı" });
    for (const [i, m] of counted.slice(0, 2).entries()) {
      const current = await getMaterial(tx, m.id);
      const diff = i === 0 ? qty(m.spec.unit, 2) : 0;
      await setCountLine(ctx(at(1, 16, 10), clerk), {
        countId: count.id,
        materialId: m.id,
        countedMilli: Math.max(0, (current?.onHandMilli ?? 0) - diff),
      });
    }
  });
}
