import type { DepartmentCode, Level, SessionUser } from "./context";
import { DomainError } from "./errors";

export type Module = "sales" | "planning" | "shopfloor" | "inventory" | "purchasing" | "reports" | "users";
export type Action = "view" | "execute" | "write" | "approve";

/** Her departmanın işlem yapabildiği modüller. Yönetim hepsinin sahibidir. */
const OWNED: Record<DepartmentCode, readonly Module[]> = {
  yonetim: ["sales", "planning", "shopfloor", "inventory", "purchasing", "users"],
  satis: ["sales"],
  planlama: ["planning"],
  atolye: ["shopfloor"],
  depo: ["inventory"],
  satinalma: ["purchasing"],
  bt: ["users"],
};

/** Sahip olunan modülde düzeyin izin verdiği işlemler: operatör yürütür, uzman kayıt açar, müdür onaylar. */
const BY_LEVEL: Record<Level, readonly Action[]> = {
  operator: ["execute"],
  uzman: ["execute", "write"],
  mudur: ["execute", "write", "approve"],
};

type Who = Pick<SessionUser, "departmentCode" | "level">;

export function can(user: Who, module: Module, action: Action): boolean {
  const owns = OWNED[user.departmentCode].includes(module);
  if (action === "view") return module === "users" ? owns : true;
  if (!owns) return false;
  if (user.departmentCode === "yonetim") return true;
  return BY_LEVEL[user.level].includes(action);
}

export function assertCan(user: SessionUser, module: Module, action: Action): void {
  if (!can(user, module, action)) {
    throw new DomainError("FORBIDDEN", `${user.email}: ${module}:${action} yetkisi yok`);
  }
}
