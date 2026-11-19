// Satın alma örnek verisi: tedarikçiler ve fiyat listeleri (toplu, ana veri), onay eşikleri ve her durumdan sipariş.
// Siparişler gerçek servislerle, işi yapan kişinin demo hesabıyla yazılır; böylece onay kademesi, geçmiş kayıtları ve
// stok defteri kendiliğinden tutarlıdır (tests/unit/seed/purchasing.test.ts denetler).
//
// Zaman: belge yazan olaylar (taslak, gönderim, onay) son iş gününden geriye doğru iş günlerine yayılır, hepsi mesai
// içindedir. Stok hareketi yazan mal kabuller seedSales'in son hareketinden hemen sonra, mesai içinde yapılır; böylece stok
// geçmişi zaman sırasını bozmaz. Mal kabul edilen malzemeler kritik değildir ve arkalık hiçbir açık siparişte yoktur:
// "malzeme bekliyor" iş emirleri ve arkalık önerisi seedSales'teki gibi kalır.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { materials, purchaseOrderLines, settings, stockMovements, supplierItems, suppliers, users } from "@/db/schema";
import { toSessionUser } from "@/domain/auth";
import type { Ctx, SessionUser } from "@/domain/context";
import { isWorkday, istanbulDayStart, shiftWorkdays } from "@/domain/production/calendar";
import { approvePurchaseOrder, submitPurchaseOrder } from "@/domain/purchasing/approval";
import { cancelPurchaseOrder, createPurchaseOrder } from "@/domain/purchasing/orders";
import { receiveGoods } from "@/domain/purchasing/receiving";
import { DEFAULT_THRESHOLDS, SETTING_KEYS } from "@/domain/settings";
import { SEED_MATERIALS } from "./data/materials";
import { SEED_SUPPLIERS, supplierPhone } from "./data/suppliers";
import { mulberry32 } from "./rng";

const DEFAULT_SEED = 20261117;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Plan = {
  /** Sıra kodu: SAS kodları açılış zamanına göre numaralanır. */
  key: string;
  supplier: string;
  lines: [material: string, units: number][];
  /** Açılış: son iş gününden kaç iş günü önce. */
  created: number;
  /** Gönderim (onaya ya da doğrudan): son iş gününden kaç iş günü önce. */
  submitted?: number;
  /** Müdür onayı: kaç iş günü önce. */
  approved?: number;
  /** İptal: kaç iş günü önce, gerekçeyle. */
  cancelled?: { at: number; reason: string };
  /** Mal kabul: teslim alınan pay (1 = tamamı) ve irsaliye. */
  receipt?: { share: number; note: string };
  note?: string;
};

