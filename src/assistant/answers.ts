// Yerel cevap üreticileri: seçeneği ya da yazıyı mevcut sorgularla cevaplar ve ekranın çizeceği tipli parçalar döner
// (metin, kart, çip, menü). İş kuralı çoğaltılmaz; liste, süzgeç ve yetki mevcut sorgulardan gelir.
import type { Ctx, SessionUser } from "@/domain/context";
import { inventorySummary, listMaterials, listMovements, type MaterialRow } from "@/domain/inventory/queries";
import { can } from "@/domain/permissions";
import { istanbulDayStart } from "@/domain/production/calendar";
import { isWaitingForMaterial, listProducts, listWorkOrders, todaysWorkOrders, type WorkOrderRow } from "@/domain/production/queries";
import { listPurchaseOrders, listReceivable, listSuppliers, type PurchaseOrderRow } from "@/domain/purchasing/queries";
import { purchaseSuggestions } from "@/domain/purchasing/suggestions";
import { listCustomers, listOrders, salesSummary, type OrderRow } from "@/domain/sales/queries";
import { formatQty } from "@/domain/units";
import { MOVEMENT_LABEL } from "@/features/inventory/labels";
import { WO_STATUS_LABEL, WO_STATUS_TONE } from "@/features/production/labels";
import { PO_STATUS_LABEL, PO_STATUS_TONE } from "@/features/purchasing/labels";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/features/sales/labels";
import { formatDate, formatSignedQty } from "@/ui/format";
import type { Tone } from "@/ui/StatusChip";
import { type CategoryId, CATEGORIES, followUps, INTENT_BY_ID, type IntentDef, type SlotEntity, visibleCategories, visibleIntents } from "./intents";
import { type CodeEntity, routeText } from "./match";

export const MAX_ROWS = 5;

export type Row = { key: string; code?: string; name: string; sub?: string; chip?: { label: string; tone: Tone }; href: string };
export type CardData = {
  title: string;
  /** Toplam kayıt sayısı (satırlar en çok 5 tanedir). */
  count?: number;
  rows: Row[];
  steps?: string[];
  more?: { label: string; href: string };
  empty?: string;
};
export type ChipAction =
  | { type: "intent"; id: string }
  | { type: "category"; id: CategoryId }
  | { type: "menu" }
  | { type: "text"; text: string }
  | { type: "link"; href: string };
export type ChipData = { label: string; action: ChipAction };
export type Part = { type: "text"; text: string } | { type: "card"; card: CardData } | { type: "chips"; chips: ChipData[] } | { type: "menu" };
/** `slot`: asistan bir girdi bekliyor; sonraki serbest yazı onu doldurur. */
export type Reply = { parts: Part[]; slot?: string | null };

export const MENU_CHIP: ChipData = { label: "⌂ Menü", action: { type: "menu" } };
export const UNSURE_TEXT = "Bunu mu demek istediniz?";

const firstName = (user: SessionUser) => user.name.split(" ")[0] ?? user.name;
const text = (t: string): Part => ({ type: "text", text: t });

export function intentChip(def: IntentDef): ChipData {
  return { label: def.label, action: def.kind === "link" && def.href ? { type: "link", href: def.href } : { type: "intent", id: def.id } };
}

function withChips(parts: Part[], chips: ChipData[], slot?: string | null): Reply {
  return { parts: [...parts, { type: "chips", chips: [...chips, MENU_CHIP] }], slot: slot ?? null };
}

/** Ana menü: selam ve kategori kutucukları. */
export function menuReply(user: SessionUser, greeting = false): Reply {
  const hello = greeting ? `Merhaba ${firstName(user)}!` : `Ana menü, ${firstName(user)}.`;
  return { parts: [text(`${hello} Aşağıdan bir başlık seçin ya da ne istediğinizi yazın.`), { type: "menu" }], slot: null };
}

