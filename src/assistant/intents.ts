// Asistanın katalogu: kategoriler, seçenekler (niyetler) ve her niyetin serbest yazıda tanınacağı söyleyişler.
// Menü bu listeden çizilir; eşleştirici (match.ts) aynı listeyi kullanır. Yetki süzgeci tek yerdedir: `visibleIntents`.
import type { SessionUser } from "@/domain/context";
import { can, type Action, type Module } from "@/domain/permissions";

export type CategoryId = "satis" | "uretim" | "stok" | "satinalma" | "ozet" | "nasil";
export type IntentKind = "list" | "slot" | "link" | "guide" | "summary";
export type SlotEntity = "order" | "customer" | "material" | "supplier" | "workorder" | "product";

export type IntentDef = {
  id: string;
  label: string;
  category: CategoryId;
  kind: IntentKind;
  module: Module;
  /** Seçeneği görmek için gereken işlem; verilmezse görüntüleme. */
  action?: Action;
  /**
   * Serbest yazıda tanıma söyleyişleri (Türkçe harf ve büyük-küçük harf gözetilmez). Sözcükler boşlukla ayrılır;
   * bir sözcükte "|" ile eş anlamlılar verilir. Söyleyişteki bütün sözcükler eşleşirse tam puan alır.
   */
  phrases: string[];
  /** Boşluk doldurma: asistanın sorduğu soru. */
  prompt?: string;
  entity?: SlotEntity;
  href?: string;
  linkLabel?: string;
  steps?: string[];
  /** Cevaptan sonra önerilen seçenekler. */
  next: string[];
};

export const CATEGORIES: { id: CategoryId; label: string; module: Module; blurb: string }[] = [
  { id: "satis", label: "Satış", module: "sales", blurb: "Sipariş ve müşteri" },
  { id: "uretim", label: "Üretim", module: "planning", blurb: "İş emri ve plan" },
  { id: "stok", label: "Stok", module: "inventory", blurb: "Malzeme ve hareket" },
  { id: "satinalma", label: "Satın alma", module: "purchasing", blurb: "Sipariş ve teslim" },
  { id: "ozet", label: "Özet", module: "reports", blurb: "Günün durumu" },
  { id: "nasil", label: "Nasıl yapılır", module: "reports", blurb: "Adım adım rehber" },
];