// Beklenen tutarlar (KDV hariç): 1 ≈ 44 bin, 2 ≈ 42 bin, 3 ≈ 42 bin, 4 ≈ 46 bin, 5 ≈ 28 bin, 6 = 48 bin,
// 7 ≈ 160 bin (müdür onayı), 8 ≈ 337 bin (müdür + Yönetim onayı), 9 ≈ 34 bin.
const PLANS: Plan[] = [
  { key: "5-gec", supplier: "İkitelli Ambalaj", created: 11, submitted: 10, lines: [["Palet Streç Film 50 cm 17 Mikron 300 m", 20], ["Oluklu Mukavva Levha 50×70 cm", 200], ["Karton Köşe Koruyucu 1 m", 300], ["Koli Bandı 45 mm × 100 m", 100]] },
  { key: "3-kismi", supplier: "İnegöl Döşemelik", created: 10, submitted: 9, lines: [["Kadife Döşemelik Kumaş, Antrasit", 60], ["Elyaf Vatka 200 gr/m²", 20]], receipt: { share: 0.4, note: "A-2026-0388" } },
  { key: "1-teslim", supplier: "Gebze Bağlantı Elemanları", created: 8, submitted: 7, lines: [["Minifiks Bağlantı Seti 15 mm", 1000], ["Ahşap Kavela 8×35 mm", 5000], ["Sunta Vidası 4×40 mm (1000'lik Kutu)", 20]], receipt: { share: 1, note: "A-2026-0412" } },
  { key: "2-teslim", supplier: "Dilovası Kenar Bandı", created: 8, submitted: 7, lines: [["PVC Kenar Bandı 22×0,4 mm Beyaz", 4000], ["ABS Kenar Bandı 22×2 mm Antrasit", 1000], ["ABS Kenar Bandı 22×2 mm Meşe", 500]], receipt: { share: 1, note: "KB-7781" } },
  { key: "9-iptal", supplier: "Tuzla Vernik ve Tutkal", created: 6, cancelled: { at: 6, reason: "Tedarikçi fiyatı değiştirdi; yeniden fiyat alınacak" }, lines: [["Akrilik Lake Boya, Beyaz", 40], ["PVA Ahşap Tutkalı D3", 20]] },
  { key: "8-yonetim", supplier: "Sapanca Yonga Levha", created: 4, submitted: 3, approved: 2, lines: [["MDF Lam 18 mm Parlak Beyaz 2100×2800", 100], ["Suntalam 18 mm Beyaz 2100×2800", 60]], note: "Aralık üretim planı için panel" },
  { key: "4-gonderildi", supplier: "Tuzla Vernik ve Tutkal", created: 2, submitted: 1, lines: [["Poliüretan Vernik, Mat", 20], ["Poliüretan Sertleştirici", 10], ["Selülozik Tiner", 40]] },
  { key: "7-mudur", supplier: "Karacabey Kereste ve Panel", created: 2, submitted: 1, lines: [["Ceviz Masif 40 mm, Fırınlanmış", 6], ["Çam Masif 50 mm, Fırın Kurusu", 3]] },
  { key: "6-taslak", supplier: "Karacabey Kereste ve Panel", created: 1, lines: [["Kayın Masif 50 mm, Fırınlanmış", 4]] },
];

