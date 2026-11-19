import type { SessionUser } from "@/domain/context";
import { addWorkdays, istanbulDayStart } from "@/domain/production/calendar";
import { canApprove, pendingTier, requiredTier } from "@/domain/purchasing/approval";
import type { PurchaseOrderDetail, PurchaseOrderLineRow, PurchaseOrderRow } from "@/domain/purchasing/queries";
import type { SuggestionGroup, SuggestionReason } from "@/domain/purchasing/suggestions";
import type { ApprovalTier, PurchaseOrderStatus } from "@/domain/purchasing/types";
import type { ApprovalThresholds } from "@/domain/settings";
import { formatMoney, formatNumber, formatQty, lineValueKurus, parseDecimal, toKurus, toMilli, UNIT_STEP_MILLI, unitLabel, type Unit } from "@/domain/units";
import { formatDate } from "@/ui/format";
import type { Tone } from "@/ui/StatusChip";

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Taslak",
  pending_approval: "Onay bekliyor",
  sent: "Gönderildi",
  partial: "Kısmi teslim",
  received: "Teslim alındı",
  cancelled: "İptal",
};

export const PO_STATUS_TONE: Record<PurchaseOrderStatus, Tone> = {
  draft: "neutral",
  pending_approval: "warn",
  sent: "info",
  partial: "info",
  received: "ok",
  cancelled: "danger",
};

export const TIER_LABEL: Record<ApprovalTier, string> = {
  0: "Doğrudan gönderilir",
  1: "Müdür onayı",
  2: "Müdür + Yönetim onayı",
};

export const TIER_TONE: Record<ApprovalTier, Tone> = { 0: "neutral", 1: "warn", 2: "danger" };

export const REASON_LABEL: Record<SuggestionReason, string> = { kritik: "Kritik stok", bekleyen_is: "Bekleyen iş emri" };

/** Sipariş durumları çip sırasıyla. */
export const PO_STATUS_ORDER: readonly PurchaseOrderStatus[] = ["draft", "pending_approval", "sent", "partial", "received", "cancelled"];

export function asPoStatus(value: string | null): PurchaseOrderStatus | undefined {
  return (PO_STATUS_ORDER as readonly string[]).includes(value ?? "") ? (value as PurchaseOrderStatus) : undefined;
}

const limitText = (kurus: number) => `${formatNumber(kurus / 100)} TL`;

/** Beklenen teslim günü: gönderim gününden tedarikçinin teslim süresi kadar iş günü sonra (serviste de aynı hesap). */
export function expectedDelivery(now: Date, leadTimeDays: number): Date {
  return addWorkdays(istanbulDayStart(now), leadTimeDays);
}

/** Taslak oluşturma onay metninin kademe cümlesi. */
export function tierSentence(tier: ApprovalTier): string {
  if (tier === 0) return "Gönderimde doğrudan tedarikçiye gidecek, onay gerekmeyecek.";
  if (tier === 1) return "Gönderimde Satın Alma müdürü onayı gerekecek.";
  return "Gönderimde Satın Alma müdürü ve Yönetim onayı gerekecek.";
}

export function draftFromSuggestionText(group: Pick<SuggestionGroup, "supplierCode" | "lines" | "netMinor" | "requiredTier">): string {
  return `${group.supplierCode} için ${group.lines.length} kalem, ${formatMoney(group.netMinor)} KDV hariç taslak açılsın mı? ${tierSentence(group.requiredTier)}`;
}

/** Tutardan gereken kademe, onay penceresinde göstermek için (serviste gönderimde donar). */
export function tierFor(netKurus: number, thresholds: ApprovalThresholds): ApprovalTier {
  return requiredTier(netKurus, thresholds);
}

export function submitText(po: Pick<PurchaseOrderRow, "code" | "netKurus">, thresholds: ApprovalThresholds, expected: Date | null): string {
  const tier = tierFor(po.netKurus, thresholds);
  const money = `${formatMoney(po.netKurus)} KDV hariç`;
  if (tier === 0) {
    return `${po.code}: ${money}, ${limitText(thresholds.managerKurus)} eşiğini aşmıyor; onay gerekmeden tedarikçiye gönderilir${expected ? `, beklenen teslim ${formatDate(expected)}` : ""}.`;
  }
  if (tier === 1) return `${po.code}: ${money} ${limitText(thresholds.managerKurus)} eşiğini aşıyor; Satın Alma müdürünün onayına gider.`;
  return `${po.code}: ${money} ${limitText(thresholds.boardKurus)} eşiğini aşıyor; önce Satın Alma müdürünün, sonra Yönetim'in onayına gider.`;
}

export type ApprovalSubject = Pick<PurchaseOrderRow, "status" | "createdById" | "requiredTier" | "managerApprovedBy" | "boardApprovedBy">;

