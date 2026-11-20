// Hızlı yardımcı: yapay zekâ kapalıyken Türkçe soruyu kalıplarla tanır, cevabı veritabanından hesaplar.
// `parseQuestion` saf bir işlevdir (soru → niyet); `answerSimple` niyeti sorgulara çevirir. Cevaplar, kayıtlara
// `[KOD](/yol?ac=kimlik)` biçiminde bağlantı verir; sohbet bunları bağlantı olarak çizer.
import type { Db } from "@/db/client";
import { listMaterials, type MaterialRow } from "@/domain/inventory/queries";
import { listWorkOrders, todaysWorkOrders } from "@/domain/production/queries";
import { listPurchaseOrders } from "@/domain/purchasing/queries";
import { listOrders } from "@/domain/sales/queries";
import { searchKey } from "@/domain/text";
import { formatQty } from "@/domain/units";
import { WO_STATUS_LABEL } from "@/features/production/labels";
import { PO_STATUS_LABEL } from "@/features/purchasing/labels";
import { ORDER_STATUS_LABEL } from "@/features/sales/labels";
import { formatDate } from "@/ui/format";

export type HowTo = "siparis" | "plan" | "satin-alma" | "mal-kabul" | "sayim";
export type Intent =
  | { kind: "critical" }
  | { kind: "overdue" }
  | { kind: "today" }
  | { kind: "code"; code: string }
  | { kind: "material"; term: string }
  | { kind: "howto"; topic: HowTo }
  | { kind: "help" };

const DOC_CODE = /\b(sip|ie|sas)[-\s]?(\d{4})[-\s]?(\d{4})\b/;
const MATERIAL_CODE = /\bmlz[-\s]?(\d{4})\b/;
const FILLER = new Set(["stok", "stogu", "stoku", "stoklari", "ne", "kadar", "var", "mi", "mu", "durumu", "durum", "nedir", "malzeme", "malzemesi", "kac", "kaldi", "bana", "goster", "bak", "ve"]);

