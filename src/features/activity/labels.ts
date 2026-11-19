// İşlemler ekranının Türkçe etiketleri. React içermez; birim testi koddaki her işlem kodunun burada olduğunu denetler.

/** Kayıt türleri, süzgeç çiplerinin sırasıyla. */
export const ENTITY_LABEL = {
  sales_order: "Sipariş",
  customer: "Müşteri",
  work_order: "İş emri",
  product: "Ürün",
  material: "Malzeme",
  purchase_order: "Satın alma",
  supplier: "Tedarikçi",
  stock_count: "Sayım",
  user: "Kullanıcı",
} as const satisfies Record<string, string>;

export type EntityKind = keyof typeof ENTITY_LABEL;
export const ENTITY_KINDS = Object.keys(ENTITY_LABEL) as EntityKind[];

export function isEntityKind(value: string | null | undefined): value is EntityKind {
  return value !== null && value !== undefined && Object.hasOwn(ENTITY_LABEL, value);
}

export function entityLabel(entity: string): string {
  return isEntityKind(entity) ? ENTITY_LABEL[entity] : entity;
}

/**
 * `logAudit` işlem kodları. Aynı kod birden çok kayıt türünde aynı anlamdadır (ör. "reserve": malzeme ya da mamul ayırma).
 * Stok hareketlerinin kodları (receipt, issue, ...) hareket türünün kendisidir.
 */
export const ACTION_LABEL: Record<string, string> = {
  create: "Oluşturuldu",
  update: "Güncellendi",
  add_line: "Satır eklendi",
  update_line: "Satır güncellendi",
  remove_line: "Satır silindi",
  update_due: "Termin değişti",
  confirm: "Onaylandı",
  status: "Durum değişti",
  ship: "Sevk edildi",
  cancel: "İptal edildi",
  submit: "Onaya gönderildi",
  send: "Gönderildi",
  approve: "Onaylandı",
  receive: "Mal kabul",
  plan: "Planlandı",
  reserve_materials: "Malzeme ayrıldı",
  start: "Üretime başladı",
  step_start: "Adım başladı",
  step_finish: "Adım bitti",
  move_step: "Adım taşındı",
  complete: "Tamamlandı",
  receipt: "Stok girişi",
  issue: "Stok çıkışı",
  reserve: "Stok ayrıldı",
  unreserve: "Ayırma kaldırıldı",
  consume: "Üretimde tüketildi",
  count_line: "Sayım girildi",
  count_adjust: "Sayım farkı",
  production_in: "Üretimden giriş",
  activate: "Etkinleştirildi",
  deactivate: "Pasife alındı",
  set_item: "Fiyat güncellendi",
  remove_item: "Fiyat kaldırıldı",
  reset_password: "Parola sıfırlandı",
};

/** İşlemin Türkçe adı; bilinmeyen kod olduğu gibi döner. */
export function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABEL, action) ? (ACTION_LABEL[action] ?? action) : action;
}