/** Servisteki `canApprove` kuralına satır biçimini uydurur. */
/** Servisteki `canApprove` kuralı (düğmeyi ve notu belirler). */
export function userCanApprove(user: Pick<SessionUser, "id" | "departmentCode" | "level">, po: ApprovalSubject): boolean {
  return canApprove(user, { ...po, createdBy: po.createdById });
}

/** Bu onay siparişi gönderir mi, yoksa sıradaki kademeye mi bırakır? */
export function approvalReleases(user: Pick<SessionUser, "departmentCode">, po: ApprovalSubject): boolean {
  const tier = pendingTier(po);
  if (tier === null) return false;
  if (po.requiredTier === 2 && tier === "manager") return user.departmentCode === "yonetim";
  return true;
}

export function approveText(
  user: Pick<SessionUser, "departmentCode">,
  po: Pick<PurchaseOrderRow, "code" | "netKurus" | "status" | "createdById" | "requiredTier" | "managerApprovedBy" | "boardApprovedBy">,
  expected: Date | null,
): string {
  const tier = pendingTier(po);
  const stage = tier === "board" ? "Yönetim kademesi" : "müdür kademesi";
  const head = `${po.code}: ${TIER_LABEL[po.requiredTier]} gerekiyor; ${formatMoney(po.netKurus)} KDV hariç, ${stage} onaylanacak.`;
  if (approvalReleases(user, po)) {
    return `${head} Onaylanınca tedarikçiye gönderilir${expected ? `, beklenen teslim ${formatDate(expected)}` : ""}.`;
  }
  return `${head} Sipariş ardından Yönetim onayı bekler.`;
}

export function cancelText(po: Pick<PurchaseOrderDetail, "code" | "supplierName" | "lines" | "netKurus" | "status">): string {
  const kept = po.lines.filter((l) => l.receivedMilli > 0).map((l) => `${l.materialCode} ${formatQty(l.receivedMilli, l.unit)}`);
  return `${po.code}, ${po.supplierName}: ${po.lines.length} kalem, ${formatMoney(po.netKurus)} KDV hariç ${PO_STATUS_LABEL[po.status].toLowerCase()} sipariş iptal edilecek. ${
    kept.length > 0 ? `Teslim alınan ${kept.join(", ")} stokta kalır. ` : ""
  }Geri alınamaz.`;
}

export function removeLineText(po: Pick<PurchaseOrderDetail, "code" | "netKurus" | "lines">, line: PurchaseOrderLineRow): string {
  const after = po.netKurus - line.lineNetMinor;
  const left = po.lines.length - 1;
  return `${po.code}: ${line.materialCode} ${line.materialName} kalemi silinecek, ${left} kalem kalacak. Sipariş tutarı ${formatMoney(po.netKurus)} → ${formatMoney(after)} olacak.`;
}

export type LineEdit = { qtyMilli: number; unitPriceMinor: number };

/** Satır içi düzenleme girişi: miktar birimin adımına tam bölünür, fiyat sıfır ya da büyük. */
export function parseLineEdit(qty: string, price: string, unit: Unit): ({ errors?: undefined } & LineEdit) | { errors: { qty?: string; price?: string } } {
  const errors: { qty?: string; price?: string } = {};
  const q = parseDecimal(qty);
  const p = parseDecimal(price);
  const qtyMilli = q === null ? 0 : toMilli(q);
  if (q === null) errors.qty = "Geçerli bir miktar girin";
  else if (qtyMilli <= 0) errors.qty = "Miktar sıfırdan büyük olmalı";
  else if (qtyMilli % UNIT_STEP_MILLI[unit] !== 0) errors.qty = `Miktar ${formatQty(UNIT_STEP_MILLI[unit], unit)} katı olmalı`;
  if (p === null) errors.price = "Geçerli bir tutar girin";
  if (errors.qty || errors.price || p === null) return { errors };
  return { qtyMilli, unitPriceMinor: toKurus(p) };
}

/** Düzenleme sonrası sipariş tutarı ve onay penceresi için değişen alanlar. */
export function previewLineEdit(po: Pick<PurchaseOrderDetail, "netKurus">, line: PurchaseOrderLineRow, next: LineEdit) {
  const afterKurus = po.netKurus - line.lineNetMinor + lineValueKurus(next.qtyMilli, next.unitPriceMinor);
  const changes = [];
  if (next.qtyMilli !== line.qtyMilli) changes.push({ label: "Miktar", from: formatQty(line.qtyMilli, line.unit), to: formatQty(next.qtyMilli, line.unit) });
  if (next.unitPriceMinor !== line.unitPriceMinor) {
    changes.push({ label: "Birim fiyat", from: priceText(line.unitPriceMinor, line.unit), to: priceText(next.unitPriceMinor, line.unit) });
  }
  return { beforeKurus: po.netKurus, afterKurus, changes };
}

