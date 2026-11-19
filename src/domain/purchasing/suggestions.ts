// Satın alma önerisi: kritik stok ve malzeme bekleyen iş emirlerinden, tedarikçiye göre gruplanmış sipariş taslağı önerisi.
// Hiçbir şey yazmaz; sabit sayıda sorgu çalıştırır (iş emri ya da malzeme başına sorgu yok).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bomLines, materials, purchaseOrderLines, purchaseOrders, supplierItems, suppliers, workOrders } from "@/db/schema";
import { approvalThresholds } from "../settings";
import { bomNeedMilli } from "../production/workOrders";
import { lineValueKurus, roundUpToStep, type Unit } from "../units";
import { requiredTier } from "./approval";
import type { ApprovalTier, Currency, PurchaseOrderStatus } from "./types";

export type SuggestionReason = "kritik" | "bekleyen_is";
export type SuggestionLine = {
  materialId: string;
  code: string;
  name: string;
  unit: Unit;
  availableMilli: number;
  reorderPointMilli: number;
  waitingNeedMilli: number;
  incomingMilli: number;
  gapMilli: number;
  qtyMilli: number;
  moqMilli: number;
  unitPriceMinor: number;
  lineNetMinor: number;
  reasons: SuggestionReason[];
  waitingWorkOrders: string[];
};
export type SuggestionGroup = {
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string;
  currency: Currency;
  leadTimeDays: number | null;
  lines: SuggestionLine[];
  netMinor: number;
  requiredTier: ApprovalTier;
};

/** Yolda sayılan siparişler: teslim alınmamış kalan miktar hâlâ bekleniyor. */
const INCOMING_STATUSES: readonly PurchaseOrderStatus[] = ["draft", "pending_approval", "sent", "partial"];
export const UNDEFINED_SUPPLIER_NAME = "Tedarikçisi tanımsız";

/**
 * Malzemesi ayrılmamış planlı iş emirlerinin (`isWaitingForMaterial` koşulu) reçete ihtiyacı; iş emri başına yuvarlanıp
 * malzemede toplanır. Tek sorgu: iş emri × reçete × malzeme.
 */
export async function waitingMaterialNeeds(db: Db): Promise<Map<string, { neededMilli: number; workOrders: string[] }>> {
  const rows = await db
    .select({
      code: workOrders.code,
      woQtyMilli: workOrders.qtyMilli,
      materialId: bomLines.materialId,
      bomQtyMilli: bomLines.qtyMilli,
      scrapPermille: bomLines.scrapPermille,
      unit: materials.unit,
    })
    .from(workOrders)
    .innerJoin(bomLines, eq(bomLines.productId, workOrders.productId))
    .innerJoin(materials, eq(materials.id, bomLines.materialId))
    .where(and(eq(workOrders.status, "planned"), eq(workOrders.materialsReserved, false)))
    .orderBy(asc(workOrders.code));
  const out = new Map<string, { neededMilli: number; workOrders: string[] }>();
  for (const r of rows) {
    const entry = out.get(r.materialId) ?? { neededMilli: 0, workOrders: [] };
    entry.neededMilli += bomNeedMilli(r.bomQtyMilli, r.woQtyMilli, r.scrapPermille, r.unit as Unit);
    if (!entry.workOrders.includes(r.code)) entry.workOrders.push(r.code);
    out.set(r.materialId, entry);
  }
  return out;
}