export function welcomeReply(user: SessionUser): Reply {
  return { parts: [text(`Merhaba ${firstName(user)}, ben Atölye Asistanı. Bir başlık seçin ya da ne istediğinizi yazın; sipariş, iş emri, stok ve satın almayı sorabilirsiniz.`), { type: "menu" }], slot: null };
}

/** Kategori alt menüsü: o kategorinin seçenekleri. */
export function categoryReply(user: SessionUser, id: CategoryId): Reply {
  const label = CATEGORIES.find((c) => c.id === id)?.label ?? "";
  const chips = visibleIntents(user, id).map(intentChip);
  return withChips([text(`${label}: ne yapmak istersiniz?`)], chips);
}

export function socialReply(user: SessionUser, kind: "greeting" | "thanks"): Reply {
  if (kind === "thanks") return { parts: [text("Rica ederim. Başka bir şey lazım olursa buradayım."), { type: "menu" }], slot: null };
  return menuReply(user, true);
}

export function unsureReply(user: SessionUser, suggestions: string[]): Reply {
  const chips = suggestions.map((id) => INTENT_BY_ID.get(id)).filter((d): d is IntentDef => !!d && visibleIntents(user).some((v) => v.id === d.id)).map(intentChip);
  return withChips([text(UNSURE_TEXT)], chips);
}

// Satır üreticileri

export const orderRow = (o: OrderRow): Row => ({
  key: o.id,
  code: o.code,
  name: o.customerName,
  sub: `Termin ${formatDate(o.dueAt)}`,
  chip: o.overdue ? { label: "Gecikmiş", tone: "danger" } : { label: ORDER_STATUS_LABEL[o.status], tone: ORDER_STATUS_TONE[o.status] },
  href: `/satis/siparisler?ac=${o.id}`,
});
export const workOrderRow = (w: WorkOrderRow): Row => ({
  key: w.id,
  code: w.code,
  name: w.productName,
  sub: w.currentStation ?? w.orderCode ?? undefined,
  chip: { label: WO_STATUS_LABEL[w.status], tone: WO_STATUS_TONE[w.status] },
  href: `/uretim/is-emirleri?ac=${w.id}`,
});
export const materialRow = (m: MaterialRow): Row => ({
  key: m.id,
  code: m.code,
  name: m.name,
  sub: `Eldeki ${formatQty(m.onHandMilli, m.unit)}`,
  chip: { label: m.isCritical ? `${formatQty(m.availableMilli, m.unit)} · kritik` : formatQty(m.availableMilli, m.unit), tone: m.isCritical ? "danger" : "ok" },
  href: `/stok/malzemeler?ac=${m.id}`,
});
export const purchaseRow = (p: PurchaseOrderRow): Row => ({
  key: p.id,
  code: p.code,
  name: p.supplierName,
  sub: p.expectedAt ? `Beklenen ${formatDate(p.expectedAt)}` : undefined,
  chip: p.late ? { label: "Gecikmiş", tone: "danger" } : { label: PO_STATUS_LABEL[p.status], tone: PO_STATUS_TONE[p.status] },
  href: `/satin-alma/siparisler?ac=${p.id}`,
});

function listCard(title: string, all: Row[], o: { more?: { label: string; href: string }; empty: string }): CardData {
  return { title, count: all.length, rows: all.slice(0, MAX_ROWS), more: all.length > 0 ? o.more : undefined, empty: o.empty };
}
const reply = (user: SessionUser, id: string, card: CardData, slot?: string | null): Reply => withChips([{ type: "card", card }], followUps(user, id).map(intentChip), slot);

const hasPerm = (user: SessionUser, module: Parameters<typeof can>[1]) => can(user, module, "view");

