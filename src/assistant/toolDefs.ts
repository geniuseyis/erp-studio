// Asistan araçlarının tanımı: sunucu bunları Claude'a verir, tarayıcı aynı adlarla çalıştırır (tools.ts).
// Yalnızca veri içerir; alan koduna bağımlılığı yoktur, böylece sunucu ucu veritabanı kodunu yüklemez.

export type ToolKind = "read" | "action";
export type ToolDef = {
  name: string;
  description: string;
  kind: ToolKind;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
};

const search = { type: "string", description: "Kod ya da ad parçası. Türkçe harf ve büyük-küçük harf fark etmez." };

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: "siparis_bul",
    kind: "read",
    description: "Satış siparişlerini kod ya da müşteri adıyla arar; durum, termin, tutar ve kayıt bağlantısı döner. En çok 10 kayıt.",
    input_schema: {
      type: "object",
      properties: {
        arama: search,
        durum: { type: "string", enum: ["draft", "confirmed", "in_production", "ready", "shipped", "cancelled"], description: "İsteğe bağlı durum süzgeci." },
        sadece_geciken: { type: "boolean", description: "Doğruysa yalnızca terminini geçmiş siparişler." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "is_emri_durumu",
    kind: "read",
    description: "İş emirlerini kod, ürün adı ya da sipariş koduyla arar; durum, istasyon, biten adım ve bağlantı döner. En çok 10 kayıt.",
    input_schema: {
      type: "object",
      properties: { arama: search, durum: { type: "string", enum: ["planned", "in_progress", "completed", "cancelled"] } },
      additionalProperties: false,
    },
  },
  {
    name: "malzeme_stok",
    kind: "read",
    description: "Malzemelerin eldeki, ayrılmış ve kullanılabilir stoğunu kod ya da adla arar; kritik olanları işaretler. En çok 10 kayıt.",
    input_schema: {
      type: "object",
      properties: { arama: search, sadece_kritik: { type: "boolean", description: "Doğruysa yalnızca sipariş noktasının altındakiler." } },
      additionalProperties: false,
    },
  },
  {
    name: "satin_alma_siparisleri",
    kind: "read",
    description: "Satın alma siparişlerini kod ya da tedarikçi adıyla arar. Onay bekleyenler için durum=pending_approval verilir. En çok 10 kayıt.",
    input_schema: {
      type: "object",
      properties: { arama: search, durum: { type: "string", enum: ["draft", "pending_approval", "sent", "partial", "received", "cancelled"] } },
      additionalProperties: false,
    },
  },
  {
    name: "oneri_ozeti",
    kind: "read",
    description: "Satın alma önerilerinin tedarikçi başına özeti: kalem sayısı, KDV hariç tutar, gereken onay. Taslak açmadan önce kullanılır.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "onayla_siparis",
    kind: "action",
    description: "Taslak bir satış siparişini onaylar. Kullanıcı önce onay kartını görür; Onayla demeden hiçbir şey değişmez.",
    input_schema: {
      type: "object",
      properties: { siparis_kodu: { type: "string", description: "Örnek: SIP-2026-0031" } },
      required: ["siparis_kodu"],
      additionalProperties: false,
    },
  },
  {
    name: "satin_alma_taslagi",
    kind: "action",
    description: "Bir tedarikçinin öneri grubundan satın alma siparişi taslağı açar. Kullanıcı önce onay kartını görür.",
    input_schema: {
      type: "object",
      properties: { tedarikci_kodu: { type: "string", description: "Örnek: TED-0003" } },
      required: ["tedarikci_kodu"],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name));