export const INTENTS: IntentDef[] = [
  // Satış
  {
    id: "overdue_orders", label: "Geciken siparişler", category: "satis", kind: "list", module: "sales",
    phrases: ["geciken|gecikmis|gecikme|gecikmeli|gecikti siparis", "gec kalan siparis", "gec kalmis siparis", "termini gecen siparis", "termini gecmis siparis", "teslim edilmeyen siparis", "zamaninda teslim edilmeyen", "vadesi gecen siparis", "gecikenler siparis"],
    next: ["draft_orders", "waiting_orders"],
  },
  {
    id: "draft_orders", label: "Taslak siparişler", category: "satis", kind: "list", module: "sales",
    phrases: ["taslak siparis", "onay bekleyen siparis", "onaylanmamis siparis", "onaylanmayan siparis", "henuz onaylanmamis", "acik taslak"],
    next: ["overdue_orders", "order_lookup"],
  },
  {
    id: "waiting_orders", label: "Malzeme bekleyen siparişler", category: "satis", kind: "list", module: "sales",
    phrases: ["malzeme bekleyen siparis", "malzeme bekliyor siparis", "malzemesi eksik siparis", "eksik malzemeli siparis", "malzeme yuzunden bekleyen"],
    next: ["critical", "po_suggestions"],
  },
  {
    id: "order_lookup", label: "Sipariş sorgula", category: "satis", kind: "slot", module: "sales", entity: "order",
    phrases: ["siparis sorgula", "siparis ara", "siparis bul", "siparis durumu", "siparisi sorgula", "siparis"],
    prompt: "Sipariş kodu ya da müşteri adı yazın",
    next: ["overdue_orders", "customer_search"],
  },
  {
    id: "customer_search", label: "Müşteri ara", category: "satis", kind: "slot", module: "sales", entity: "customer",
    phrases: ["musteri ara", "musteri bul", "musteri sorgula", "musteri bilgisi", "musteri", "musteriler", "kim siparis verdi"],
    prompt: "Müşteri adı ya da kodu yazın",
    next: ["order_lookup", "overdue_orders"],
  },
  {
    id: "new_order", label: "Yeni sipariş aç", category: "satis", kind: "link", module: "sales", action: "write",
    phrases: ["yeni siparis", "siparis ac|olustur|gir|ekle|kaydet", "siparis yaz", "siparis olusturalim"],
    href: "/satis/siparisler?yeni=1", linkLabel: "Yeni sipariş ekranını aç",
    next: ["howto_order", "draft_orders"],
  },
  // Üretim
  {
    id: "today_wo", label: "Bugünün iş emirleri", category: "uretim", kind: "list", module: "planning",
    phrases: ["bugun is emir|emri", "bugunku is emir|emri", "bugun uretim", "bugun ne uretiliyor", "bugun atolye", "gunun is emir|emri", "bugun planli", "bugun yapilacak"],
    next: ["waiting_wo", "unscheduled_wo"],
  },
  {
    id: "unscheduled_wo", label: "Planlanmamış iş emirleri", category: "uretim", kind: "list", module: "planning",
    phrases: ["planlanmamis is emir|emri", "plansiz is emir|emri", "planlanmayan is emir|emri", "plani olmayan is emir|emri", "planlanmamis", "plansiz", "planlanacak is emir|emri"],
    next: ["plan_link", "waiting_wo"],
  },
  {
    id: "waiting_wo", label: "Malzeme bekleyenler", category: "uretim", kind: "list", module: "planning",
    phrases: ["malzeme bekleyen is emir|emri", "malzeme bekleyen uretim", "malzemesi eksik is emir|emri", "malzeme bekliyor is emir|emri", "malzeme bekleyenler uretim", "malzeme ayrilmamis"],
    next: ["critical", "po_suggestions"],
  },
  {
    id: "late_wo", label: "Termine yetişmeyenler", category: "uretim", kind: "list", module: "planning",
    phrases: ["termine yetismeyen|yetismeyecek|yetisemeyen", "termin asimi", "geciken is emir|emri", "gecikmis is emir|emri", "termini gecen is emir|emri", "yetismeyen is emir|emri", "yetismeyen uretim"],
    next: ["overdue_orders", "plan_link"],
  },
  {
    id: "wo_lookup", label: "İş emri sorgula", category: "uretim", kind: "slot", module: "planning", entity: "workorder",
    phrases: ["is emri sorgula", "is emir|emri ara", "is emir|emri bul", "is emri durumu", "is emir|emri"],
    prompt: "İş emri kodu, ürün adı ya da sipariş kodu yazın",
    next: ["today_wo", "waiting_wo"],
  },
  {
    id: "plan_link", label: "Haftalık plan", category: "uretim", kind: "link", module: "planning",
    phrases: ["haftalik plan", "uretim plani", "plan ekrani", "kapasite", "takvim", "uretim takvimi"],
    href: "/uretim/plan", linkLabel: "Haftalık planı aç",
    next: ["unscheduled_wo", "today_wo"],
  },
  // Stok
  {
    id: "critical", label: "Kritik stok", category: "stok", kind: "list", module: "inventory",
    phrases: ["kritik stok", "kritik malzeme", "kritik", "azalan stok|malzeme", "azalan", "ne bitti", "bitti", "bitmek uzere", "bitmek uzere olan", "eksik malzeme", "eksik stok", "stok azaldi|azaliyor", "yetersiz stok", "tukenen|tukenmek stok|malzeme", "siparis noktasi", "stogu azalan", "ne eksik"],
    next: ["po_suggestions", "material_search"],
  },
  {
    id: "material_search", label: "Malzeme ara", category: "stok", kind: "slot", module: "inventory", entity: "material",
    phrases: ["malzeme ara", "malzeme bul", "malzeme sorgula", "malzeme", "stok sorgula", "stok", "stogu", "stoku", "stoklar"],
    prompt: "Malzeme adı ya da kodu yazın",
    next: ["critical", "recent_movements"],
  },
  {
    id: "recent_movements", label: "Son stok hareketleri", category: "stok", kind: "list", module: "inventory",
    phrases: ["son stok hareket", "stok hareket", "son hareket", "son giris cikis", "hareketler", "ne girdi ne cikti", "son islemler stok"],
    next: ["critical", "material_search"],
  },
  {
    id: "product_stock", label: "Ürün stoğu", category: "stok", kind: "slot", module: "inventory", entity: "product",
    phrases: ["urun stok", "urun stogu", "mamul stok", "mamul stogu", "urun ara", "urun sorgula", "urun bul", "hazir urun", "urun", "mamul"],
    prompt: "Ürün adı ya da kodu yazın",
    next: ["material_search", "critical"],
  },
  {
    id: "count_link", label: "Sayım", category: "stok", kind: "link", module: "inventory",
    phrases: ["sayim", "stok sayimi", "sayim yap", "sayim fisi", "envanter sayimi"],
    href: "/stok/sayim", linkLabel: "Sayım ekranını aç",
    next: ["howto_count", "critical"],
  },
  // Satın alma
  {
    id: "po_pending", label: "Onay bekleyenler", category: "satinalma", kind: "list", module: "purchasing",
    phrases: ["onay bekleyen satin alma", "onay bekleyen sas", "onay bekleyen tedarik", "onay bekleyen", "onay bekliyor", "onayimi bekleyen", "onaylanacak satin alma", "onaylanacak"],
    next: ["po_suggestions", "po_late"],
  },
  {
    id: "po_suggestions", label: "Satın alma önerileri", category: "satinalma", kind: "list", module: "purchasing",
    phrases: ["satin alma onerisi|oneri|onerileri", "ne satin almaliyiz", "ne almaliyiz", "ne siparis vermeliyiz", "hangi malzeme siparis", "tedarik onerisi|oneri", "satin alinacak", "oneriler", "neyi satin almali"],
    next: ["po_pending", "critical"],
  },
  {
    id: "po_late", label: "Geciken teslimler", category: "satinalma", kind: "list", module: "purchasing",
    phrases: ["geciken|gecikmis|gecikme teslim|teslimat|tedarik|tedarikci", "gec gelen malzeme", "gec gelen siparis", "teslim gecikti", "gecikmis satin alma", "gelmeyen malzeme", "gelmeyen siparis", "gec teslim"],
    next: ["receivable", "supplier_search"],
  },
  {
    id: "receivable", label: "Mal kabul bekleyenler", category: "satinalma", kind: "list", module: "purchasing",
    phrases: ["mal kabul bekleyen", "mal kabul", "teslim alinacak", "teslim bekleyen", "yoldaki siparis", "yolda olan", "gelecek malzeme", "gelecek siparis", "ne gelecek", "kabul bekleyen"],
    next: ["po_late", "howto_receiving"],
  },
  {
    id: "supplier_search", label: "Tedarikçi ara", category: "satinalma", kind: "slot", module: "purchasing", entity: "supplier",
    phrases: ["tedarikci ara", "tedarikci bul", "tedarikci sorgula", "tedarikci", "tedarikciler", "saticidan", "firma ara"],
    prompt: "Tedarikçi adı ya da kodu yazın",
    next: ["po_pending", "po_late"],
  },
  // Özet
  {
    id: "summary", label: "Günün özeti", category: "ozet", kind: "summary", module: "reports",
    phrases: ["gunun ozeti", "gun ozeti", "ozet", "durum ozeti", "genel durum", "bugun ne var", "durum nedir", "ne durumdayiz", "rapor", "genel bakis", "gunluk durum"],
    next: ["overdue_orders", "critical"],
  },
  // Nasıl yapılır
  {
    id: "howto_order", label: "Sipariş nasıl açılır?", category: "nasil", kind: "guide", module: "reports",
    phrases: ["siparis nasil", "nasil siparis", "siparis acmak|acilir|acarim|olusturmak|verilir|girilir|olusturulur", "siparis rehberi"],
    steps: ["Siparişler ekranında “Yeni sipariş” düğmesine basın.", "Müşteriyi ve terminini seçin; taslak açılır.", "Çekmecede ürün satırlarını ekleyin.", "“Onayla” deyin: eldeki mamul ayrılır, kalan adet için iş emri açılır.", "Bunun için Satış departmanında uzman olmanız gerekir."],
    href: "/satis/siparisler", linkLabel: "Siparişler ekranına git",
    next: ["new_order", "howto_plan"],
  },
  {
    id: "howto_plan", label: "İş emri nasıl planlanır?", category: "nasil", kind: "guide", module: "reports",
    phrases: ["is emri nasil", "is emir|emri nasil planlanir|planlarim", "nasil planlarim", "plan nasil", "planlama nasil", "planla nasil"],
    steps: ["İş emirleri ekranında kaydı açın.", "“Planla” ile başlangıç gününü seçin; adımlar istasyon kapasitesine göre günlere dağılır.", "Haftalık plan ekranında kartları sürükleyerek günü değiştirebilirsiniz."],
    href: "/uretim/is-emirleri", linkLabel: "İş emirlerine git",
    next: ["plan_link", "howto_purchase"],
  },
  {
    id: "howto_purchase", label: "Satın alma nasıl yapılır?", category: "nasil", kind: "guide", module: "reports",
    phrases: ["satin alma nasil", "nasil satin alirim", "tedarik nasil", "satin alma yapmak|yapilir|yapmak", "satin alma rehberi", "taslak nasil"],
    steps: ["Öneriler ekranına bakın: kritik stok ve malzeme bekleyen iş emirleri tedarikçiye göre gruplanır.", "Bir grubun taslağını açın.", "Satın alma siparişleri ekranında siparişi gönderin.", "Tutar eşiği aşarsa müdür onayı istenir."],
    href: "/satin-alma/oneriler", linkLabel: "Önerilere git",
    next: ["po_suggestions", "howto_receiving"],
  },
  {
    id: "howto_receiving", label: "Mal kabul nasıl yapılır?", category: "nasil", kind: "guide", module: "reports",
    phrases: ["mal kabul nasil", "nasil mal kabul", "teslim nasil alinir", "irsaliye nasil", "mal kabul yapmak|yapilir", "malzeme nasil teslim"],
    steps: ["Mal kabul ekranında gönderilmiş siparişi seçin.", "Gelen miktarları ve irsaliye numarasını girin.", "“Mal kabul et” deyin; stok bu işlemle artar.", "Depo departmanında yetki gerekir."],
    href: "/depo/mal-kabul", linkLabel: "Mal kabule git",
    next: ["receivable", "howto_count"],
  },
  {
    id: "howto_count", label: "Sayım nasıl yapılır?", category: "nasil", kind: "guide", module: "reports",
    phrases: ["sayim nasil", "nasil sayim", "sayim yapmak|yapilir", "sayim rehberi", "stok nasil sayilir"],
    steps: ["Sayım ekranında “Yeni sayım” ile fiş açın.", "Sayılan miktarları girin.", "Fişi kapatın; fark varsa stok hareketi olarak yazılır."],
    href: "/stok/sayim", linkLabel: "Sayıma git",
    next: ["count_link", "howto_order"],
  },
  {
    id: "howto_user", label: "Kullanıcı nasıl eklenir?", category: "nasil", kind: "guide", module: "users",
    phrases: ["kullanici nasil", "kullanici eklemek|eklenir|ekle", "yeni kullanici", "hesap nasil acilir", "personel ekle", "kullanici ac"],
    steps: ["Kullanıcılar ekranında “Yeni kullanıcı” düğmesine basın.", "Ad, e-posta, departman ve düzeyi girin.", "Kaydedin; kişi geçici parolayla girebilir."],
    href: "/yonetim/kullanicilar", linkLabel: "Kullanıcılara git",
    next: ["howto_order", "summary"],
  },
];