async function summaryCard(ctx: Ctx): Promise<CardData> {
  const { db, user, now } = ctx;
  const rows: Row[] = [];
  const stat = (key: string, name: string, n: number, href: string, bad = false) =>
    rows.push({ key, name, href, chip: { label: String(n), tone: bad && n > 0 ? "danger" : "neutral" } });
  if (hasPerm(user, "sales")) {
    const s = await salesSummary(db, now);
    stat("open", "Açık sipariş", s.openOrders, "/satis/siparisler");
    stat("overdue", "Geciken sipariş", s.overdue, "/satis/siparisler?geciken=1", true);
    stat("waiting", "Malzeme bekleyen sipariş", s.waitingMaterial, "/satis/siparisler?bekleyen=1", true);
  }
  if (hasPerm(user, "planning")) {
    stat("today", "Bugünün iş emirleri", (await todaysWorkOrders(db, now)).length, "/uretim/is-emirleri");
    stat("unscheduled", "Planlanmamış iş emri", (await listWorkOrders(db, { unscheduled: true })).length, "/uretim/is-emirleri?planlanmamis=1", true);
  }
  if (hasPerm(user, "inventory")) stat("critical", "Kritik malzeme", (await inventorySummary(db)).criticalCount, "/stok/malzemeler?kritik=1", true);
  if (hasPerm(user, "purchasing")) {
    stat("pending", "Onay bekleyen satın alma", (await listPurchaseOrders(db, { status: "pending_approval", now })).length, "/satin-alma/siparisler?durum=pending_approval");
    stat("receivable", "Mal kabul bekleyen", (await listReceivable(db, now)).length, "/depo/mal-kabul");
  }
  return { title: "Günün özeti", rows, empty: "Gösterilecek bir şey yok." };
}

const SLOT_ROUTE: Record<SlotEntity, { title: string; more: string; label: string }> = {
  order: { title: "Siparişler", more: "/satis/siparisler", label: "Siparişlerde gör" },
  customer: { title: "Müşteriler", more: "/satis/musteriler", label: "Müşterilerde gör" },
  material: { title: "Malzemeler", more: "/stok/malzemeler", label: "Malzemelerde gör" },
  supplier: { title: "Tedarikçiler", more: "/satin-alma/tedarikciler", label: "Tedarikçilerde gör" },
  workorder: { title: "İş emirleri", more: "/uretim/is-emirleri", label: "İş emirlerinde gör" },
  product: { title: "Ürünler", more: "/uretim/urunler", label: "Ürünlerde gör" },
};

async function lookup(ctx: Ctx, entity: SlotEntity, term: string): Promise<Row[]> {
  const { db, now } = ctx;
  switch (entity) {
    case "order":
      return (await listOrders(db, { search: term, now })).map(orderRow);
    case "customer":
      return (await listCustomers(db, { search: term })).map((c) => ({ key: c.id, code: c.code, name: c.name, sub: c.city, chip: { label: `${c.orderCount} sipariş`, tone: "neutral" as Tone }, href: `/satis/musteriler?ac=${c.id}` }));
    case "material":
      return (await listMaterials(db, { search: term })).map(materialRow);
    case "supplier":
      return (await listSuppliers(db, { search: term })).map((s) => ({ key: s.id, code: s.code, name: s.name, sub: s.city, chip: { label: `${s.openOrderCount} açık sipariş`, tone: "neutral" as Tone }, href: `/satin-alma/tedarikciler?ac=${s.id}` }));
    case "workorder":
      return (await listWorkOrders(db, { search: term })).map(workOrderRow);
    case "product":
      return (await listProducts(db, { search: term })).map((p) => ({ key: p.id, code: p.code, name: p.name, chip: { label: `Stok ${formatQty(p.availableMilli, "adet")}`, tone: p.availableMilli > 0 ? ("ok" as Tone) : ("warn" as Tone) }, href: `/uretim/urunler?ac=${p.id}` }));
  }
}