/** Türkçe soruyu niyete çevirir. Büyük-küçük harf ve Türkçe harf farkı gözetilmez. */
export function parseQuestion(question: string): Intent {
  const key = searchKey(question).replace(/[?!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const doc = DOC_CODE.exec(key);
  if (doc) return { kind: "code", code: `${doc[1]!.toUpperCase()}-${doc[2]}-${doc[3]}` };
  const mat = MATERIAL_CODE.exec(key);
  if (mat) return { kind: "code", code: `MLZ-${mat[1]}` };

  if (key.includes("nasil")) {
    if (key.includes("mal kabul") || key.includes("teslim")) return { kind: "howto", topic: "mal-kabul" };
    if (key.includes("sayim")) return { kind: "howto", topic: "sayim" };
    if (key.includes("satin alma") || key.includes("satinalma") || key.includes("tedarik")) return { kind: "howto", topic: "satin-alma" };
    if (key.includes("is emir") || key.includes("plan")) return { kind: "howto", topic: "plan" };
    if (key.includes("siparis")) return { kind: "howto", topic: "siparis" };
    return { kind: "help" };
  }
  if (key.includes("kritik")) return { kind: "critical" };
  if (key.includes("gecik")) return { kind: "overdue" };
  if (key.includes("bugun") && (key.includes("is emir") || key.includes("uretim"))) return { kind: "today" };
  if (/stok|stog|malzeme/.test(key)) {
    const term = key
      .split(" ")
      .filter((w) => w && !FILLER.has(w))
      .join(" ");
    if (term) return { kind: "material", term };
  }
  return { kind: "help" };
}

const MAX_ROWS = 8;
const link = (label: string, path: string, id: string) => `[${label}](${path}?ac=${id})`;

const HOWTO: Record<HowTo, string> = {
  siparis:
    "Sipariş açmak için [Siparişler](/satis/siparisler) ekranında “Yeni sipariş” düğmesine basın: müşteriyi ve terminini seçin, taslak açılınca çekmecede ürün satırlarını ekleyin, sonra “Onayla”. Onayda mamul ayrılır, kalan adet için iş emri açılır. Bunun için Satış departmanında uzman olmanız gerekir.",
  plan: "İş emrini planlamak için [İş emirleri](/uretim/is-emirleri) ekranında kaydı açın ve “Planla” ile başlangıç gününü seçin; adımlar istasyon kapasitesine göre günlere dağılır. Sonra [Haftalık plan](/uretim/plan) ekranında kartları sürükleyerek günü değiştirebilirsiniz.",
  "satin-alma":
    "Eksik malzeme için [Öneriler](/satin-alma/oneriler) ekranına bakın: kritik stok ve malzeme bekleyen iş emirleri tedarikçiye göre gruplanır. Bir grubun taslağını açın, sonra [Satın alma siparişleri](/satin-alma/siparisler) ekranında siparişi gönderin; tutar eşiği aşarsa müdür onayı istenir.",
  "mal-kabul":
    "Mal kabul için [Mal kabul](/depo/mal-kabul) ekranında gönderilmiş siparişi seçin, gelen miktarları ve irsaliye numarasını girip “Mal kabul et” deyin. Stok bu işlemle artar. Depo departmanında yetki gerekir.",
  sayim: "Sayım için [Sayım](/stok/sayim) ekranında “Yeni sayım” ile fiş açın, sayılan miktarları girin ve fişi kapatın; fark varsa stok hareketi olarak yazılır.",
};

const HELP =
  "Şunları cevaplayabilirim:\n• kritik stok\n• geciken siparişler\n• bugünün iş emirleri\n• bir kodun durumu: SIP-…, IE-…, SAS-… ya da MLZ-…\n• malzeme adıyla stok, örneğin “meşe masif stoğu”\n• nasıl yapılır: sipariş açmak, iş emri planlamak, satın alma, mal kabul, sayım";

/** Niyeti veritabanından cevaplar; cevap bağlantılı düz metindir. */
export async function answerSimple(db: Db, question: string, now: Date): Promise<string> {
  const intent = parseQuestion(question);
  switch (intent.kind) {
    case "critical": {
      const rows = await listMaterials(db, { criticalOnly: true });
      if (rows.length === 0) return "Şu an sipariş noktasının altında malzeme yok.";
      const lines = rows
        .slice(0, MAX_ROWS)
        .map((m) => `• ${link(m.code, "/stok/malzemeler", m.id)} ${m.name}: kullanılabilir ${formatQty(m.availableMilli, m.unit)}, sipariş noktası ${formatQty(m.reorderPointMilli, m.unit)}`);
      const more = rows.length > MAX_ROWS ? `\n… ve ${rows.length - MAX_ROWS} malzeme daha: [Malzemeler](/stok/malzemeler)` : "";
      return `${rows.length} malzeme sipariş noktasının altında:\n${lines.join("\n")}${more}`;
    }
    case "overdue": {
      const rows = (await listOrders(db, { now })).filter((o) => o.overdue);
      if (rows.length === 0) return "Geciken sipariş yok.";
      const lines = rows
        .slice(0, MAX_ROWS)
        .map((o) => `• ${link(o.code, "/satis/siparisler", o.id)} ${o.customerName}: termin ${formatDate(o.dueAt)}, ${ORDER_STATUS_LABEL[o.status]}`);
      const more = rows.length > MAX_ROWS ? `\n… ve ${rows.length - MAX_ROWS} sipariş daha: [Siparişler](/satis/siparisler)` : "";
      return `${rows.length} sipariş gecikmiş:\n${lines.join("\n")}${more}`;
    }
    case "today": {
      const rows = await todaysWorkOrders(db, now);
      if (rows.length === 0) return "Bugün planlı iş emri yok.";
      const lines = rows
        .slice(0, MAX_ROWS)
        .map((w) => `• ${link(w.code, "/uretim/is-emirleri", w.id)} ${w.productName}: ${w.currentStation ?? "istasyon yok"}, ${WO_STATUS_LABEL[w.status]}`);
      return `Bugün ${rows.length} iş emri var:\n${lines.join("\n")}`;
    }
    case "code":
      return answerCode(db, intent.code, now);
    case "material": {
      const rows = await listMaterials(db, { search: intent.term });
      if (rows.length === 0) return `“${intent.term}” ile eşleşen malzeme bulunamadı.`;
      return rows.slice(0, MAX_ROWS).map(materialLine).join("\n");
    }
    case "howto":
      return HOWTO[intent.topic];
    case "help":
      return `Bunu anlayamadım. ${HELP}`;
  }
}

function materialLine(m: MaterialRow): string {
  const state = m.isCritical ? " (kritik)" : "";
  return `• ${link(m.code, "/stok/malzemeler", m.id)} ${m.name}: eldeki ${formatQty(m.onHandMilli, m.unit)}, kullanılabilir ${formatQty(m.availableMilli, m.unit)}${state}`;
}

async function answerCode(db: Db, code: string, now: Date): Promise<string> {
  const notFound = `${code} bulunamadı.`;
  if (code.startsWith("SIP-")) {
    const o = (await listOrders(db, { search: code, now })).find((r) => r.code === code);
    if (!o) return notFound;
    const late = o.overdue ? ", gecikmiş" : "";
    const wait = o.waitingMaterial ? ", malzeme bekliyor" : "";
    return `${link(o.code, "/satis/siparisler", o.id)} (${o.customerName}): ${ORDER_STATUS_LABEL[o.status]}${late}${wait}, termin ${formatDate(o.dueAt)}.`;
  }
  if (code.startsWith("IE-")) {
    const w = (await listWorkOrders(db, { search: code })).find((r) => r.code === code);
    if (!w) return notFound;
    const where = w.currentStation ? `, şu an ${w.currentStation}` : "";
    return `${link(w.code, "/uretim/is-emirleri", w.id)} (${w.productName}): ${WO_STATUS_LABEL[w.status]}${where}, ${w.doneSteps}/${w.totalSteps} adım bitti.`;
  }
  if (code.startsWith("SAS-")) {
    const p = (await listPurchaseOrders(db, { search: code, now })).find((r) => r.code === code);
    if (!p) return notFound;
    return `${link(p.code, "/satin-alma/siparisler", p.id)} (${p.supplierName}): ${PO_STATUS_LABEL[p.status]}${p.late ? ", gecikmiş" : ""}.`;
  }
  const m = (await listMaterials(db, { search: code })).find((r) => r.code === code);
  return m ? materialLine(m).slice(2) : notFound;
}