export const INTENT_BY_ID = new Map(INTENTS.map((i) => [i.id, i]));

type Who = Pick<SessionUser, "departmentCode" | "level">;

/** Kullanıcının görebileceği seçenekler (yetki süzgeci). */
export function visibleIntents(user: Who, category?: CategoryId): IntentDef[] {
  return INTENTS.filter((i) => (!category || i.category === category) && can(user, i.module, i.action ?? "view"));
}

/** Ana menüde gösterilecek kategoriler: görme yetkisi olan ve en az bir seçeneği kalan. */
export function visibleCategories(user: Who) {
  return CATEGORIES.filter((c) => can(user, c.module, "view") && visibleIntents(user, c.id).length > 0);
}

/** Cevaptan sonra önerilen seçenekler; kullanıcının göremediği seçenek düşer. */
export function followUps(user: Who, id: string): IntentDef[] {
  const allowed = new Set(visibleIntents(user).map((i) => i.id));
  return (INTENT_BY_ID.get(id)?.next ?? []).filter((n) => allowed.has(n)).map((n) => INTENT_BY_ID.get(n)!);
}

/** Hiçbir şey anlaşılmadığında önerilen, herkesin işine yarayan seçenekler. */
export const FALLBACK_IDS = ["summary", "critical", "overdue_orders", "today_wo", "po_suggestions"];