/** Boşluk sorusunda önerilen en son 3-5 kayıt. Çip metni kayıt koduna ya da adına yazılır. */
export async function recentChips(ctx: Ctx, entity: SlotEntity): Promise<ChipData[]> {
  const { db, now } = ctx;
  const chip = (label: string): ChipData => ({ label, action: { type: "text", text: label } });
  switch (entity) {
    case "order":
      return (await listOrders(db, { now })).slice(0, 4).map((o) => chip(o.code));
    case "customer":
      return (await listCustomers(db)).sort((a, b) => (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0)).slice(0, 4).map((c) => chip(c.name));
    case "material": {
      const critical = await listMaterials(db, { criticalOnly: true });
      return (critical.length >= 3 ? critical : [...critical, ...(await listMaterials(db))]).slice(0, 4).map((m) => chip(m.code));
    }
    case "supplier":
      return (await listSuppliers(db)).sort((a, b) => b.openOrderCount - a.openOrderCount).slice(0, 4).map((s) => chip(s.name));
    case "workorder":
      return (await listWorkOrders(db)).slice(0, 4).map((w) => chip(w.code));
    case "product":
      return (await listProducts(db)).slice(0, 4).map((p) => chip(p.name));
  }
}

/** Boşluk doldurma sonucu: yazılan metinle kayıtları arar. */
async function slotResult(ctx: Ctx, def: IntentDef, term: string): Promise<Reply> {
  const entity = def.entity!;
  const info = SLOT_ROUTE[entity];
  const rows = await lookup(ctx, entity, term);
  const empty = `“${term}” ile eşleşen kayıt bulunamadı. Başka bir yazılışla deneyin.`;
  const more = { label: "Hepsini gör →", href: `${info.more}?q=${encodeURIComponent(term)}` };
  const card = listCard(`${info.title}: “${term}”`, rows, { more, empty });
  // Sonuç yoksa asistan aynı boşluğu tekrar bekler; bir sonraki yazı yeni deneme olur.
  return reply(ctx.user, def.id, card, rows.length === 0 ? def.id : null);
}