export async function seedPurchasing(db: Db, opts: { now: Date; seed?: number }): Promise<void> {
  const rnd = mulberry32(opts.seed ?? DEFAULT_SEED);
  const nowMs = opts.now.getTime();
  const today = istanbulDayStart(opts.now);
  let lastDay = new Date(today.getTime() - DAY);
  while (!isWorkday(lastDay)) lastDay = new Date(lastDay.getTime() - DAY);

  await db.transaction(async (tx) => {
    const used = new Set<number>();
    /** `back` iş günü önce, [from, to) dakikaları arasında rastgele bir an; mesai içinde ve şimdiden önce. */
    const slot = (back: number, from: number, to: number): Date => {
      const day = shiftWorkdays(lastDay, -back);
      let ms = day.getTime() + (from + Math.floor(rnd() * (to - from))) * MINUTE + Math.floor(rnd() * 60) * 1000;
      while (used.has(ms)) ms += 1000;
      used.add(ms);
      if (ms >= nowMs) throw new Error("satın alma anı şimdiden sonra");
      return new Date(ms);
    };

    const byName = new Map((await tx.select().from(users)).map((u) => [u.name, toSessionUser(u)]));
    const person = (name: string): SessionUser => {
      const u = byName.get(name);
      if (!u) throw new Error(`demo hesabı yok: ${name}`);
      return u;
    };
    const buyer = person("Kerem Uysal");
    const manager = person("Ayla Güneş");
    const warehouse = person("Onur Tekin");
    const ctx = (user: SessionUser, at: Date): Ctx => ({ db: tx, user, now: at });

    // ---- Ana veri: tedarikçiler ve fiyat listeleri (toplu) -------------------------------------------------
    const mats = new Map((await tx.select().from(materials)).map((m) => [m.name, m]));
    const catalogAt = new Date(shiftWorkdays(lastDay, -19).getTime() + 8 * HOUR + 30 * MINUTE);
    const supplierRows = await tx
      .insert(suppliers)
      .values(
        SEED_SUPPLIERS.map((s, i) => ({
          code: `TED-${String(i + 1).padStart(4, "0")}`,
          name: s.name,
          city: s.city,
          contact: s.contact,
          phone: supplierPhone(s, i),
          paymentTermDays: s.paymentTermDays,
          leadTimeDays: s.leadTimeDays,
          createdAt: catalogAt,
        })),
      )
      .returning();
    const supplierId = new Map(supplierRows.map((r) => [r.name, r.id]));
    const source = new Map(SEED_MATERIALS.map((m) => [m.name, m.price]));
    const itemRows = SEED_SUPPLIERS.flatMap((s) =>
      s.items.map((i) => {
        const m = mats.get(i.material);
        if (!m) throw new Error(`malzeme yok: ${i.material}`);
        const priceKurus = Math.round((source.get(i.material) as number) * i.priceFactor * 100); // kaynaklı KDV hariç fiyat × katsayı
        return { supplierId: supplierId.get(s.name) as string, materialId: m.id, unitPriceMinor: priceKurus, moqMilli: i.moq * 1000, isPreferred: i.preferred };
      }),
    );
    await tx.insert(supplierItems).values(itemRows);
    await tx.insert(settings).values([
      { key: SETTING_KEYS.approvalManagerKurus, value: DEFAULT_THRESHOLDS.managerKurus },
      { key: SETTING_KEYS.approvalBoardKurus, value: DEFAULT_THRESHOLDS.boardKurus },
    ]);

    // ---- Siparişler: açılış zamanına göre, gerçek servislerle ----------------------------------------------
    const created = PLANS.map((p) => ({ plan: p, at: slot(p.created, 9 * 60, 15 * 60) })).sort((a, b) => a.at.getTime() - b.at.getTime());
    const orders: { plan: Plan; id: string }[] = [];
    for (const { plan, at } of created) {
      const supplier = supplierId.get(plan.supplier) as string;
      const po = await createPurchaseOrder(ctx(buyer, at), {
        supplierId: supplier,
        note: plan.note,
        lines: plan.lines.map(([name, units]) => ({ materialId: (mats.get(name) as { id: string }).id, qtyMilli: units * 1000 })),
      });
      orders.push({ plan, id: po.id });
    }

    for (const { plan, id } of orders) {
      if (plan.submitted !== undefined) await submitPurchaseOrder(ctx(buyer, slot(plan.submitted, 8 * 60 + 30, 12 * 60)), id);
      if (plan.approved !== undefined) await approvePurchaseOrder(ctx(manager, slot(plan.approved, 9 * 60, 16 * 60)), id);
      if (plan.cancelled) await cancelPurchaseOrder(ctx(buyer, slot(plan.cancelled.at, 15 * 60 + 30, 17 * 60)), { purchaseOrderId: id, reason: plan.cancelled.reason });
    }

    // ---- Mal kabuller: son iş günü, stok geçmişinin son hareketinden sonra ----------------------------------
    const moves = await tx.select({ at: stockMovements.createdAt }).from(stockMovements);
    const lastMove = moves.reduce((n, r) => Math.max(n, r.at.getTime()), 0);
    // Son hareket bir hafta sonuna (cumartesi akşamı) düşebilir; yüklemede hafta sonu değerleri son iş gününe çekilir (makeDateShift),
    // saat korunur. Mal kabuller o son hareketin hemen ardından, mesai bitmeden (17:50) yapılır.
    const receiptDayEnd = istanbulDayStart(new Date(lastMove)).getTime() + 17 * HOUR + 50 * MINUTE;
    let receiptMs = lastMove;
    for (const { plan, id } of orders) {
      if (!plan.receipt) continue;
      const { receipt } = plan;
      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, id));
      receiptMs += 2 * MINUTE;
      const at = new Date(receiptMs);
      if (at.getTime() >= receiptDayEnd || at.getTime() >= nowMs) throw new Error("mal kabul anı mesai dışı");
      await receiveGoods(ctx(warehouse, at), {
        purchaseOrderId: id,
        deliveryNote: receipt.note,
        lines: lines.map((l) => ({ lineId: l.id, qtyMilli: receipt.share === 1 ? l.qtyMilli : Math.floor((l.qtyMilli * receipt.share) / 1000) * 1000 })),
      });
    }
  });
}