/** Malzeme başına yoldaki miktar: taslak, onay bekleyen, gönderilmiş ve kısmi siparişlerin `qty − received` toplamı. */
export async function incomingByMaterial(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({
      materialId: purchaseOrderLines.materialId,
      sum: sql<number>`sum(${purchaseOrderLines.qtyMilli} - ${purchaseOrderLines.receivedMilli})::float8`,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
    .where(inArray(purchaseOrders.status, [...INCOMING_STATUSES]))
    .groupBy(purchaseOrderLines.materialId);
  return new Map(rows.map((r) => [r.materialId, Number(r.sum)]));
}

type Source = { supplierId: string; code: string; name: string; currency: Currency; leadTimeDays: number; unitPriceMinor: number; moqMilli: number; preferred: boolean };

/** Tercihli kalem; yoksa en düşük fiyat (eşitlikte tedarikçi kodu). */
function pickSource(options: Source[]): Source | undefined {
  return [...options].sort(
    (a, b) => Number(b.preferred) - Number(a.preferred) || a.unitPriceMinor - b.unitPriceMinor || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  )[0];
}

export async function purchaseSuggestions(db: Db): Promise<SuggestionGroup[]> {
  const waiting = await waitingMaterialNeeds(db);
  const incoming = await incomingByMaterial(db);
  const mats = await db.select().from(materials).where(eq(materials.active, true)).orderBy(asc(materials.code));
  const items = await db
    .select({
      materialId: supplierItems.materialId,
      supplierId: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      currency: suppliers.currency,
      leadTimeDays: suppliers.leadTimeDays,
      unitPriceMinor: supplierItems.unitPriceMinor,
      moqMilli: supplierItems.moqMilli,
      preferred: supplierItems.isPreferred,
    })
    .from(supplierItems)
    .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId))
    .where(eq(suppliers.active, true));
  const thresholds = await approvalThresholds(db);

  const sources = new Map<string, Source[]>();
  for (const it of items) {
    const list = sources.get(it.materialId) ?? [];
    list.push({ ...it, currency: it.currency as Currency });
    sources.set(it.materialId, list);
  }

  const groups = new Map<string, SuggestionGroup>();
  for (const m of mats) {
    const unit = m.unit as Unit;
    const need = waiting.get(m.id);
    const waitingNeedMilli = need?.neededMilli ?? 0;
    const incomingMilli = incoming.get(m.id) ?? 0;
    const availableMilli = m.onHandMilli - m.reservedMilli;
    const gapMilli = waitingNeedMilli + m.reorderPointMilli - availableMilli - incomingMilli;
    if (gapMilli <= 0) continue;

    const source = pickSource(sources.get(m.id) ?? []);
    const qtyMilli = roundUpToStep(Math.max(gapMilli, source?.moqMilli ?? 0), unit);
    const unitPriceMinor = source?.unitPriceMinor ?? 0;
    const reasons: SuggestionReason[] = [];
    if (availableMilli < m.reorderPointMilli) reasons.push("kritik");
    if (waitingNeedMilli > 0) reasons.push("bekleyen_is");
    const line: SuggestionLine = {
      materialId: m.id,
      code: m.code,
      name: m.name,
      unit,
      availableMilli,
      reorderPointMilli: m.reorderPointMilli,
      waitingNeedMilli,
      incomingMilli,
      gapMilli,
      qtyMilli,
      moqMilli: source?.moqMilli ?? 0,
      unitPriceMinor,
      lineNetMinor: lineValueKurus(qtyMilli, unitPriceMinor),
      reasons,
      waitingWorkOrders: need?.workOrders ?? [],
    };
    const key = source?.supplierId ?? "";
    const group = groups.get(key) ?? {
      supplierId: source?.supplierId ?? null,
      supplierCode: source?.code ?? null,
      supplierName: source?.name ?? UNDEFINED_SUPPLIER_NAME,
      currency: source?.currency ?? "TRY",
      leadTimeDays: source?.leadTimeDays ?? null,
      lines: [],
      netMinor: 0,
      requiredTier: 0 as ApprovalTier,
    };
    group.lines.push(line);
    group.netMinor += line.lineNetMinor;
    groups.set(key, group);
  }

  const out = [...groups.values()];
  for (const g of out) {
    g.lines.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    // 3A'da yalnızca TL tedarikçi vardır: netMinor kuruştur. Tanımsız grup fiyatsızdır, onay gerekmez.
    g.requiredTier = g.supplierId ? requiredTier(g.netMinor, thresholds) : 0;
  }
  const hasWaiting = (g: SuggestionGroup) => g.lines.some((l) => l.waitingNeedMilli > 0);
  out.sort((a, b) => {
    if ((a.supplierId === null) !== (b.supplierId === null)) return a.supplierId === null ? 1 : -1;
    return Number(hasWaiting(b)) - Number(hasWaiting(a)) || a.supplierName.localeCompare(b.supplierName, "tr");
  });
  return out;
}