/** Bir seçeneği çalıştırır. Boşluk seçeneği `term` yoksa girdi ister. */
export async function answerIntent(ctx: Ctx, id: string, term?: string): Promise<Reply> {
  const { db, user, now } = ctx;
  const def = INTENT_BY_ID.get(id);
  if (!def) return menuReply(user);
  switch (def.kind) {
    case "slot": {
      if (term) return slotResult(ctx, def, term);
      return withChips([text(def.prompt ?? "Aramak istediğinizi yazın")], await recentChips(ctx, def.entity!), def.id);
    }
    case "link":
      return withChips([text(`${def.label}: ${def.linkLabel ?? "ekranı"} bağlantıdan açabilirsiniz.`), { type: "card", card: { title: def.label, rows: [{ key: def.id, name: def.linkLabel ?? def.label, href: def.href! }] } }], followUps(user, id).map(intentChip));
    case "guide":
      return reply(user, id, { title: def.label.replace(/\?$/, ""), rows: [], steps: def.steps, more: { label: `${def.linkLabel ?? "Ekrana git"} →`, href: def.href! } });
    case "summary":
      return reply(user, id, await summaryCard(ctx));
    case "list":
      break;
  }
  const none = (what: string) => `${what} yok. Her şey yolunda.`;
  switch (id) {
    case "overdue_orders": {
      const rows = (await listOrders(db, { now })).filter((o) => o.overdue).map(orderRow);
      return reply(user, id, listCard("Geciken siparişler", rows, { more: { label: "Hepsini gör →", href: "/satis/siparisler?geciken=1" }, empty: none("Geciken sipariş") }));
    }
    case "draft_orders": {
      const rows = (await listOrders(db, { status: "draft", now })).map(orderRow);
      return reply(user, id, listCard("Taslak siparişler", rows, { more: { label: "Hepsini gör →", href: "/satis/siparisler?durum=draft" }, empty: "Onay bekleyen taslak sipariş yok." }));
    }
    case "waiting_orders": {
      const rows = (await listOrders(db, { now })).filter((o) => o.waitingMaterial).map(orderRow);
      return reply(user, id, listCard("Malzeme bekleyen siparişler", rows, { more: { label: "Hepsini gör →", href: "/satis/siparisler?bekleyen=1" }, empty: none("Malzeme bekleyen sipariş") }));
    }
    case "today_wo": {
      const rows = (await todaysWorkOrders(db, now)).map(workOrderRow);
      return reply(user, id, listCard("Bugünün iş emirleri", rows, { more: { label: "Hepsini gör →", href: "/uretim/is-emirleri" }, empty: "Bugün planlı iş emri yok." }));
    }
    case "unscheduled_wo": {
      const rows = (await listWorkOrders(db, { unscheduled: true })).map(workOrderRow);
      return reply(user, id, listCard("Planlanmamış iş emirleri", rows, { more: { label: "Hepsini gör →", href: "/uretim/is-emirleri?planlanmamis=1" }, empty: none("Planlanmamış iş emri") }));
    }
    case "waiting_wo": {
      const rows = (await listWorkOrders(db)).filter(isWaitingForMaterial).map(workOrderRow);
      return reply(user, id, listCard("Malzeme bekleyen iş emirleri", rows, { more: { label: "Hepsini gör →", href: "/uretim/is-emirleri?bekleyen=1" }, empty: none("Malzeme bekleyen iş emri") }));
    }
    case "late_wo": {
      const today = istanbulDayStart(now).getTime();
      const rows = (await listWorkOrders(db))
        .filter((w) => (w.status === "planned" || w.status === "in_progress") && w.dueAt !== null && w.dueAt.getTime() < today)
        .map((w) => ({ ...workOrderRow(w), sub: `Termin ${formatDate(w.dueAt!)}` }));
      return reply(user, id, listCard("Termine yetişmeyen iş emirleri", rows, { more: { label: "Hepsini gör →", href: "/uretim/is-emirleri" }, empty: none("Termini geçen iş emri") }));
    }
    case "critical": {
      const rows = (await listMaterials(db, { criticalOnly: true })).map(materialRow);
      return reply(user, id, listCard("Kritik stok", rows, { more: { label: "Hepsini gör →", href: "/stok/malzemeler?kritik=1" }, empty: "Sipariş noktasının altında malzeme yok." }));
    }
    case "recent_movements": {
      const rows = (await listMovements(db, { limit: MAX_ROWS })).map((m): Row => ({
        key: m.id,
        code: m.materialCode,
        name: `${MOVEMENT_LABEL[m.type]}: ${m.materialName}`,
        sub: formatDate(m.createdAt),
        chip: { label: formatSignedQty(m.deltaOnHandMilli !== 0 ? m.deltaOnHandMilli : m.deltaReservedMilli, m.unit), tone: "neutral" },
        href: `/stok/malzemeler?ac=${m.materialId}`,
      }));
      return reply(user, id, listCard("Son stok hareketleri", rows, { more: { label: "Hepsini gör →", href: "/stok/hareketler" }, empty: "Henüz stok hareketi yok." }));
    }
    case "po_pending": {
      const rows = (await listPurchaseOrders(db, { status: "pending_approval", now })).map(purchaseRow);
      return reply(user, id, listCard("Onay bekleyen satın alma", rows, { more: { label: "Hepsini gör →", href: "/satin-alma/siparisler?durum=pending_approval" }, empty: "Onay bekleyen satın alma yok." }));
    }
    case "po_suggestions": {
      const groups = await purchaseSuggestions(db);
      const rows = groups.map((g, i): Row => ({ key: g.supplierId ?? `g${i}`, code: g.supplierCode ?? undefined, name: g.supplierName, sub: `${g.lines.length} kalem`, chip: { label: `${g.lines.length} kalem`, tone: "info" }, href: "/satin-alma/oneriler" }));
      return reply(user, id, listCard("Satın alma önerileri", rows, { more: { label: "Hepsini gör →", href: "/satin-alma/oneriler" }, empty: "Şu an satın alma önerisi yok." }));
    }
    case "po_late": {
      const rows = (await listPurchaseOrders(db, { now })).filter((p) => p.late).map(purchaseRow);
      return reply(user, id, listCard("Geciken teslimler", rows, { more: { label: "Hepsini gör →", href: "/satin-alma/siparisler" }, empty: none("Geciken teslim") }));
    }
    case "receivable": {
      const rows = (await listReceivable(db, now)).map((p): Row => ({ ...purchaseRow(p), sub: `${p.remainingLineCount} kalem bekliyor`, href: `/depo/mal-kabul?ac=${p.id}` }));
      return reply(user, id, listCard("Mal kabul bekleyenler", rows, { more: { label: "Hepsini gör →", href: "/depo/mal-kabul" }, empty: "Mal kabul bekleyen sipariş yok." }));
    }
  }
  return menuReply(user);
}

