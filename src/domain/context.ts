import type { Db } from "@/db/client";

export const DEPARTMENT_NAMES = {
  yonetim: "Yönetim",
  satis: "Satış",
  planlama: "Üretim Planlama",
  atolye: "Atölye",
  depo: "Depo ve Sevkiyat",
  satinalma: "Satın Alma",
  bt: "Bilgi İşlem",
} as const;

export type DepartmentCode = keyof typeof DEPARTMENT_NAMES;

export const LEVEL_NAMES = { mudur: "Departman müdürü", uzman: "Uzman", operator: "Operatör" } as const;
export type Level = keyof typeof LEVEL_NAMES;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  title: string;
  departmentCode: DepartmentCode;
  level: Level;
};

/** Bir iş kuralının çalıştığı bağlam: veritabanı, işlemi yapan kullanıcı ve "şimdi". */
export type Ctx = { db: Db; user: SessionUser; now: Date };

/** `run`'ı tek transaction içinde çalıştırır; hata olursa hiçbir değişiklik kalmaz. İç içe çağrılabilir. */
export function inTx<T>(ctx: Ctx, run: (ctx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction((tx) => run({ ...ctx, db: tx }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
