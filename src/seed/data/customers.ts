// Örnek müşteriler. Kişi ve firma adları kurgusaldır; kurumsal adlar gerçek bir firmaya benzemesin diye
// sıradan olmayan birleşimlerdir. İl ve ilçe çiftleri gerçektir. Telefonlar "0 5xx 000 00 NN" biçimindedir:
// ortadaki "000 00" gerçek bir abone numarasına denk gelmez (docs/DATA_SOURCES.md).
import type { NewCustomer } from "@/domain/sales/customers";

const phone = (operator: number, n: number) => `0 ${operator} 000 00 ${String(n).padStart(2, "0")}`;

type Spec = [name: string, city: string, district: string, operator: number, paymentTermDays?: number];

const PEOPLE: Spec[] = [
  ["Selin Yalçınkaya", "İstanbul", "Kadıköy", 532],
  ["Barış Ertürk", "Ankara", "Çankaya", 505],
  ["Gülşen Akbulut", "İzmir", "Karşıyaka", 542],
  ["Okan Tezcan", "Bursa", "Nilüfer", 533],
  ["Melis Kocabaş", "Antalya", "Muratpaşa", 555],
  ["Emre Sarıgül", "İstanbul", "Beşiktaş", 506],
  ["Damla Önal", "Eskişehir", "Tepebaşı", 543],
  ["Serkan Altıntaş", "Kocaeli", "İzmit", 535],
  ["Pınar Tunçel", "İstanbul", "Üsküdar", 507],
  ["Caner Ilıcalı", "Ankara", "Yenimahalle", 544],
  ["Gizem Ateşoğlu", "Mersin", "Yenişehir", 536],
  ["Volkan Demirtaş", "Konya", "Selçuklu", 552],
  ["Nihan Bozkurt", "İzmir", "Bornova", 538],
  ["Kaan Erbaşı", "Kayseri", "Melikgazi", 501],
  ["Aslı Yeğen", "Samsun", "Atakum", 546],
];

const COMPANIES: Spec[] = [
  ["Yedi Pencere Mimarlık", "İstanbul", "Şişli", 532, 30],
  ["Lacivert Kum Otelcilik", "Antalya", "Konyaaltı", 530, 60],
  ["Dört Kanat Ofis Mobilyaları", "Ankara", "Çankaya", 541, 45],
  ["Çınar Avlu Otelcilik", "Muğla", "Bodrum", 553, 60],
  ["Yamuk Pergel Mimarlık", "İzmir", "Konak", 539, 30],
  ["Ardıç Tepe Ofis Mobilyaları", "Bursa", "Osmangazi", 549, 45],
  ["Kırk Basamak İç Mimarlık", "İstanbul", "Beyoğlu", 534, 30],
  ["Kekik Yokuşu Otelcilik", "Çanakkale", "Ayvacık", 545, 30],
  ["Ölçü ve Oran Mimarlık", "Eskişehir", "Odunpazarı", 537, 45],
  ["Dokuz Raf Ofis Mobilyaları", "Gaziantep", "Şahinbey", 554, 60],
];

export const SEED_CUSTOMERS: NewCustomer[] = [
  ...PEOPLE.map(([name, city, district, operator], i) => ({
    name,
    kind: "bireysel" as const,
    city,
    district,
    phone: phone(operator, i + 1),
    paymentTermDays: 0,
  })),
  ...COMPANIES.map(([name, city, district, operator, term], i) => ({
    name,
    kind: "kurumsal" as const,
    city,
    district,
    phone: phone(operator, PEOPLE.length + i + 1),
    paymentTermDays: term ?? 30,
  })),
];