const CODE_INTENT: Record<CodeEntity, { entity: SlotEntity; intent: string }> = {
  order: { entity: "order", intent: "order_lookup" },
  workorder: { entity: "workorder", intent: "wo_lookup" },
  po: { entity: "order", intent: "po_pending" },
  material: { entity: "material", intent: "material_search" },
  supplier: { entity: "supplier", intent: "supplier_search" },
  product: { entity: "product", intent: "product_stock" },
};

/** Kayıt koduna göre doğrudan kayıt kartı. */
export async function answerCode(ctx: Ctx, code: string, entity: CodeEntity): Promise<Reply> {
  const { db, now, user } = ctx;
  const map = CODE_INTENT[entity];
  let rows: Row[];
  if (entity === "po") rows = (await listPurchaseOrders(db, { search: code, now })).filter((p) => p.code === code).map(purchaseRow);
  else rows = (await lookup(ctx, map.entity, code)).filter((r) => r.code === code);
  const title = code;
  const card: CardData = { title, count: rows.length, rows, empty: `${code} bulunamadı. Kodu kontrol edin.` };
  const chips = followUps(user, map.intent).map(intentChip);
  return withChips([{ type: "card", card }], chips);
}

/** Niyet çıkmayan yazıdaki ad parçasını müşteri, ürün, malzeme ve tedarikçilerde arar. */
export async function answerEntitySearch(ctx: Ctx, term: string): Promise<Reply | null> {
  const { user } = ctx;
  const groups: [SlotEntity, string, boolean][] = [
    ["customer", "Müşteri", hasPerm(user, "sales")],
    ["product", "Ürün", hasPerm(user, "planning")],
    ["material", "Malzeme", hasPerm(user, "inventory")],
    ["supplier", "Tedarikçi", hasPerm(user, "purchasing")],
  ];
  const rows: Row[] = [];
  let total = 0;
  for (const [entity, label, ok] of groups) {
    if (!ok) continue;
    const found = await lookup(ctx, entity, term);
    total += found.length;
    rows.push(...found.slice(0, 2).map((r) => ({ ...r, sub: [label, r.sub].filter(Boolean).join(" · ") })));
  }
  if (total === 0) return null;
  const card: CardData = { title: `“${term}” için sonuçlar`, count: total, rows: rows.slice(0, MAX_ROWS), empty: "" };
  return withChips([{ type: "card", card }], []);
}

/** Hızlı modun tek giriş noktası: yazıyı yönlendirir ve cevabı üretir. Kesin sözcük istemez. */
export async function answerText(ctx: Ctx, input: string, pendingSlot?: string | null): Promise<Reply> {
  const allowed = visibleIntents(ctx.user);
  const route = routeText(input, allowed, pendingSlot);
  switch (route.kind) {
    case "menu":
      return menuReply(ctx.user);
    case "greeting":
    case "thanks":
      return socialReply(ctx.user, route.kind);
    case "code":
      return answerCode(ctx, route.code, route.entity);
    case "slot_fill":
      return answerIntent(ctx, route.id, route.term);
    case "intent":
      return answerIntent(ctx, route.id, route.term);
    case "unsure": {
      if (route.term && route.term.length >= 3) {
        const found = await answerEntitySearch(ctx, route.term);
        if (found) return found;
      }
      return unsureReply(ctx.user, route.suggestions);
    }
  }
}

export { visibleCategories };