export function priceText(minor: number, unit: Unit): string {
  return `${formatMoney(minor)} / ${unitLabel(unit)}`;
}

export type ApprovalView = {
  /** Gereken kademe cümlesi ("Bu sipariş Müdür + Yönetim onayı ister"). */
  required: string;
  steps: { key: "manager" | "board"; label: string; done: boolean; text: string }[];
  /** Kullanıcı sıradaki kademeyi onaylayabilir mi. */
  can: boolean;
  /** Onay beklerken sıradaki kademe: "Onay bekleniyor: Satın Alma müdürü". */
  waiting: string | null;
  /** Kullanıcı sıradaki kademeyi onaylayamıyorsa nedeni ("Kendi siparişinizi onaylayamazsınız"). */
  note: string | null;
};

/**
 * Çekmecedeki onay zinciri: gereken kademe, kim ne zaman onayladı ve oturumdaki kullanıcının durumu. Taslakta kademe
 * henüz donmamıştır; verilen eşiklerden tahmin edilir. Onay beklemeyen siparişte not yoktur.
 */
export function approvalView(user: Pick<SessionUser, "id" | "departmentCode" | "level">, po: PurchaseOrderDetail, thresholds: ApprovalThresholds | undefined): ApprovalView {
  const draft = po.status === "draft";
  const tier: ApprovalTier = draft ? (thresholds ? tierFor(po.netKurus, thresholds) : 0) : po.requiredTier;
  const pending = pendingTier(po);
  const steps: ApprovalView["steps"] = [];
  const stepText = (name: string | null, key: "manager" | "board") => {
    if (name) return `Onayladı: ${name}`;
    if (po.status === "cancelled") return "Onaylanmadı";
    if (draft) return "Gönderimde istenecek";
    return pending === key ? "Bekleniyor" : "Sırası gelmedi";
  };
  if (tier >= 1) steps.push({ key: "manager", label: "Satın Alma müdürü", done: po.managerApprovedBy !== null, text: stepText(po.managerApprovedByName, "manager") });
  if (tier === 2) steps.push({ key: "board", label: "Yönetim", done: po.boardApprovedBy !== null, text: stepText(po.boardApprovedByName, "board") });

  const can = userCanApprove(user, po);
  let waiting: string | null = null;
  let note: string | null = null;
  if (po.status === "pending_approval" && pending !== null) {
    waiting = `Onay bekleniyor: ${pending === "board" ? "Yönetim" : "Satın Alma müdürü"}`;
    if (!can) {
      if (po.createdById === user.id) note = "Kendi siparişinizi onaylayamazsınız";
      else if (pending === "board") note = "Bu kademe Yönetim onayı ister";
      else note = "Bu kademe Satın Alma müdürü onayı ister";
    }
  }
  return { required: tier === 0 ? "Onay gerekmez, doğrudan gönderilir" : `Bu sipariş ${TIER_LABEL[tier]} ister`, steps, can, waiting, note };
}

/** Listedeki "Onay durumu" sütunu: sıradaki kademe, onaylandı ya da onay gerekmedi. */
export function approvalLabel(po: ApprovalSubject): string {
  if (po.status === "draft" || po.status === "cancelled") return "—";
  const tier = pendingTier(po);
  if (tier === "manager") return "Müdür onayı bekliyor";
  if (tier === "board") return "Yönetim onayı bekliyor";
  return po.requiredTier === 0 ? "Onay gerekmedi" : "Onaylandı";
}

/** Kalemlerden KDV hariç, oran başına KDV ve KDV dahil tutar (kuruş). Her oranın KDV'si o orandaki kalemlerin toplamından yuvarlanır. */
export function purchaseTotals(lines: readonly Pick<PurchaseOrderLineRow, "lineNetMinor" | "vatRate">[]): {
  netKurus: number;
  vatByRate: Record<string, number>;
  vatKurus: number;
  totalKurus: number;
} {
  const netByRate = new Map<number, number>();
  let netKurus = 0;
  for (const l of lines) {
    netKurus += l.lineNetMinor;
    netByRate.set(l.vatRate, (netByRate.get(l.vatRate) ?? 0) + l.lineNetMinor);
  }
  const vatByRate: Record<string, number> = {};
  let vatKurus = 0;
  for (const [rate, net] of netByRate) {
    const vat = Math.round((net * rate) / 100);
    vatByRate[String(rate)] = vat;
    vatKurus += vat;
  }
  return { netKurus, vatByRate, vatKurus, totalKurus: netKurus + vatKurus };
}
