import type { DepartmentCode, Level } from "@/domain/context";

export type SeedUser = { name: string; departmentCode: DepartmentCode; level: Level; title: string };

/** Demo hesapları. Hepsi kurgusaldır; gerçek kişilerle ilgisi yoktur. */
export const SEED_USERS: SeedUser[] = [
  { name: "Nermin Aksoy", departmentCode: "yonetim", level: "mudur", title: "Genel Müdür" },
  { name: "Tolga Erden", departmentCode: "satis", level: "mudur", title: "Satış Müdürü" },
  { name: "Elif Karaca", departmentCode: "satis", level: "uzman", title: "Satış Uzmanı" },
  { name: "Hakan Yıldırım", departmentCode: "planlama", level: "mudur", title: "Üretim Planlama Müdürü" },
  { name: "Zeynep Arıkan", departmentCode: "planlama", level: "uzman", title: "Planlama Uzmanı" },
  { name: "Murat Özkaya", departmentCode: "atolye", level: "mudur", title: "Atölye Şefi" },
  { name: "Cem Doğru", departmentCode: "atolye", level: "operator", title: "Montaj Ustası" },
  { name: "Sevgi Polat", departmentCode: "depo", level: "mudur", title: "Depo ve Sevkiyat Müdürü" },
  { name: "Onur Tekin", departmentCode: "depo", level: "uzman", title: "Depo Uzmanı" },
  { name: "Burak Şen", departmentCode: "depo", level: "operator", title: "Depo Görevlisi" },
  { name: "Ayla Güneş", departmentCode: "satinalma", level: "mudur", title: "Satın Alma Müdürü" },
  { name: "Kerem Uysal", departmentCode: "satinalma", level: "uzman", title: "Satın Alma Uzmanı" },
  { name: "Deniz Aydemir", departmentCode: "bt", level: "mudur", title: "Bilgi İşlem Müdürü" },
  { name: "Ece Korkmaz", departmentCode: "bt", level: "uzman", title: "Sistem Uzmanı" },
];

/** Bütün demo hesaplarının parolası. Giriş ekranında açıkça gösterilir. */
export const DEMO_PASSWORD = "Demo2026!";

export const DEMO_EMAIL_DOMAIN = "baltacioglus.example";

/** "Ayla Güneş" → "ayla.gunes@baltacioglus.example". */
export function demoEmail(name: string): string {
  const slug = name
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (ch) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[ch] ?? ch)
    .trim()
    .replace(/\s+/g, ".");
  return `${slug}@${DEMO_EMAIL_DOMAIN}`;
}
